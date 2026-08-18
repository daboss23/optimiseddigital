// Performance Intelligence (ORACLE's memory layer). Logs how generated campaigns
// actually performed, feeds winners back into the knowledge layer as new
// patterns, and aggregates outcomes into pattern confidence — the mechanism that
// makes the Reactor compound intelligence over time.

import { getSupabaseAdmin } from '@/lib/supabase'
import { ingestKnowledge } from '@/lib/knowledge'
import type { AngleEvidence } from '@/lib/reactor-inputs'
import type { CreativeTaxonomy } from '@/lib/taxonomy'

export type Verdict = 'pending' | 'winner' | 'loser' | 'high_performer' | 'average' | 'unknown'

// Verdicts that count as a success and get re-ingested as retrievable patterns.
const WIN_VERDICTS: Verdict[] = ['winner', 'high_performer']

export const VERDICT_LABELS: Record<Verdict, string> = {
  winner: 'Winner',
  high_performer: 'High Performer',
  average: 'Average Performer',
  loser: 'Loser',
  unknown: 'Unknown',
  pending: 'Pending',
}

// Structured campaign attributes captured at outcome time. Optional — the MVP
// works with whatever is present, and the schema is ready for CTR/CPL/ROAS later.
export interface OutcomeAttributes {
  campaignType?: string
  audience?: string
  awareness?: string
  offer?: string
  pattern?: string
  creativeStructure?: string
  copyStructure?: string
  platform?: string
  assetType?: string
  // Full strategic configuration — what made this win, so ORACLE can reuse it.
  proofAssets?: string[]
  frameworks?: string[]
  // Live-performance ingest (Meta): the source ad and its measured metrics, so
  // synced outcomes are idempotent and ORACLE memory carries real numbers.
  metaAdId?: string
  metrics?: Record<string, number>
  // Clone & Iterate: the fixed taxonomy this concept was tagged with (the axis
  // values ORACLE groups by) and the test it belonged to. Stored inside the
  // concept jsonb like every other attribute here — no schema migration needed.
  taxonomy?: CreativeTaxonomy
  /** The isolation test this concept ran under, e.g. "RXN-42". */
  testId?: string
  /** This specific variant within the test, e.g. "RXN-42-B". */
  variantId?: string
  /** Which axis the test isolated (hook | persona | painPoint | visualFormat | assetType). */
  isolatedAxis?: string
  /**
   * Brief-configured variation attribution. `variationMethod` is the lever the
   * set was built on (hooks / angles / visual-execution / copy / smart-mix) and
   * `variationLabel` is the concrete difference THIS version carried.
   *
   * These exist alongside `isolatedAxis` rather than inside it because only two
   * of the levers map onto that closed axis list — filing an angle test under
   * "painPoint" would make the memory wrong in a way that is worse than having
   * no axis at all.
   */
  variationMethod?: string
  variationLabel?: string
  /** Confidence in the winner score, from spend + impression volume (low = thin data). */
  scoreConfidence?: 'low' | 'high'
}

/** A past winning strategic configuration retrieved from ORACLE memory. */
export interface WinningConfig {
  angle: string
  audience?: string
  awareness?: string
  offer?: string
  creativeStructure?: string
  copyStructure?: string
  pattern?: string
  score?: number
  conceptText: string
}

export interface OutcomeInput {
  angle: string
  concept: { type: string; text: string; basis?: string; attributes?: OutcomeAttributes }
  attributes?: OutcomeAttributes
  metricName?: string
  metricValue?: number
  verdict?: Verdict
  builderId?: string | null
  notes?: string
}

export interface OutcomeResult {
  ok: boolean
  logged: boolean
  reingested: boolean
  reason?: string
}

function dbConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
}

/**
 * ORACLE strategic memory: how many stored campaigns share an angle/pattern,
 * how many won, and the average win score. Powers the angle reasoning panel so a
 * recommendation cites real history. Degrades to null when Supabase is absent or
 * the angle has no memory yet (a genuinely new strategic configuration).
 */
