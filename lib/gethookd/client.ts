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
export async function gethookdGet<T>(
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
      return {
        ok: false,
        data: null,
        meta: null,
        note: json?.message || `GetHookd returned ${res.status}. Paste an ad below to clone it in the meantime.`,
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
