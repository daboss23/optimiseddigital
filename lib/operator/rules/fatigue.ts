/**
 * REPLACE / WATCH / RECOVERING — the fatigue rule.
 *
 * Fatigue is the most predictable phenomenon in the business and the most
 * consistently ignored. It has a shape: frequency climbing, CTR bleeding, cost
 * per result following. The shape does not lie.
 *
 * What DOES lie is the shape read too early. Three bad days is a weekend, a
 * competitor's promo, a tracking hiccup, or the start of a genuine decline, and
 * on day three there is no way to tell which. So this rule refuses to collapse
 * three different situations into one card:
 *
 * **CONFIRMED** — both windows deteriorating, directionally consistent, with
 * delivery saturating underneath it. This is a replacement, and it is the only
 * state that drafts a successor.
 *
 * **WATCH** — the rapid window has moved and the confirmation window has not
 * backed it up. This is a real, distinct state with its own card, its own
 * primary action (*Keep watching* — which creates nothing), and a hard cap
 * below STRONG. It exists because the alternative is either crying wolf or
 * saying nothing, and both are worse.
 *
 * **RECOVERING** — the long window looks bad and the short one has already
 * turned. No proposal at all. It suppresses the SPECIFIC creative plus the
 * SPECIFIC signal that recovered, for three days, and nothing else: a frequency
 * that has come back down says precisely nothing about a cost per result that
 * is still climbing, and suppressing the whole category on that basis would
 * hide a legitimate replacement behind unrelated good news.
 */

import { RESULT_LABELS } from '@/lib/creative-status'
import { rangeLabel } from '@/lib/operator/dates'
import {
  collectEvidence,
  completenessEvidence,
  costVsBaselineEvidence,
  costWord,
  frequencyEvidence,
  nullWindowEvidence,
  signedPct,
  trendEvidence,
  volumeEvidence,
} from '@/lib/operator/evidence'
import { proposalFingerprint, subjectFingerprint, suppressionKey } from '@/lib/operator/fingerprint'
import { definitiveVerdictBlocked } from '@/lib/operator/maturity'
import { addDays } from '@/lib/operator/dates'
import { assessStrength } from '@/lib/operator/strength'
import {
  activeFatigueSignals,
  bandScore,
  changeOf,
  emptyResult,
  FATIGUE_SIGNAL_WORDS,
  SCORE_BANDS,
  THRESHOLDS,
  type EvaluatedCreative,
  type Rule,
  type RuleContext,
  type RuleResult,
  type Suppression,
} from '@/lib/operator/rules/shared'
import type { CreativeSignals, FatigueSignal, Proposal } from '@/lib/operator/types'

/* ------------------------------ signal reading ----------------------------- */

/** Deterioration present in BOTH windows, moving the same way in both. */
function deterioratingAcrossWindows(s: CreativeSignals): boolean {
  const ctr3 = changeOf(s.trends.ctr3v3)
  const ctr7 = changeOf(s.trends.ctr7v7)
  const cpr3 = changeOf(s.trends.cpr3v3)
  const cpr7 = changeOf(s.trends.cpr7v7)

  const ctrBoth = ctr3 !== null && ctr7 !== null && ctr3 < 0 && ctr7 < 0
  const cprBoth = cpr3 !== null && cpr7 !== null && cpr3 > 0 && cpr7 > 0
  return ctrBoth || cprBoth
}

/** Rapid deterioration on its own, at the same magnitudes a signal needs. */
function rapidDeterioration(s: CreativeSignals): boolean {
  const ctr3 = changeOf(s.trends.ctr3v3)
  const cpr3 = changeOf(s.trends.cpr3v3)
  return (
    (ctr3 !== null && ctr3 <= THRESHOLDS.ctrDeclinePct) ||
    (cpr3 !== null && cpr3 >= THRESHOLDS.costRisePct)
  )
}

/**
 * Which signals were poor over the confirmation window but have already turned
 * over the rapid one. These are the recoveries — each one suppressed alone.
 */
