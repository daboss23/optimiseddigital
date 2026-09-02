// Best-performing taxonomy value per axis — what isolation mode locks the
// non-tested axes to, so a controlled test holds proven values fixed and varies
// only the one under test. Reads tagged outcomes from ORACLE memory, weighting
// by verdict + winner score; falls back to canonical defaults (demo / cold
// start) so the configurator always has sensible locks. Also surfaces the
// real persona/pain values discovered in history — together with the personas
// and pains ATLAS derived from the connected website — so the extensible axes
// offer what THIS business actually runs, not just the seed list. Never throws.

import { getSupabaseAdmin } from '@/lib/supabase'
import {
  AXIS_META,
  ITERATION_AXES,
  PAIN_POINT_SEEDS,
  PERSONA_SEEDS,
  defaultLockedTaxonomy,
  type CreativeTaxonomy,
} from '@/lib/taxonomy'
import { getConnectedWebsite } from '@/lib/website-intelligence'
import { currentAccount } from '@/lib/account'

const WIN = new Set(['winner', 'high_performer'])

export interface TaxonomyLocks {
  configured: boolean
  /** Best-known value per axis — the isolation lock defaults. */
  locks: CreativeTaxonomy
  /** Persona labels seen in real outcomes (seed ∪ discovered), for the picker. */
  personaOptions: string[]
  /** Pain-point labels seen in real outcomes (seed ∪ discovered). */
  painOptions: string[]
}

interface OutcomeLite {
  verdict: string
  concept: {
    attributes?: { taxonomy?: CreativeTaxonomy; metrics?: { winnerScore?: number } }
  } | null
}

function uniq(seed: readonly string[], discovered: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of seed.concat(discovered)) {
    const k = v.trim().toLowerCase()
    if (!v.trim() || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/**
 * Personas / pains ATLAS derived from the connected website. These lead the
 * menu because they describe THIS business's market; the built-in seeds stay
 * behind them so the axis is never empty and nothing a user already picked
 * disappears. Never throws — no site connected simply means no derived values.
 */
async function derivedAudienceAxes(): Promise<{ personas: string[]; pains: string[] }> {
  try {
    const site = await getConnectedWebsite(await currentAccount())
    return {
      personas: site?.strategyOptions?.personas ?? [],
      pains: site?.strategyOptions?.painPoints ?? [],
    }
  } catch {
    return { personas: [], pains: [] }
  }
}

export async function getTaxonomyLocks(): Promise<TaxonomyLocks> {
  const derived = await derivedAudienceAxes()
  const base: TaxonomyLocks = {
    configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    locks: defaultLockedTaxonomy(),
    personaOptions: uniq(derived.personas, [...PERSONA_SEEDS]),
    painOptions: uniq(derived.pains, [...PAIN_POINT_SEEDS]),
  }
  if (!base.configured) return base

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('campaign_outcomes')
      .select('verdict, concept')
      .limit(1000)
    if (error) throw error

    // Per axis-value tally: win-weighted score so the lock is the value that has
    // actually performed, not merely the most frequent.
    const tally: Record<string, Map<string, { score: number; n: number }>> = {}
    for (const axis of ITERATION_AXES) tally[axis] = new Map()
    const personas = new Set<string>()
    const pains = new Set<string>()

    for (const r of (data ?? []) as OutcomeLite[]) {
      const tax = r.concept?.attributes?.taxonomy
      if (!tax) continue
      const ws = r.concept?.attributes?.metrics?.winnerScore
      const weight = (WIN.has(r.verdict) ? 1 : 0) + (typeof ws === 'number' ? ws : 0)
      if (tax.persona) personas.add(tax.persona)
      if (tax.painPoint) pains.add(tax.painPoint)
      for (const axis of ITERATION_AXES) {
        const v = tax[AXIS_META[axis].key]
        if (!v) continue
        const m = tally[axis]
        const cur = m.get(v) ?? { score: 0, n: 0 }
        cur.score += weight
        cur.n += 1
        m.set(v, cur)
      }
    }

    const locks: CreativeTaxonomy = { ...base.locks }
    for (const axis of ITERATION_AXES) {
      let best: string | undefined
      let bestScore = -1
      for (const [v, s] of Array.from(tally[axis])) {
        // Win-weighted score, with a tiny frequency tiebreak.
        const sc = s.score + s.n * 0.01
        if (sc > bestScore) {
          bestScore = sc
          best = v
        }
      }
      if (best) locks[AXIS_META[axis].key] = best
    }

    return {
      configured: true,
      locks,
      personaOptions: uniq(derived.personas, [...PERSONA_SEEDS, ...Array.from(personas)]),
      painOptions: uniq(derived.pains, [...PAIN_POINT_SEEDS, ...Array.from(pains)]),
    }
  } catch (err) {
    console.error('getTaxonomyLocks failed:', err)
    return base
  }
}
