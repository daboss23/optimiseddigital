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

/**
 * The REST endpoint's own parameter names, which are NOT the ones its MCP
 * wrapper takes — the wrapper translates, and building against its vocabulary
 * shipped a tab that returned "Unrecognized parameter(s): geo, limit, compact".
 *
 *   limit   → per_page   (the REST convention across this API's endpoints)
 *   compact →            (MCP-only payload shaping; no REST equivalent)
 *   geo     → env-overridable, because the endpoint's name for the country
 *             filter is the one thing still unconfirmed. `gethookd:params`
 *             probes a live key and prints the value to set.
 */
/**
 * The endpoint's name for the country filter.
 *
 * `location`, confirmed against the live API by `npm run gethookd:params`:
 * `geo`, `countries` and `country` are all refused by name, and `geo` is what
 * the MCP wrapper takes — the wrapper-vs-REST split again. The default used to
 * be `geo`, so every search paid a wasted round trip to be refused and renamed
 * before it ran. Still env-overridable, because vendor names drift and a
 * confirmed name should never need a deploy.
 */
export function geoParam(): string {
  return (process.env.GETHOOKD_GEO_PARAM || 'location').trim()
}

/**
 * Filters whose refusal costs tidiness, not scope.
 *
 * A dropped country filter changes WHICH ads come back and must be reported. A
 * dropped variant-collapse changes only how many times the same creative is
 * listed. The two must not share a banner.
 */
const COSMETIC_PARAMS = new Set(['collapse_variants'])

/**
 * The static-ad archetypes worth learning from, by id.
 *
 * From `list_creative_categories`, which is the filter the product shows as
 * "Static ad style". Six of the eleven are here. The five left out are left
 * out on purpose: Promotion and Discount, Holiday/Seasonal, Humor/Fun, FAQ
 * Explainers and Media and Press are either DTC-specific or carry no
 * transferable construction — a seasonal sale graphic teaches a lead-gen ad
 * nothing, while a Before/After or an Us vs Them is the same machine whatever
 * it is selling.
 */
export const CRAFT_ARCHETYPES = [
  1, // Before and After
  2, // Testimonial - Reviews
  16, // Reasons why
  17, // Facts and Stats
  18, // Features and Benefits
  20, // Us vs Them
] as const

/** Cap the grid. Every row costs credits, and nobody studies 50 ads at once. */
const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
/** One advertiser running 180 creatives must not become the whole feed. */
const ADS_PER_BRAND = 2

/**
 * How far back a "currently working" ad may have LAUNCHED, in days.
 *
 * This is the single most important number on this surface, and shipping
 * without it is what filled the feed with 2018 dropshipping ads. The source
 * records an ad's run time from its start date to the last day it was seen,
 * and an ad that launched in 2018 and was never marked stopped reports ~3,200
 * days "live" — so ordering by duration returns the OLDEST RECORDS IN THE
 * DATABASE, not the best ads. Worse, the performance tier is largely derived
 * from that same duration, so the tier filter agrees with the bad sort instead
 * of correcting it: those zombies come back scored "Winning, 100".
 *
 * Bounding the launch date fixes it at the source. Inside the window, long
 * duration means what everyone assumes it means — this launched recently AND
 * is still running, which somebody is still paying for.
 */
const LAUNCH_WINDOW_DAYS = Number(process.env.GETHOOKD_LAUNCH_WINDOW_DAYS) || 540

/**
 * Minimum days an ad must have been running to count as proven.
 *
 * Duration inside a bounded window is honest evidence; the vendor's stored
 * tier is not. The tier is recorded at index time and re-checked at display
 * time, so a page asking for winning/optimized routinely has most of its rows
 * WITHHELD as stale — six found, five thrown away, one rendered. That is why
 * the grid looked half-empty. Run time is computed from dates on the row and
 * cannot go stale between the two checks.
 *
 * Ninety days, so that BOTH surfaces mean the same thing by "proven": what the
 * agents research automatically and what an operator browses by hand are the
 * same bar. A quarter of continuous spend on one static creative is the
 * strongest signal this source can give, and the library holds hundreds of
 * them per focus — the bar is not what empties a feed here, a long free-text
 * query is.
 */
const MIN_DAYS_ACTIVE = Number(process.env.GETHOOKD_MIN_DAYS_ACTIVE) || 90

/**
 * The earliest launch date still inside the window, as YYYY-MM-DD.
 *
 * `null` means no bound at all — the caller has taken responsibility for the
 * zombie rows this guards against, which only the automatic research layer
 * does (it re-checks run time on every row and caps the upper end itself).
 */
