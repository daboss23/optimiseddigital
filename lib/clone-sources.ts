// Clone sources — the data behind the Ad Library dashboard's "Our Winners"
// tab, which reads proven ads out of ORACLE memory (campaign_outcomes) with their
// real CTR/ROAS/winner-score and taxonomy so a strategist can clone what has
// actually worked. External ads come in on the "Proven Ads" tab (lib/gethookd)
// or via paste-to-DNA (see /api/clone/extract), both of which reuse SPARK's
// extractor — no second extractor here.
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

/**
 * Curated demo rows for a deployment with no logged winners yet.
 *
 * They are written to THIS platform's ICP — service businesses and e-commerce —
 * and deliberately not to any one vertical. The previous set was a single
 * construction-coaching account's ads, which is worse than generic: a demo row
 * is a clone reference, so an operator in a different market would have cloned
 * another industry's campaign structure and never known where it came from.
 *
 * One lead-gen service ad, one service testimonial, one DTC product ad, so both
 * halves of the ICP are represented and neither reads as the default.
 */
function demoWinners(): WinnerCard[] {
  return [
    {
      id: 'demo-1',
      title: 'Empty Calendar',
      conceptType: 'Founder Concept',
      conceptText:
        "Most service businesses don't have a lead problem — they have a follow-up problem. Founder pulls up the CRM and shows where the enquiries actually die.",
      metrics: { ctr: 2.1, roas: 5.4, spend: 4200, winnerScore: 2.25 },
      scoreBand: '2.25x',
      scoreConfidence: 'high',
      taxonomy: {
        hookStyle: 'Contrarian',
        visualFormat: 'Expert Explainer',
        assetType: 'UGC Mashup',
        persona: 'Owner-Operator',
        painPoint: 'Leads Going Cold',
      },
      verdict: 'winner',
      demo: true,
    },
    {
      id: 'demo-2',
      title: 'Booked Solid',
      conceptType: 'Testimonial Concept',
      conceptText:
        'Client states the quiet months before, the one change they made, then the after — a calendar booked six weeks out. Screen recording of the booking system doing the work.',
      metrics: { ctr: 1.8, roas: 4.1, spend: 3100, winnerScore: 1.72 },
      scoreBand: '1.72x',
      scoreConfidence: 'high',
      taxonomy: {
        hookStyle: 'Storytelling',
        visualFormat: 'Review',
        assetType: 'UGC Mashup',
        persona: 'Service Business Owner',
        painPoint: 'Unpredictable Month-to-Month Revenue',
      },
      verdict: 'winner',
      demo: true,
    },
    {
      id: 'demo-3',
      title: 'Side By Side',
      conceptType: 'Static Creative',
      conceptText:
        'The product against what it replaces, shot in the same frame at the same scale. One line of copy naming the difference, price held back until the click.',
      metrics: { ctr: 2.6, roas: 3.8, spend: 5600, winnerScore: 1.94 },
      scoreBand: '1.94x',
      scoreConfidence: 'high',
      taxonomy: {
        hookStyle: 'Contrast',
        visualFormat: 'Transformation',
        assetType: 'Lifestyle-Product Image with Text',
        persona: 'Repeat DTC Buyer',
        painPoint: 'Paying More For Less',
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
