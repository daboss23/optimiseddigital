/**
 * The rule contract, and the thresholds every rule reads from.
 *
 * Rules are the ONLY layer allowed to hold a threshold. Signals describe,
 * baselines compare, strength tiers, evidence formats — none of them decide.
 * Keeping the numbers here means "we were calling fatigue too early" is a
 * conversation about one file with one exported object in it, not an
 * archaeology expedition through the codebase.
 *
 * Every rule has the same shape:
 *
 *   (context) => { proposals, suppressions, notes }
 *
 * and every rule is allowed to return nothing. A rule that fires on thin data
 * to avoid an empty dashboard is worse than an empty dashboard.
 */

import type { BaselineResolution } from '@/lib/operator/baselines'
import type { MaturityReport } from '@/lib/operator/maturity'
import type {
  CreativeSignals,
  CreativeSnapshot,
  DataSourceMetadata,
  FatigueSignal,
  PerformanceBaseline,
  Proposal,
  ProposalParams,
} from '@/lib/operator/types'

export interface EvaluatedCreative {
  creative: CreativeSnapshot
  signals: CreativeSignals
  baseline: PerformanceBaseline | null
  resolution: BaselineResolution
}

export interface Suppression {
  /** hash(creativeId + fatigueSignal) — precise, never category-wide. */
  key: string
  creativeId: string
  creativeName: string
  signal: FatigueSignal
  /** Inclusive date the suppression lifts. */
  untilDate: string
  note: string
}

export interface RuleContext {
  evaluated: EvaluatedCreative[]
  maturity: MaturityReport
  metadata: DataSourceMetadata
  evaluationDate: string
  /** Defaults the operator's own editing history has moved. */
  defaults: ProposalParams
  /** The campaign's configured cost-per-result target, when there is one. */
  targetCostPerResult?: number
}

export interface RuleResult {
  proposals: Proposal[]
  suppressions: Suppression[]
  /** Things worth Mike knowing that are not proposals — e.g. a recovery. */
  notes: string[]
}

export type Rule = (ctx: RuleContext) => RuleResult

export const emptyResult = (): RuleResult => ({ proposals: [], suppressions: [], notes: [] })

/* -------------------------------- thresholds ------------------------------- */

export const THRESHOLDS = {
  /** ITERATE: how far inside the cohort median a winner has to sit. */
  winnerCostRatio: 0.8,
  /** ITERATE: results needed before a winner is worth pouring budget into. */
  winnerMinResults: 15,
  /** ITERATE: how much rapid CTR slippage is tolerated on a winner. */
  winnerMaxCtrSlipPct: -10,

  /** Fatigue: complete days needed before the shape can be read at all. */
  fatigueMinCompleteDays: 7,
  /** Fatigue: the CTR decline that counts as a signal. */
  ctrDeclinePct: -20,
  /** Fatigue: the cost-per-result rise that counts as a signal. */
  costRisePct: 25,
  /** Fatigue: range-level frequency at or above which delivery is saturating. */
  frequencyFloor: 2.5,

  /** RECOVERING: the 7v7 deterioration that has to have been there. */
  recoveryPriorCtrPct: -15,
  recoveryPriorCostPct: 20,
  /** RECOVERING: 3v3 at or better than this counts as stabilised. */
  recoveryStabilisedCtrPct: -5,
  recoveryStabilisedCostPct: 8,
  /** RECOVERING: how long the recovered signal stays suppressed. */
  recoveryQuietDays: 3,

  /** EXPLORE: creatives that must share the pattern. Never fires on one. */
  patternMinCreatives: 3,
  /** EXPLORE: group mean cost ratio against the cohort. */
  patternCostRatio: 0.85,

  /** WATCH: default days until the check-back. */
  watchReviewDays: 3,
} as const

/* ------------------------------- score bands ------------------------------- */

/**
 * Score is for RANKING ONLY and is never displayed as a confidence.
 *
 * The bands do not overlap where the spec says they must not: a WATCH cannot
 * reach a CONFIRMED replacement's floor, so short-term nerves can never push a
 * real replacement off the board.
 */
export const SCORE_BANDS = {
  replaceConfirmed: { min: 70, max: 98 },
  iterate: { min: 52, max: 88 },
  watch: { min: 30, max: 65 },
  explore: { min: 22, max: 58 },
  collect: { min: 5, max: 12 },
} as const

export function bandScore(
  band: { min: number; max: number },
  /** 0–1, how strongly the rule fired. */
  severity: number,
): number {
  const clamped = Math.max(0, Math.min(1, severity))
  return Math.round(band.min + (band.max - band.min) * clamped)
}

/* -------------------------------- utilities -------------------------------- */

/** Reads a resolved percent change, or null when the window did not resolve. */
export function changeOf(w: {
  complete: boolean
  percentChange: number | null
}): number | null {
  return w.complete ? w.percentChange : null
}

/** Which fatigue signals are currently firing on this creative. */
export function activeFatigueSignals(s: CreativeSignals): FatigueSignal[] {
  const out: FatigueSignal[] = []
  const ctr3 = changeOf(s.trends.ctr3v3)
  const cpr3 = changeOf(s.trends.cpr3v3)
  if (ctr3 !== null && ctr3 <= THRESHOLDS.ctrDeclinePct) out.push('ctr_decline')
  if (cpr3 !== null && cpr3 >= THRESHOLDS.costRisePct) out.push('cost_rise')
  if (
    s.currentFrequency !== null &&
    s.currentFrequency >= THRESHOLDS.frequencyFloor &&
    s.frequencyRising
  ) {
    out.push('frequency')
  }
  return out
}

export const FATIGUE_SIGNAL_WORDS: Record<FatigueSignal, string> = {
  frequency: 'frequency',
  ctr_decline: 'CTR decline',
  cost_rise: 'cost-per-result rise',
}
