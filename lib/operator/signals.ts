/**
 * Signals — raw delivery turned into typed metrics and trend windows.
 *
 * This layer DESCRIBES. It does not judge. There is not a single threshold in
 * this file: no "good", no "fatiguing", no "winner". Rules read from here and
 * make the calls, which is what makes a threshold change a one-file change.
 *
 * Two disciplines are load-bearing:
 *
 * **Equal, complete windows.** A 3-day window is only ever compared against the
 * 3 days before it. Comparing 3 against 7 is how a normal weekend reads as a
 * collapse. Windows are cut by CALENDAR DATE rather than by available rows, so
 * a creative that simply did not deliver on Sunday is measured honestly instead
 * of having Saturday quietly promoted into Sunday's slot.
 *
 * **Null is an answer.** When the previous window has too little delivery to
 * compare against, `percentChange` is null and `complete` is false. It is never
 * a zero, never an assumed flat, never a trend invented out of one good day.
 * Everything downstream — rules, evidence strength, Mike himself — has to
 * handle that state, and the tests prove they do.
 */

import {
  addDays,
  isSameOrBefore,
  isAfter,
  rangeLabel,
} from '@/lib/operator/dates'
import {
  completeDaily,
  isProvisional,
  provisionalWeight,
  type MaturityReport,
} from '@/lib/operator/maturity'
import type {
  CreativeSignals,
  CreativeSnapshot,
  CreativeTrends,
  DailyMetric,
  PerformanceBaseline,
  RangeDeliveryMetric,
  Stability,
  TrendWindow,
} from '@/lib/operator/types'

/* ------------------------------ delivery floors ----------------------------- */

/**
 * The minimum delivery a window needs before a comparison against it means
 * anything. Below these, the window returns null rather than a number that
 * looks like a trend and is really noise.
 */
export const MIN_IMPRESSIONS_FOR_TREND = 400
export const MIN_RESULTS_FOR_TREND = 3

/** The two window sizes the system reasons in. */
export const RAPID_WINDOW_DAYS = 3
export const CONFIRMATION_WINDOW_DAYS = 7

/* --------------------------------- windows --------------------------------- */

interface WindowTotals {
  from: string
  to: string
  spend: number
  impressions: number
  clicks: number
  results: number
  /** Whether the creative actually has data covering this whole span. */
  covered: boolean
}

function totalsFor(
  rows: DailyMetric[],
  from: string,
  to: string,
  earliestAvailable: string | null,
): WindowTotals {
  const inWindow = rows.filter((d) => isSameOrBefore(from, d.date) && isSameOrBefore(d.date, to))
  return {
    from,
    to,
    spend: inWindow.reduce((s, d) => s + d.spend, 0),
    impressions: inWindow.reduce((s, d) => s + d.impressions, 0),
    clicks: inWindow.reduce((s, d) => s + d.clicks, 0),
    results: inWindow.reduce((s, d) => s + d.primaryResults, 0),
    // The creative has to have existed for the whole span. A creative that
    // launched halfway through the previous window has no previous window.
    covered: earliestAvailable !== null && isSameOrBefore(earliestAvailable, from),
  }
}

const ctrOf = (t: WindowTotals): number | null =>
  t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null

const cprOf = (t: WindowTotals): number | null => (t.results > 0 ? t.spend / t.results : null)

function incomplete(
  current: WindowTotals,
  previous: WindowTotals,
  reason: string,
): TrendWindow {
  return {
    current: 0,
    previous: 0,
    percentChange: null,
    complete: false,
    reason,
    currentRange: { from: current.from, to: current.to },
    previousRange: { from: previous.from, to: previous.to },
  }
}

