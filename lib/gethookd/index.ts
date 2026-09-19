/**
 * The proven-ad source — GetHookd's library, normalised into `ProvenAd`.
 *
 * This is the platform's answer to "show me what is already working in my
 * market". Meta's own ads_archive cannot answer it outside the EU (it returns
 * political/issue ads or nothing), which is why the Ad Library's search tab has
 * been a dead end and paste-to-clone carried the whole surface.
 *
 * Two disciplines are enforced here rather than left to callers:
 *
 *   1. COST. The source bills per returned row. Page size is capped, one brand
 *      can never fill the grid (`ads_per_brand_limit`), and the credits a query
 *      actually spent ride back in the result so the operator sees the price.
 *   2. HONESTY. A filtered-to-nothing feed says WHY it is empty. The source
 *      withholds rows whose indexed tier has gone stale, so a page can legally
 *      come back shorter than the page size — that is reported, never hidden
 *      behind "no results".
 */

import { gethookdGet, gethookdConfigured } from './client'
import { defaultGeo, nicheCsvFor, type IcpFocus } from './icp'
import type { AdFormat, ProvenAd, ProvenAdQuery, ProvenAdResult } from './types'

export * from './types'
export * from './icp'
export { gethookdConfigured }

/** Cap the grid. Every row costs credits, and nobody studies 50 ads at once. */
const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
/** One advertiser running 180 creatives must not become the whole feed. */
const ADS_PER_BRAND = 2

/* -------------------------------- the wire -------------------------------- */

interface RawMedia {
  type?: string
  thumbnail_url?: string | null
  download_url?: string | null
  resized_url?: string | null
  video_length_seconds?: number | null
}

interface RawAd {
  id?: number | string
  platform?: string | null
  countries?: string[] | null
  display_format?: string | null
  asset_type?: string | null
  title?: string | null
  body?: string | null
  landing_page?: string | null
  cta_text?: string | null
  days_active?: number | null
  performance_score?: number | null
  performance_score_title?: string | null
  share_url?: string | null
  primary_image_url?: string | null
  transcripts?: { content?: string | null }[] | null
  brand?: { id?: number; name?: string | null; logo_url?: string | null } | null
  media?: RawMedia[] | null
}

function toFormat(raw: RawAd): AdFormat {
  const v = (raw.asset_type || raw.display_format || '').toLowerCase()
  if (v.includes('carousel') || v === 'dco' || v === 'dpa') return 'carousel'
  if (v.includes('video')) return 'video'
  if (v.includes('image')) return 'image'
  return 'other'
}

/**
 * The still the design read and the grid both use. Prefer the ad-level signed
 * image; fall back to the first medium's thumbnail. Both are pre-signed URLs
 * the SPARK reader can fetch server-side without a credential.
 */
function toStill(raw: RawAd): string | undefined {
  const direct = raw.primary_image_url?.trim()
  if (direct) return direct
  for (const m of raw.media ?? []) {
    const t = (m.thumbnail_url || m.resized_url || '').trim()
    if (t) return t
  }
  return undefined
}

function toMedia(raw: RawAd): string | undefined {
  for (const m of raw.media ?? []) {
    const d = (m.download_url || '').trim()
    if (d) return d
  }
  return undefined
}

