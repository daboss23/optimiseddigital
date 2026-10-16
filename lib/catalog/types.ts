/**
 * The product catalog — what the connected store actually sells.
 *
 * Read from the store itself (Shopify's public `products.json`, the WooCommerce
 * Store API, or schema.org Product markup on the pages), never typed in. The
 * catalog is where every figure a creative may state comes from: a price, a
 * compare-at price, a rating. A creative is burned into pixels and cannot be
 * edited after the render, so a number on it has to be a number the store
 * publishes — not one a model found plausible.
 */

export type CatalogSource = 'shopify' | 'woocommerce' | 'jsonld'

export interface CatalogProduct {
  /** Stable within the source: the Shopify / WooCommerce id, or the page URL. */
  id: string
  title: string
  /** The product page. */
  url: string
  /** Plain text, trimmed — what the product IS, in the store's own words. */
  description: string
  /** Current selling price of the cheapest variant, in major units. */
  price: number | null
  /** The struck-through price when the product is on sale. Null when it is not. */
  compareAtPrice: number | null
  currency: string | null
  /** The primary product photo — the reference every brief describes the product from. */
  imageUrl: string | null
  /** Further photos, primary first excluded. */
  images: string[]
  productType: string | null
  vendor: string | null
  tags: string[]
  /** Whether any variant can be bought right now. Null when the source does not say. */
  available: boolean | null
  /** Average rating out of 5, only when the store publishes one. */
  rating: number | null
  /** Number of reviews behind `rating`. */
  reviewCount: number | null
  /** How many purchasable variants (sizes, colours) the product has. */
  variantCount: number
}

export interface Catalog {
  source: CatalogSource
  /** The store origin the catalog was read from. */
  storeUrl: string
  syncedAt: string
  /** Store currency when the source states one. */
  currency: string | null
  products: CatalogProduct[]
  /** True when the store held more products than the platform keeps. */
  truncated: boolean
}

/** The light shape a client list renders — no descriptions, no image galleries. */
export interface CatalogProductSummary {
  id: string
  title: string
  price: number | null
  compareAtPrice: number | null
  currency: string | null
  imageUrl: string | null
  available: boolean | null
  rating: number | null
  reviewCount: number | null
  productType: string | null
}