function recoveredSignals(s: CreativeSignals): FatigueSignal[] {
  const out: FatigueSignal[] = []
  const ctr3 = changeOf(s.trends.ctr3v3)
  const ctr7 = changeOf(s.trends.ctr7v7)
  const cpr3 = changeOf(s.trends.cpr3v3)
  const cpr7 = changeOf(s.trends.cpr7v7)

  if (
    ctr7 !== null &&
    ctr7 <= THRESHOLDS.recoveryPriorCtrPct &&
    ctr3 !== null &&
    ctr3 >= THRESHOLDS.recoveryStabilisedCtrPct
  ) {
    out.push('ctr_decline')
  }
  if (
    cpr7 !== null &&
    cpr7 >= THRESHOLDS.recoveryPriorCostPct &&
    cpr3 !== null &&
    cpr3 <= THRESHOLDS.recoveryStabilisedCostPct
  ) {
    out.push('cost_rise')
  }
  // Frequency recovers when it has stopped climbing across the two windows.
  if (
    s.previousFrequency !== null &&
    s.currentFrequency !== null &&
    s.previousFrequency >= THRESHOLDS.frequencyFloor &&
    s.currentFrequency < s.previousFrequency
  ) {
    out.push('frequency')
  }
  return out
}

/**
 * The signal a replacement is actually DRIVEN by.
 *
 * Frequency corroborates; it is rarely the reason on its own. So the efficiency
 * collapse is named as the driver where there is one, which is what makes the
 * per-signal recovery suppression meaningful rather than a formality.
 */
function drivingSignal(active: FatigueSignal[]): FatigueSignal {
  if (active.includes('cost_rise')) return 'cost_rise'
  if (active.includes('ctr_decline')) return 'ctr_decline'
  return 'frequency'
}

/* ------------------------------ card assembly ------------------------------ */

function fatigueEvidence(item: EvaluatedCreative, ctx: RuleContext) {
  const { signals: s, baseline } = item
  return collectEvidence([
    trendEvidence(s, s.trends.ctr3v3, {
      kind: 'ctr_rapid',
      label: 'Outbound CTR — last 3 complete days vs prior 3',
      short: 'CTR',
      goodWhen: 'up',
      unit: 'pct',
    }),
    trendEvidence(s, s.trends.ctr7v7, {
      kind: 'ctr_confirm',
      label: 'Outbound CTR — last 7 complete days vs prior 7',
      short: 'CTR',
      goodWhen: 'up',
      unit: 'pct',
    }),
    nullWindowEvidence(s, s.trends.ctr7v7, {
      kind: 'ctr_confirm_null',
      label: 'Outbound CTR — 7-day confirmation window',
      short: 'CTR',
    }),
    trendEvidence(s, s.trends.cpr3v3, {
      kind: 'cost_rapid',
      label: `${RESULT_LABELS[s.primaryResultType].cost} — last 3 complete days vs prior 3`,
      short: RESULT_LABELS[s.primaryResultType].short,
      goodWhen: 'down',
      unit: 'money',
    }),
    trendEvidence(s, s.trends.cpr7v7, {
      kind: 'cost_confirm',
      label: `${RESULT_LABELS[s.primaryResultType].cost} — last 7 complete days vs prior 7`,
      short: RESULT_LABELS[s.primaryResultType].short,
      goodWhen: 'down',
      unit: 'money',
    }),
    nullWindowEvidence(s, s.trends.cpr7v7, {
      kind: 'cost_confirm_null',
      label: `${RESULT_LABELS[s.primaryResultType].cost} — 7-day confirmation window`,
      short: RESULT_LABELS[s.primaryResultType].short,
    }),
    frequencyEvidence(s),
    costVsBaselineEvidence(s, baseline),
    volumeEvidence(s, s.resultsAreProvisional),
    completenessEvidence(s, {
      completeThrough: ctx.maturity.completeThrough,
      provisionalDates: ctx.maturity.provisionalDates,
      attributionWindow: ctx.metadata.attributionWindow,
    }),
  ])
}