export async function angleEvidence(angleOrPattern: string): Promise<AngleEvidence | null> {
  const needle = angleOrPattern.trim().toLowerCase()
  if (!needle || !dbConfigured()) return null
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('campaign_outcomes')
      .select('angle, verdict, concept')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error

    const rows = (data ?? []) as {
      angle: string | null
      verdict: string | null
      concept: { score?: number; attributes?: { pattern?: string } } | null
    }[]

    const overlaps = (a: string, b: string) => Boolean(a && b && (a.includes(b) || b.includes(a)))
    const matches = rows.filter((r) => {
      const a = (r.angle ?? '').toLowerCase()
      const p = (r.concept?.attributes?.pattern ?? '').toLowerCase()
      return overlaps(a, needle) || overlaps(p, needle)
    })
    if (matches.length === 0) return null

    const winners = matches.filter((m) => WIN_VERDICTS.includes((m.verdict ?? '') as Verdict))
    const scores = winners
      .map((w) => Number(w.concept?.score))
      .filter((n) => Number.isFinite(n)) as number[]
    const avg = scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null

    return {
      similar: matches.length,
      winners: winners.length,
      avgWinScore: avg === null ? null : Math.round(avg * 10) / 10,
    }
  } catch (err) {
    console.error('angleEvidence failed:', err)
    return null
  }
}

/**
 * ORACLE at fire time: retrieve past winning strategic configurations that match
 * the current brief, ranked by configuration overlap. OPUS incorporates these
 * into its reasoning so the Reactor reuses what worked instead of starting from
 * scratch — the shared-memory moat. Degrades to [] without Supabase.
 */
export async function retrieveWinningConfigs(
  input: { angle?: string; audience?: string; awareness?: string; offer?: string },
  limit = 3,
): Promise<WinningConfig[]> {
  if (!dbConfigured()) return []
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('campaign_outcomes')
      .select('angle, verdict, concept')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) throw error

    const rows = (data ?? []) as {
      angle: string | null
      verdict: string | null
      concept: {
        text?: string
        score?: number
        attributes?: OutcomeAttributes
      } | null
    }[]

    const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()
    const overlaps = (a: string, b: string) => Boolean(a && b && (a.includes(b) || b.includes(a)))
    const wantAngle = norm(input.angle)
    const wantAud = norm(input.audience)
    const wantAware = norm(input.awareness)
    const wantOffer = norm(input.offer)

    const scored = rows
      .filter((r) => WIN_VERDICTS.includes((r.verdict ?? '') as Verdict))
      .map((r) => {
        const at = r.concept?.attributes ?? {}
        let match = 0
        if (overlaps(norm(r.angle), wantAngle) || overlaps(norm(at.pattern), wantAngle)) match += 3
        if (overlaps(norm(at.audience), wantAud)) match += 1
        if (overlaps(norm(at.awareness), wantAware)) match += 1
        if (overlaps(norm(at.offer), wantOffer)) match += 1
        const config: WinningConfig = {
          angle: r.angle ?? at.campaignType ?? '—',
          audience: at.audience,
          awareness: at.awareness,
          offer: at.offer,
          creativeStructure: at.creativeStructure,
          copyStructure: at.copyStructure,
          pattern: at.pattern,
          score: typeof r.concept?.score === 'number' ? r.concept.score : undefined,
          conceptText: r.concept?.text ?? '',
        }
        return { config, match }
      })
      .filter((x) => x.match > 0)
      .sort((a, b) => b.match - a.match || (b.config.score ?? 0) - (a.config.score ?? 0))

    return scored.slice(0, limit).map((x) => x.config)
  } catch (err) {
    console.error('retrieveWinningConfigs failed:', err)
    return []
  }
}

export async function recordOutcome(input: OutcomeInput): Promise<OutcomeResult> {
  const verdict: Verdict = input.verdict ?? 'pending'
  const attributes = input.attributes ?? input.concept.attributes ?? {}
  // Fold the structured attributes into the concept jsonb so no schema migration
  // is required, while staying queryable for pattern confidence.
  const conceptRecord = { ...input.concept, attributes }

  if (!dbConfigured()) {
    return { ok: true, logged: false, reingested: false, reason: 'Supabase not configured' }
  }

  const { error } = await getSupabaseAdmin().from('campaign_outcomes').insert([
    {
      angle: input.angle,
      concept: conceptRecord,
      metric_name: input.metricName ?? null,
      metric_value: input.metricValue ?? null,
      verdict,
      builder_id: input.builderId ?? null,
      notes: input.notes ?? null,
    },
  ])
  if (error) throw error

  // Wins become new retrievable knowledge — the smartening loop.
  let reingested = false
  if (WIN_VERDICTS.includes(verdict)) {
    try {
      const metric = input.metricName ? ` (${input.metricName}: ${input.metricValue ?? '—'})` : ''
      const pattern = attributes.pattern ? `\nPattern: ${attributes.pattern}` : ''
      await ingestKnowledge({
        system: 'pattern',
        title: `Proven ${VERDICT_LABELS[verdict].toLowerCase()} — ${input.angle}${metric}`,
        content: `${input.concept.type}: ${input.concept.text}${input.concept.basis ? `\nGrounded in: ${input.concept.basis}` : ''}${pattern}\nVerified ${VERDICT_LABELS[verdict].toLowerCase()} for the ${input.angle} angle.`,
        category: attributes.pattern || input.concept.type,
        builderId: input.builderId ?? null,
        metadata: { source: 'campaign_outcome', verdict, attributes, metric: input.metricName },
      })
      reingested = true
    } catch (err) {
      console.error('Winner re-ingest failed:', err)
    }
  }

  return { ok: true, logged: true, reingested }
}