function buildWindow(
  current: WindowTotals,
  previous: WindowTotals,
  metric: 'ctr' | 'cpr',
): TrendWindow {
  const label = metric === 'ctr' ? 'outbound CTR' : 'cost per result'

  if (!previous.covered) {
    return incomplete(current, previous, `the creative had not launched for the whole prior window`)
  }

  const enough = (t: WindowTotals) =>
    metric === 'ctr'
      ? t.impressions >= MIN_IMPRESSIONS_FOR_TREND
      : t.results >= MIN_RESULTS_FOR_TREND && t.spend > 0

  if (!enough(previous)) {
    return incomplete(
      current,
      previous,
      `too little delivery in the prior window to compare ${label} against`,
    )
  }
  if (!enough(current)) {
    return incomplete(current, previous, `too little delivery in the current window to read ${label}`)
  }

  const c = (metric === 'ctr' ? ctrOf(current) : cprOf(current)) as number
  const p = (metric === 'ctr' ? ctrOf(previous) : cprOf(previous)) as number

  return {
    current: c,
    previous: p,
    percentChange: p === 0 ? null : ((c - p) / p) * 100,
    complete: true,
    currentRange: { from: current.from, to: current.to },
    previousRange: { from: previous.from, to: previous.to },
  }
}

/**
 * Build one equal-window comparison ending on the last complete day.
 *
 * Exported so the tests can assert directly that the two spans are the same
 * length and that neither reaches into the incomplete present.
 */
export function trendWindows(
  rows: DailyMetric[],
  maturity: MaturityReport,
  size: number,
): { current: WindowTotals; previous: WindowTotals } {
  const end = maturity.completeThrough
  const earliest = rows.length > 0 ? rows[0].date : null

  const currentFrom = addDays(end, -(size - 1))
  const previousTo = addDays(currentFrom, -1)
  const previousFrom = addDays(previousTo, -(size - 1))

  return {
    current: totalsFor(rows, currentFrom, end, earliest),
    previous: totalsFor(rows, previousFrom, previousTo, earliest),
  }
}

function buildTrends(rows: DailyMetric[], maturity: MaturityReport): CreativeTrends {
  const rapid = trendWindows(rows, maturity, RAPID_WINDOW_DAYS)
  const confirm = trendWindows(rows, maturity, CONFIRMATION_WINDOW_DAYS)
  return {
    ctr3v3: buildWindow(rapid.current, rapid.previous, 'ctr'),
    cpr3v3: buildWindow(rapid.current, rapid.previous, 'cpr'),
    ctr7v7: buildWindow(confirm.current, confirm.previous, 'ctr'),
    cpr7v7: buildWindow(confirm.current, confirm.previous, 'cpr'),
  }
}

/* -------------------------------- stability -------------------------------- */

/**
 * How steady the creative is day to day.
 *
 * Measured as the coefficient of variation of daily cost per result, which is
 * the number the operator actually cares about. Falls back to daily CTR when
 * there are too few converting days, and reports `low` when neither can be
 * established — an unproven creative is not a stable one.
 */
export function dailyStability(rows: DailyMetric[]): {
  variation: number | null
  stability: Stability
} {
  const series = (() => {
    const cpr = rows.filter((d) => d.primaryResults > 0).map((d) => d.spend / d.primaryResults)
    if (cpr.length >= 3) return cpr
    const ctr = rows.filter((d) => d.impressions > 0).map((d) => (d.clicks / d.impressions) * 100)
    return ctr.length >= 3 ? ctr : []
  })()

  if (series.length < 3) return { variation: null, stability: 'low' }

  const mean = series.reduce((s, v) => s + v, 0) / series.length
  if (mean === 0) return { variation: null, stability: 'low' }
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length
  const cv = Math.sqrt(variance) / mean

  return { variation: cv, stability: cv <= 0.25 ? 'high' : cv <= 0.5 ? 'mixed' : 'low' }
}

/* -------------------------------- frequency -------------------------------- */

