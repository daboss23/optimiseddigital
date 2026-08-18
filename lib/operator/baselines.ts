/**
 * Contextual baselines — what "good" is compared against.
 *
 * A single account-wide median is the most common way a creative gets graded
 * wrongly. A retargeting ad at $22 a lead looks like a triumph next to a $41
 * account median, right up until you notice every retargeting ad on the account
 * is at $22 and this one is the worst of them. And a $186 cost per booked call
 * is meaningless measured against a pool that is mostly lead-magnet CPLs,
 * because those are not the same outcome and never were.
 *
 * So the resolver walks from the most specific cohort outward and stops at the
 * first one with enough evidence behind it:
 *
 *   exact_cohort      offer + result + temperature + market + objective
 *   result_and_offer  offer + result type
 *   result_type       result type only
 *   account           the account, still scoped to the result type
 *
 * Two constraints never bend, at any level:
 *
 * - **Result types are never blended.** Even the broadest fallback stays inside
 *   the creative's own `primaryResultType`. There is no level of desperation at
 *   which a booked call gets compared against a lead.
 * - **Cold is never compared against retargeting.** Broadening DROPS the
 *   temperature attribute; it never substitutes a different one. So a cold
 *   creative can fall back to "all lead campaigns" but can never be graded
 *   against the retargeting cohort.
 *
 * How far it had to walk rides along on `fallbackLevel`, into the evidence and
 * into the strength tier — a broad comparison is still an honest one, it just
 * cannot support a strong claim.
 */

import type {
  BaselineFallbackLevel,
  CreativeSnapshot,
  PerformanceBaseline,
} from '@/lib/operator/types'

/** A cohort needs this much behind it before it is preferred to a broader one. */
export const MIN_COHORT_CREATIVES = 3
export const MIN_COHORT_RESULTS = 15

/** Specific → broad. The resolver walks this order and takes the first match. */
const LEVEL_ORDER: BaselineFallbackLevel[] = [
  'exact_cohort',
  'result_and_offer',
  'result_type',
  'account',
]

export interface BaselineResolution {
  baseline: PerformanceBaseline | null
  /** Levels that matched a cohort but were too thin to use. */
  rejected: { level: BaselineFallbackLevel; reason: string }[]
  /** How many comparable creatives sat in the cohort that was chosen. */
  comparableCreatives: number
}

function sufficient(b: PerformanceBaseline): boolean {
  return b.creativeCount >= MIN_COHORT_CREATIVES && b.resultCount >= MIN_COHORT_RESULTS
}

/** Does this baseline describe a cohort the creative legitimately belongs to? */
function matches(
  creative: CreativeSnapshot,
  b: PerformanceBaseline,
  level: BaselineFallbackLevel,
): boolean {
  // Absolute floor, checked at every level including `account`.
  if (b.key.primaryResultType !== creative.primaryResultType) return false
  if (b.fallbackLevel !== level) return false

  // An attribute the baseline declares must match the creative's. An attribute
  // it leaves undefined has been deliberately broadened away, which is allowed;
  // a MISMATCH never is.
  const attr = <T>(a: T | undefined, b2: T | undefined) => a === undefined || a === b2

  return (
    attr(b.key.offerType, creative.offerType) &&
    attr(b.key.audienceTemperature, creative.audienceTemperature) &&
    attr(b.key.market, creative.market) &&
    attr(b.key.campaignObjective, creative.campaignObjective)
  )
}

/**
 * Pick the most specific cohort with enough evidence behind it.
 *
 * Returns null when nothing at all is comparable — an honest "no baseline",
 * which the strength tiering treats as weak rather than pretending to a
 * comparison that does not exist.
 */
export function resolveBaseline(
  creative: CreativeSnapshot,
  baselines: PerformanceBaseline[],
): BaselineResolution {
  const rejected: BaselineResolution['rejected'] = []

  for (const level of LEVEL_ORDER) {
    const candidates = baselines.filter((b) => matches(creative, b, level))
    if (candidates.length === 0) continue

    // Where several cohorts match at one level, prefer the one with the most
    // evidence behind it.
    const best = candidates.slice().sort((a, b) => b.resultCount - a.resultCount)[0]

    if (!sufficient(best)) {
      rejected.push({
        level,
        reason: `${best.creativeCount} creatives / ${best.resultCount} results — below the ${MIN_COHORT_CREATIVES} creative, ${MIN_COHORT_RESULTS} result floor`,
      })
      continue
    }

    return { baseline: best, rejected, comparableCreatives: best.creativeCount }
  }

  return { baseline: null, rejected, comparableCreatives: 0 }
}

/** Cohort strength as a word, for the evidence-strength tiering. */
export function cohortQuality(
  b: PerformanceBaseline | null,
): 'weak' | 'acceptable' | 'strong' {
  if (!b) return 'weak'
  if (b.fallbackLevel === 'account') return 'weak'
  if (b.fallbackLevel === 'result_type') return 'acceptable'
  return b.creativeCount >= 5 ? 'strong' : 'acceptable'
}

const RESULT_WORDS: Record<PerformanceBaseline['key']['primaryResultType'], string> = {
  lead: 'lead',
  registration: 'registration',
  application: 'application',
  booked_call: 'booked-call',
  purchase: 'purchase',
  custom: 'custom-conversion',
}

/**
 * The comparison written out honestly — "the median for cold Strategy Call
 * campaigns", not "the account average". This string is what appears under the
 * number on the card, so it has to name exactly what was compared.
 */
export function baselineLabel(b: PerformanceBaseline | null): string {
  if (!b) return 'no comparable cohort'
  const { key } = b
  const parts: string[] = []
  if (key.audienceTemperature) parts.push(key.audienceTemperature)
  if (key.offerType) parts.push(key.offerType)
  if (key.market) parts.push(key.market)

  const scope = parts.length > 0 ? parts.join(' ') : 'account-wide'
  return `${scope} ${RESULT_WORDS[key.primaryResultType]} campaigns`
}

/** Plain-language note on how broad the comparison had to go. */
export const FALLBACK_NOTES: Record<BaselineFallbackLevel, string> = {
  exact_cohort: 'compared against its exact cohort',
  result_and_offer: 'compared against the same offer and result type',
  result_type: 'compared against all campaigns with the same result type',
  account: 'compared account-wide — the narrowest cohorts were too thin to use',
}
