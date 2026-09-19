/**
 * ICP — who this platform researches ads FOR.
 *
 * The deployment's own identity resolves in `lib/tenant.ts` (connected website
 * → env → neutral). This is the other half of that question: which slice of the
 * ad library is worth showing. They are deliberately separate — a marketing
 * operator IS an agency, but the ads they need to study are their CLIENTS'
 * categories, and collapsing the two makes the library research the agency
 * rather than the market.
 *
 * Two focuses, because that is the actual book of business: service businesses
 * (lead-gen, booked calls, quotes) and e-commerce (purchases, AOV, repeat).
 * They are separated rather than blended because the winning creative is
 * structurally different — a service ad sells a conversation, an e-commerce ad
 * sells a product — and an averaged feed of both teaches neither.
 *
 * GetHookd has no single "e-commerce" category; it classifies by product
 * vertical. So e-commerce is a SET of DTC verticals, and services is the set of
 * categories that sell time and expertise. Ids come from `list_niches` and are
 * stable; the titles are carried here only for labelling rows.
 */

export type IcpFocus = 'services' | 'ecommerce' | 'all'

/** Niche ids that sell time, expertise or a booked appointment. */
export const SERVICE_NICHE_IDS = [25, 7, 24, 22, 12, 18, 9] as const

/** Niche ids that sell a physical product to a consumer. */
export const ECOMMERCE_NICHE_IDS = [11, 5, 32, 30, 16, 17, 1, 23, 19, 13, 20, 26, 34] as const

/**
 * Niche id → title, for labelling a row without a second API round trip.
 * The leading emoji GetHookd ships is stripped: it reads as decoration in a
 * dense grid and the platform's type rules are "tight, clean, no decorative".
 */
export const NICHE_TITLES: Record<number, string> = {
  1: 'Accessories',
  2: 'Alcohol',
  3: 'App/Software',
  4: 'Automotive',
  5: 'Beauty',
  6: 'Book/Publishing',
  7: 'Business/Professional',
  8: 'Charity/NFP',
  9: 'Info',
  10: 'Entertainment',
  11: 'Fashion',
  12: 'Finance',
  13: 'Food/Drink',
  14: 'Games',
  15: 'Government',
  16: 'Health/Wellness',
  17: 'Home/Garden',
  18: 'Insurance',
  19: 'Jewelry/Watches',
  20: 'Kids/Baby',
  21: 'Media/News',
  22: 'Medical',
  23: 'Pets',
  24: 'Real Estate',
  25: 'Service Business',
  26: 'Sports/Outdoors',
  27: 'Tech',
  28: 'Travel',
  29: 'Other',
  30: 'Supplements',
  32: 'Skincare',
  33: 'CBD/Cannabis',
  34: 'Subscription Box',
}

export const ICP_FOCUSES: { id: IcpFocus; label: string; blurb: string }[] = [
  {
    id: 'services',
    label: 'Service Businesses',
    blurb: 'Lead-gen, booked calls and quotes — ads that sell a conversation.',
  },
  {
    id: 'ecommerce',
    label: 'E-commerce',
    blurb: 'DTC product verticals — ads that sell a purchase.',
  },
  { id: 'all', label: 'Both', blurb: 'The full ICP, services and e-commerce together.' },
]

/**
 * Markets this deployment sells into. Overridable without a redeploy.
 *
 * A FUNCTION, not a module-scope constant, so this file reads no environment at
 * import time and stays safely isomorphic — the Ad Library's client component
 * imports ICP_FOCUSES from here, and one source of truth for the ICP is worth
 * more than the constant.
 */
export function defaultGeo(): string {
  return (process.env.GETHOOKD_GEO || 'US,AU').trim()
}

export function isIcpFocus(value: unknown): value is IcpFocus {
  return value === 'services' || value === 'ecommerce' || value === 'all'
}

/** The niche ids a focus searches, as the CSV the ad library expects. */
export function nicheCsvFor(focus: IcpFocus): string {
  const ids =
    focus === 'services'
      ? SERVICE_NICHE_IDS
      : focus === 'ecommerce'
        ? ECOMMERCE_NICHE_IDS
        : [...SERVICE_NICHE_IDS, ...ECOMMERCE_NICHE_IDS]
  return ids.join(',')
}

/** Human label for a niche id, or '' when it is one we do not carry. */
export function nicheTitle(id: number | null | undefined): string {
  return id == null ? '' : (NICHE_TITLES[id] ?? '')
}

/** Which focus a niche id belongs to — used to label a row in the "Both" feed. */
export function focusOf(id: number | null | undefined): IcpFocus | null {
  if (id == null) return null
  if ((SERVICE_NICHE_IDS as readonly number[]).includes(id)) return 'services'
  if ((ECOMMERCE_NICHE_IDS as readonly number[]).includes(id)) return 'ecommerce'
  return null
}
