import { getSetting, setSetting, settingsConfigured } from '@/lib/settings'
import { getConnectedWebsite } from '@/lib/website-intelligence'
import { isMultiTenant } from '@/lib/tenancy-mode'
import { readCapped, safeFetch } from '@/lib/safe-fetch'
import {
  MAX_PRODUCTS,
  enrichFromPage,
  inferNiches,
  parseShopifyProducts,
  parseWooProducts,
  productsFromJsonLd,
  summarise,
} from './parse'
import type { Catalog, CatalogProduct, CatalogProductSummary, CatalogSource } from './types'

export * from './types'
export {
  catalogRangeBlock,
  discountPercent,
  formatPrice,
  inferNiches,
  productFactsBlock,
  summarise,
  visionSizedImage,
} from './parse'

/**
 * The product catalog — read from the connected store, kept per account.
 *
 * Three readers, tried in order, each one a thing the store already publishes:
 *   1. Shopify's public `/products.json` — every Shopify store serves it.
 *   2. The WooCommerce Store API — public on every modern WooCommerce install.
 *   3. schema.org Product markup on the homepage and the product pages it
 *      links to — any platform that wants rich results publishes it.
 *
 * Shopify and WooCommerce do not put RATINGS in their catalog APIs; review
 * apps publish them as schema.org markup on the product page. So the first
 * products read through (1) or (2) are enriched from their own pages — a
 * rating on a creative is then the store's published rating, never a guess.
 *
 * Stored in the account's `platform_settings` row (`catalog.products`). With
 * no settings store, the one catalog a session synced is kept in memory and
 * shown to that session only — the same rule `getConnectedWebsite` follows for
 * an unpersisted scan, so one brand's catalog can never surface for another.
 *
 * Never throws: every failure is a `{ ok: false, error }` the panel can show.
 */

export const SETTING_CATALOG = 'catalog.products'

const PAGE_TIMEOUT_MS = 12_000
const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_HTML_BYTES = 3 * 1024 * 1024
/** Product pages read for ratings after a Shopify / WooCommerce sync. */
const ENRICH_PAGES = 12
/** Product pages read when the store has neither catalog API. */
const JSONLD_PAGES = 15
const CONCURRENCY = 4

/** The catalog a session synced when there was no account row to keep it in. */
let lastUnpersistedCatalog: Catalog | null = null

export interface SyncResult {
  ok: boolean
  catalog?: Catalog
  /** False when the catalog was read but could not be stored for this account. */
  stored: boolean
  error?: string
}

async function getJson(url: string): Promise<unknown | null> {
  const got = await safeFetch(url, { headers: { Accept: 'application/json' }, timeoutMs: PAGE_TIMEOUT_MS })
  if (!got || !got.res.ok) return null
  if (!/json/i.test(got.res.headers.get('content-type') ?? '')) return null
  const bytes = await readCapped(got.res, MAX_JSON_BYTES)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

async function getHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const got = await safeFetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    timeoutMs: PAGE_TIMEOUT_MS,
  })
  if (!got || !got.res.ok) return null
  if (!/html/i.test(got.res.headers.get('content-type') ?? '')) return null
  const bytes = await readCapped(got.res, MAX_HTML_BYTES)
  if (!bytes) return null
  return { html: new TextDecoder().decode(bytes), finalUrl: got.finalUrl }
}

async function mapPool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return out
}

/** Same-host product links on a page — the JSON-LD reader's crawl list. */
function productLinks(html: string, base: string): string[] {
  const host = new URL(base).host
  const out = new Set<string>()
  const re = /href=["']([^"'#]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.size < JSONLD_PAGES * 3) {
    let u: URL
    try {
      u = new URL(m[1], base)
    } catch {
      continue
    }
    if (u.host !== host) continue
    if (!/\/(products?|shop|item|p)\/[^/]+\/?$/i.test(u.pathname)) continue
    u.search = ''
    out.add(u.toString())
  }
  return Array.from(out).slice(0, JSONLD_PAGES)
}

/** Ratings and currency from each product's own page, for the first few products. */
async function enrich(products: CatalogProduct[]): Promise<CatalogProduct[]> {
  const head = products.slice(0, ENRICH_PAGES)
  const enriched = await mapPool(head, async (p) => {
    const page = await getHtml(p.url)
    if (!page) return p
    const found = productsFromJsonLd(page.html, page.finalUrl)
    const match =
      found.find((f) => f.title.toLowerCase() === p.title.toLowerCase()) ?? (found.length === 1 ? found[0] : undefined)
    return enrichFromPage(p, match)
  })
  return [...enriched, ...products.slice(ENRICH_PAGES)]
}

