/**
 * ITERATE — a winner is running and it has not been pushed yet.
 *
 * The belief underneath this rule: winners have ceilings, and the only way to
 * find one is to walk into it. A creative comfortably inside its cohort median
 * with real volume behind it and delivery still healthy is not a thing to
 * admire, it is a thing to iterate on immediately and aggressively, because the
 * window in which it is cheap is finite and nobody knows how finite.
 *
 * The gate that matters most here is the provisional one. An ITERATE on results
 * that are still attributing is a variation brief written against numbers that
 * will have changed by the time it renders.
 */

import { RESULT_LABELS } from '@/lib/creative-status'
import {
  collectEvidence,
  costVsBaselineEvidence,
  costWord,
  frequencyEvidence,
  money2,
  nullWindowEvidence,
  signedPct,
  trendEvidence,
  volumeEvidence,
} from '@/lib/operator/evidence'
import { proposalFingerprint, subjectFingerprint } from '@/lib/operator/fingerprint'
import { definitiveVerdictBlocked } from '@/lib/operator/maturity'
import { assessStrength } from '@/lib/operator/strength'
import { rangeLabel } from '@/lib/operator/dates'
import {
  bandScore,
  changeOf,
  emptyResult,
  SCORE_BANDS,
  THRESHOLDS,
  type Rule,
  type RuleResult,
} from '@/lib/operator/rules/shared'
import type { Proposal } from '@/lib/operator/types'

export const iterateRule: Rule = (ctx): RuleResult => {
  const result = emptyResult()

  for (const item of ctx.evaluated) {
    const { signals: s, baseline, creative } = item

    // A winner is only a winner against something. No cohort, no claim.
    if (!baseline || s.costPerResultVsBaseline === null || s.costPerResult === null) continue
    if (s.costPerResultVsBaseline > THRESHOLDS.winnerCostRatio) continue
    if (s.totalPrimaryResults < THRESHOLDS.winnerMinResults) continue

    // Null-tolerant: an unresolved rapid window does not block an iteration,
    // it just means there is no evidence of slippage to weigh against it.
    const ctr3 = changeOf(s.trends.ctr3v3)
    if (ctr3 !== null && ctr3 <= THRESHOLDS.winnerMaxCtrSlipPct) continue

    // Results that are still landing cannot support a definitive conclusion.
    if (definitiveVerdictBlocked(creative.daily, ctx.maturity)) continue

    const evidence = collectEvidence([
      costVsBaselineEvidence(s, baseline),
      volumeEvidence(s, false),
      trendEvidence(s, s.trends.ctr3v3, {
        kind: 'ctr_rapid',
        label: 'Outbound CTR — last 3 complete days vs prior 3',
        goodWhen: 'up',
        unit: 'pct',
      }),
      trendEvidence(s, s.trends.cpr7v7, {
        kind: 'cost_confirm',
        label: `${RESULT_LABELS[s.primaryResultType].cost} — last 7 complete days vs prior 7`,
        goodWhen: 'down',
        unit: 'money',
      }),
      nullWindowEvidence(s, s.trends.cpr7v7, {
        kind: 'cost_confirm_null',
        label: `${RESULT_LABELS[s.primaryResultType].cost} — 7-day confirmation window`,
      }),
      frequencyEvidence(s),
    ])

    const strength = assessStrength({
      signals: s,
      baseline,
      comparableCreatives: item.resolution.comparableCreatives,
      proposalType: 'ITERATE',
      supportingCreatives: 1,
      targetCostPerResult: ctx.targetCostPerResult,
    })

    // How far inside the median it sits, mapped onto the band. A creative at
    // half the cohort cost tops out; one just inside the 0.8 gate sits low.
    const severity = (THRESHOLDS.winnerCostRatio - s.costPerResultVsBaseline) / 0.5
    const cheaperBy = Math.round((1 - s.costPerResultVsBaseline) * 100)
    const resultWord = RESULT_LABELS[s.primaryResultType]

    const proposal: Proposal = {
      id: proposalFingerprint('ITERATE', [creative.id], ctx.evaluationDate),
      subjectKey: subjectFingerprint('ITERATE', [creative.id]),
      type: 'ITERATE',
      subjectIds: [creative.id],
      subjectNames: [creative.name],
      score: bandScore(SCORE_BANDS.iterate, severity),
      strength,
      evidence,
      params: {
        ...ctx.defaults,
        hookDirection: creative.hookType,
        format: creative.format,
      },
      createdAt: ctx.evaluationDate,
      draftIntent: 'variations',
      fallback: {
        // Deliberately carries no variation count. The count lives in `params`,
        // where Edit can change it — baking it into the sentence produced a
        // brief whose headline said five while its spec said three.
        recommendation: `Build variations off ${creative.name}`,
        reasoning: [
          `${money2(s.costPerResult)} ${costWord(s.primaryResultType)} is ${cheaperBy}% inside the cohort median`,
          `on ${s.totalPrimaryResults} ${s.totalPrimaryResults === 1 ? resultWord.one.toLowerCase() : resultWord.many}`,
          `over ${s.completeDays} complete days (${rangeLabel(s.analysed.from, s.analysed.to)})`,
          ctr3 === null
            ? 'with no rapid-window slippage resolved either way'
            : `with outbound CTR ${signedPct(ctr3)} on the rapid window`,
        ].join(', ') + '.',
      },
    }

    result.proposals.push(proposal)
  }

  return result
}
