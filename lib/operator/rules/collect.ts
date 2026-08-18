/**
 * COLLECT — the honest fallback, and a fallback only.
 *
 * This rule runs when nothing else fired at all. Not when the evidence was
 * merely inconclusive: a rapid window without confirmation is a WATCH, and
 * saying "gather more data" about a creative that is visibly deteriorating is
 * how a dashboard trains its reader to ignore it.
 *
 * So COLLECT is rare by construction, and it has to earn its card by being
 * specific. What is missing, on which creatives, and roughly when there will be
 * enough — computed from the actual shortfall, not asserted. If this is firing
 * often, the thresholds are wrong or the account is too thin to be graded, and
 * either way that is a bug to investigate rather than a state to narrate
 * around.
 */

import { RESULT_LABELS } from '@/lib/creative-status'
import { addDays, rangeLabel } from '@/lib/operator/dates'
import { collectEvidence, gapEvidence, money2 } from '@/lib/operator/evidence'
import { proposalFingerprint, subjectFingerprint } from '@/lib/operator/fingerprint'
import { assessStrength } from '@/lib/operator/strength'
import {
  emptyResult,
  SCORE_BANDS,
  THRESHOLDS,
  type EvaluatedCreative,
  type RuleContext,
  type RuleResult,
} from '@/lib/operator/rules/shared'
import type { Proposal } from '@/lib/operator/types'

/** Daily results across the complete window — the rate the shortfall closes at. */
function dailyResultRate(item: EvaluatedCreative): number {
  const { completeDays, totalPrimaryResults } = item.signals
  return completeDays > 0 ? totalPrimaryResults / completeDays : 0
}

/**
 * Roughly when this creative will have enough to judge. Returns null when it is
 * not converting at all — "never at this rate" is a different and more useful
 * message than a projected date built on a divide by zero.
 */
function daysUntilJudgeable(item: EvaluatedCreative): number | null {
  const resultsShort = Math.max(0, THRESHOLDS.winnerMinResults - item.signals.totalPrimaryResults)
  const daysShort = Math.max(0, THRESHOLDS.fatigueMinCompleteDays - item.signals.completeDays)
  const rate = dailyResultRate(item)
  if (resultsShort > 0 && rate <= 0) return null
  const byResults = resultsShort > 0 ? Math.ceil(resultsShort / rate) : 0
  return Math.max(byResults, daysShort)
}

/** Everything standing between this creative and a verdict, in plain words. */
function shortfalls(item: EvaluatedCreative): string[] {
  const out: string[] = []
  const s = item.signals
  const word = RESULT_LABELS[s.primaryResultType]

  if (s.completeDays < THRESHOLDS.fatigueMinCompleteDays) {
    out.push(
      `${s.completeDays} of ${THRESHOLDS.fatigueMinCompleteDays} complete delivery days`,
    )
  }
  if (s.totalPrimaryResults < THRESHOLDS.winnerMinResults) {
    out.push(`${s.totalPrimaryResults} of ${THRESHOLDS.winnerMinResults} ${word.many}`)
  }
  if (!item.baseline) {
    out.push('no cohort specific enough to compare against')
  } else if (item.baseline.fallbackLevel === 'account') {
    out.push('only an account-wide cohort to compare against')
  }
  if (!s.trends.ctr7v7.complete) {
    out.push(`no 7-day confirmation window (${s.trends.ctr7v7.reason ?? 'insufficient delivery'})`)
  }
  if (s.currentFrequency === null) {
    out.push('no range-level frequency for the current window')
  }
  return out
}

/**
 * Build the COLLECT card. Called by the orchestrator ONLY when every other rule
 * returned nothing, which is why this is a plain function rather than a `Rule`
 * in the array — its precondition is about the other rules, not about the data.
 */
export function collectProposal(ctx: RuleContext): RuleResult {
  const result = emptyResult()
  if (ctx.evaluated.length === 0) return result

  // Lead with the creative closest to being judgeable — that is the one whose
  // shortfall is worth naming, because it is the one about to become useful.
  const ranked = ctx.evaluated
    .map((item) => ({ item, eta: daysUntilJudgeable(item), gaps: shortfalls(item) }))
    .filter((r) => r.gaps.length > 0)
    .sort((a, b) => (a.eta ?? 999) - (b.eta ?? 999))

  const subjects = ranked.slice(0, 3)
  if (subjects.length === 0) return result

  const ids = subjects.map((r) => r.item.creative.id)
  const from = subjects.map((r) => r.item.signals.analysed.from).sort()[0]
  const to = subjects.map((r) => r.item.signals.analysed.to).sort().slice(-1)[0]
  const lead = subjects[0]

  const evidence = collectEvidence([
    gapEvidence({
      kind: 'collect_gap',
      short: 'Missing',
      label: `What ${lead.item.creative.name} is short of`,
      creativeIds: [lead.item.creative.id],
      displayValue: lead.gaps.join(' · '),
      comparisonValue:
        lead.eta === null
          ? 'not converting at a measurable rate — the shortfall does not close on its own'
          : `roughly ${lead.eta} more ${lead.eta === 1 ? 'day' : 'days'} of delivery at the current rate, around ${addDays(ctx.evaluationDate, lead.eta)}`,
      dateRange: { from: lead.item.signals.analysed.from, to: lead.item.signals.analysed.to },
    }),
    gapEvidence({
      kind: 'collect_scope',
      short: 'Coverage',
      label: 'Account coverage',
      creativeIds: ids,
      displayValue: `${ctx.evaluated.length} creatives analysed, none judgeable`,
      comparisonValue: `${money2(
        ctx.evaluated.reduce((s, e) => s + e.signals.totalSpend, 0),
      )} spend across ${rangeLabel(from, to)} · complete through ${ctx.maturity.completeThrough}`,
      dateRange: { from, to },
    }),
  ])

  const strength = assessStrength({
    signals: lead.item.signals,
    baseline: lead.item.baseline,
    comparableCreatives: lead.item.resolution.comparableCreatives,
    proposalType: 'COLLECT',
    supportingCreatives: 1,
    singleTest: true,
    targetCostPerResult: ctx.targetCostPerResult,
  })

  result.proposals.push({
    id: proposalFingerprint('COLLECT', ids, ctx.evaluationDate),
    subjectKey: subjectFingerprint('COLLECT', ids),
    type: 'COLLECT',
    subjectIds: ids,
    subjectNames: subjects.map((r) => r.item.creative.name),
    subjectLabel: lead.item.creative.name,
    score: SCORE_BANDS.collect.min,
    strength,
    evidence,
    params: { ...ctx.defaults, reviewInDays: Math.max(1, lead.eta ?? 7) },
    createdAt: ctx.evaluationDate,
    draftIntent: 'collect',
    fallback: {
      recommendation: `Let ${lead.item.creative.name} run`,
      short:
        lead.eta === null
          ? 'Not converting at a measurable rate, so nothing can be judged yet.'
          : 'Not enough delivery on the account yet to judge anything.',
      reasoning: `${lead.item.creative.name} is short of ${lead.gaps.join(' and ')}. ${
        lead.eta === null
          ? 'It is not converting at a measurable rate, so the shortfall will not close on its own.'
          : `At the current rate that closes in roughly ${lead.eta} ${lead.eta === 1 ? 'day' : 'days'}.`
      } No other creative on the account cleared a rule this run.`,
    },
  } satisfies Proposal)

  return result
}