function launchedAfter(windowDays: number | null, now: Date = new Date()): string | undefined {
  if (windowDays === null) return undefined
  const d = new Date(now.getTime() - windowDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

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
 * "Proven" is defined here as: launched inside `LAUNCH_WINDOW_DAYS`, still
 * running, and running for at least `MIN_DAYS_ACTIVE`. Deliberately NOT the
 * vendor's performance tier — that score is largely a function of raw run
 * time, so it rates a 2018 record nobody ever closed as "Winning, 100", and it
 * goes stale between indexing and display, which withholds most of a page.
 *
 * Duration still orders the feed, because an advertiser does not keep paying
 * for a loser. That reasoning is only sound inside the launch window: applied
 * to the whole corpus it returns the oldest rows in the database instead of
 * the best ads. The window is what makes the sort mean anything.
 *
 * With a query, relevance leads and duration becomes the tiebreaker; that is
 * the source's ordering contract and fighting it returns worse ads, not
 * better ones.
 */
export async function searchProvenAds(q: ProvenAdQuery = {}): Promise<ProvenAdResult> {
  const focus: IcpFocus = q.focus ?? 'all'
  const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const page = Math.min(Math.max(Number(q.page) || 1, 1), 20)
  const query = (q.query ?? '').trim()
  const sort = q.sort ?? 'longest'

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
    // Without this the source silently relaxes the term: it matches partial
    // words, drops words and adds similar meanings, so a search for
    // "contractor" comes back full of ads that merely say "contract" — car
    // loan claims, phone plans. Those rows bill like any other, and a feed of
    // confidently wrong ads is worse than an empty one.
    strict_query: query ? 'true' : undefined,
    // `library` scope drops the niche filter deliberately — see ProvenAdQuery.
    niche: q.scope === 'library' ? undefined : nicheCsvFor(focus),
    creative_categories: q.creativeCategories?.length ? q.creativeCategories.join(',') : undefined,
    [geoParam()]: (q.geo ?? defaultGeo()) || undefined,
    performance_scores: TIER_FILTER[q.tier ?? 'all'],
    ad_format: FORMAT_FILTER[q.format ?? 'all'],
    // Proof of life, in two halves: launched inside the window, and running a
    // while since. Together they mean "someone is still paying for this".
    started_after: launchedAfter(
      q.launchWindowDays === undefined ? LAUNCH_WINDOW_DAYS : q.launchWindowDays,
    ),
    run_time: q.minDaysActive ?? MIN_DAYS_ACTIVE,
    status: 'active',
    // Ordering only bites when no query is set — a text query outranks the
    // sort column and this becomes a tiebreaker within a relevance tier.
    // Sending it always is harmless and keeps the intent visible at the call
    // site. Safe to sort on duration ONLY because started_after bounds what
    // can appear.
    sort_column: sort === 'newest' ? 'start_date' : 'days_active',
    sort_direction: 'desc',
    // With a query, relevance leads and the column above only breaks ties — so
    // "newest" silently returns the same relevance-ordered page as "longest"
    // unless strict ordering is demanded. Asked for only when the operator
    // picked an order AND typed a term, because the trade is real: strict
    // ordering can rank a weak match above a strong one.
    sort_strict: sort === 'newest' && query ? 'true' : undefined,
    ads_per_brand_limit: ADS_PER_BRAND,
    // One creative re-uploaded under several ad ids is one lesson, and every
    // copy of it is billed like a separate ad. The source can collapse them
    // per request; a filter it refuses is dropped by the transport, so this
    // can only ever cost a round trip, never the feed.
    collapse_variants: 'true',
    per_page: limit,
    page,
  })

  const credits =
    res.usedCredits !== undefined || res.remainingCredits !== undefined
      ? { used: res.usedCredits ?? 0, remaining: res.remainingCredits ?? 0 }
      : undefined

  if (!res.ok) {
    return { configured: true, source: 'gethookd', ads: [], hasMore: false, credits, note: res.note }
  }

  const ads = (res.data ?? [])
    .map((r) => normalise(r, focus))
    .filter((a): a is ProvenAd => a !== null)
    // The archetype tag does not buy construction on its own — the library
    // files untreated product photos under one. A headline is the cheapest
    // evidence the ad was designed rather than uploaded.
    .filter((a) => !q.requireHeadline || a.title.trim().length > 0)
  const meta = res.meta ?? {}
  const total = typeof meta.total === 'number' ? meta.total : undefined
  const hasMore = meta.has_more === true

  // A filter the endpoint refused means these rows are WIDER than what was
  // asked for. Saying so is the whole point: silently serving global ads to
  // someone who selected their own markets is a worse failure than an error,
  // because it looks like it worked.
  //
  // Except for the ones that do not change the SCOPE. Refusing to collapse
  // duplicate variants returns the same market with the same ads in it, just
  // listed more than once — worth a wasted round trip, not worth a banner.
  // Warning about a filter that changed nothing is how an operator learns to
  // ignore a banner that means something.
  const dropped = (res.droppedParams ?? []).filter((name) => !COSMETIC_PARAMS.has(name))
  const widened = dropped.length
    ? dropped.includes(geoParam())
      ? 'Showing ads from all markets — this endpoint did not accept the country filter. Run `npm run gethookd:params` to find its current name.'
      : `Showing wider results — the ad library did not accept: ${dropped.join(', ')}.`
    : undefined

  return {
    configured: true,
    source: 'gethookd',
    ads,
    total,
    hasMore,
    credits,
    note: ads.length
      ? widened
      : [
          query
            ? `No proven ads matched "${query}" in this focus. Terms are matched exactly, so try a single broader word — or clear it to browse what is running now.`
            : 'No proven ads are running in this focus right now. Widen the format, or switch focus.',
          widened,
        ]
          .filter(Boolean)
          .join(' '),
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
