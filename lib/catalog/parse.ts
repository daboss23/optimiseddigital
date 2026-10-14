/**
 * Catalog parsing — pure functions from what a store publishes to the
 * platform's `CatalogProduct`, plus the blocks the orchestrator reads.
 *
 * No network and no imports beyond the types, so the selftest can pin every
 * parser against captured payloads without touching a live store.
 */

import type { Catalog, CatalogProduct, CatalogProductSummary } from './types'

/** The most products a catalog keeps — enough for any picker, small enough to store whole. */
export const MAX_PRODUCTS = 250
/** Descriptions are context for a brief, not a product page. */
const MAX_DESCRIPTION = 400

/* --------------------------------- helpers -------------------------------- */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
}

/** HTML → one line of plain text. */
export function stripHtml(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(text: string, max = MAX_DESCRIPTION): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const stop = cut.lastIndexOf('. ')
  return `${(stop > max * 0.5 ? cut.slice(0, stop + 1) : cut).trim()}…`
}

/** A price as a number, or null for anything that is not one. */
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function absolute(src: unknown, base: string): string | null {
  if (typeof src !== 'string' || !src.trim()) return null
  try {
    const u = new URL(src.trim().startsWith('//') ? `https:${src.trim()}` : src.trim(), base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
  if (typeof v === 'string') return v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12)
  return []
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/* --------------------------------- Shopify -------------------------------- */

interface ShopifyVariant {
  price?: string | number
  compare_at_price?: string | number | null
  available?: boolean
}

interface ShopifyProduct {
  id?: number | string
  title?: string
  handle?: string
  body_html?: string
  vendor?: string
  product_type?: string
  tags?: string[] | string
  variants?: ShopifyVariant[]
  images?: { src?: string }[]
}

/**
 * Shopify's public `/products.json`. The price shown is the cheapest variant
 * that can be bought (the cheapest overall when none says), and the
 * compare-at price is THAT variant's — so a sale price and its strike-through
 * always describe the same thing.
 */
export function parseShopifyProducts(json: unknown, origin: string): CatalogProduct[] {
  const list = isObject(json) && Array.isArray(json.products) ? (json.products as ShopifyProduct[]) : []
  return list
    .filter((p) => p && p.title && (p.id !== undefined || p.handle))
    .map((p) => {
      const variants = Array.isArray(p.variants) ? p.variants : []
      const priced = variants
        .map((v) => ({ v, price: money(v.price) }))
        .filter((x): x is { v: ShopifyVariant; price: number } => x.price !== null)
      const buyable = priced.filter((x) => x.v.available !== false)
      const pick = (buyable.length ? buyable : priced).sort((a, b) => a.price - b.price)[0]
      const compareAt = pick ? money(pick.v.compare_at_price) : null
      const anyAvailability = variants.some((v) => typeof v.available === 'boolean')
      const images = (Array.isArray(p.images) ? p.images : [])
        .map((i) => absolute(i?.src, origin))
        .filter((u): u is string => Boolean(u))
      return {
        id: String(p.id ?? p.handle),
        title: String(p.title).trim(),
        url: p.handle ? `${origin}/products/${p.handle}` : origin,
        description: clip(stripHtml(p.body_html)),
        price: pick?.price ?? null,
        compareAtPrice: pick && compareAt !== null && compareAt > pick.price ? compareAt : null,
        currency: null,
        imageUrl: images[0] ?? null,
        images: images.slice(1, 6),
        productType: p.product_type?.trim() || null,
        vendor: p.vendor?.trim() || null,
        tags: asTags(p.tags),
        available: anyAvailability ? variants.some((v) => v.available === true) : null,
        rating: null,
        reviewCount: null,
        variantCount: Math.max(1, variants.length),
      }
    })
}

/* ------------------------------- WooCommerce ------------------------------- */

interface WooProduct {
  id?: number | string
  name?: string
  permalink?: string
  short_description?: string
  description?: string
  prices?: {
    price?: string
    regular_price?: string
    currency_code?: string
    currency_minor_unit?: number
  }
  images?: { src?: string }[]
  categories?: { name?: string }[]
  tags?: { name?: string }[]
  average_rating?: string | number
  review_count?: number
  is_in_stock?: boolean
  variations?: unknown[]
}

/**
 * The WooCommerce Store API (`/wp-json/wc/store/v1/products`). Prices arrive
 * in minor units as strings — "2900" with a minor unit of 2 is 29.00.
 */
export function parseWooProducts(json: unknown, origin: string): CatalogProduct[] {
  const list = Array.isArray(json) ? (json as WooProduct[]) : []
  return list
    .filter((p) => p && p.name && p.id !== undefined)
    .map((p) => {
      const unit = Number.isFinite(p.prices?.currency_minor_unit) ? Number(p.prices?.currency_minor_unit) : 2
      const scale = (v: string | undefined) => {
        const n = money(v)
        return n === null ? null : Math.round((n / 10 ** unit) * 100) / 100
      }
      const price = scale(p.prices?.price)
      const regular = scale(p.prices?.regular_price)
      const images = (Array.isArray(p.images) ? p.images : [])
        .map((i) => absolute(i?.src, origin))
        .filter((u): u is string => Boolean(u))
      const reviews = Number(p.review_count) || 0
      const rating = money(p.average_rating)
      return {
        id: String(p.id),
        title: String(p.name).trim(),
        url: absolute(p.permalink, origin) ?? origin,
        description: clip(stripHtml(p.short_description || p.description)),
        price,
        compareAtPrice: price !== null && regular !== null && regular > price ? regular : null,
        currency: p.prices?.currency_code?.trim() || null,
        imageUrl: images[0] ?? null,
        images: images.slice(1, 6),
        productType: p.categories?.[0]?.name?.trim() || null,
        vendor: null,
        tags: (p.tags ?? []).map((t) => t?.name?.trim() ?? '').filter(Boolean).slice(0, 12),
        available: typeof p.is_in_stock === 'boolean' ? p.is_in_stock : null,
        rating: reviews > 0 && rating !== null && rating > 0 ? rating : null,
        reviewCount: reviews > 0 ? reviews : null,
        variantCount: Math.max(1, Array.isArray(p.variations) ? p.variations.length : 1),
      }
    })
}

/* ------------------------------ schema.org (JSON-LD) ----------------------- */

/** Every JSON-LD block on a page, parsed. Malformed blocks are skipped, never fatal. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      out.push(JSON.parse(raw))
    } catch {
      // A store theme that ships broken JSON-LD is common; one bad block must
      // not cost the readable ones beside it.
    }
  }
  return out
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type']
  return (Array.isArray(t) ? t : [t]).map((x) => String(x ?? ''))
}

/** Depth-first walk over arrays, objects and `@graph`, collecting Product nodes. */
function productNodes(value: unknown, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 6) return out
  if (Array.isArray(value)) {
    for (const v of value) productNodes(v, out, depth + 1)
    return out
  }
  if (!isObject(value)) return out
  if (typesOf(value).some((t) => /^(Product|ProductGroup)$/.test(t))) out.push(value)
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item', 'hasVariant']) {
    if (key in value) productNodes(value[key], out, depth + 1)
  }
  return out
}

