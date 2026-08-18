/**
 * Data completeness and attribution delay.
 *
 * Meta results keep arriving after the day they belong to. A lead that
 * converted at 11pm yesterday can land in the account this afternoon. If the
 * rules read yesterday as finished, every creative looks like it fell off a
 * cliff overnight and Mike calls fatigue on a healthy ad — which is the single
 * most expensive mistake this system could make, because a replacement gets
 * drafted, a winner gets rested, and the account pays for it.
 *
 * So three states, not two:
 *
 *   EXCLUDED    — today (still running) and anything the source has not marked
 *                 complete. Never enters a calculation at all.
 *   PROVISIONAL — complete enough to look at, still inside the attribution
 *                 delay. May raise a monitoring signal or a COLLECT proposal.
 *                 May NOT support a definitive REPLACE or ITERATE.
 *   SETTLED     — the ground the conclusions stand on.
 *
 * Bucketing runs on the ad account's own timezone, carried on the metadata, so
 * "yesterday" means yesterday to the account rather than to the browser.
 */

import {
  addDays,
  daysBetween,
  isAfter,
  isSameOrBefore,
  minDate,
} from '@/lib/operator/dates'
import type { DailyMetric, EvaluationContext } from '@/lib/operator/types'

export interface MaturityReport {
  evaluationDate: string
  accountTimezone: string
  attributionWindow: string
  /** Last date any calculation is allowed to read. */
  completeThrough: string
  /** Dates that are readable but still attributing, newest last. */
  provisionalDates: string[]
  /** Earliest provisional date, or null when nothing is inside the delay. */
  provisionalFrom: string | null
  /** Last date that is fully settled, or null when everything readable is provisional. */
  settledThrough: string | null
  /** How many whole days of attribution delay the account is configured for. */
  delayDays: number
  lastSyncedAt: string
}

/** Whole days of attribution delay, rounded up — a partial day still delays. */
function delayDaysFrom(hours: number): number {
  return Math.max(0, Math.ceil(hours / 24))
}

/**
 * Resolve what may be read, and what may only be watched.
 *
 * `completeThrough` is the earlier of the source's own marker and yesterday.
 * The current day is always excluded: it is, by definition, still running.
 */
export function assessMaturity(ctx: EvaluationContext): MaturityReport {
  const { evaluationDate, metadata } = ctx
  const yesterday = addDays(evaluationDate, -1)
  const completeThrough = minDate(metadata.completeThrough, yesterday)

  const delayDays = delayDaysFrom(metadata.maturityDelayHours)
  // A date is provisional while it sits inside the attribution delay measured
  // back from the evaluation date. With a 48h delay and today the 12th, the
  // 11th and the 10th are still landing.
  const provisionalFromCandidate = addDays(evaluationDate, -delayDays)

  const provisionalDates: string[] = []
  if (delayDays > 0) {
    for (
      let d = provisionalFromCandidate;
      isSameOrBefore(d, completeThrough);
      d = addDays(d, 1)
    ) {
      provisionalDates.push(d)
    }
  }

  const provisionalFrom = provisionalDates[0] ?? null
  const settledThrough = provisionalFrom
    ? isAfter(provisionalFrom, completeThrough)
      ? completeThrough
      : addDays(provisionalFrom, -1)
    : completeThrough

  return {
    evaluationDate,
    accountTimezone: metadata.accountTimezone,
    attributionWindow: metadata.attributionWindow,
    completeThrough,
    provisionalDates,
    provisionalFrom,
    settledThrough:
      settledThrough && isSameOrBefore(settledThrough, completeThrough) ? settledThrough : null,
    delayDays,
    lastSyncedAt: metadata.lastSyncedAt,
  }
}

/** True when this date is readable — not today, not beyond the source marker. */
export function isComplete(date: string, m: MaturityReport): boolean {
  return isSameOrBefore(date, m.completeThrough)
}

/** True when this date is readable but still attributing. */
export function isProvisional(date: string, m: MaturityReport): boolean {
  return m.provisionalDates.includes(date)
}

/**
 * The daily rows a calculation is allowed to use, oldest → newest.
 *
 * Everything else in the pipeline reads its days through this function, which
 * is why no rule can accidentally include the current incomplete day.
 */
export function completeDaily(daily: DailyMetric[], m: MaturityReport): DailyMetric[] {
  return daily
    .filter((d) => isComplete(d.date, m))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Rows that are settled — the only ones a definitive conclusion may rest on. */
export function settledDaily(daily: DailyMetric[], m: MaturityReport): DailyMetric[] {
  return completeDaily(daily, m).filter((d) => !isProvisional(d.date, m))
}

/**
 * How much of a creative's read is still moving.
 *
 * A creative whose recent results are mostly provisional cannot support a
 * REPLACE or an ITERATE — the rules check this before they conclude anything.
 */
export function provisionalWeight(
  daily: DailyMetric[],
  m: MaturityReport,
): { provisionalResults: number; totalResults: number; share: number } {
  const rows = completeDaily(daily, m)
  const totalResults = rows.reduce((s, d) => s + d.primaryResults, 0)
  const provisionalResults = rows
    .filter((d) => isProvisional(d.date, m))
    .reduce((s, d) => s + d.primaryResults, 0)
  return {
    provisionalResults,
    totalResults,
    share: totalResults > 0 ? provisionalResults / totalResults : 0,
  }
}

/**
 * A definitive verdict is blocked when the supporting results are provisional.
 *
 * The threshold is deliberately a share rather than a count: one late lead on a
 * creative with two hundred of them changes nothing, but a creative whose last
 * three days are half its record is a creative nobody should be replacing yet.
 */
export const PROVISIONAL_BLOCK_SHARE = 0.25

export function definitiveVerdictBlocked(daily: DailyMetric[], m: MaturityReport): boolean {
  const { share, provisionalResults } = provisionalWeight(daily, m)
  return provisionalResults > 0 && share >= PROVISIONAL_BLOCK_SHARE
}

/** How stale the sync is, in whole days, against the evaluation date. */
export function syncAgeDays(m: MaturityReport): number {
  return daysBetween(m.lastSyncedAt.slice(0, 10), m.evaluationDate)
}
