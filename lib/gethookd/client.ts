/**
 * GetHookd REST client — the transport, and nothing else.
 *
 * The Ad Library's MCP server is an authoring-time convenience; a deployed
 * Next.js route cannot use it, so the platform talks to the same corpus over
 * REST with its own credential (`GETHOOKD_API_KEY`). The base URL is
 * env-overridable for the same reason every vendor endpoint in this codebase
 * is: they drift, and a drifted host should be a dashboard edit, not a deploy.
 *
 * Never throws. Every failure resolves to a typed result carrying a
 * builder-facing `note`, because the Ad Library must still render its
 * paste-to-clone path when the source is down, unkeyed or out of credits.
 */

const DEFAULT_BASE = 'https://app.gethookd.ai/api/v1'
const TIMEOUT_MS = Number(process.env.GETHOOKD_TIMEOUT_MS) || 20_000

export interface GetHookdResponse<T> {
  ok: boolean
  data: T | null
  meta: Record<string, unknown> | null
  usedCredits?: number
  remainingCredits?: number
  /** Present only on failure. Safe to show a builder. */
  note?: string
  /**
   * Filters the API refused by name and the retry therefore dropped. Non-empty
   * means the rows came back LESS filtered than asked for, which the caller
   * must report rather than pass off as a clean result.
   */
  droppedParams?: string[]
}

/**
 * The API names every parameter it does not recognise, e.g.
 * "Unrecognized parameter(s): geo, limit, compact". That is a gift: a vendor
 * that renames a filter tells us exactly which one, so the request can be
 * retried without it instead of failing the whole surface.
 */
function unrecognisedParams(message: string | undefined): string[] {
  if (!message) return []
  const m = /unrecognized parameter\(s\)\s*:\s*(.+)/i.exec(message)
  if (!m) return []
  return m[1]!
    .split(',')
    .map((s) => s.trim().replace(/[.'"`]/g, ''))
    .filter(Boolean)
}

export function gethookdConfigured(): boolean {
  return Boolean((process.env.GETHOOKD_API_KEY ?? '').trim())
}

function base(): string {
  return (process.env.GETHOOKD_API_BASE || DEFAULT_BASE).replace(/\/+$/, '')
}

/** Drop empty values so an unset filter never becomes `&niche=` on the wire. */
function toQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s) q.set(k, s)
  }
  return q.toString()
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * One GET against the ad library. `T` is the shape of the `data` array/object
 * the endpoint returns; the envelope (`meta`, credit counters) is unwrapped
 * here so callers never parse it twice.
 */
async function gethookdGetOnce<T>(
  path: string,
  params: Record<string, string | number | undefined | null> = {},
): Promise<GetHookdResponse<T>> {
  const key = (process.env.GETHOOKD_API_KEY ?? '').trim()
  if (!key) {
    return {
      ok: false,
      data: null,
      meta: null,
      note: 'GetHookd is not connected. Add GETHOOKD_API_KEY to your environment to browse the proven-ad library.',
    }
  }

  const query = toQuery(params)
  const url = `${base()}/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    // An auth failure is the one error worth naming precisely — it is almost
    // always a pasted key with a stray space, and "unavailable" sends the
    // operator looking in the wrong place.
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        data: null,
        meta: null,
        note: 'GetHookd rejected the API key. Check GETHOOKD_API_KEY is current and has ad-library scope.',
      }
    }
    if (res.status === 402 || res.status === 429) {
      return {
        ok: false,
        data: null,
        meta: null,
        note:
          res.status === 402
            ? 'GetHookd credits are exhausted. Top up the account to keep pulling ads.'
            : 'GetHookd is rate-limiting this account. Wait a moment and search again.',
      }
    }

    const json = (await res.json().catch(() => null)) as {
      data?: T
      meta?: Record<string, unknown>
      errors?: unknown
      message?: string
      used_credits?: number
      remaining_credits?: number
    } | null

    if (!res.ok || !json || json.errors) {
      const message = json?.message
      return {
        ok: false,
        data: null,
        meta: null,
        note: message || `GetHookd returned ${res.status}. Paste an ad below to clone it in the meantime.`,
        droppedParams: unrecognisedParams(message),
      }
    }

    return {
      ok: true,
      data: (json.data ?? null) as T | null,
      meta: json.meta ?? null,
      usedCredits: num(json.used_credits),
      remainingCredits: num(json.remaining_credits),
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      meta: null,
      note:
        err instanceof Error && err.name === 'AbortError'
          ? 'GetHookd timed out. Try a narrower search, or paste an ad below to clone it.'
          : 'GetHookd is unreachable right now. Paste an ad below to clone it instead.',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One GET, retried once without any filter the API refused by name.
 *
 * Vendor parameter names drift, and this endpoint's names differ from the ones
 * its MCP wrapper takes. A rename should cost a filter, not the whole feature:
 * losing a country filter returns ads from more markets, which is worth
 * showing; returning nothing is not. What it must never do is pretend — the
 * dropped names ride back so the surface can say the results are wider than
 * asked for, and `npm run gethookd:params` finds the endpoint's current name so
 * the filter can be restored with an env var rather than a deploy.
 *
 * Exactly one retry. A second would mean the API is refusing something we send
 * unconditionally, and quietly stripping our way down to an unfiltered, fully
 * billed search is worse than one honest failure.
 */
export async function gethookdGet<T>(
  path: string,
  params: Record<string, string | number | undefined | null> = {},
): Promise<GetHookdResponse<T>> {
  const first = await gethookdGetOnce<T>(path, params)
  const refused = (first.droppedParams ?? []).filter((name) => name in params)
  if (first.ok || refused.length === 0) return first

  const retried: Record<string, string | number | undefined | null> = { ...params }
  for (const name of refused) delete retried[name]

  const second = await gethookdGetOnce<T>(path, retried)
  return { ...second, droppedParams: refused }
}
