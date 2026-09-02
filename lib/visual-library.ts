// Visual library — the design side of the Knowledge Vault.
//
// Every ad SPARK reads is stored as a `creative` chunk with its full VisualDNA
// kept verbatim in `metadata.visualDna` (see storeCreativeDNA). This module
// reads those designs back and answers one question the Reactor asks on every
// run: "of every winning ad design we have banked, which one should THIS brief
// be built on?"
//
// The match is deliberately deterministic — token overlap over the brief, the
// angle, the audience and the requested placement, weighted by how well the
// design's own taxonomy lines up. No embedding call, no model call, no latency
// added to the front of a run. The orchestrator is still free to override the
// pick when the angle calls for a different design; this only guarantees it
// starts from a design that actually earned its scroll-stop.
//
// Never throws. With Supabase absent it returns nothing and the Reactor runs
// exactly as it does today.

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import type { VisualDNA } from '@/lib/spark'
import type { CreativeTaxonomy } from '@/lib/taxonomy'

/** A design banked in the Vault, ready to be rebuilt for a new brief. */
export interface StoredVisualReference {
  id: string
  title: string
  /** The creative pattern it was classified as, e.g. "Profit Leak". */
  pattern: string | null
  taxonomy?: CreativeTaxonomy
  summary: string
  visual: VisualDNA
  createdAt: string | null
}

interface ChunkRow {
  id: string
  title: string | null
  category: string | null
  content: string | null
  created_at: string | null
  metadata: Record<string, unknown> | null
}

function ready(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

/** A stored value is only a usable design if it carries placements + a layout. */
function isVisualDna(value: unknown): value is VisualDNA {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<VisualDNA>
  return typeof v.layout === 'string' && Array.isArray(v.elements) && Array.isArray(v.palette)
}

/**
 * Every ad design banked in the Vault, newest first.
 *
 * One row per chunk, and a long teardown is chunked — so designs are de-duped
 * by title, keeping the newest copy of each.
 */
export async function listVisualReferences(limit = 60): Promise<StoredVisualReference[]> {
  if (!ready()) return []

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('knowledge_chunks')
      .select('id, title, category, content, created_at, metadata')
      // `creative` is included for designs banked before the visual section
      // existed — they carry the same metadata and are still perfectly good.
      .in('system', ['design', 'creative'])
      .eq('metadata->>visual', 'true')
      .order('created_at', { ascending: false })
      .limit(limit * 3)
    if (error) throw error

    const seen = new Set<string>()
    const refs: StoredVisualReference[] = []

    for (const row of (data ?? []) as ChunkRow[]) {
      const meta = row.metadata ?? {}
      const visual = meta.visualDna
      if (!isVisualDna(visual)) continue

      const title = row.title?.trim() || 'Untitled ad'
      if (seen.has(title)) continue
      seen.add(title)

      refs.push({
        id: row.id,
        title,
        pattern: typeof meta.pattern === 'string' ? meta.pattern : row.category,
        taxonomy: (meta.taxonomy as CreativeTaxonomy | null) ?? undefined,
        summary:
          typeof meta.summary === 'string' && meta.summary.trim()
            ? meta.summary.trim()
            : (row.content ?? '').split('\n')[0]?.slice(0, 160) ?? '',
        visual,
        createdAt: row.created_at,
      })
      if (refs.length >= limit) break
    }

    return refs
  } catch (err) {
    console.error('Visual library read failed:', err)
    return []
  }
}

/* -------------------------------- Matching --------------------------------- */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'they', 'them', 'their', 'have', 'has',
  'are', 'was', 'were', 'you', 'your', 'our', 'not', 'but', 'all', 'any', 'can', 'who', 'what',
  'how', 'why', 'get', 'got', 'out', 'about', 'into', 'more', 'most', 'preference', 'decides',
  'agent', 'none',
])

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
}

/** What the run is trying to make — everything the pick is scored against. */
export interface VisualBrief {
  angle?: string | null
  brief?: string | null
  audience?: string | null
  outputs?: string[]
  /** Placement ratio the run will render at, e.g. "1:1", "4:5", "9:16". */
  aspectRatio?: string | null
  taxonomy?: CreativeTaxonomy
}

function briefText(brief: VisualBrief): string {
  return [
    brief.angle,
    brief.brief,
    brief.audience,
    ...(brief.outputs ?? []),
    ...Object.values(brief.taxonomy ?? {}),
  ]
    .filter((v): v is string => Boolean(v && v.trim()) && v !== 'No Preference' && v !== 'Agent decides')
    .join(' ')
}

