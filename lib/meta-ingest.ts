/**
 * Meta performance ingest — closes the learning loop with real spend data.
 *
 * Pulls ad-level insights from the Meta Marketing API (the same signed Graph
 * plumbing that powers the /meta dashboard), grades every ad with real spend
 * against its own account cohort, and logs the verdicts into
 * `campaign_outcomes` — the ORACLE memory the Campaign Reactor retrieves at
 * fire time. Winners are automatically re-ingested into the knowledge Vault as
 * proven patterns.
 *
 * PURCHASE FIRST. An account that records purchases is graded on what the
 * purchases returned — ROAS and cost per purchase against the account's own
 * medians — because an e-commerce ad that wins on clicks and loses on revenue
 * is a loser with a good thumbnail. Click-through grading remains for an
 * account with no purchase signal yet (no pixel, or too few purchases to
 * compare), and says so in the verdict's metric.
 *
 * ATTRIBUTION, three ways, in order: the Meta ad id (a re-sync), the RXN token
 * in the ad's name, and — new — the ASSET. Creatives are uploaded to the
 * brand's media library and the buyer builds the ad in Ads Manager under any
 * name they like, so the ad is matched back by the image hash or video id the
 * upload recorded. Without it, every ad built from an uploaded creative would
 * grade into memory as an orphan.
 *
 * SCOPED TO THE ACCOUNT. Every read and write here carries the account id: the
 * outcomes it matches against, the rows it writes, the winners it banks. An
 * ingest that read every account's pending rows could attribute one brand's ad
 * to another brand's upload.
 *
 * Idempotent: each Meta ad maps to at most one outcome row (keyed by
 * `attributes.metaAdId`). Never throws — every failure degrades to a summary.
 *
 * Credentials: the connection stored from the Meta Intelligence settings
 * screen first, META_ACCESS_TOKEN as the fallback. Optional env:
 * META_INGEST_MIN_SPEND (spend floor to judge an ad, default 50, account
 * currency), META_INGEST_DATE_PRESET (Graph date_preset, default last_30d).
 */

import {
  graphGet,
  listAccountIds,
  num,
  conversions,
  resultCount,
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
  /** Ads matched back to a creative uploaded from the platform. */
  attributed: number
  /** What the verdicts were graded on — purchases when the account records them. */
  gradedOn: 'purchases' | 'clicks'
  error?: string
}

/** The media an ad's creative is built from — what an upload is matched on. */
interface AdAssets {
  imageHashes: string[]
  videoIds: string[]
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
  purchases: number
  /** Cost per purchase. Zero when there were none. */
  cpa: number
  impressions: number
  assets: AdAssets
}

/** The account's own medians — what every ad is graded against. */
interface Cohort {
  ctr: number
  cpl: number
  roas: number
  cpa: number
  /** Ads in the cohort with at least one purchase. */
  purchasers: number
  size: number
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
    attributed: 0,
    gradedOn: 'clicks',
  }
}

/* ------------------------------- Grading ----------------------------------- */

