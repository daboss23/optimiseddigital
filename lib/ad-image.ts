// Ad image intake — turns whatever the strategist drops into SPARK (uploaded
// files, pasted screenshots, direct image links, or a page that contains the
// ad) into vision-ready image blocks for the Claude Messages API.
//
// Everything here is best-effort and NEVER throws: an unreachable link, a
// hotlink-blocked CDN, or a JavaScript-rendered board simply yields no images
// plus a human-readable note explaining what to do instead (drop the
// screenshot in). The analyzer always stays usable.

import type { MeasuredSwatch } from '@/lib/palette'

/** A normalised image ready to be sent to a vision model. */
export interface AdImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  /** Base64 payload with no `data:` prefix. */
  data: string
  /** Where this image came from, for telemetry and the source label. */
  label: string
  /**
   * The colours measured from this image's actual pixels, when the browser
   * could sample them before upload. Ground truth for the design read — see
   * lib/palette.ts. Absent for images fetched server-side from a link.
   */
  palette?: MeasuredSwatch[]
}

export interface ResolvedAdImages {
  images: AdImage[]
  /** Human-readable notes about what could and could not be read. */
  notes: string[]
}

/** Claude accepts up to 5MB per image; stay well under once base64 inflates it. */
const MAX_IMAGE_BYTES = 3_500_000
/** More than this and the read stops being about one ad's design. */
export const MAX_AD_IMAGES = 4
const FETCH_TIMEOUT_MS = 12_000

const SUPPORTED: Record<string, AdImage['mediaType']> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
}

// Browsers send a real User-Agent or many CDNs return 403. Mimicking one is the
// difference between reading a public ad screenshot and getting nothing.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,text/html;q=0.9,*/*;q=0.8',
} as const

function normaliseMediaType(raw: string | null | undefined): AdImage['mediaType'] | null {
  if (!raw) return null
  return SUPPORTED[raw.split(';')[0]!.trim().toLowerCase()] ?? null
}

/** Guess a media type from a file extension when the server sends none. */
function mediaTypeFromUrl(url: string): AdImage['mediaType'] | null {
  const ext = url.split('?')[0]!.split('#')[0]!.toLowerCase()
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg'
  if (ext.endsWith('.png')) return 'image/png'
  if (ext.endsWith('.webp')) return 'image/webp'
  if (ext.endsWith('.gif')) return 'image/gif'
  return null
}

/* ------------------------------ data: URLs -------------------------------- */

/**
 * Parse a `data:image/...;base64,...` URL (what the browser hands us after a
 * drop / paste / file pick). Returns null for anything malformed or unsupported.
 */
export function parseDataUrl(value: string, label = 'Uploaded image'): AdImage | null {
  // [\s\S] rather than the `s` flag — the build targets ES2017.
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(value.trim())
  if (!match) return null
  const mediaType = normaliseMediaType(match[1])
  if (!mediaType) return null
  const data = match[2]!.replace(/\s/g, '')
  if (!data) return null
  // base64 inflates ~4/3; check the decoded size against the cap.
  if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) return null
  return { mediaType, data, label }
}

/* ---------------------------- remote fetching ------------------------------ */

/** Fetch a direct image URL into base64. Returns null on any failure. */
export async function fetchImage(url: string, label?: string): Promise<AdImage | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const mediaType = normaliseMediaType(res.headers.get('content-type')) ?? mediaTypeFromUrl(url)
    if (!mediaType) return null

    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null

    return { mediaType, data: buf.toString('base64'), label: label ?? url }
  } catch {
    return null
  }
}

/* --------------------------- page image discovery -------------------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// Assets that are never the ad itself — logos, icons, spinners, tracking pixels.
const JUNK = /sprite|favicon|logo|icon|avatar|placeholder|spinner|loading|pixel|badge|pattern|pattern\.svg/i

function isPlausibleImage(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  if (/\.svg(\?|#|$)/i.test(url)) return false
  return !JUNK.test(url)
}

/**
 * Pull candidate image URLs out of a page's HTML. Handles the three places an
 * ad screenshot actually lives: social preview meta tags, plain <img> tags, and
 * image URLs inlined in a single-page app's JSON payload (which is how most
 * modern "board"/gallery apps ship their data).
 *
 * Ordered best-first: og:image is the page's own idea of its hero image.
 */
