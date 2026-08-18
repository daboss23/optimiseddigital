/**
 * Evidence strength — how much weight this read can carry.
 *
 * This replaces what a lesser dashboard calls "confidence", and the rename is
 * the point. Confidence sounds like a feeling and gets computed from win rate,
 * which is how you end up with the single worst artefact in performance
 * software: **"1/1 wins · 100% confidence"**. One test is a story. It is not a
 * pattern, and no amount of arithmetic on a sample of one turns it into one.
 *
 * Strength is derived from the things that actually determine whether a
 * conclusion survives contact with next week:
 *
 *   - how many primary results are behind it
 *   - how many complete delivery days
 *   - how steady those days were
 *   - whether the rapid window and the confirmation window agree
 *   - how many comparable creatives the cohort held
 *   - how specific that cohort was
 *
 * Never from win rate. And four floors are enforced in code rather than trusted
 * to the scoring, because each one is a mistake that has been made in
 * production by somebody:
 *
 *   1. A single test never leaves EARLY_SIGNAL.
 *   2. An EXPLORE on fewer than three compatible creatives never leaves it either.
 *   3. A broad account-level baseline caps below STRONG.
 *   4. A null confirmation window caps below STRONG.
 *
 * The tier is a ceiling on what Mike is allowed to claim, enforced after
 * generation by `validate.ts`. He can be as uncertain as he likes below it.
 */

import { cohortQuality } from '@/lib/operator/baselines'
import { directionallyConsistent } from '@/lib/operator/signals'
import type {
  CreativeSignals,
  EvidenceStrength,
  EvidenceStrengthTier,
  PerformanceBaseline,
  ProposalType,
  Stability,
} from '@/lib/operator/types'

const TIER_RANK: Record<EvidenceStrengthTier, number> = {
  EARLY_SIGNAL: 0,
  MODERATE: 1,
  STRONG: 2,
}

/** Below this the cohort is called out as thin rather than silently accepted. */
const MIN_COMPARABLES = 3

/** UI labels. The internals renamed; the operator's vocabulary did not. */
export const STRENGTH_LABELS: Record<EvidenceStrengthTier, string> = {
  EARLY_SIGNAL: 'Early signal · Low confidence',
  MODERATE: 'Moderate confidence',
  STRONG: 'Strong confidence',
}

export const STRENGTH_TONE: Record<EvidenceStrengthTier, 'default' | 'warning' | 'success'> = {
  EARLY_SIGNAL: 'default',
  MODERATE: 'warning',
  STRONG: 'success',
}

export function tierAtMost(
  tier: EvidenceStrengthTier,
  ceiling: EvidenceStrengthTier,
): EvidenceStrengthTier {
  return TIER_RANK[tier] <= TIER_RANK[ceiling] ? tier : ceiling
}

export function tierAtLeast(
  tier: EvidenceStrengthTier,
  floor: EvidenceStrengthTier,
): boolean {
  return TIER_RANK[tier] >= TIER_RANK[floor]
}

/* --------------------------------- inputs ---------------------------------- */

export interface StrengthInput {
  signals: CreativeSignals
  baseline: PerformanceBaseline | null
  /** How many creatives sat in the resolved cohort. */
  comparableCreatives: number
  proposalType: ProposalType
  /** EXPLORE: how many creatives share the pattern. ITERATE/REPLACE: 1. */
  supportingCreatives: number
  /** True while a fatigue read is in WATCH — rapid movement, unconfirmed. */
  watch?: boolean
  /** True when every result behind the read came from one creative's one test. */
  singleTest?: boolean
  /** The campaign's cost-per-result target, when one is configured. */
  targetCostPerResult?: number
}

const STABILITY_POINTS: Record<Stability, number> = { high: 1, mixed: 0, low: -1 }

/**
 * Tier one read.
 *
 * The scoring is deliberately dull — a handful of integers — because the
 * interesting behaviour is in the floors underneath it, and a clever score that
 * can be argued with is worse than a boring one that cannot.
 */
