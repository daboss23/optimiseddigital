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
