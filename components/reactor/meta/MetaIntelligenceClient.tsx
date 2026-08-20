'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { PageHeader, Panel, Pill } from '@/components/reactor/ui'
import { DateRangePicker } from '@/components/reactor/DateRangePicker'
import { ConnectMetaPanel } from '@/components/reactor/meta/ConnectMetaPanel'
import { MetaIntelligenceView } from '@/components/reactor/meta/MetaIntelligenceView'
import type { MetaDashboard } from '@/lib/meta-data'
import { rangeKey, rangeQuery, rangeSubLabel, type DateRange } from '@/lib/date-range'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   Meta Intelligence, driven by ONE date range.

   The rules this component exists to guarantee:
   · one shared range for the whole page — no component fetches its own window
   · changing it rewrites the URL (?from=…&to=…), so a view is shareable and
     survives a refresh or a back button
   · the last range is remembered for the next visit
   · recent ranges are cached in memory, so flicking between windows is instant
   · a request that lands out of order is discarded — old and new range data are
     never mixed on screen, the swap is atomic
   · a failed load shows a real error with a retry, never silent stale numbers
---------------------------------------------------------------------------- */

const STORAGE_KEY = 'tpb.meta.range.v1'
const CACHE_MAX = 12

export function MetaIntelligenceClient({
  initialRange,
  initialData,
}: {
  initialRange: DateRange
  initialData: MetaDashboard
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [range, setRange] = useState<DateRange>(initialRange)
  const [data, setData] = useState<MetaDashboard>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(initialData.error ?? null)

  // Recently fetched ranges, keyed by window. Bounded so a long session cannot
  // grow the cache without limit.
  const cache = useRef<Map<string, MetaDashboard>>(
    new Map([[rangeKey(initialRange), initialData]]),
  )
  // Monotonic request id — only the newest response is allowed to render.
  const requestId = useRef(0)

  /** Remember the last window the user chose, for their next visit. */
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(range))
    } catch {
      /* storage unavailable — the URL still carries the range */
    }
  }, [range])

  /**
   * On a cold visit with no range in the URL, restore the remembered one. The
   * URL is rewritten to match so the page is immediately shareable.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.has('from') || params.has('preset')) return
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved) as DateRange
      if (!parsed?.from || !parsed?.to) return
      if (rangeKey(parsed) === rangeKey(initialRange)) return
      void applyRange(parsed)
    } catch {
      /* ignore a corrupt stored value */
    }
    // Deliberately runs once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchRange = useCallback(
    async (next: DateRange, opts?: { force?: boolean }) => {
      const key = rangeKey(next)
      const id = ++requestId.current

      const cached = cache.current.get(key)
      if (cached && !opts?.force) {
        setData(cached)
        setError(cached.error ?? null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/meta/dashboard?${rangeQuery(next)}`, { cache: 'no-store' })
        const json = (await res.json()) as { ok: boolean; data?: MetaDashboard; error?: string }
        // A slower earlier request must never overwrite a newer one.
        if (id !== requestId.current) return
        if (!res.ok || !json.ok || !json.data) {
          setError(json.error ?? 'Meta data could not be loaded for this range.')
          setLoading(false)
          return
        }
        cache.current.set(key, json.data)
        if (cache.current.size > CACHE_MAX) {
          const oldest = cache.current.keys().next().value
          if (oldest) cache.current.delete(oldest)
        }
        setData(json.data)
        setError(json.data.error ?? null)
      } catch (e) {
        if (id !== requestId.current) return
        setError(e instanceof Error ? e.message : 'Meta data could not be loaded.')
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [],
  )

  const applyRange = useCallback(
    async (next: DateRange) => {
      setRange(next)
      // The URL is the source of truth for sharing and for linked navigation
      // out of the Reactor Dashboard; replace so the history stays clean.
      router.replace(`${pathname}?${rangeQuery(next)}`, { scroll: false })
      await fetchRange(next)
    },
    [fetchRange, pathname, router],
  )

  const live = data.source === 'live'
  const subtitle = useMemo(
    () =>
      'The performance record: what each creative spent, what it produced, and what that cost — read straight from the Meta Marketing API. Every figure below is calculated over the selected date range. What it means, and what to build next, lives on the Reactor Dashboard.',
    [],
  )

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          system="06"
          title="Meta Intelligence"
          subtitle={subtitle}
          tagline="Engineered For Performance."
        />
        <div className="flex flex-col items-end gap-2">
          <DateRangePicker value={range} onChange={applyRange} busy={loading} />
          <Pill tone={live ? 'success' : 'warning'}>
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                live ? 'dot-live animate-pulse-glow' : 'bg-warning',
              )}
            />
            <span className="font-semibold uppercase tracking-[0.16em]">
              {live ? 'Live · Meta API' : 'Demo data'}
            </span>
          </Pill>
        </div>
      </div>

      {error && (
        <Panel className="mt-3 border-danger/30">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-danger/30 bg-danger/10 text-danger">
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-white">
                Meta data could not be loaded for {rangeSubLabel(range)}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/60">
                {error} The figures below are the curated demo set, not live performance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void fetchRange(range, { force: true })}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-2 text-[12.5px] font-medium text-white/75 transition-colors hover:border-primary/40 hover:text-glow"
            >
              <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
              Retry
            </button>
          </div>
        </Panel>
      )}

      {/* The connection this tab reads with. Storing or removing one changes
          where the figures come from, so the current range is re-pulled
          against the new credentials rather than left showing the old ones. */}
      <ConnectMetaPanel onConnectionChange={() => void fetchRange(range, { force: true })} />

      <MetaIntelligenceView data={data} loading={loading} />
    </>
  )
}