export function discoverImageUrls(html: string, baseUrl: string): string[] {
  const found: string[] = []
  const push = (raw: string | undefined) => {
    if (!raw) return
    try {
      const abs = new URL(decodeEntities(raw.trim()), baseUrl).toString()
      if (isPlausibleImage(abs) && !found.includes(abs)) found.push(abs)
    } catch {
      /* unresolvable href — skip */
    }
  }

  // 1. Social preview meta tags (content can precede or follow the name attr).
  const metaKeys = /(og:image(?::secure_url|:url)?|twitter:image(?::src)?)/i
  for (const tag of html.match(/<meta\s+[^>]*>/gi) ?? []) {
    if (!metaKeys.test(tag)) continue
    push(/content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1])
  }
  push(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1])

  // 2. Real <img> tags — src, then common lazy-loading attributes.
  for (const tag of html.match(/<img\s+[^>]*>/gi) ?? []) {
    push(
      /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
        /\sdata-src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ??
        /\sdata-lazy-src\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1],
    )
  }

  // 3. Image URLs embedded in inlined JSON (Next.js __NEXT_DATA__, Nuxt, and
  //    most SPA board apps hydrate from a payload like this). Without this
  //    step a client-rendered gallery yields nothing at all.
  // Path segments may be JSON-escaped (`https:\/\/host\/a\/b.jpg`), so each
  // character is either an ordinary one or an escaped slash — a plain
  // "anything but backslash" class would stop dead at the first `\/`.
  const seg = '(?:[^"\'\\s\\\\]|\\\\\\/)'
  const embedded = new RegExp(
    `https?:(?:\\\\?\\/){2}${seg}+?\\.(?:jpe?g|png|webp)(?:\\?${seg}*)?`,
    'gi',
  )
  for (let m = embedded.exec(html); m !== null; m = embedded.exec(html)) {
    push(m[0].replace(/\\\//g, '/'))
  }

  return found
}

/**
 * Fetch a page and return the images it references. Returns an empty list (not
 * an error) when the page is unreachable or renders its content purely
 * client-side — the caller turns that into guidance for the user.
 */
export async function imagesFromPage(pageUrl: string, limit: number): Promise<AdImage[]> {
  let html = ''
  try {
    const res = await fetch(pageUrl, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return []

    // The link may point straight at an image rather than a page.
    const direct = normaliseMediaType(res.headers.get('content-type'))
    if (direct) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) return []
      return [{ mediaType: direct, data: buf.toString('base64'), label: pageUrl }]
    }

    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return []
    html = await res.text()
  } catch {
    return []
  }

  const candidates = discoverImageUrls(html, pageUrl).slice(0, limit * 3)
  const images: AdImage[] = []
  // Sequential on purpose: stop as soon as we have enough rather than hammering
  // the host for images we would discard.
  for (const url of candidates) {
    if (images.length >= limit) break
    const img = await fetchImage(url, url)
    if (img) images.push(img)
  }
  return images
}

/* -------------------------------- Resolver --------------------------------- */

/**
 * Resolve every image input the analyzer accepts into vision-ready blocks.
 *
 * - `images`: data: URLs from drag/drop/paste/file-pick, or direct https image
 *   links. These are the reliable path and are always tried first.
 * - `url`: a direct image link, or a page containing the ad. Only consulted
 *   when there is still room, so an upload is never displaced by a scrape.
 */
export async function resolveAdImages(input: {
  images?: string[]
  /**
   * Palettes measured in the browser, indexed to match `images`. Kept aligned
   * by index rather than merged into the payload so an older client that sends
   * plain data URLs keeps working unchanged.
   */
  palettes?: (MeasuredSwatch[] | undefined)[]
  url?: string
  max?: number
}): Promise<ResolvedAdImages> {
  const limit = Math.max(1, Math.min(input.max ?? MAX_AD_IMAGES, MAX_AD_IMAGES))
  const images: AdImage[] = []
  const notes: string[] = []
  let rejectedUploads = 0

  const sources = input.images ?? []
  for (let i = 0; i < sources.length; i += 1) {
    if (images.length >= limit) break
    const value = sources[i]?.trim()
    if (!value) continue
    const palette = input.palettes?.[i]

    if (value.startsWith('data:')) {
      const parsed = parseDataUrl(value, `Uploaded image ${images.length + 1}`)
      if (parsed) images.push({ ...parsed, palette })
      else rejectedUploads += 1
      continue
    }

    if (/^https?:\/\//i.test(value)) {
      const fetched = await fetchImage(value)
      if (fetched) images.push({ ...fetched, palette })
      else rejectedUploads += 1
    }
  }

  if (rejectedUploads > 0) {
    notes.push(
      `${rejectedUploads} image${rejectedUploads > 1 ? 's' : ''} could not be read — SPARK reads JPEG, PNG, WebP and GIF up to ~3.5MB each.`,
    )
  }

  const url = input.url?.trim()
  if (url && images.length < limit) {
    const fromUrl = await imagesFromPage(url, limit - images.length)
    if (fromUrl.length) {
      images.push(...fromUrl)
    } else {
      notes.push(
        'No image could be read from that link. Boards and ad-library pages usually render their creatives with JavaScript after load, so there is nothing for a server to fetch — screenshot the ad and drop it in instead.',
      )
    }
  }

  return { images: images.slice(0, limit), notes }
}
