/**
 * Meta performance ingest — closes the learning loop with real spend data.
 *
 * Pulls ad-level insights from the Meta Marketing API (the same signed Graph
 * plumbing that powers the /meta dashboard), grades every ad with real spend
 * against its own account cohort (CTR / CPL / ROAS vs the cohort median), and
 * logs the verdicts into `campaign_outcomes` — the ORACLE memory the Campaign
 * Reactor retrieves at fire time. Winners are automatically re-ingested into
 * the knowledge Vault as proven patterns via `recordOutcome`.
 *
 * Idempotent: each Meta ad maps to at most one outcome row (keyed by
 * `attributes.metaAdId`). Re-running the sync updates verdicts that changed
 * and skips everything else. Per CLAUDE.md it never throws — every failure
 * degrades to a summary the caller can surface.
 *
 * Credentials: the connection stored from the Meta Intelligence settings
 * screen first, META_ACCESS_TOKEN as the fallback (shared with the dashboard).
 * Optional env: META_INGEST_MIN_SPEND (spend floor to judge an ad, default 50,
 * account currency), META_INGEST_DATE_PRESET (Graph date_preset, default
 * last_30d).
 */

import {
  graphGet,
  listAccountIds,
  num,
  conversions,
  roas,
  type InsightRow,
} from '@/lib/meta-graph'
import { resolveMetaCredentials } from '@/lib/operator/adapters/meta-credentials'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ingestKnowledge } from '@/lib/knowledge'
import { parseTestToken, type TestToken } from '@/lib/meta-ads'
import { computeWinnerScore } from '@/lib/winner-score'
import {
  recordOutcome,
  VERDICT_LABELS,
  type OutcomeAttributes,
  type Verdict,
} from '@/lib/outcomes'

export interface MetaIngestSummary {
  configured: boolean
  ok: boolean
  /** Ads returned by the API across all accounts. */
  scanned: number
  /** Ads with enough spend to be judged (META_INGEST_MIN_SPEND floor). */
  eligible: number
  /** New outcome rows written to ORACLE memory. */
  created: number
  /** Existing rows whose verdict changed since the last sync. */
  updated: number
  winners: number
  losers: number
  /** Eligible ads already in memory with an unchanged verdict. */
  skipped: number
  error?: string
}

interface AdPerf {
  adId: string
  name: string
  campaign: string
  spend: number
  ctr: number
  cpl: number
  roas: number
  conversions: number
  impressions: number
}

function minSpend(): number {
  const raw = Number(process.env.META_INGEST_MIN_SPEND)
  return Number.isFinite(raw) && raw >= 0 ? raw : 50
}

function datePreset(): string {
  return process.env.META_INGEST_DATE_PRESET || 'last_30d'
}

function emptySummary(configured: boolean): MetaIngestSummary {
  return {
    configured,
    ok: false,
    scanned: 0,
    eligible: 0,
    created: 0,
    updated: 0,
    winners: 0,
    losers: 0,
    skipped: 0,
  }
}

/* ------------------------------- Grading ----------------------------------- */

