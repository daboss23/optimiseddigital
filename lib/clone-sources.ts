// Clone sources — the data behind the Ad Library dashboard's two tabs. "Our
// Winners" reads proven ads out of ORACLE memory (campaign_outcomes) with their
// real CTR/ROAS/winner-score and taxonomy so a strategist can clone what has
// actually worked. External ads come in via paste-to-DNA (see /api/clone/extract)
// which reuses SPARK's extractor — no second extractor here.
//
// Never throws; degrades to a small curated demo set so the tab always shows the
// experience with no keys, per the platform convention.

import { listOutcomes } from '@/lib/outcomes'
import { formatBand } from '@/lib/winner-score'
import type { CreativeTaxonomy } from '@/lib/taxonomy'
import { demoDataEnabled } from '@/lib/demo-mode'

const WIN = new Set(['winner', 'high_performer'])

export interface WinnerCard {
  id: string
  title: string
  conceptType: string
  conceptText: string
  metrics: { ctr?: number; roas?: number; spend?: number; winnerScore?: number }
  /** Display band for the winner score, e.g. "2.30x". */
  scoreBand: string
  scoreConfidence?: 'low' | 'high'
  taxonomy?: CreativeTaxonomy
  verdict: string
  /** True for the curated demo rows (no live data behind them). */
  demo?: boolean
}

function demoWinners(): WinnerCard[] {
  return [
    {
      id: 'demo-1',
      title: 'Profit Leak',
      conceptType: 'Founder Concept',
      conceptText:
        "Most builders don't have a profit problem — they have a profit leak. Founder walks a finished site and breaks down where the margin actually goes.",
      metrics: { ctr: 2.1, roas: 5.4, spend: 4200, winnerScore: 2.25 },
      scoreBand: '2.25x',
      scoreConfidence: 'high',
      taxonomy: {
        hookStyle: 'Contrarian',
        visualFormat: 'Expert Explainer',
        assetType: 'UGC Mashup',
        persona: 'Sub-$1M Builder',
        painPoint: 'Profit Leak',
      },
      verdict: 'winner',
      demo: true,
    },
    {
      id: 'demo-2',
      title: 'Time Freedom',
      conceptType: 'Testimonial Concept',
      conceptText:
        'Member states their old 70-hour weeks, the systems turning point, then the after — weekends back. B-roll of their jobs running without them.',
      metrics: { ctr: 1.8, roas: 4.1, spend: 3100, winnerScore: 1.72 },
      scoreBand: '1.72x',
      scoreConfidence: 'high',
      taxonomy: {
        hookStyle: 'Storytelling',
        visualFormat: 'Transformation',
        assetType: 'UGC Mashup',
        persona: 'Overwhelmed Owner',
        painPoint: 'No Time / Weekends Gone',
      },
      verdict: 'winner',
      demo: true,
    },
  ]
}

/**
 * Winning ads from ORACLE memory, ranked by winner score, for the "Our Winners"
 * clone tab. Returns curated demo rows when Supabase is absent or no winner is
 * logged yet so the tab is never a blank box.
 */
export async function getWinners(limit = 24): Promise<{ configured: boolean; winners: WinnerCard[] }> {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const rows = await listOutcomes(500)

  const winners: WinnerCard[] = rows
    .filter((r) => WIN.has(r.verdict))
    .map((r) => {
      const m = r.attributes.metrics ?? {}
      return {
        id: r.id,
        title: r.attributes.pattern || r.angle || r.conceptType,
        conceptType: r.conceptType,
        conceptText: r.conceptText,
        metrics: {
          ctr: typeof m.ctr === 'number' ? m.ctr : undefined,
          roas: typeof m.roas === 'number' ? m.roas : undefined,
          spend: typeof m.spend === 'number' ? m.spend : undefined,
          winnerScore: typeof m.winnerScore === 'number' ? m.winnerScore : undefined,
        },
        scoreBand: formatBand(typeof m.winnerScore === 'number' ? m.winnerScore : undefined),
        scoreConfidence: r.attributes.scoreConfidence,
        taxonomy: r.attributes.taxonomy,
        verdict: r.verdict,
      }
    })
    .sort((a, b) => (b.metrics.winnerScore ?? 0) - (a.metrics.winnerScore ?? 0))
    .slice(0, limit)

  // The curated winners are one business's ads. Offered as clone references on
  // a different deployment they are not just noise — the user clones them, and
  // the structure of someone else's campaign silently becomes theirs.
  if (winners.length === 0) {
    return { configured, winners: demoDataEnabled() ? demoWinners() : [] }
  }
  return { configured, winners }
}
