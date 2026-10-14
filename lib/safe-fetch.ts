import { assertSafeUrl } from '@/lib/website-intelligence'

/**
 * fetch() for URLs that came from outside the platform — a store a brand
 * connected, a product page it links to, a render URL a client posted.
 *
 * Every redirect hop is re-validated against the SSRF guard. Letting fetch
 * follow redirects on its own is how a public URL that answers 302 to a
 * private address reads something on the platform's own network; checking
 * only the first URL checks the one hop nobody attacks.
 *
 * Returns null — never throws — when the URL or any hop is unsafe, the host is
 * unreachable, or the clock runs out. A non-2xx response is returned as-is so
 * the caller can tell "not found" from "not reachable".
 */

const MAX_REDIRECTS = 4
const DEFAULT_TIMEOUT_MS = 12_000

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

export async function safeFetch(
  url: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ res: Response; finalUrl: string } | null> {
  let current: string
  try {
    current = assertSafeUrl(url).toString()
  } catch {
    return null
  }
  const deadline = AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response
    try {
      res = await fetch(current, {
        headers: { 'User-Agent': BROWSER_UA, ...init.headers },
        redirect: 'manual',
        signal: deadline,
      })
    } catch {
      return null
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      try {
        current = assertSafeUrl(new URL(loc, current).toString()).toString()
      } catch {
        return null
      }
      continue
    }
    return { res, finalUrl: current }
  }
  return null
}

/**
 * The body as bytes, refused past `maxBytes` — checked against the declared
 * length first and the bytes actually read second, because a server is free
 * to lie in the header.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  try {
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.byteLength > maxBytes ? null : buf
  } catch {
    return null
  }
}