/** The text of a reference that a brief can match against. */
function referenceText(ref: StoredVisualReference): string {
  return [
    ref.title,
    ref.pattern ?? '',
    ref.summary,
    ...Object.values(ref.taxonomy ?? {}).filter(Boolean),
    ref.visual.layout,
    ref.visual.imagery,
    ref.visual.scrollStopReason,
    ...ref.visual.elements.map((e) => `${e.element} ${e.text}`),
  ].join(' ')
}

/** A reference plus why it won, so telemetry can say more than "picked one". */
export interface VisualMatch {
  reference: StoredVisualReference
  score: number
  /**
   * The part of the score that is EVIDENCE THIS BRIEF, not design richness.
   *
   * Word overlap and taxonomy agreement say a design was aimed at the same
   * reader; element count only says the design was read thoroughly. Ranking can
   * use both, but the decision to auto-attach a reference at all must rest on
   * the first alone — a thoroughly-read ad for someone else's business is the
   * most dangerous thing in the Vault, not the best.
   */
  relevance: number
  /** Human-readable reason, e.g. "Profit Leak · 4:5 · matches profit, margin". */
  why: string
}

/**
 * How much real evidence of fit a design needs before the platform will attach
 * it to a run unasked.
 *
 * Two shared content words, or one taxonomy axis in common. Below that the pick
 * is not a match, it is whatever happens to sit at the top of an ordered list —
 * and `bestVisualReferenceFor` used to return exactly that, so a single
 * unrelated ad banked in the Vault became "PROVEN DESIGN — build the visual
 * concepts on it" on every subsequent run, carrying its subject matter into
 * campaigns that had nothing to do with it.
 *
 * Deliberately NOT satisfied by an aspect-ratio match: every 4:5 design in the
 * Vault shares a ratio with every 4:5 brief, which is a fact about Meta's
 * placements, not about this campaign.
 */
export const MIN_VISUAL_RELEVANCE = 4

/**
 * Rank banked designs against a brief. Highest score first; ties broken by
 * recency, which is already the order `listVisualReferences` returns.
 */
export function rankVisualReferences(
  refs: StoredVisualReference[],
  brief: VisualBrief,
): VisualMatch[] {
  const wanted = new Set(tokens(briefText(brief)))
  const wantedRatio = brief.aspectRatio?.trim()
  const briefTax = brief.taxonomy ?? {}

  return refs
    .map((reference) => {
      const refTokens = new Set(tokens(referenceText(reference)))
      const shared = Array.from(wanted).filter((t) => refTokens.has(t))

      // Evidence that this design was aimed at THIS brief.
      let relevance = shared.length * 2
      // Everything else that makes one match rank above another.
      let bonus = 0
      const reasons: string[] = []

      // A design built for a different placement has to be re-laid-out, which
      // is exactly the work a proven layout is supposed to save. It orders
      // matches; it never establishes one (see MIN_VISUAL_RELEVANCE).
      if (wantedRatio && reference.visual.aspectRatio === wantedRatio) {
        bonus += 3
        reasons.push(wantedRatio)
      }

      // Taxonomy agreement is a stronger signal than loose word overlap: same
      // persona and same pain means the design was aimed at the same reader.
      for (const key of ['persona', 'painPoint', 'visualFormat', 'hookStyle'] as const) {
        const a = briefTax[key]
        const b = reference.taxonomy?.[key]
        if (a && b && a === b) {
          relevance += 4
          reasons.push(b)
        }
      }

      // A design with real placements is worth more than a thin one — it gives
      // the production brief more to rebuild from. Richness, not relevance.
      bonus += Math.min(3, reference.visual.elements.length / 3)

      if (shared.length) reasons.push(shared.slice(0, 3).join(', '))

      return {
        reference,
        score: relevance + bonus,
        relevance,
        why: [reference.pattern, ...reasons].filter(Boolean).join(' · ') || reference.title,
      }
    })
    .sort((a, b) => b.score - a.score)
}

/**
 * The best banked ad design for this brief, or null when the Vault has none.
 *
 * Used by the Reactor when the strategist hasn't attached a reference by hand:
 * rather than inventing a layout from scratch, it builds on the strongest
 * design already proven and stored.
 */
export async function bestVisualReferenceFor(brief: VisualBrief): Promise<VisualMatch | null> {
  const refs = await listVisualReferences()
  if (!refs.length) return null
  const best = rankVisualReferences(refs, brief)[0]
  // No match is a legitimate answer, and a far better one than the top of a
  // list. A run with no proven design simply invents its own layout, which is
  // what it did before the visual library existed; a run handed an irrelevant
  // one is told to build on it.
  if (!best || best.relevance < MIN_VISUAL_RELEVANCE) return null
  return best
}