function median(values: number[]): number {
  const v = values.filter((n) => n > 0).sort((a, b) => a - b)
  if (v.length === 0) return 0
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/**
 * Grade one ad against its cohort. Relative-to-median grading self-calibrates
 * to the account's vertical and objective; with fewer than 3 eligible ads the
 * medians are noise, so absolute Meta benchmarks take over.
 */
function gradeAd(ad: AdPerf, medCtr: number, medCpl: number, cohortSize: number): Verdict {
  if (cohortSize < 3 || medCtr === 0) {
    // Absolute fallback (CTR is in % as returned by the Graph API).
    if (ad.roas >= 3 || ad.ctr >= 2) return 'winner'
    if (ad.ctr >= 1.5) return 'high_performer'
    if (ad.ctr > 0 && ad.ctr <= 0.5) return 'loser'
    return 'average'
  }

  const strongCtr = ad.ctr >= 1.5 * medCtr
  const goodCtr = ad.ctr >= 1.15 * medCtr
  const weakCtr = ad.ctr > 0 && ad.ctr <= 0.6 * medCtr
  const cheapCpl = ad.cpl > 0 && medCpl > 0 && ad.cpl <= 0.7 * medCpl
  const goodCpl = ad.cpl > 0 && medCpl > 0 && ad.cpl <= medCpl
  const expensiveCpl = ad.cpl > 0 && medCpl > 0 && ad.cpl >= 1.6 * medCpl

  if (ad.roas >= 3 || (strongCtr && (cheapCpl || ad.conversions > 0))) return 'winner'
  if (goodCtr && (goodCpl || ad.conversions > 0)) return 'high_performer'
  if (weakCtr || expensiveCpl) return 'loser'
  return 'average'
}

const WIN_VERDICTS: Verdict[] = ['winner', 'high_performer']

/* ------------------------------ Live pull ---------------------------------- */

async function adInsights(accountId: string, token?: string): Promise<InsightRow[]> {
  const json = (await graphGet(
    `act_${accountId}/insights`,
    {
      level: 'ad',
      fields: 'ad_id,ad_name,campaign_name,spend,impressions,ctr,cpm,frequency,actions,purchase_roas',
      date_preset: datePreset(),
      limit: '200',
    },
    token,
  )) as { data?: InsightRow[] }
  return json.data ?? []
}

function toPerf(row: InsightRow): AdPerf | null {
  if (!row.ad_id) return null
  const spend = num(row.spend)
  const conv = conversions(row)
  return {
    adId: row.ad_id,
    name: row.ad_name || 'Untitled ad',
    campaign: row.campaign_name || 'Meta campaign',
    spend,
    ctr: num(row.ctr),
    cpl: conv > 0 ? spend / conv : 0,
    roas: roas(row),
    conversions: conv,
    impressions: num(row.impressions),
  }
}

/* ---------------------------- Existing memory ------------------------------ */

interface ExistingOutcome {
  id: string
  verdict: Verdict
  concept: { type?: string; text?: string; basis?: string; attributes?: OutcomeAttributes } | null
}

interface ExistingIndex {
  /** Rows already carrying a Meta ad id — the idempotency map for re-syncs. */
  byAdId: Map<string, ExistingOutcome>
  /** Pending push rows awaiting their live ad, keyed by variantId (RXN-…-B). */
  byVariant: Map<string, ExistingOutcome>
}

// Index the outcome rows the sync cares about: those already keyed to a Meta ad
// id (idempotency), and pending rows pre-seeded at creative-push time (keyed by
// variantId) that a synced ad's name token can now be matched to.
async function existingMetaOutcomes(): Promise<ExistingIndex> {
  const byAdId = new Map<string, ExistingOutcome>()
  const byVariant = new Map<string, ExistingOutcome>()
  const { data, error } = await getSupabaseAdmin()
    .from('campaign_outcomes')
    .select('id, verdict, concept')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  for (const r of (data ?? []) as { id: string; verdict: string; concept: ExistingOutcome['concept'] }[]) {
    const at = r.concept?.attributes
    const row: ExistingOutcome = { id: r.id, verdict: (r.verdict as Verdict) ?? 'pending', concept: r.concept }
    const adId = at?.metaAdId
    if (adId) {
      if (!byAdId.has(adId)) byAdId.set(adId, row)
    } else if (at?.variantId && !byVariant.has(at.variantId)) {
      // Only pre-seeded rows that have NOT yet been matched to a live ad.
      byVariant.set(at.variantId, row)
    }
  }
  return { byAdId, byVariant }
}

/* -------------------------------- Sync ------------------------------------- */

function perfNotes(ad: AdPerf): string {
  const parts = [
    `Auto-ingested from Meta (${datePreset()})`,
    `spend $${Math.round(ad.spend).toLocaleString()}`,
    `CTR ${ad.ctr.toFixed(2)}%`,
  ]
  if (ad.cpl > 0) parts.push(`CPL $${ad.cpl.toFixed(2)}`)
  if (ad.roas > 0) parts.push(`ROAS ${ad.roas.toFixed(1)}x`)
  if (ad.conversions > 0) parts.push(`${Math.round(ad.conversions)} conversions`)
  return parts.join(' · ')
}

function perfAttributes(
  ad: AdPerf,
  medCtr: number,
  medCpl: number,
  medRoas: number,
  token?: TestToken | null,
): OutcomeAttributes {
  // Blended "×-vs-account-average" score + volume confidence — the sortable
  // winner metric the Our Winners picker and ORACLE rank by.
  const ws = computeWinnerScore(
    { ctr: ad.ctr, roas: ad.roas, cpl: ad.cpl, spend: ad.spend, impressions: ad.impressions },
    { ctr: medCtr, roas: medRoas, cpl: medCpl },
  )
  return {
    platform: 'meta',
    assetType: 'Live Meta Ad',
    metaAdId: ad.adId,
    scoreConfidence: ws.confidence,
    // Attribution recovered from the ad name for ads that weren't pre-seeded at
    // push time (e.g. named by hand in Ads Manager). Pre-seeded rows already
    // carry the authoritative testId/variantId + taxonomy — those are preserved
    // by the merge in the sync and are never overwritten by these.
    ...(token ? { testId: token.testId, variantId: token.variantId } : {}),
    metrics: {
      spend: Math.round(ad.spend * 100) / 100,
      ctr: Math.round(ad.ctr * 100) / 100,
      cpl: Math.round(ad.cpl * 100) / 100,
      roas: Math.round(ad.roas * 100) / 100,
      conversions: Math.round(ad.conversions),
      impressions: Math.round(ad.impressions),
      winnerScore: ws.score,
    },
  }
}

/**
 * Run one full performance sync: Meta ads → graded verdicts → ORACLE memory.
 * Winners flow on into the knowledge Vault automatically. Never throws.
 */
export async function syncMetaPerformance(accountId: string | null): Promise<MetaIngestSummary> {
  const credentials = await resolveMetaCredentials(accountId)
  if (!credentials) {
    return {
      ...emptySummary(false),
      error: 'Meta is not connected — add a token on Meta Intelligence or set META_ACCESS_TOKEN',
    }
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ...emptySummary(true), error: 'Supabase not configured — nowhere to store outcomes' }
  }

  const summary = emptySummary(true)
  try {
    const accountIds = credentials.accountId
      ? [credentials.accountId]
      : await listAccountIds(credentials.token)
    const rows = (
      await Promise.all(accountIds.map((id) => adInsights(id, credentials.token).catch(() => [])))
    ).flat()
    const ads = rows.map(toPerf).filter((a): a is AdPerf => a !== null)
    summary.scanned = ads.length

    const floor = minSpend()
    const eligible = ads.filter((a) => a.spend >= floor)
    summary.eligible = eligible.length
    if (eligible.length === 0) {
      summary.ok = true
      return summary
    }

    const medCtr = median(eligible.map((a) => a.ctr))
    const medCpl = median(eligible.map((a) => a.cpl))
    const medRoas = median(eligible.map((a) => a.roas))
    const existing = await existingMetaOutcomes()
    const supabase = getSupabaseAdmin()

    for (const ad of eligible) {
      const verdict = gradeAd(ad, medCtr, medCpl, eligible.length)
      if (WIN_VERDICTS.includes(verdict)) summary.winners += 1
      if (verdict === 'loser') summary.losers += 1

      // Attribution: match a live ad to its test. First by ad id (re-syncs),
      // then by the RXN token in the ad name → a pending row pre-seeded at
      // creative-push time. Claiming a pending row removes it so two ads can't
      // both grab it in one run.
      const token = parseTestToken(ad.name)
      let prior = existing.byAdId.get(ad.adId)
      const enrichingPending = !prior && token?.variantId ? existing.byVariant.get(token.variantId) : undefined
      if (enrichingPending && token?.variantId) {
        existing.byVariant.delete(token.variantId)
        prior = enrichingPending
      }

      try {
        if (!prior) {
          await recordOutcome({
            angle: ad.campaign,
            concept: { type: 'Live Meta Ad', text: ad.name, basis: 'Meta Marketing API' },
            attributes: perfAttributes(ad, medCtr, medCpl, medRoas, token),
            metricName: 'CTR',
            metricValue: ad.ctr,
            verdict,
            notes: perfNotes(ad),
          })
          summary.created += 1
        } else if (prior.verdict !== verdict || enrichingPending) {
          // Merge order preserves the pre-seeded row's authoritative taxonomy +
          // test IDs and its concept type/text; perfAttributes only adds the ad
          // id + measured metrics (and token attribution for un-seeded ads).
          const mergedConcept = {
            ...(prior.concept ?? { type: 'Live Meta Ad', text: ad.name }),
            attributes: { ...(prior.concept?.attributes ?? {}), ...perfAttributes(ad, medCtr, medCpl, medRoas, token) },
          }
          const { error } = await supabase
            .from('campaign_outcomes')
            .update({
              verdict,
              metric_name: 'CTR',
              metric_value: ad.ctr,
              notes: perfNotes(ad),
              concept: mergedConcept,
            })
            .eq('id', prior.id)
          if (error) throw error
          summary.updated += 1

          // Newly promoted to a win — feed it into the Vault like any winner.
          if (WIN_VERDICTS.includes(verdict) && !WIN_VERDICTS.includes(prior.verdict)) {
            await ingestKnowledge({
              system: 'pattern',
              title: `Proven ${VERDICT_LABELS[verdict].toLowerCase()} — ${ad.campaign} (CTR: ${ad.ctr.toFixed(2)}%)`,
              content: `Live Meta Ad: ${ad.name}\n${perfNotes(ad)}\nVerified ${VERDICT_LABELS[verdict].toLowerCase()} for the ${ad.campaign} campaign.`,
              category: 'Live Meta Ad',
              builderId: null,
              metadata: { source: 'meta_ingest', verdict, metaAdId: ad.adId },
            }).catch((err) => console.error('Meta winner re-ingest failed:', err))
          }
        } else {
          summary.skipped += 1
        }
      } catch (err) {
        console.error(`Meta ingest failed for ad ${ad.adId}:`, err)
      }
    }

    summary.ok = true
    return summary
  } catch (err) {
    console.error('Meta performance sync failed:', err)
    summary.error = err instanceof Error ? err.message : 'Meta performance sync failed'
    return summary
  }
}

/** Status for the sync UI — configuration + how much Meta memory exists. */
export async function metaIngestStatus(accountId: string | null): Promise<{
  configured: boolean
  storageReady: boolean
  minSpend: number
  datePreset: string
  syncedAds: number
}> {
  const base = {
    configured: Boolean(await resolveMetaCredentials(accountId)),
    storageReady: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    minSpend: minSpend(),
    datePreset: datePreset(),
    syncedAds: 0,
  }
  if (!base.storageReady) return base
  try {
    const existing = await existingMetaOutcomes()
    return { ...base, syncedAds: existing.byAdId.size }
  } catch {
    return base
  }
}