function median(values: number[]): number {
  const v = values.filter((n) => n > 0).sort((a, b) => a - b)
  if (v.length === 0) return 0
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Purchases are compared only once enough ads have them to make a median mean something. */
const MIN_PURCHASERS = 3

export function purchaseGraded(cohort: Cohort): boolean {
  return cohort.purchasers >= MIN_PURCHASERS
}

/**
 * Grade one ad against its cohort.
 *
 * Purchase-graded when the account records purchases: a winner returns at
 * least break-even ROAS and beats the account median (or buys its purchases
 * far cheaper), on enough purchases to mean it; a loser spent double the floor
 * without a sale, or returns well under the median. Otherwise click-graded,
 * relative to the cohort median — with fewer than 3 eligible ads the medians
 * are noise, so absolute Meta benchmarks take over.
 */
export function gradeAd(ad: AdPerf, cohort: Cohort): Verdict {
  if (purchaseGraded(cohort)) {
    const strongRoas = ad.roas >= 1 && cohort.roas > 0 && ad.roas >= 1.3 * cohort.roas
    const goodRoas = ad.roas > 0 && cohort.roas > 0 && ad.roas >= cohort.roas
    const cheapCpa = ad.cpa > 0 && cohort.cpa > 0 && ad.cpa <= 0.75 * cohort.cpa
    const goodCpa = ad.cpa > 0 && cohort.cpa > 0 && ad.cpa <= cohort.cpa
    if ((strongRoas || (cheapCpa && ad.roas >= 1)) && ad.purchases >= 3) return 'winner'
    if ((goodRoas || goodCpa) && ad.purchases >= 1) return 'high_performer'
    if (ad.purchases === 0 && ad.spend >= 2 * minSpend()) return 'loser'
    if (ad.roas > 0 && cohort.roas > 0 && ad.roas <= 0.6 * cohort.roas) return 'loser'
    return 'average'
  }

  if (cohort.size < 3 || cohort.ctr === 0) {
    // Absolute fallback (CTR is in % as returned by the Graph API).
    if (ad.roas >= 3 || ad.ctr >= 2) return 'winner'
    if (ad.ctr >= 1.5) return 'high_performer'
    if (ad.ctr > 0 && ad.ctr <= 0.5) return 'loser'
    return 'average'
  }

  const strongCtr = ad.ctr >= 1.5 * cohort.ctr
  const goodCtr = ad.ctr >= 1.15 * cohort.ctr
  const weakCtr = ad.ctr > 0 && ad.ctr <= 0.6 * cohort.ctr
  const cheapCpl = ad.cpl > 0 && cohort.cpl > 0 && ad.cpl <= 0.7 * cohort.cpl
  const goodCpl = ad.cpl > 0 && cohort.cpl > 0 && ad.cpl <= cohort.cpl
  const expensiveCpl = ad.cpl > 0 && cohort.cpl > 0 && ad.cpl >= 1.6 * cohort.cpl

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

interface RawCreative {
  image_hash?: string
  video_id?: string
  object_story_spec?: {
    link_data?: { image_hash?: string; child_attachments?: { image_hash?: string; video_id?: string }[] }
    video_data?: { video_id?: string; image_hash?: string }
    photo_data?: { image_hash?: string }
  }
  asset_feed_spec?: { images?: { hash?: string }[]; videos?: { video_id?: string }[] }
}

/** Every image hash and video id a creative is built from — single, carousel or flexible. */
export function assetsOf(creative: RawCreative | undefined): AdAssets {
  const images = new Set<string>()
  const videos = new Set<string>()
  if (!creative) return { imageHashes: [], videoIds: [] }
  const addImage = (h?: string) => h && images.add(h)
  const addVideo = (v?: string) => v && videos.add(String(v))
  addImage(creative.image_hash)
  addVideo(creative.video_id)
  const story = creative.object_story_spec
  addImage(story?.link_data?.image_hash)
  for (const card of story?.link_data?.child_attachments ?? []) {
    addImage(card.image_hash)
    addVideo(card.video_id)
  }
  addVideo(story?.video_data?.video_id)
  addImage(story?.video_data?.image_hash)
  addImage(story?.photo_data?.image_hash)
  for (const img of creative.asset_feed_spec?.images ?? []) addImage(img.hash)
  for (const vid of creative.asset_feed_spec?.videos ?? []) addVideo(vid.video_id)
  return { imageHashes: Array.from(images), videoIds: Array.from(videos) }
}

/**
 * The assets behind every ad in the account. Best effort: a token without
 * read access to creatives still grades ads, it just cannot attribute them by
 * asset — the name token and the ad id still work.
 */
async function adAssetMap(accountId: string, token?: string): Promise<Map<string, AdAssets>> {
  const out = new Map<string, AdAssets>()
  let after: string | undefined
  for (let page = 0; page < 5; page++) {
    try {
      const json = (await graphGet(
        `act_${accountId}/ads`,
        {
          fields: 'id,creative{image_hash,video_id,object_story_spec,asset_feed_spec}',
          limit: '200',
          ...(after ? { after } : {}),
        },
        token,
      )) as {
        data?: { id?: string; creative?: RawCreative }[]
        paging?: { cursors?: { after?: string }; next?: string }
      }
      for (const ad of json.data ?? []) if (ad.id) out.set(ad.id, assetsOf(ad.creative))
      if (!json.paging?.next || !json.paging.cursors?.after) break
      after = json.paging.cursors.after
    } catch {
      break
    }
  }
  return out
}

function toPerf(row: InsightRow, assets: Map<string, AdAssets>): AdPerf | null {
  if (!row.ad_id) return null
  const spend = num(row.spend)
  const conv = conversions(row)
  const purchases = resultCount(row, 'purchase')
  return {
    adId: row.ad_id,
    name: row.ad_name || 'Untitled ad',
    campaign: row.campaign_name || 'Meta campaign',
    spend,
    ctr: num(row.ctr),
    cpl: conv > 0 ? spend / conv : 0,
    roas: roas(row),
    conversions: conv,
    purchases,
    cpa: purchases > 0 ? spend / purchases : 0,
    impressions: num(row.impressions),
    assets: assets.get(row.ad_id) ?? { imageHashes: [], videoIds: [] },
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
  /** Pending upload rows awaiting their live ad, keyed by variantId (RXN-…-B). */
  byVariant: Map<string, ExistingOutcome>
  /** Pending upload rows awaiting their live ad, keyed by the asset uploaded. */
  byImageHash: Map<string, ExistingOutcome>
  byVideoId: Map<string, ExistingOutcome>
}

// Index THIS account's outcome rows the sync cares about: those already keyed
// to a Meta ad id (idempotency), and pending rows pre-seeded at upload time
// that a synced ad can be matched to — by its name token or by its asset.
async function existingMetaOutcomes(accountId: string | null): Promise<ExistingIndex> {
  const index: ExistingIndex = {
    byAdId: new Map(),
    byVariant: new Map(),
    byImageHash: new Map(),
    byVideoId: new Map(),
  }
  if (!accountId) return index
  const { data, error } = await getSupabaseAdmin()
    .from('campaign_outcomes')
    .select('id, verdict, concept')
    .eq('builder_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  for (const r of (data ?? []) as { id: string; verdict: string; concept: ExistingOutcome['concept'] }[]) {
    const at = r.concept?.attributes
    const row: ExistingOutcome = { id: r.id, verdict: (r.verdict as Verdict) ?? 'pending', concept: r.concept }
    const adId = at?.metaAdId
    if (adId) {
      if (!index.byAdId.has(adId)) index.byAdId.set(adId, row)
      continue
    }
    // Only pre-seeded rows that have NOT yet been matched to a live ad.
    if (at?.variantId && !index.byVariant.has(at.variantId)) index.byVariant.set(at.variantId, row)
    if (at?.metaImageHash && !index.byImageHash.has(at.metaImageHash)) index.byImageHash.set(at.metaImageHash, row)
    if (at?.metaVideoId && !index.byVideoId.has(at.metaVideoId)) index.byVideoId.set(at.metaVideoId, row)
  }
  return index
}

/** Remove a claimed pending row from every index, so two ads can never both take it. */
function release(index: ExistingIndex, row: ExistingOutcome): void {
  for (const map of [index.byVariant, index.byImageHash, index.byVideoId]) {
    for (const [k, v] of Array.from(map.entries())) if (v.id === row.id) map.delete(k)
  }
}

/** The pending upload row this ad was built from, if any — by name token, then by asset. */
function claimPending(index: ExistingIndex, ad: AdPerf, token: TestToken | null): ExistingOutcome | undefined {
  const byToken = token?.variantId ? index.byVariant.get(token.variantId) : undefined
  const byAsset =
    byToken ??
    ad.assets.imageHashes.map((h) => index.byImageHash.get(h)).find(Boolean) ??
    ad.assets.videoIds.map((v) => index.byVideoId.get(v)).find(Boolean)
  if (byAsset) release(index, byAsset)
  return byAsset
}

/* -------------------------------- Sync ------------------------------------- */

function perfNotes(ad: AdPerf, cohort: Cohort): string {
  const parts = [
    `Auto-ingested from Meta (${datePreset()})`,
    `spend $${Math.round(ad.spend).toLocaleString()}`,
  ]
  if (purchaseGraded(cohort)) {
    parts.push(`${Math.round(ad.purchases)} purchase${Math.round(ad.purchases) === 1 ? '' : 's'}`)
    if (ad.cpa > 0) parts.push(`CPA $${ad.cpa.toFixed(2)}`)
    if (ad.roas > 0) parts.push(`ROAS ${ad.roas.toFixed(2)}x`)
    parts.push(`CTR ${ad.ctr.toFixed(2)}%`)
  } else {
    parts.push(`CTR ${ad.ctr.toFixed(2)}%`)
    if (ad.cpl > 0) parts.push(`CPL $${ad.cpl.toFixed(2)}`)
    if (ad.roas > 0) parts.push(`ROAS ${ad.roas.toFixed(1)}x`)
    if (ad.conversions > 0) parts.push(`${Math.round(ad.conversions)} conversions`)
  }
  return parts.join(' · ')
}

function perfAttributes(ad: AdPerf, cohort: Cohort, token?: TestToken | null): OutcomeAttributes {
  // Blended "×-vs-account-average" score + volume confidence — the sortable
  // winner metric the Our Winners picker and ORACLE rank by. Purchase-graded
  // accounts blend ROAS and cost per purchase; others blend CTR and CPL.
  const purchases = purchaseGraded(cohort)
  const ws = computeWinnerScore(
    {
      ctr: ad.ctr,
      roas: ad.roas,
      cpl: purchases ? ad.cpa : ad.cpl,
      spend: ad.spend,
      impressions: ad.impressions,
    },
    { ctr: purchases ? 0 : cohort.ctr, roas: cohort.roas, cpl: purchases ? cohort.cpa : cohort.cpl },
  )
  return {
    platform: 'meta',
    assetType: 'Live Meta Ad',
    metaAdId: ad.adId,
    scoreConfidence: ws.confidence,
    // Attribution recovered from the ad name for ads that weren't pre-seeded at
    // upload time. Pre-seeded rows already carry the authoritative testId /
    // variantId + taxonomy — those are preserved by the merge in the sync and
    // are never overwritten by these.
    ...(token ? { testId: token.testId, variantId: token.variantId } : {}),
    metrics: {
      spend: Math.round(ad.spend * 100) / 100,
      ctr: Math.round(ad.ctr * 100) / 100,
      cpl: Math.round(ad.cpl * 100) / 100,
      roas: Math.round(ad.roas * 100) / 100,
      conversions: Math.round(ad.conversions),
      purchases: Math.round(ad.purchases),
      cpa: Math.round(ad.cpa * 100) / 100,
      impressions: Math.round(ad.impressions),
      winnerScore: ws.score,
    },
  }
}

/** The one metric a verdict is filed under — what it was actually graded on. */
function headlineMetric(ad: AdPerf, cohort: Cohort): { name: string; value: number; label: string } {
  return purchaseGraded(cohort)
    ? { name: 'ROAS', value: ad.roas, label: `ROAS: ${ad.roas.toFixed(2)}x` }
    : { name: 'CTR', value: ad.ctr, label: `CTR: ${ad.ctr.toFixed(2)}%` }
}

/**
 * Run one full performance sync for ONE account: Meta ads → graded verdicts →
 * that account's ORACLE memory. Winners flow on into its Vault. Never throws.
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
    const perAccount = await Promise.all(
      accountIds.map(async (id) => {
        const [rows, assets] = await Promise.all([
          adInsights(id, credentials.token).catch(() => [] as InsightRow[]),
          adAssetMap(id, credentials.token),
        ])
        return rows.map((r) => toPerf(r, assets)).filter((a): a is AdPerf => a !== null)
      }),
    )
    const ads = perAccount.flat()
    summary.scanned = ads.length

    const floor = minSpend()
    const eligible = ads.filter((a) => a.spend >= floor)
    summary.eligible = eligible.length
    if (eligible.length === 0) {
      summary.ok = true
      return summary
    }

    const cohort: Cohort = {
      ctr: median(eligible.map((a) => a.ctr)),
      cpl: median(eligible.map((a) => a.cpl)),
      roas: median(eligible.map((a) => a.roas)),
      cpa: median(eligible.map((a) => a.cpa)),
      purchasers: eligible.filter((a) => a.purchases > 0).length,
      size: eligible.length,
    }
    summary.gradedOn = purchaseGraded(cohort) ? 'purchases' : 'clicks'
    const existing = await existingMetaOutcomes(accountId)
    const supabase = getSupabaseAdmin()

    for (const ad of eligible) {
      const verdict = gradeAd(ad, cohort)
      if (WIN_VERDICTS.includes(verdict)) summary.winners += 1
      if (verdict === 'loser') summary.losers += 1

      // Attribution: a re-sync first (the ad id), then the upload this ad was
      // built from — by the RXN token in its name, or by the asset itself.
      const token = parseTestToken(ad.name)
      let prior = existing.byAdId.get(ad.adId)
      const enrichingPending = prior ? undefined : claimPending(existing, ad, token)
      if (enrichingPending) {
        prior = enrichingPending
        summary.attributed += 1
      }
      const metric = headlineMetric(ad, cohort)

      try {
        if (!prior) {
          await recordOutcome({
            angle: ad.campaign,
            concept: { type: 'Live Meta Ad', text: ad.name, basis: 'Meta Marketing API' },
            attributes: perfAttributes(ad, cohort, token),
            metricName: metric.name,
            metricValue: metric.value,
            verdict,
            builderId: accountId,
            notes: perfNotes(ad, cohort),
          })
          summary.created += 1
        } else if (prior.verdict !== verdict || enrichingPending) {
          // Merge order preserves the pre-seeded row's authoritative taxonomy +
          // test IDs + asset ids and its concept type/text; perfAttributes only
          // adds the ad id + measured metrics (and token attribution for
          // un-seeded ads).
          const mergedConcept = {
            ...(prior.concept ?? { type: 'Live Meta Ad', text: ad.name }),
            attributes: { ...(prior.concept?.attributes ?? {}), ...perfAttributes(ad, cohort, token) },
          }
          const { error } = await supabase
            .from('campaign_outcomes')
            .update({
              verdict,
              metric_name: metric.name,
              metric_value: metric.value,
              notes: perfNotes(ad, cohort),
              concept: mergedConcept,
            })
            .eq('id', prior.id)
            .eq('builder_id', accountId)
          if (error) throw error
          summary.updated += 1

          // Newly promoted to a win — feed it into the Vault like any winner.
          if (WIN_VERDICTS.includes(verdict) && !WIN_VERDICTS.includes(prior.verdict)) {
            const concept = prior.concept
            const what =
              concept?.type && concept.type !== 'Live Meta Ad' && concept.text
                ? `${concept.type}: ${concept.text}`
                : `Live Meta Ad: ${ad.name}`
            await ingestKnowledge({
              system: 'pattern',
              title: `Proven ${VERDICT_LABELS[verdict].toLowerCase()} — ${ad.campaign} (${metric.label})`,
              content: `${what}\n${perfNotes(ad, cohort)}\nVerified ${VERDICT_LABELS[verdict].toLowerCase()} for the ${ad.campaign} campaign.`,
              category: 'Live Meta Ad',
              builderId: accountId,
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
    const existing = await existingMetaOutcomes(accountId)
    return { ...base, syncedAds: existing.byAdId.size }
  } catch {
    return base
  }
}
