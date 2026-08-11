/**
 * The one date range the analytics surfaces share.
 *
 * Every performance number on Meta Intelligence — totals, costs, charts,
 * breakdowns, rankings, trends and the status calculations themselves — derives
 * from a single `DateRange`. No component is allowed to quietly pick its own
 * window, which is why there is no "last 30 days" or "8 weeks" constant left
 * anywhere in the UI: the labels are rendered from the range in force.
 *
 * The deliberate exception is lifecycle metadata — days live, original launch
 * date, all-time status history. Those describe the creative's own life, not
 * the window being analysed, and are labelled as such wherever they appear.
 */

export type RangePreset =
  | 'last_7d'
  | 'last_14d'
  | 'last_30d'
  | 'last_90d'
  | 'this_month'
  | 'last_month'
  | 'custom'

export interface DateRange {
  /** Inclusive start, YYYY-MM-DD in the range's timezone. */
  from: string
  /** Inclusive end, YYYY-MM-DD. */
  to: string
  preset: RangePreset
  /** IANA timezone the range is expressed in — carried on every request. */
  timezone: string
}

export const DEFAULT_PRESET: RangePreset = 'last_30d'
export const DEFAULT_TIMEZONE = 'UTC'

export const RANGE_PRESETS: { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { id: 'last_7d', label: 'Last 7 days' },
  { id: 'last_14d', label: 'Last 14 days' },
  { id: 'last_30d', label: 'Last 30 days' },
  { id: 'last_90d', label: 'Last 90 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
]

const DAY_MS = 86_400_000

/* --------------------------------- helpers -------------------------------- */

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseISODate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function shift(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

/** Number of days the range covers, inclusive of both ends. */
export function rangeDays(r: DateRange): number {
  const a = parseISODate(r.from)
  const b = parseISODate(r.to)
  if (!a || !b) return 1
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / DAY_MS) + 1)
}

/* -------------------------------- resolution ------------------------------- */

/** Build a range from a preset, anchored on `today` (UTC date). */
export function rangeFromPreset(preset: RangePreset, timezone = DEFAULT_TIMEZONE, now = new Date()): DateRange {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const mk = (from: Date, to: Date): DateRange => ({
    from: toISODate(from),
    to: toISODate(to),
    preset,
    timezone,
  })

  switch (preset) {
    case 'last_7d':
      return mk(shift(today, -6), today)
    case 'last_14d':
      return mk(shift(today, -13), today)
    case 'last_90d':
      return mk(shift(today, -89), today)
    case 'this_month':
      return mk(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), today)
    case 'last_month': {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
      return mk(first, last)
    }
    case 'last_30d':
    case 'custom':
    default:
      return { ...mk(shift(today, -29), today), preset: preset === 'custom' ? 'custom' : 'last_30d' }
  }
}

/**
 * Resolve the range for a request. Explicit from/to always wins (that is what
 * a shared URL carries); otherwise the named preset; otherwise the default.
 * Invalid or inverted input falls back rather than throwing — a malformed link
 * must never take the dashboard down.
 */
export function resolveRange(params: {
  from?: string | null
  to?: string | null
  preset?: string | null
  tz?: string | null
  now?: Date
}): DateRange {
  const timezone = params.tz && params.tz.length < 64 ? params.tz : DEFAULT_TIMEZONE
  const preset = (params.preset ?? '') as RangePreset

  const from = params.from ? parseISODate(params.from) : null
  const to = params.to ? parseISODate(params.to) : null
  if (from && to && from.getTime() <= to.getTime()) {
    const explicit: DateRange = {
      from: toISODate(from),
      to: toISODate(to),
      preset: 'custom',
      timezone,
    }
    // A custom range that exactly matches a preset keeps the preset's name, so
    // the control reads "Last 30 days" rather than a date pair.
    for (const p of RANGE_PRESETS) {
      const candidate = rangeFromPreset(p.id, timezone, params.now)
      if (candidate.from === explicit.from && candidate.to === explicit.to) {
        return { ...explicit, preset: p.id }
      }
    }
    return explicit
  }

  const known = RANGE_PRESETS.some((p) => p.id === preset)
  return rangeFromPreset(known ? preset : DEFAULT_PRESET, timezone, params.now)
}

/**
 * The comparison window: the equally long period immediately before this one.
 * Every "vs prior period" delta and every fatigue trend is measured against it.
 */
export function previousRange(r: DateRange): DateRange {
  const days = rangeDays(r)
  const from = parseISODate(r.from)
  if (!from) return r
  const prevTo = shift(from, -1)
  const prevFrom = shift(prevTo, -(days - 1))
  return { from: toISODate(prevFrom), to: toISODate(prevTo), preset: 'custom', timezone: r.timezone }
}

/* -------------------------------- labelling -------------------------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDay(iso: string): string {
  const d = parseISODate(iso)
  if (!d) return iso
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Last 30 days" for a preset, "Jul 13 – Aug 11" for a custom window. */
export function rangeLabel(r: DateRange): string {
  const preset = RANGE_PRESETS.find((p) => p.id === r.preset)
  if (preset) return preset.label
  return `${formatDay(r.from)} – ${formatDay(r.to)}`
}

/** The precise window, always available even when a preset name is shown. */
export function rangeSubLabel(r: DateRange): string {
  return `${formatDay(r.from)} – ${formatDay(r.to)} · ${rangeDays(r)} days · ${r.timezone}`
}

/* ------------------------------- serialisation ----------------------------- */

/** URL params for the range — the shareable, navigable representation. */
export function rangeParams(r: DateRange): URLSearchParams {
  const p = new URLSearchParams()
  p.set('from', r.from)
  p.set('to', r.to)
  if (r.preset !== 'custom') p.set('preset', r.preset)
  if (r.timezone !== DEFAULT_TIMEZONE) p.set('tz', r.timezone)
  return p
}

export function rangeQuery(r: DateRange): string {
  return rangeParams(r).toString()
}

/** Stable cache key for a resolved range. */
export function rangeKey(r: DateRange): string {
  return `${r.from}_${r.to}_${r.timezone}`
}

/* --------------------------------- buckets --------------------------------- */

export interface TrendBucket {
  /** Short axis label, e.g. "Aug 4" or "W3". */
  label: string
  from: string
  to: string
}

/**
 * Split the range into chart buckets. Short windows read daily, long windows
 * read weekly — so the trend chart always reflects the SELECTED range instead
 * of a fixed eight weeks.
 */
export function trendBuckets(r: DateRange, maxBuckets = 8): TrendBucket[] {
  const days = rangeDays(r)
  const from = parseISODate(r.from)
  if (!from) return []
  const count = Math.min(maxBuckets, days)
  const size = Math.ceil(days / count)
  const buckets: TrendBucket[] = []
  for (let i = 0; i < count; i++) {
    const start = shift(from, i * size)
    if ((start.getTime() - from.getTime()) / DAY_MS >= days) break
    const endOffset = Math.min(i * size + size - 1, days - 1)
    const end = shift(from, endOffset)
    buckets.push({
      label: size === 1 ? formatDay(toISODate(start)) : `${formatDay(toISODate(start))}`,
      from: toISODate(start),
      to: toISODate(end),
    })
  }
  return buckets
}

/** Graph API `time_range` value for a range. */
export function graphTimeRange(r: DateRange): string {
  return JSON.stringify({ since: r.from, until: r.to })
}