function firstImage(v: unknown, base: string): string | null {
  if (typeof v === 'string') return absolute(v, base)
  if (Array.isArray(v)) {
    for (const x of v) {
      const img = firstImage(x, base)
      if (img) return img
    }
    return null
  }
  if (isObject(v)) return absolute(v.url ?? v.contentUrl, base)
  return null
}

function offersOf(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter(isObject)
  return isObject(v) ? [v] : []
}

/**
 * Products described by schema.org markup — the fallback for any store that
 * is neither Shopify nor WooCommerce, and the source of the RATING on stores
 * that are: review apps publish their aggregate here, not in the catalog API.
 */
export function productsFromJsonLd(html: string, pageUrl: string): CatalogProduct[] {
  const nodes = jsonLdBlocks(html).flatMap((b) => productNodes(b))
  const seen = new Set<string>()
  const out: CatalogProduct[] = []
  for (const n of nodes) {
    const title = typeof n.name === 'string' ? stripHtml(n.name) : ''
    if (!title) continue
    const url = absolute(n.url, pageUrl) ?? pageUrl
    const id = String(n.productGroupID ?? n.sku ?? url)
    if (seen.has(id)) continue
    seen.add(id)

    const offers = offersOf(n.offers).flatMap((o) =>
      typesOf(o).includes('AggregateOffer') ? [o, ...offersOf(o.offers)] : [o],
    )
    const prices = offers
      .map((o) => money(o.price ?? o.lowPrice))
      .filter((p): p is number => p !== null && p > 0)
    const price = prices.length ? Math.min(...prices) : null
    const currency =
      offers.map((o) => (typeof o.priceCurrency === 'string' ? o.priceCurrency.trim() : '')).find(Boolean) || null
    const availability = offers
      .map((o) => String(o.availability ?? ''))
      .filter(Boolean)
    const rating = isObject(n.aggregateRating) ? n.aggregateRating : null
    const ratingValue = rating ? money(rating.ratingValue) : null
    const reviewCount = rating ? money(rating.reviewCount ?? rating.ratingCount) : null
    const brand = isObject(n.brand) ? n.brand.name : n.brand

    out.push({
      id,
      title,
      url,
      description: clip(stripHtml(typeof n.description === 'string' ? n.description : '')),
      price,
      compareAtPrice: null,
      currency,
      imageUrl: firstImage(n.image, pageUrl),
      images: [],
      productType: typeof n.category === 'string' ? n.category.trim() || null : null,
      vendor: typeof brand === 'string' ? brand.trim() || null : null,
      tags: [],
      available: availability.length ? availability.some((a) => /InStock|PreOrder/i.test(a)) : null,
      rating: ratingValue !== null && ratingValue > 0 && reviewCount ? ratingValue : null,
      reviewCount: ratingValue !== null && reviewCount ? Math.round(reviewCount) : null,
      variantCount: Math.max(1, Array.isArray(n.hasVariant) ? n.hasVariant.length : 1),
    })
  }
  return out
}