/** Longest transcript wins — duplicate media often carry the same words twice. */
function toTranscript(raw: RawAd): string | undefined {
  const best = (raw.transcripts ?? [])
    .map((t) => (t.content ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0]
  return best || undefined
}

function normalise(raw: RawAd, focus: IcpFocus): ProvenAd | null {
  const id = raw.id
  if (id === undefined || id === null) return null
  const media = raw.media ?? []
  return {
    id: `gethookd-${id}`,
    brand: raw.brand?.name?.trim() || 'Advertiser',
    brandId: raw.brand?.id,
    logoUrl: raw.brand?.logo_url?.trim() || undefined,
    title: raw.title?.trim() ?? '',
    body: raw.body?.trim() ?? '',
    transcript: toTranscript(raw),
    format: toFormat(raw),
    imageUrl: toStill(raw),
    mediaUrl: toMedia(raw),
    shareUrl: raw.share_url?.trim() || undefined,
    landingPage: raw.landing_page?.trim() || undefined,
    ctaText: raw.cta_text?.trim() || undefined,
    daysActive: typeof raw.days_active === 'number' ? raw.days_active : undefined,
    performanceScore: typeof raw.performance_score === 'number' ? raw.performance_score : undefined,
    performanceTier: raw.performance_score_title?.trim() || undefined,
    videoLength: media.find((m) => (m.video_length_seconds ?? 0) > 0)?.video_length_seconds ?? undefined,
    platforms: (raw.platform ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    countries: (raw.countries ?? []).filter(Boolean),
    // Never invented per row: the source does not return the ad's own niche, so
    // a row is labelled by the focus that FOUND it, and "all" labels nothing.
    focus: focus === 'all' ? null : focus,
  }
}

/* ------------------------------ query mapping ----------------------------- */

const TIER_FILTER: Record<NonNullable<ProvenAdQuery['tier']>, string | undefined> = {
  winning: 'winning',
  proven: 'winning,optimized',
  all: undefined,
}

const FORMAT_FILTER: Record<string, string | undefined> = {
  image: 'images',
  video: 'videos',
  carousel: 'carousels',
  all: undefined,
}

/**
 * Search the proven-ad library, scoped to the ICP.
 *
 * With no free-text query the source sorts strictly by how long each ad has
 * been running — the single most honest proxy for "this is working", since an
 * agency does not keep paying for a loser for 1,300 days. With a query,
 * relevance leads and duration becomes the tiebreaker; that is the source's
 * ordering contract and fighting it returns worse ads, not better ones.
 */
export async function searchProvenAds(q: ProvenAdQuery = {}): Promise<ProvenAdResult> {
  const focus: IcpFocus = q.focus ?? 'all'
  const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const page = Math.min(Math.max(Number(q.page) || 1, 1), 20)
  const query = (q.query ?? '').trim()

  if (!gethookdConfigured()) {
    return {
      configured: false,
      source: 'none',
      ads: [],
      hasMore: false,
      note: 'GetHookd is not connected. Add GETHOOKD_API_KEY to browse proven ads — paste-to-clone works without it.',
    }
  }

  const res = await gethookdGet<RawAd[]>('explore', {
    query: query || undefined,
    niche: nicheCsvFor(focus),
    geo: (q.geo ?? defaultGeo()) || undefined,
    performance_scores: TIER_FILTER[q.tier ?? 'proven'],
    ad_format: FORMAT_FILTER[q.format ?? 'all'],
    run_time: q.minDaysActive,
    status: 'active',
    // Ordering only bites when no query is set; sending it always is harmless
    // and keeps the intent visible at the call site.
    sort_column: 'days_active',
    sort_direction: 'desc',
    ads_per_brand_limit: ADS_PER_BRAND,
    limit,
    page,
    compact: 'true',
  })

  const credits =
    res.usedCredits !== undefined || res.remainingCredits !== undefined
      ? { used: res.usedCredits ?? 0, remaining: res.remainingCredits ?? 0 }
      : undefined

  if (!res.ok) {
    return { configured: true, source: 'gethookd', ads: [], hasMore: false, credits, note: res.note }
  }

  const ads = (res.data ?? []).map((r) => normalise(r, focus)).filter((a): a is ProvenAd => a !== null)
  const meta = res.meta ?? {}
  const total = typeof meta.total === 'number' ? meta.total : undefined
  const hasMore = meta.has_more === true

  return {
    configured: true,
    source: 'gethookd',
    ads,
    total,
    hasMore,
    credits,
    note: ads.length
      ? undefined
      : query
        ? `No proven ads matched "${query}" in this focus. Try a broader term, or clear it to browse the longest-running winners.`
        : 'No proven ads matched those filters. Widen the performance tier or the format.',
  }
}

/**
 * Everything the platform knows about an ad, as one block of text for the
 * Creative DNA extractor. Headline, primary text and the spoken words are the
 * three things a clone is actually built from.
 */
export function adToCloneText(ad: ProvenAd): string {
  return [ad.title, ad.body, ad.transcript].map((s) => (s ?? '').trim()).filter(Boolean).join('\n\n')
}
