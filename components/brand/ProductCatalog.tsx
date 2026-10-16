'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Package, RefreshCw, Search, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState, Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { discountPercent, formatPrice } from '@/lib/catalog/parse'
import type { CatalogProductSummary, CatalogSource } from '@/lib/catalog/types'

/**
 * The product catalog panel — what the connected store sells, read from the
 * store itself.
 *
 * Every price, sale price and rating a creative may state comes from here, so
 * this panel's job is to make that ground truth visible: the operator can see
 * exactly which figures the Reactor is allowed to put on an ad, and re-read
 * the store the moment a price changes.
 */

export interface CatalogView {
  source: CatalogSource
  storeUrl: string
  syncedAt: string
  currency: string | null
  truncated: boolean
  total: number
  products: CatalogProductSummary[]
}

const SOURCE_LABEL: Record<CatalogSource, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  jsonld: 'Product pages',
}

/** One product card — the photo, the price as the store publishes it, the proof. */
export function ProductTile({ p, currency }: { p: CatalogProductSummary; currency: string | null }) {
  const off = discountPercent(p)
  const cur = p.currency ?? currency
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="relative aspect-square w-full bg-black/30">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt={p.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-white/25">
            <Package size={22} />
          </span>
        )}
        {off !== null && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">
            {off}% off
          </span>
        )}
        {p.available === false && (
          <span className="absolute right-2 top-2 rounded-full border border-white/20 bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white/80">
            Sold out
          </span>
        )}
      </div>
      <div className="space-y-1 p-2.5">
        <p className="line-clamp-2 text-[12px] font-semibold leading-snug text-white/85">{p.title}</p>
        <p className="text-[12px] text-white/70">
          {formatPrice(p.price, cur)}
          {off !== null && (
            <span className="ml-1.5 text-white/35 line-through">{formatPrice(p.compareAtPrice, cur)}</span>
          )}
        </p>
        {p.rating !== null && p.reviewCount ? (
          <p className="flex items-center gap-1 text-[11px] text-white/55">
            <Star size={10} className="fill-amber-500 text-amber-500" />
            {p.rating} · {p.reviewCount.toLocaleString('en')} reviews
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function ProductCatalog() {
  const [catalog, setCatalog] = useState<CatalogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [storeUrl, setStoreUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notStored, setNotStored] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/catalog', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { catalog?: CatalogView | null }) => live && setCatalog(d.catalog ?? null))
      .catch(() => live && setCatalog(null))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  const sync = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = (await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeUrl.trim() ? { storeUrl: storeUrl.trim() } : {}),
      }).then((r) => r.json())) as { ok: boolean; error?: string; stored?: boolean; catalog?: CatalogView }
      if (res.ok && res.catalog) {
        setCatalog(res.catalog)
        setNotStored(res.stored === false)
      } else {
        setError(res.error || 'The store could not be read.')
      }
    } catch {
      setError('The store could not be reached — try again.')
    } finally {
      setSyncing(false)
    }
  }, [storeUrl])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = catalog?.products ?? []
    return q ? list.filter((p) => `${p.title} ${p.productType ?? ''}`.toLowerCase().includes(q)) : list
  }, [catalog, query])

  const onSale = (catalog?.products ?? []).filter((p) => discountPercent(p) !== null).length
  const rated = (catalog?.products ?? []).filter((p) => p.rating !== null).length

  return (
    <Panel>
      <PanelHeader
        icon={<Package size={16} />}
        accent="amber"
        title="Product Catalog"
        subtitle="Read from your store, never typed in. Every price, sale and rating a creative may state comes from here."
        accessory={
          catalog ? (
            <button
              type="button"
              onClick={sync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:border-amber-500/40 hover:text-amber-500 disabled:opacity-50"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {syncing ? 'Reading…' : 'Re-read store'}
            </button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-white/45">
          <Loader2 size={15} className="animate-spin text-amber-500" /> Loading the catalog…
        </div>
      ) : !catalog ? (
        <div className="space-y-3 p-5">
          <EmptyState
            icon={<Package size={20} />}
            message="No products read yet."
            hint="Shopify and WooCommerce stores are read automatically from your connected website. Any other store works when its product pages carry schema.org Product markup."
          />
          <div className="mx-auto flex max-w-xl flex-col gap-2 sm:flex-row">
            <input
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
              placeholder="Store address — leave blank to use your connected website"
              className="min-h-[42px] flex-1 rounded-xl border border-white/12 bg-black/40 px-3.5 text-[13px] text-white placeholder:text-white/30 outline-none transition-colors focus:border-amber-500/50"
            />
            <button
              type="button"
              onClick={sync}
              disabled={syncing}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[13px] font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {syncing ? 'Reading your store…' : 'Read my products'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="primary">{SOURCE_LABEL[catalog.source]}</Pill>
            <Pill>
              {catalog.total} product{catalog.total === 1 ? '' : 's'}
              {catalog.truncated ? ' (first 250 kept)' : ''}
            </Pill>
            {onSale > 0 && <Pill tone="warning">{onSale} on sale</Pill>}
            {rated > 0 && <Pill tone="success">{rated} with a published rating</Pill>}
            <span className="text-[11px] text-white/40">
              Read {new Date(catalog.syncedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}
              {' · '}
              {catalog.storeUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>

          {notStored && (
            <p className="flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/[0.06] p-2.5 text-[11px] text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              Read, but not saved to this account — the settings store is not configured, so the catalog lasts
              until the server restarts.
            </p>
          )}

          <label className="relative block max-w-sm">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a product"
              className="min-h-[38px] w-full rounded-lg border border-white/12 bg-black/40 pl-8 pr-3 text-[12.5px] text-white placeholder:text-white/30 outline-none focus:border-amber-500/50"
            />
          </label>

          {shown.length === 0 ? (
            <p className="text-[12px] text-white/45">No product matches “{query}”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {shown.slice(0, 60).map((p) => (
                <ProductTile key={p.id} p={p} currency={catalog.currency} />
              ))}
            </div>
          )}
          {shown.length > 60 && (
            <p className="text-[11px] text-white/40">
              Showing 60 of {shown.length} — search to find the rest.
            </p>
          )}
        </div>
      )}

      {error && (
        <p
          className={cn(
            'mx-5 mb-5 flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/[0.06] p-2.5 text-[11.5px] text-danger',
          )}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </Panel>
  )
}