/**
 * Fill in what only the product page knows — the rating, and the currency —
 * without letting the page overwrite what the catalog API already said.
 */
export function enrichFromPage(product: CatalogProduct, page: CatalogProduct | undefined): CatalogProduct {
  if (!page) return product
  return {
    ...product,
    rating: product.rating ?? page.rating,
    reviewCount: product.reviewCount ?? page.reviewCount,
    currency: product.currency ?? page.currency,
    imageUrl: product.imageUrl ?? page.imageUrl,
  }
}

/**
 * A product photo at a size worth sending to a vision model. Shopify's CDN
 * resizes on request (`width=`), and a 4000px original would cost tokens and
 * blow the inline-image cap for no gain in what the model can see. Any other
 * host is returned unchanged.
 */
export function visionSizedImage(url: string, width = 1024): string {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('cdn.shopify.com') || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(width))
      return u.toString()
    }
    return url
  } catch {
    return url
  }
}

/* --------------------------------- derived -------------------------------- */

/** The real discount a compare-at price implies, in whole percent. Null when there is none. */
export function discountPercent(p: Pick<CatalogProduct, 'price' | 'compareAtPrice'>): number | null {
  if (p.price === null || p.compareAtPrice === null || p.price <= 0 || p.compareAtPrice <= p.price) return null
  const pct = Math.floor((1 - p.price / p.compareAtPrice) * 100)
  return pct >= 1 ? pct : null
}

/** "$29.00" — the store's currency when known, a plain figure otherwise. */
export function formatPrice(n: number | null, currency: string | null): string {
  if (n === null) return 'not published'
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency }).format(n)
    } catch {
      // An unknown code falls through to the plain figure.
    }
  }
  return n.toFixed(2)
}

export function summarise(p: CatalogProduct, currency: string | null = null): CatalogProductSummary {
  return {
    id: p.id,
    title: p.title,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    currency: p.currency ?? currency,
    imageUrl: p.imageUrl,
    available: p.available,
    rating: p.rating,
    reviewCount: p.reviewCount,
    productType: p.productType,
  }
}

/* ---------------------------- orchestrator blocks -------------------------- */

/**
 * The facts a campaign about ONE product may use — and the rule that they are
 * the only ones. Every figure here was published by the store; anything not
 * here is not stated on a creative.
 */
export function productFactsBlock(p: CatalogProduct, catalog: Pick<Catalog, 'currency' | 'syncedAt'>): string {
  const currency = p.currency ?? catalog.currency
  const off = discountPercent(p)
  const lines = [
    `- Product: ${p.title}${p.variantCount > 1 ? ` (${p.variantCount} variants)` : ''}`,
    p.price === null
      ? '- Price: not published — do not state one.'
      : off !== null
        ? `- Price: ${formatPrice(p.price, currency)} — on sale from ${formatPrice(p.compareAtPrice, currency)} (${off}% off, as the store publishes it today).`
        : `- Price: ${formatPrice(p.price, currency)} — full price, no sale running.`,
    p.rating !== null && p.reviewCount
      ? `- Rating: ${p.rating}★ from ${p.reviewCount.toLocaleString('en')} reviews, as published on the product page.`
      : '- Rating: none published — do not state a rating or a review count.',
    p.available === false
      ? '- Availability: currently SOLD OUT — do not run an offer on it; a restock or waitlist framing only if the brief says so.'
      : p.available === true
        ? '- Availability: in stock.'
        : '',
    p.productType || p.tags.length
      ? `- Category: ${[p.productType, ...p.tags.slice(0, 6)].filter(Boolean).join(', ')}`
      : '',
    p.description ? `- What it is, in the store's words: ${p.description}` : '',
    p.imageUrl
      ? `- Product photo: ${p.imageUrl} — every production brief describes the product exactly as this photo shows it: its shape, colour, material, packaging and label. Never invent a variant, a colourway or packaging that is not sold.`
      : '',
    `- Product page: ${p.url}`,
  ].filter(Boolean)
  return `PRODUCT FACTS — the product this campaign sells, read from the brand's own store (${catalog.syncedAt.slice(
    0,
    10,
  )}). These are the ONLY figures a creative may state about it: a price, discount, rating or count that is not listed here does not appear on any creative.\n${lines.join('\n')}`
}

