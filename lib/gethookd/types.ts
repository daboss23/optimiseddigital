/**
 * The normalised shape an external ad source hands the platform.
 *
 * Deliberately provider-agnostic, exactly as `lib/video/types.ts` and
 * `lib/image/types.ts` are: the Ad Library UI renders a `ProvenAd`, never a
 * GetHookd row. When a second source is wired (Meta's ads_archive still sits
 * behind this as a fallback), it normalises into this same shape and nothing
 * above `lib/gethookd/` changes.
 */

import type { IcpFocus } from './icp'

export type AdFormat = 'image' | 'video' | 'carousel' | 'other'

/** GetHookd's performance tiers, coarsest first. */
export type PerformanceTier = 'testing' | 'scaling' | 'growing' | 'optimized' | 'winning'

export interface ProvenAd {
  /** Stable source id, prefixed so it can never collide with an ORACLE winner. */
  id: string
  brand: string
  brandId?: number
  logoUrl?: string
  /** Meta headline. */
  title: string
  /** Meta primary text. */
  body: string
  /** Spoken words, when the source has transcribed the video. */
  transcript?: string
  format: AdFormat
  /** Signed still the design read and the grid both use. */
  imageUrl?: string
  /** Full-resolution media, when it differs from the thumbnail. */
  mediaUrl?: string
  /** The ad on the source's own site — the "see the original" link. */
  shareUrl?: string
  landingPage?: string
  ctaText?: string
  /** Days the creative has been live. The honest proxy for "this is working". */
  daysActive?: number
  performanceScore?: number
  performanceTier?: string
  /** Seconds, for video rows. */
  videoLength?: number
  platforms: string[]
  countries: string[]
  nicheLabel?: string
  focus?: IcpFocus | null
}

export interface ProvenAdQuery {
  query?: string
  focus?: IcpFocus
  format?: AdFormat | 'all'
  /** Minimum performance tier to return. */
  tier?: 'winning' | 'proven' | 'all'
  /** Minimum days the ad has been running. */
  minDaysActive?: number
  /**
   * How far back the ad may have LAUNCHED, in days.
   *
   * Omitted keeps the library's own browse window. `null` removes the bound
   * entirely, which only the automatic research layer asks for: it wants a
   * two-year-old ad that is still running, and it re-checks run time on every
   * row itself rather than trusting the sort.
   */
  launchWindowDays?: number | null
  /**
   * Which slice of the library to search.
   *
   * `icp` (default) scopes to the focus's niches — the right answer when the
   * question is "what is working in MY market". `library` removes the niche
   * filter entirely, which is the right answer when the question is "what does
   * a well-built static ad look like": construction transfers across verticals
   * even though the argument does not, and the unscoped pool is roughly 60x
   * larger and visibly better made.
   */
  scope?: 'icp' | 'library'
  /**
   * Static-ad archetype ids — the filter the product calls "Static ad style"
   * (Before and After, Testimonial, Us vs Them, Facts and Stats, Reasons Why,
   * Features and Benefits). Ids come from `list_creative_categories`.
   *
   * This is the filter that makes breadth worth having: it buys CONSTRUCTION
   * rather than noise. Removing the niche filter without it returns the whole
   * market, most of which is an untreated product photo.
   */
  creativeCategories?: number[]
  /**
   * Require an on-ad headline before a row is served.
   *
   * The library files an untreated phone photo of a product under a static-ad
   * archetype at the same performance tier as a properly built ad beside it,
   * so the archetype tag alone does not buy construction. A headline is the
   * cheapest proof that somebody DESIGNED the thing. Used by the craft pool on
   * both surfaces; never applied to the market pool, where the argument
   * matters more than the treatment.
   */
  requireHeadline?: boolean
  /**
   * Apply the format and run-time bars to the RETURNED ROWS.
   *
   * On by default, because the endpoint refuses both filters under every
   * spelling probed and something has to hold the line — a page asked for
   * Static otherwise comes back carrying video.
   *
   * The automatic research layer turns it OFF: it re-checks eligibility on
   * every row itself (`isEligible`) and reports a thin result in its own
   * words. Filtering underneath it replaced that message with the source's,
   * so a run that found nothing stopped being able to say the bar had not
   * been lowered — which is the one thing it most needs to say.
   */
  enforceBars?: boolean
  /**
   * Feed ordering.
   *
   * `longest` is duration-first — the proof-of-life sort, and the default.
   * It is also deterministic: the top of a bounded, filtered pool is the same
   * rows today and next week, which is what makes a browse feed feel frozen.
   * `newest` orders by launch date so the same pool yields ads the operator
   * has not already seen.
   *
   * Duration-first is only sound INSIDE the launch window — applied to the
   * whole corpus it returns the oldest rows in the database.
   */
  sort?: 'longest' | 'newest'
  geo?: string
  limit?: number
  page?: number
}

/**
 * Credit accounting, passed through to the UI on purpose. The source bills per
 * returned row, so a search that quietly spends someone's balance is a bug even
 * when it returns good ads. The operator sees the price of the query they ran.
 */
export interface CreditUsage {
  used: number
  remaining: number
}

export interface ProvenAdResult {
  configured: boolean
  source: 'gethookd' | 'meta-archive' | 'none'
  ads: ProvenAd[]
  /** Upper bound on matches, as reported by the source. */
  total?: number
  hasMore: boolean
  credits?: CreditUsage
  /** Builder-facing explanation whenever the feed is empty or degraded. */
  note?: string
}