/* ---------------------------------- rule ----------------------------------- */

export const fatigueRule: Rule = (ctx): RuleResult => {
  const result = emptyResult()

  for (const item of ctx.evaluated) {
    const { signals: s, creative, baseline } = item

    // The shape needs a week of complete delivery before it can be read.
    if (s.completeDays < THRESHOLDS.fatigueMinCompleteDays) continue

    const recovered = recoveredSignals(s)
    for (const signal of recovered) {
      result.suppressions.push({
        key: suppressionKey(creative.id, signal),
        creativeId: creative.id,
        creativeName: creative.name,
        signal,
        untilDate: addDays(ctx.evaluationDate, THRESHOLDS.recoveryQuietDays),
        note: `${creative.name}: ${FATIGUE_SIGNAL_WORDS[signal]} deteriorated over the 7-day window and has stabilised over the last 3 — held for ${THRESHOLDS.recoveryQuietDays} days.`,
      } satisfies Suppression)
      result.notes.push(
        `${creative.name} recovered on ${FATIGUE_SIGNAL_WORDS[signal]} — the rapid window has turned.`,
      )
    }

    // A replacement drafted off results that are still landing is a brief
    // written against numbers that will have moved by the time it renders.
    const provisionalBlock = definitiveVerdictBlocked(creative.daily, ctx.maturity)

    const active = activeFatigueSignals(s)
    // Frequency is the mandatory delivery signal; `active.length >= 2` is the
    // "at least two of CTR decline / cost rise / frequency" requirement, so a
    // saturating creative whose efficiency is holding never gets replaced.
    const frequencySignal = active.includes('frequency')

    const confirmed =
      !provisionalBlock &&
      deterioratingAcrossWindows(s) &&
      frequencySignal &&
      active.length >= 2

    // WATCH is exactly "the rapid window moved and CONFIRMED did not fire".
    // Not "the rapid window moved and the long one is perfectly flat" — a 7v7
    // drifting gently down while the last 3 days fall off a cliff is the most
    // common shape there is, and it is a watch, not a replacement.
    const watch = !confirmed && rapidDeterioration(s)

    if (!confirmed && !watch) continue

    const signal = drivingSignal(active)
    const evidence = fatigueEvidence(item, ctx)
    const ctr3 = changeOf(s.trends.ctr3v3)
    const ctr7 = changeOf(s.trends.ctr7v7)
    const cpr3 = changeOf(s.trends.cpr3v3)
    const cpr7 = changeOf(s.trends.cpr7v7)

    const strength = assessStrength({
      signals: s,
      baseline,
      comparableCreatives: item.resolution.comparableCreatives,
      proposalType: 'REPLACE',
      supportingCreatives: 1,
      watch,
      targetCostPerResult: ctx.targetCostPerResult,
    })

    if (confirmed) {
      // Severity blends how far the efficiency has moved with how saturated
      // delivery has become, so the worst offender leads the board.
      const efficiencySeverity = Math.max(
        ctr7 !== null ? Math.abs(Math.min(0, ctr7)) / 40 : 0,
        cpr7 !== null ? Math.max(0, cpr7) / 60 : 0,
      )
      const deliverySeverity =
        s.currentFrequency !== null
          ? (s.currentFrequency - THRESHOLDS.frequencyFloor) / 2
          : 0

      result.proposals.push({
        id: proposalFingerprint('REPLACE', [creative.id], ctx.evaluationDate),
        subjectKey: subjectFingerprint('REPLACE', [creative.id]),
        type: 'REPLACE',
        fatigueState: 'CONFIRMED',
        fatigueSignal: signal,
        subjectIds: [creative.id],
        subjectNames: [creative.name],
        subjectLabel: creative.name,
        score: bandScore(
          SCORE_BANDS.replaceConfirmed,
          efficiencySeverity * 0.7 + deliverySeverity * 0.3,
        ),
        strength,
        evidence,
        params: {
          ...ctx.defaults,
          hookDirection: creative.hookType,
          format: creative.format,
        },
        createdAt: ctx.evaluationDate,
        draftIntent: 'successor',
        fallback: {
          recommendation: `Brief a successor to ${creative.name}`,
          // Names the signals that fired, in the order a buyer reads them, and
          // stops there. No figures — the chips carry those alongside — and no
          // clause about confidence, which has a column of its own.
          short:
            [
              active.includes('cost_rise') ? 'Cost per result is rising' : null,
              active.includes('ctr_decline') ? 'CTR is falling' : null,
              frequencySignal ? 'frequency is climbing' : null,
            ]
              .filter(Boolean)
              .join(', ')
              .replace(/,([^,]*)$/, ' and$1') + '.',
          reasoning:
            [
              ctr7 !== null ? `outbound CTR ${signedPct(ctr7)} over the 7-day window` : null,
              ctr3 !== null ? `${signedPct(ctr3)} over the rapid 3-day window` : null,
              cpr7 !== null
                ? `${costWord(s.primaryResultType)} ${signedPct(cpr7)}`
                : null,
              s.currentFrequency !== null && s.previousFrequency !== null
                ? `frequency ${s.previousFrequency.toFixed(1)} → ${s.currentFrequency.toFixed(1)} on deduplicated range reach`
                : null,
            ]
              .filter(Boolean)
              .join(', ') +
            `. Both windows agree over ${rangeLabel(s.analysed.from, s.analysed.to)}.`,
        },
      } satisfies Proposal)
      continue
    }

    // WATCH — a distinct state, not a soft replacement.
    const rapidSeverity = Math.max(
      ctr3 !== null ? Math.abs(Math.min(0, ctr3)) / 45 : 0,
      cpr3 !== null ? Math.max(0, cpr3) / 60 : 0,
    )

    result.proposals.push({
      id: proposalFingerprint('REPLACE', [creative.id], ctx.evaluationDate),
        subjectKey: subjectFingerprint('REPLACE', [creative.id]),
      type: 'REPLACE',
      fatigueState: 'WATCH',
      fatigueSignal: signal,
      subjectIds: [creative.id],
      subjectNames: [creative.name],
      subjectLabel: creative.name,
      score: bandScore(SCORE_BANDS.watch, rapidSeverity),
      strength,
      evidence,
      params: {
        ...ctx.defaults,
        hookDirection: creative.hookType,
        format: creative.format,
        reviewInDays: THRESHOLDS.watchReviewDays,
      },
      createdAt: ctx.evaluationDate,
      draftIntent: 'successor',
      fallback: {
        recommendation: `Keep watching ${creative.name}`,
        short: s.trends.ctr7v7.complete
          ? 'The last three days dropped, but the week has not confirmed it.'
          : 'The last three days dropped, and the week is too thin to confirm it.',
        reasoning:
          [
            ctr3 !== null ? `outbound CTR ${signedPct(ctr3)} over the last 3 complete days` : null,
            cpr3 !== null
              ? `${costWord(s.primaryResultType)} ${signedPct(cpr3)} over the same window`
              : null,
            // Say what the confirmation window actually did, rather than
            // asserting it is flat — most of the time it is drifting, and the
            // reason WATCH exists is that drifting is not the same as failing.
            !s.trends.ctr7v7.complete
              ? `the 7-day window did not resolve — ${s.trends.ctr7v7.reason ?? 'insufficient delivery'}`
              : ctr7 !== null
                ? `the 7-day window is only ${signedPct(ctr7)}`
                : null,
            !frequencySignal && s.currentFrequency !== null
              ? `frequency at ${s.currentFrequency.toFixed(1)} is not saturating`
              : null,
          ]
            .filter(Boolean)
            .join(', ') + `. Not enough to replace it on.`,
      },
    } satisfies Proposal)
  }

  return result
}