/**
 * What the store sells, for a campaign about the brand rather than one
 * product — and for bundles and cross-sells, which need to know the range.
 */
export function catalogRangeBlock(c: Catalog, limit = 8): string {
  const products = c.products.filter((p) => p.available !== false).slice(0, limit)
  if (!products.length) return ''
  const lines = products.map((p) => {
    const off = discountPercent(p)
    const price = formatPrice(p.price, p.currency ?? c.currency)
    return `- ${p.title} — ${price}${off !== null ? ` (on sale from ${formatPrice(p.compareAtPrice, p.currency ?? c.currency)})` : ''}`
  })
  return `THE RANGE — what this store sells (${products.length} of ${c.products.length} products, prices as published). Use it for bundles, cross-sells and a whole-brand campaign; show a product only as it is actually sold:\n${lines.join('\n')}`
}

/* ------------------------------ vertical read ------------------------------ */

/**
 * Product keywords → the ad library's e-commerce niche ids (`lib/gethookd/icp.ts`).
 * Read off product types, tags and titles, so research studies the brand's own
 * vertical instead of every DTC category at once.
 */
const NICHE_KEYWORDS: { id: number; re: RegExp }[] = [
  { id: 32, re: /\b(skin ?care|serums?|moisturi[sz]ers?|cleansers?|spf|sunscreens?|toners?|retinol|face (cream|oil|wash|mask)|eye cream)\b/ },
  { id: 5, re: /\b(make-?up|cosmetics?|lipsticks?|lip (gloss|balm|oil)|mascara|eyeliner|foundation|concealer|blush|nail polish|perfumes?|fragrances?|hair ?care|shampoos?|conditioners?|brows?|lashes)\b/ },
  { id: 30, re: /\b(supplements?|vitamins?|protein|collagen|capsules?|gumm(y|ies)|greens powder|probiotics?|electrolytes?|creatine|magnesium|omega)\b/ },
  { id: 16, re: /\b(wellness|sleep aid|recovery|massag(e|er)|posture|pain relief|meditation|aromatherapy|ergonomic)\b/ },
  { id: 11, re: /\b(apparel|clothing|dress(es)?|shirts?|t-?shirts?|tees?|jeans|pants|trousers|shorts|skirts?|hoodies?|sweaters?|jackets?|coats?|leggings|swim ?wear|lingerie|underwear|socks|sneakers?|shoes|boots|sandals)\b/ },
  { id: 1, re: /\b(bags?|totes?|backpacks?|wallets?|sunglasses|belts?|hats?|caps?|scarf|scarves|phone cases?|keychains?|accessor(y|ies))\b/ },
  { id: 19, re: /\b(jewel(le)?ry|rings?|necklaces?|bracelets?|earrings?|pendants?|anklets?|watch(es)?)\b/ },
  { id: 17, re: /\b(kitchen|bedding|sheets|pillows?|duvets?|towels?|candles?|decor|furniture|rugs?|lamps?|mattress(es)?|cookware|knives|planters?|garden|vases?|home fragrance)\b/ },
  { id: 13, re: /\b(coffee|tea|snacks?|chocolate|sauces?|spices?|seasonings?|drinks?|beverages?|juices?|granola|honey|cookies?)\b/ },
  { id: 20, re: /\b(baby|babies|kids?|toddlers?|infants?|nursery|toys?|strollers?|diapers?)\b/ },
  { id: 23, re: /\b(dogs?|cats?|pets?|puppy|puppies|kittens?|leash(es)?|collars?)\b/ },
  { id: 26, re: /\b(outdoor|camping|hiking|golf|bikes?|cycling|yoga|gym|fitness|running|surf|ski|fishing|tennis)\b/ },
  { id: 34, re: /\bsubscription box\b/ },
]

/**
 * The one or two niches a catalog sits in — the ones a meaningful share of
 * its products match. Empty when the catalog is too mixed or too thin to
 * say, which leaves research on the whole e-commerce set rather than a guess.
 */
export function inferNiches(products: CatalogProduct[], extra = ''): number[] {
  if (!products.length && !extra.trim()) return []
  const texts = products.map((p) => `${p.productType ?? ''} ${p.tags.join(' ')} ${p.title}`.toLowerCase())
  const extraText = extra.toLowerCase()
  const scored = NICHE_KEYWORDS.map(({ id, re }) => ({
    id,
    hits: texts.filter((t) => re.test(t)).length + (extraText && re.test(extraText) ? 2 : 0),
  }))
  const floor = Math.max(2, Math.ceil(products.length * 0.15))
  return scored
    .filter((s) => s.hits >= floor)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map((s) => s.id)
}