/**
 * Frequency, and ONLY from range-level delivery.
 *
 * Reach deduplicates people across days: the same builder who saw the ad on
 * Monday and Wednesday is one reached person over the week and two over the
 * daily rows. Summing or averaging daily frequency therefore does not
 * approximate the weekly figure, it invents a different and always-wrong one.
 * There is deliberately no code path in this module that can produce a
 * frequency from `DailyMetric.reach` — if the source did not supply a range,
 * the answer is null and the fatigue rule loses its delivery signal, which is
 * the correct outcome.
 */
export function frequencyFromRanges(
  ranges: RangeDeliveryMetric[],
  days: number,
  window: 'current' | 'previous',
): number | null {
  const hit = ranges.find((r) => r.days === days && r.window === window)
  return hit ? hit.frequency : null
}

/* --------------------------------- signals --------------------------------- */

/**
 * Everything the rules need to know about one creative, computed once.
 *
 * `baseline` is passed in already resolved so the ratio against the cohort
 * lives alongside the rest of the numbers — but note this layer only divides.
 * Whether 0.78 is good is a judgement, and judgements live in `rules/`.
 */
export function computeSignals(
  creative: CreativeSnapshot,
  maturity: MaturityReport,
  baseline: PerformanceBaseline | null,
): CreativeSignals {
  const rows = completeDaily(creative.daily, maturity)
  const totalSpend = rows.reduce((s, d) => s + d.spend, 0)
  const totalPrimaryResults = rows.reduce((s, d) => s + d.primaryResults, 0)
  const impressions = rows.reduce((s, d) => s + d.impressions, 0)
  const clicks = rows.reduce((s, d) => s + d.clicks, 0)

  const costPerResult = totalPrimaryResults > 0 ? totalSpend / totalPrimaryResults : null
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null

  const { variation, stability } = dailyStability(rows)
  const { provisionalResults } = provisionalWeight(creative.daily, maturity)

  const currentFrequency = frequencyFromRanges(
    creative.ranges,
    CONFIRMATION_WINDOW_DAYS,
    'current',
  )
  const previousFrequency = frequencyFromRanges(
    creative.ranges,
    CONFIRMATION_WINDOW_DAYS,
    'previous',
  )

  return {
    creativeId: creative.id,
    name: creative.name,
    completeDays: rows.length,
    totalSpend,
    totalPrimaryResults,
    primaryResultType: creative.primaryResultType,
    costPerResult,
    ctr,
    trends: buildTrends(rows, maturity),
    stability,
    dailyVariation: variation,
    currentFrequency,
    previousFrequency,
    frequencyRising:
      currentFrequency !== null && previousFrequency !== null && currentFrequency > previousFrequency,
    costPerResultVsBaseline:
      costPerResult !== null && baseline && baseline.medianCostPerResult > 0
        ? costPerResult / baseline.medianCostPerResult
        : null,
    provisionalResults,
    resultsAreProvisional: rows.some((d) => isProvisional(d.date, maturity) && d.primaryResults > 0),
    analysed: {
      from: rows[0]?.date ?? maturity.completeThrough,
      to: rows[rows.length - 1]?.date ?? maturity.completeThrough,
    },
  }
}

/** "28 Jul – 3 Aug", for an evidence row's window. */
export function windowLabel(w: TrendWindow): string {
  if (!w.currentRange) return ''
  return rangeLabel(w.currentRange.from, w.currentRange.to)
}

/** True when both windows moved the same way and both actually resolved. */
export function directionallyConsistent(rapid: TrendWindow, confirm: TrendWindow): boolean {
  if (!rapid.complete || !confirm.complete) return false
  if (rapid.percentChange === null || confirm.percentChange === null) return false
  return Math.sign(rapid.percentChange) === Math.sign(confirm.percentChange)
}

/** Guard used by the tests: no window may reach into the incomplete present. */
export function windowEndsBeforeToday(w: TrendWindow, evaluationDate: string): boolean {
  if (!w.currentRange) return true
  return !isAfter(w.currentRange.to, addDays(evaluationDate, -1))
}