/* ----------------------------- Strategic memory --------------------------- */

export interface OutcomeRow {
  id: string
  created_at: string | null
  angle: string
  verdict: Verdict
  conceptType: string
  conceptText: string
  attributes: OutcomeAttributes
}

interface RawOutcome {
  id: string
  created_at: string | null
  angle: string
  verdict: string
  concept: { type?: string; text?: string; attributes?: OutcomeAttributes } | null
}

// Recent logged outcomes — powers the Performance Intelligence feed. Degrades to
// an empty list when Supabase isn't configured (page shows its empty state).
export async function listOutcomes(limit = 50): Promise<OutcomeRow[]> {
  if (!dbConfigured()) return []
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('campaign_outcomes')
      .select('id, created_at, angle, verdict, concept')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return (data as RawOutcome[]).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      angle: r.angle,
      verdict: (r.verdict as Verdict) ?? 'pending',
      conceptType: r.concept?.type ?? '—',
      conceptText: r.concept?.text ?? '',
      attributes: r.concept?.attributes ?? {},
    }))
  } catch (err) {
    console.error('listOutcomes failed:', err)
    return []
  }
}

/**
 * How a single variation lever has actually performed — the answer to "do
 * specific-dollar hooks beat problem hooks for this offer?".
 *
 * Grouped by the concrete per-version label rather than the lever alone: the
 * lever says what was tested, the label says which value won. Rows only appear
 * for outcomes that carry both, so a campaign fired before variations were
 * attributable contributes nothing here rather than diluting it.
 */
export interface VariationPerformance {
  method: string
  label: string
  wins: number
  total: number
  confidence: number
}

/**
 * Aggregate graded outcomes by the lever value that produced them.
 *
 * Distinct from `patternConfidence()`, which buckets by pattern/angle: two
 * versions of one campaign share a pattern, so a hook test's two rows cancel
 * out there into "this pattern won 50%" and teach nothing. Splitting on the
 * variation label is what makes a controlled set legible.
 */
export async function variationPerformance(): Promise<VariationPerformance[]> {
  const rows = await listOutcomes(500)
  const map = new Map<string, { method: string; label: string; wins: number; total: number }>()

  for (const r of rows) {
    const method = r.attributes.variationMethod
    const label = r.attributes.variationLabel
    if (!method || !label) continue
    const key = `${method}::${label}`
    const entry = map.get(key) ?? { method, label, wins: 0, total: 0 }
    entry.total += 1
    if (WIN_VERDICTS.includes(r.verdict)) entry.wins += 1
    map.set(key, entry)
  }

  return Array.from(map.values())
    .map((e) => ({ ...e, confidence: Math.round((e.wins / Math.max(e.total, 1)) * 100) }))
    .sort((a, b) => b.confidence - a.confidence || b.total - a.total)
}

export interface PatternConfidence {
  pattern: string
  wins: number
  total: number
  confidence: number
}

// Aggregate outcomes into per-pattern confidence: wins / total, weighted by the
// verdict. This is ORACLE's read on "what is most likely to work next".
export async function patternConfidence(): Promise<PatternConfidence[]> {
  const rows = await listOutcomes(500)
  if (rows.length === 0) return []

  const map = new Map<string, { wins: number; total: number }>()
  for (const r of rows) {
    const pattern = r.attributes.pattern || r.angle || 'Uncategorized'
    const entry = map.get(pattern) ?? { wins: 0, total: 0 }
    entry.total += 1
    if (WIN_VERDICTS.includes(r.verdict)) entry.wins += 1
    map.set(pattern, entry)
  }

  return Array.from(map.entries())
    .map(([pattern, { wins, total }]) => ({
      pattern,
      wins,
      total,
      confidence: Math.round((wins / Math.max(total, 1)) * 100),
    }))
    .sort((a, b) => b.confidence - a.confidence || b.total - a.total)
}