async function readShopify(origin: string): Promise<CatalogProduct[]> {
  const json = await getJson(`${origin}/products.json?limit=${MAX_PRODUCTS}`)
  return json ? parseShopifyProducts(json, origin) : []
}

async function readWoo(origin: string): Promise<CatalogProduct[]> {
  const json = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=100`)
  return json ? parseWooProducts(json, origin) : []
}

async function readJsonLd(origin: string): Promise<CatalogProduct[]> {
  const home = await getHtml(origin)
  if (!home) return []
  const fromHome = productsFromJsonLd(home.html, home.finalUrl)
  const pages = await mapPool(productLinks(home.html, home.finalUrl), async (url) => {
    const page = await getHtml(url)
    return page ? productsFromJsonLd(page.html, page.finalUrl) : []
  })
  const seen = new Set<string>()
  return [...fromHome, ...pages.flat()].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
}

/**
 * Read the store's catalog and keep it for this account.
 *
 * `storeUrl` defaults to the account's connected website — the same store the
 * brand profile was read from.
 */
export async function syncCatalog(accountId: string | null, storeUrl?: string): Promise<SyncResult> {
  const raw = storeUrl?.trim() || (await getConnectedWebsite(accountId).catch(() => null))?.url?.trim()
  if (!raw) {
    return { ok: false, stored: false, error: 'Connect your store’s website first, or enter its address.' }
  }
  let origin: string
  try {
    origin = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin
  } catch {
    return { ok: false, stored: false, error: 'That doesn’t look like a store address.' }
  }

  let source: CatalogSource = 'shopify'
  let products = await readShopify(origin)
  if (!products.length) {
    source = 'woocommerce'
    products = await readWoo(origin)
  }
  if (products.length) {
    products = await enrich(products)
  } else {
    source = 'jsonld'
    products = await readJsonLd(origin)
  }

  if (!products.length) {
    return {
      ok: false,
      stored: false,
      error:
        'No products could be read from that store. Shopify and WooCommerce stores are read automatically; any other store needs product pages with schema.org Product markup.',
    }
  }

  const catalog: Catalog = {
    source,
    storeUrl: origin,
    syncedAt: new Date().toISOString(),
    currency: products.map((p) => p.currency).find(Boolean) ?? null,
    products: products.slice(0, MAX_PRODUCTS),
    truncated: products.length > MAX_PRODUCTS,
  }

  if (!settingsConfigured() || !accountId) {
    lastUnpersistedCatalog = catalog
    return { ok: true, catalog, stored: false }
  }
  const stored = await setSetting(SETTING_CATALOG, catalog, accountId)
  return { ok: true, catalog, stored }
}

/**
 * This account's catalog, or null when none has been synced.
 *
 * The in-memory copy answers only where it cannot be somebody else's: with no
 * settings store, or with no account on a single-brand deployment. On a
 * shared deployment an account-less session reads nothing.
 */
export async function getCatalog(accountId: string | null): Promise<Catalog | null> {
  if (!settingsConfigured()) return lastUnpersistedCatalog
  if (!accountId) return (await isMultiTenant()) ? null : lastUnpersistedCatalog
  return getSetting<Catalog>(SETTING_CATALOG, accountId)
}

/** One product from this account's own catalog — the only way a product's facts reach a run. */
export async function findProduct(
  accountId: string | null,
  productId: string | undefined,
): Promise<{ product: CatalogProduct; catalog: Catalog } | null> {
  if (!productId) return null
  const catalog = await getCatalog(accountId)
  const product = catalog?.products.find((p) => p.id === productId)
  return catalog && product ? { product, catalog } : null
}

/** The catalog as the client lists it — summaries, never the stored blob. */
export async function catalogSummary(accountId: string | null): Promise<{
  source: CatalogSource
  storeUrl: string
  syncedAt: string
  currency: string | null
  truncated: boolean
  total: number
  /** The ad-library verticals this catalog sits in — the Ad Library's default view. */
  niches: number[]
  products: CatalogProductSummary[]
} | null> {
  const c = await getCatalog(accountId)
  if (!c) return null
  return {
    source: c.source,
    storeUrl: c.storeUrl,
    syncedAt: c.syncedAt,
    currency: c.currency,
    truncated: c.truncated,
    total: c.products.length,
    niches: inferNiches(c.products),
    products: c.products.map((p) => summarise(p, c.currency)),
  }
}