export function assessStrength(input: StrengthInput): EvidenceStrength {
  const { signals, baseline, comparableCreatives, proposalType, supportingCreatives } = input
  const reasons: string[] = []
  const quality = cohortQuality(baseline)

  let points = 0

  /* -- volume of primary results ------------------------------------------ */
  if (signals.totalPrimaryResults >= 40) {
    points += 2
    reasons.push(`${signals.totalPrimaryResults} primary results behind the read`)
  } else if (signals.totalPrimaryResults >= 15) {
    points += 1
    reasons.push(`${signals.totalPrimaryResults} primary results — enough to act on`)
  } else {
    points -= 1
    reasons.push(`only ${signals.totalPrimaryResults} primary results so far`)
  }

  /* -- delivery days ------------------------------------------------------- */
  if (signals.completeDays >= 10) {
    points += 2
    reasons.push(`${signals.completeDays} complete delivery days`)
  } else if (signals.completeDays >= 7) {
    points += 1
    reasons.push(`${signals.completeDays} complete delivery days`)
  } else {
    reasons.push(`${signals.completeDays} complete delivery days — a short window`)
  }

  /* -- spend against the target ------------------------------------------- */
  if (input.targetCostPerResult && input.targetCostPerResult > 0) {
    const targetsWorthOfSpend = signals.totalSpend / input.targetCostPerResult
    if (targetsWorthOfSpend >= 30) points += 1
  }

  /* -- day-to-day stability ------------------------------------------------ */
  points += STABILITY_POINTS[signals.stability]
  if (signals.stability === 'low') reasons.push('daily performance still variable')
  if (signals.stability === 'high') reasons.push('daily performance steady')

  /* -- do the rapid and confirmation windows agree? ------------------------ */
  const ctrAgrees = directionallyConsistent(signals.trends.ctr3v3, signals.trends.ctr7v7)
  const cprAgrees = directionallyConsistent(signals.trends.cpr3v3, signals.trends.cpr7v7)
  const confirmationResolved =
    signals.trends.ctr7v7.complete || signals.trends.cpr7v7.complete
  if (ctrAgrees || cprAgrees) {
    points += 1
    reasons.push('the rapid and confirmation windows agree')
  } else if (!confirmationResolved) {
    reasons.push('the confirmation window has not resolved')
  }

  /* -- cohort -------------------------------------------------------------- */
  if (comparableCreatives >= 5) {
    points += 1
    reasons.push(`${comparableCreatives} comparable creatives in the cohort`)
  } else if (comparableCreatives < MIN_COMPARABLES) {
    points -= 1
    reasons.push(
      comparableCreatives === 0
        ? 'no comparable cohort to measure against'
        : `only ${comparableCreatives} comparable creatives in the cohort`,
    )
  }
  if (quality === 'strong') points += 1
  if (quality === 'weak') points -= 1

  let tier: EvidenceStrengthTier = points >= 5 ? 'STRONG' : points >= 2 ? 'MODERATE' : 'EARLY_SIGNAL'

  /* ------------------------------- the floors ----------------------------- */

  // 1. A single test is a story, not a pattern. No exceptions, ever.
  if (input.singleTest || supportingCreatives <= 1) {
    if (proposalType === 'EXPLORE') {
      tier = 'EARLY_SIGNAL'
      reasons.push('a pattern claimed from a single creative stays an early signal')
    }
  }
  if (input.singleTest) {
    tier = 'EARLY_SIGNAL'
    reasons.push('one test — a story, not a pattern')
  }

  // 2. EXPLORE needs three compatible creatives before it is more than a hunch,
  //    and three is where a pattern STARTS rather than where it is settled. The
  //    tiering runs on the group's strongest member, which would otherwise let
  //    one exceptional creative carry a three-creative pattern all the way to
  //    STRONG — a claim about a pattern resting on evidence about an ad.
  if (proposalType === 'EXPLORE') {
    if (supportingCreatives < 3) {
      tier = 'EARLY_SIGNAL'
      reasons.push(`${supportingCreatives} creatives share the pattern — below the 3 needed`)
    } else if (supportingCreatives < 5) {
      tier = tierAtMost(tier, 'MODERATE')
      reasons.push(`${supportingCreatives} creatives share the pattern — a pattern, not a rule yet`)
    }
  }

  // 3. A broad account fallback cannot support a strong claim.
  if (baseline?.fallbackLevel === 'account' || !baseline) {
    tier = tierAtMost(tier, 'MODERATE')
    reasons.push(
      baseline
        ? 'the comparison had to fall back to an account-wide cohort'
        : 'no cohort specific enough to compare against',
    )
  }

  // 4. Without a confirmation window, nothing is confirmed.
  if (!confirmationResolved) {
    tier = tierAtMost(tier, 'MODERATE')
  }

  // 5. WATCH is by definition unconfirmed.
  if (input.watch) {
    tier = tierAtMost(tier, 'MODERATE')
    reasons.push('short-term movement not yet confirmed by the longer window')
  }

  return {
    tier,
    reasons,
    primaryResults: signals.totalPrimaryResults,
    completeDays: signals.completeDays,
    stability: signals.stability,
    cohortQuality: quality,
  }
}

/* ------------------------------ display helper ----------------------------- */

const STABILITY_PHRASES: Record<Stability, string> = {
  high: 'with steady daily performance',
  mixed: 'with daily performance varying somewhat',
  low: 'with daily performance still variable',
}

const COHORT_PHRASES: Record<EvidenceStrength['cohortQuality'], string> = {
  strong: 'against a close, well-populated cohort',
  acceptable: 'against a broader cohort',
  weak: 'against a wide comparison group',
}

/**
 * The hover explanation, built from the STRUCTURED values rather than from
 * prose. It says what it counted, so the operator can disagree with the count
 * instead of arguing with an adjective.
 */
export function strengthExplanation(
  s: EvidenceStrength,
  resultWord: string,
): string {
  return [
    `Based on ${s.primaryResults} ${resultWord}`,
    `across ${s.completeDays} complete ${s.completeDays === 1 ? 'day' : 'days'}`,
    STABILITY_PHRASES[s.stability],
    COHORT_PHRASES[s.cohortQuality],
  ].join(', ') + '.'
}
