/**
 * Date arithmetic for the operator, all of it pure.
 *
 * Every function here takes the dates it works on. None of them reads the
 * clock. That is the whole point: "the last 3 complete days" has to mean the
 * same thing in a test pinned to a fixed evaluation date as it does in the
 * browser at 8am, or the 3v3 and 7v7 windows quietly slide and a suite starts
 * passing on Monday and failing on Thursday for no reason anyone can find.
 *
 * Dates are YYYY-MM-DD strings in the ad account's timezone. They are parsed as
 * UTC midnight purely as a stable arithmetic base — no local-time conversion
 * ever happens, so the account's own calendar is what the maths runs on.
 */

const DAY_MS = 86_400_000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * THE clock read. The only one in the operator, deliberately.
 *
 * It lives here, exported and obvious, so that "no pure function calls
 * `new Date()` internally" is a property you can check by grepping for this
 * name rather than a promise. Callers read it once at the boundary and inject
 * the result as `evaluationDate`; tests pass a fixed string and never call it.
 *
 * It resolves the date in the AD ACCOUNT's timezone, not the browser's. An
 * operator in London looking at a Brisbane account must see Brisbane's
 * yesterday, or "the last complete day" means two different things to the two
 * people reading the same card.
 */
export function todayIn(timezone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is the shape the whole module speaks.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/** Parse a YYYY-MM-DD date to epoch ms at UTC midnight. NaN when malformed. */
export function dateValue(iso: string): number {
  if (!ISO_DATE.test(iso)) return Number.NaN
  return Date.parse(`${iso}T00:00:00Z`)
}

export function isValidDate(iso: string): boolean {
  return Number.isFinite(dateValue(iso))
}

/** Format epoch ms back to YYYY-MM-DD. */
export function fromValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return fromValue(dateValue(iso) + days * DAY_MS)
}

/** Whole days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateValue(b) - dateValue(a)) / DAY_MS)
}

export function isBefore(a: string, b: string): boolean {
  return dateValue(a) < dateValue(b)
}

export function isAfter(a: string, b: string): boolean {
  return dateValue(a) > dateValue(b)
}

export function isSameOrBefore(a: string, b: string): boolean {
  return dateValue(a) <= dateValue(b)
}

export function minDate(a: string, b: string): string {
  return isBefore(a, b) ? a : b
}

export function maxDate(a: string, b: string): string {
  return isAfter(a, b) ? a : b
}

/** The date part of an ISO timestamp, in the same YYYY-MM-DD shape. */
export function dayOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10)
}

/**
 * ISO-8601 week bucket, e.g. `2026-W33`.
 *
 * The proposal fingerprint includes this so the same recommendation about the
 * same creative is one proposal all week — it does not become a new card every
 * morning and slip out from under its own cooldown.
 */
export function weekBucket(iso: string): string {
  const d = new Date(dateValue(iso))
  // ISO weeks run Monday–Sunday and belong to the year containing their Thursday.
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const year = d.getUTCFullYear()
  const jan1 = Date.UTC(year, 0, 1)
  const week = Math.ceil(((d.getTime() - jan1) / DAY_MS + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** "3 Aug" / "3 Aug 2025" — compact, unambiguous, no locale surprises. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function shortDate(iso: string, withYear = false): string {
  if (!isValidDate(iso)) return iso
  const [y, m, d] = iso.split('-')
  const label = `${Number(d)} ${MONTHS[Number(m) - 1]}`
  return withYear ? `${label} ${y}` : label
}

/** "28 Jul – 3 Aug" — the window a figure was measured over. */
export function rangeLabel(from: string, to: string): string {
  return `${shortDate(from)} – ${shortDate(to)}`
}
