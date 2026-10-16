/**
 * The Platform Library's niche tags — which brands a section of method is for.
 *
 * Isomorphic on purpose: the owner's upload screen offers these chips and the
 * server matches against them, so the vocabulary is defined once. The
 * e-commerce verticals are the ad library's own (`lib/gethookd/icp.ts`), so a
 * brand's catalog read (`inferNiches`) maps straight onto a library tag.
 *
 * Keys, not labels, are stored: a relabelled vertical must not orphan the
 * sections already tagged with it.
 */

import { ECOMMERCE_VERTICALS } from '@/lib/gethookd/icp'

export interface LibraryNiche {
  key: string
  label: string
  /** Where the chip sits on the upload screen. */
  group: 'broad' | 'vertical' | 'other'
}

/** Every brand on the platform, whatever it sells. */
export const NICHE_ALL = 'all'
/** Every e-commerce brand — which, today, is every brand. */
export const NICHE_ECOMMERCE = 'ecommerce'

export const LIBRARY_NICHES: LibraryNiche[] = [
  { key: NICHE_ALL, label: 'Every brand', group: 'broad' },
  { key: NICHE_ECOMMERCE, label: 'All e-commerce', group: 'broad' },
  ...ECOMMERCE_VERTICALS.map((v) => ({ key: `ecom:${v.id}`, label: v.label, group: 'vertical' as const })),
  { key: 'services', label: 'Service businesses', group: 'other' },
  { key: 'marketing', label: 'Marketing & agency', group: 'other' },
]

const KNOWN = new Set(LIBRARY_NICHES.map((n) => n.key))

export function isLibraryNiche(key: unknown): key is string {
  return typeof key === 'string' && KNOWN.has(key)
}

/** Known keys only, de-duplicated; an empty or unusable set means "every brand". */
export function cleanNiches(keys: unknown): string[] {
  const list = Array.isArray(keys) ? keys.filter(isLibraryNiche) : []
  const unique = Array.from(new Set(list))
  return unique.length ? unique : [NICHE_ALL]
}

export function nicheLabel(key: string): string {
  return LIBRARY_NICHES.find((n) => n.key === key)?.label ?? key
}

/**
 * The keys a brand's runs may draw on, from its e-commerce vertical ids.
 *
 * Always 'all' and 'ecommerce' — the platform makes e-commerce creative, so a
 * brand whose catalog is too mixed to place in a vertical still gets the
 * general e-commerce method. Its verticals narrow from there.
 */
export function brandNicheKeys(verticalIds: number[]): string[] {
  return [NICHE_ALL, NICHE_ECOMMERCE, ...Array.from(new Set(verticalIds)).map((id) => `ecom:${id}`)]
}
