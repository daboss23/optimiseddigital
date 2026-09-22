'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Check,
  Clipboard,
  Copy,
  Database,
  ExternalLink,
  Flame,
  Images,
  Loader2,
  Search,
  Sparkles,
  Trophy,
  Video,
  X,
} from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { CLONE_STORAGE_KEY, taxonomyToTags, type CreativeTaxonomy } from '@/lib/taxonomy'
import { ICP_FOCUSES, type IcpFocus } from '@/lib/gethookd/icp'
import type { AdFormat, CreditUsage, ProvenAd } from '@/lib/gethookd/types'
import type { WinnerCard } from '@/lib/clone-sources'

/* ------------------------------- shared types ------------------------------ */

interface CreativeDNA {
  hook: string
  opening: string
  storyStructure: string
  ctaStructure: string
  editingStyle: string
  offerPresentation: string
  visualStyle: string
  summary: string
}

interface CloneReference extends CreativeDNA {
  taxonomy?: CreativeTaxonomy
  sourceLabel?: string
}

const EMPTY_DNA: CreativeDNA = {
  hook: '',
  opening: '',
  storyStructure: '',
  ctaStructure: '',
  editingStyle: '',
  offerPresentation: '',
  visualStyle: '',
  summary: '',
}

// The editable DNA fields, in a sensible edit order.
const DNA_FIELDS: { key: keyof CreativeDNA; label: string; long?: boolean }[] = [
  { key: 'hook', label: 'Hook' },
  { key: 'opening', label: 'Opening' },
  { key: 'storyStructure', label: 'Story structure', long: true },
  { key: 'ctaStructure', label: 'CTA structure' },
  { key: 'offerPresentation', label: 'Offer presentation' },
  { key: 'visualStyle', label: 'Visual style' },
  { key: 'editingStyle', label: 'Editing style' },
  { key: 'summary', label: 'Summary', long: true },
]

const FORMATS: { id: AdFormat | 'all'; label: string }[] = [
  { id: 'image', label: 'Static' },
  { id: 'all', label: 'All formats' },
  { id: 'video', label: 'Video' },
  { id: 'carousel', label: 'Carousel' },
]

/**
 * The run-time filter leads and is the default, because it is the one that is
 * actually true: an ad launched inside the window and still running after
 * months is being paid for by somebody. The other two are the SOURCE's stored
 * rating — useful, but recorded at index time and re-checked at display time,
 * so asking for it has most of a page withheld as stale. Labelled as the
 * source's opinion rather than as "Proven", which is what made the weaker
 * filter look like the stronger one and left the grid looking empty.
 */
const TIERS: { id: 'winning' | 'proven' | 'all'; label: string }[] = [
  { id: 'all', label: 'Still running' },
  { id: 'proven', label: 'Source-rated: strong' },
  { id: 'winning', label: 'Source-rated: winning' },
]

/** What a design read banked, per ad id. */
type DesignReceipt = { ok: boolean; message: string }

/* --------------------------------- component ------------------------------- */

export function AdLibrary({
  initialWinners,
  winnersLive,
}: {
  initialWinners: WinnerCard[]
  winnersLive: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<'winners' | 'proven'>('winners')
  const [editing, setEditing] = useState<CloneReference | null>(null)

  /* -------- proven ad library -------- */
  const [focus, setFocus] = useState<IcpFocus>('services')
  // Static leads: this deployment's campaigns render static Meta ads, and the
  // design read behind "Design" needs a still to read.
  const [format, setFormat] = useState<AdFormat | 'all'>('image')
  const [tier, setTier] = useState<'winning' | 'proven' | 'all'>('all')
  const [query, setQuery] = useState('')
  const [ads, setAds] = useState<ProvenAd[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [credits, setCredits] = useState<CreditUsage | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)

  /* -------- paste + extraction -------- */
  const [paste, setPaste] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [designing, setDesigning] = useState<string | null>(null)
  const [receipts, setReceipts] = useState<Record<string, DesignReceipt>>({})

  // Every row costs a credit, so a filter change replaces the feed rather than
  // appending to it, and "Load more" is the only path that spends again.
  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      setLoading(true)
      setNote(null)
      try {
        const params = new URLSearchParams({
          focus,
          format,
          tier,
          page: String(nextPage),
          limit: '12',
        })
        if (query.trim()) params.set('q', query.trim())
        const res = await fetch(`/api/ad-library/search?${params.toString()}`).then((r) => r.json())
        const rows: ProvenAd[] = Array.isArray(res.ads) ? res.ads : []
        setAds((prev) => (append ? [...prev, ...rows] : rows))
        setNote(res.note ?? null)
        setCredits(res.credits ?? null)
        setTotal(typeof res.total === 'number' ? res.total : null)
        setHasMore(Boolean(res.hasMore))
        setPage(nextPage)
      } catch {
        if (!append) setAds([])
        setNote('The ad library is unreachable right now. Paste an ad below to clone it instead.')
      } finally {
        setLoading(false)
      }
    },
    [focus, format, tier, query],
  )

  // Filters refetch; typing in the search box does not. A search that fires on
  // every keystroke would bill the account for every keystroke.
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])
  useEffect(() => {
    if (tab === 'proven') void loadRef.current(1, false)
  }, [tab, focus, format, tier])

  // Turn arbitrary ad text into an editable Creative DNA via SPARK + classifier.
  const extractToEditor = useCallback(
    async (text: string, sourceLabel: string) => {
      if (text.trim().length < 20 || extracting) return
      setExtracting(true)
      try {
        const res = await fetch('/api/clone/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, sourceLabel }),
        }).then((r) => r.json())
        if (res.ok) {
          setEditing({ ...EMPTY_DNA, ...res.dna, taxonomy: res.taxonomy, sourceLabel })
        } else {
          setNote(res.error || 'Could not read that ad.')
        }
      } catch {
        setNote('Could not extract that ad. Try again.')
      } finally {
        setExtracting(false)
      }
    },
    [extracting],
  )

  // Bank the ad's DESIGN, not just its words. The still is a signed URL, so
  // SPARK's existing reader fetches it server-side, extracts the Visual DNA
  // (palette, layout archetype, element zones, on-ad copy) and files it in the
  // Vault's `design` section — where the Reactor retrieves it later. No second
  // extractor: this is the same route the drop-box uses.
  const readDesign = useCallback(
    async (ad: ProvenAd) => {
      if (!ad.imageUrl || designing) return
      setDesigning(ad.id)
      try {
        const res = await fetch('/api/spark/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: [ad.imageUrl],
            text: [ad.title, ad.body, ad.transcript].filter(Boolean).join('\n\n'),
            title: `${ad.brand} — proven ad`,
            url: ad.landingPage,
          }),
        }).then((r) => r.json())

        if (!res.success) {
          setReceipts((p) => ({
            ...p,
            [ad.id]: { ok: false, message: res.error || 'Could not read that design.' },
          }))
          return
        }
        setReceipts((p) => ({
          ...p,
          [ad.id]: res.stored
            ? { ok: true, message: `Design banked · ${res.chunks} chunk${res.chunks === 1 ? '' : 's'}` }
            : {
                ok: false,
                message: res.reason || 'Read only — nothing was banked, so the Vault stays clean.',
              },
        }))
      } catch {
        setReceipts((p) => ({
          ...p,
          [ad.id]: { ok: false, message: 'Design read failed. Try again.' },
        }))
      } finally {
        setDesigning(null)
      }
    },
    [designing],
  )

  // Internal winner → editable reference. DNA already exists as taxonomy + the
  // winning concept text, so we prefill from that rather than re-extracting.
  const cloneWinner = (w: WinnerCard) => {
    setEditing({
      ...EMPTY_DNA,
      summary: w.conceptText,
      hook: w.conceptText.split(/[.!?\n]/)[0]?.trim() ?? '',
      taxonomy: w.taxonomy,
      sourceLabel: `${w.title} · ${w.conceptType}`,
    })
  }

  // Hand the edited reference to the reactor and jump there. sessionStorage keeps
  // the payload out of the URL; Workbench reads + clears it on mount.
  const sendToReactor = (ref: CloneReference) => {
    try {
      sessionStorage.setItem(CLONE_STORAGE_KEY, JSON.stringify(ref))
    } catch {
      /* private mode — the reactor just won't pre-load a clone */
    }
    router.push('/campaign-reactor')
  }

  const activeFocus = ICP_FOCUSES.find((f) => f.id === focus)

  return (
    <>
      {/* Tabs */}
      <div className="mb-5 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
        {(
          [
            { id: 'winners', label: 'Our Winners', icon: Trophy },
            { id: 'proven', label: 'Proven Ads', icon: Flame },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-cyan text-black' : 'text-white/60 hover:text-white/85'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'winners' ? (
        <Panel>
          <PanelHeader
            icon={<Trophy size={16} />}
            accent="cyan"
            title="Our Winners"
            subtitle="Proven ads from ORACLE, ranked by winner score. Clone one to regenerate fresh creative on the same structure."
            accessory={
              winnersLive ? (
                <Pill tone="primary">{initialWinners.length} winners</Pill>
              ) : (
                <Pill tone="default">Demo winners</Pill>
              )
            }
          />
          {initialWinners.length === 0 ? (
            <EmptyState label="No winners logged yet — sync Meta performance or mark a concept a winner to fill this." />
          ) : (
            <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
              {initialWinners.map((w) => (
                <WinnerTile key={w.id} winner={w} onClone={() => cloneWinner(w)} />
              ))}
            </div>
          )}
        </Panel>
      ) : (
        <Panel>
          <PanelHeader
            icon={<Flame size={16} />}
            accent="cyan"
            title="Proven Ads"
            subtitle="Live Meta creative that is already working in your market. Clone the structure, or bank the design into the Vault so the Reactor can build on it."
            accessory={
              total !== null ? (
                <Pill tone="primary">{total.toLocaleString()} matches</Pill>
              ) : undefined
            }
          />

          <div className="space-y-5 p-5">
            {/* Focus — services and e-commerce are never blended into one feed */}
            <div>
              <div className="flex flex-wrap gap-2">
                {ICP_FOCUSES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFocus(f.id)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                      focus === f.id
                        ? 'border-cyan/50 bg-cyan/15 text-cyan'
                        : 'border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white/85'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {activeFocus && <p className="mt-2 text-[12px] text-white/40">{activeFocus.blurb}</p>}
            </div>

            {/* Search + filters */}
            <div className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && void load(1, false)}
                placeholder="Narrow by offer, angle or brand — or leave empty for the longest-running winners…"
                className="min-w-[240px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/80 placeholder:text-white/30 focus:border-cyan/40 focus:outline-none"
              />
              <Select value={format} onChange={(v) => setFormat(v as AdFormat | 'all')} options={FORMATS} />
              <Select
                value={tier}
                onChange={(v) => setTier(v as 'winning' | 'proven' | 'all')}
                options={TIERS}
              />
              <button
                type="button"
                onClick={() => void load(1, false)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </div>

            {note && (
              <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-white/50">
                {note}
              </p>
            )}

            {/* Results */}
            {loading && ads.length === 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-[380px] animate-pulse rounded-xl border border-white/10 bg-white/[0.02]"
                  />
                ))}
              </div>
            ) : ads.length === 0 ? (
              <EmptyState label="No proven ads loaded yet. Pick a focus above, or paste an ad below to clone it directly." />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {ads.map((ad) => (
                    <ProvenAdTile
                      key={ad.id}
                      ad={ad}
                      busy={extracting}
                      designing={designing === ad.id}
                      receipt={receipts[ad.id]}
                      onClone={() =>
                        extractToEditor(
                          [ad.title, ad.body, ad.transcript].filter(Boolean).join('\n\n'),
                          `${ad.brand} · proven ad`,
                        )
                      }
                      onReadDesign={() => void readDesign(ad)}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] text-white/35">
                    {credits
                      ? `${credits.used.toFixed(2)} credits this search · ${credits.remaining.toFixed(2)} left`
                      : ''}
                  </p>
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => void load(page + 1, true)}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.03] px-4 py-2 text-sm text-white/75 transition-colors hover:border-white/25 hover:text-white disabled:opacity-40"
                    >
                      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                      Load 12 more
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Paste-to-clone — always available, source or no source */}
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-white/45">
                <Clipboard size={13} /> Or paste an ad to clone
              </p>
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={3}
                placeholder="Paste the ad's primary text, script, or transcript here…"
                className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/80 placeholder:text-white/30 focus:border-cyan/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => extractToEditor(paste, 'Pasted ad')}
                disabled={paste.trim().length < 20 || extracting}
                className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-cyan px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {extracting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Extract &amp; Clone
              </button>
            </div>
          </div>
        </Panel>
      )}

      {editing && (
        <CloneEditor
          reference={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSend={() => sendToReactor(editing)}
        />
      )}
    </>
  )
}

/* -------------------------------- sub-parts -------------------------------- */

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { id: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/75 focus:border-cyan/40 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id} className="bg-[#0a0a0a]">
          {o.label}
        </option>
      ))}
    </select>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <Copy size={30} className="mb-3 text-white/15" />
      <p className="max-w-md text-sm text-white/40">{label}</p>
    </div>
  )
}

function TaxonomyChips({ taxonomy }: { taxonomy?: CreativeTaxonomy }) {
  const tags = taxonomyToTags(taxonomy)
  if (!tags.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/55"
        >
          {t}
        </span>
      ))}
    </div>
  )
}

function WinnerTile({ winner, onClone }: { winner: WinnerCard; onClone: () => void }) {
  const m = winner.metrics
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{winner.title}</p>
          <p className="text-[12px] text-white/45">{winner.conceptType}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[12px] font-bold text-emerald-300">
            {winner.scoreBand}
          </span>
          {winner.scoreConfidence && (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                winner.scoreConfidence === 'high'
                  ? 'bg-white/10 text-white/60'
                  : 'bg-cyan/15 text-cyan'
              }`}
            >
              {winner.scoreConfidence}
            </span>
          )}
        </div>
      </div>
      <p className="line-clamp-3 text-[13px] leading-relaxed text-white/65">{winner.conceptText}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
        {typeof m.ctr === 'number' && <span>CTR {m.ctr.toFixed(2)}%</span>}
        {typeof m.roas === 'number' && <span>ROAS {m.roas.toFixed(1)}x</span>}
        {typeof m.spend === 'number' && <span>${Math.round(m.spend).toLocaleString()} spend</span>}
      </div>
      <TaxonomyChips taxonomy={winner.taxonomy} />
      <button
        type="button"
        onClick={onClone}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-full border border-cyan/40 bg-cyan/10 px-4 py-2 text-sm font-semibold text-cyan transition-colors hover:bg-cyan/20"
      >
        <Copy size={14} /> Clone &amp; Iterate
      </button>
    </div>
  )
}

const FORMAT_ICON = { video: Video, carousel: Images, image: Images, other: Images } as const

function ProvenAdTile({
  ad,
  onClone,
  onReadDesign,
  busy,
  designing,
  receipt,
}: {
  ad: ProvenAd
  onClone: () => void
  onReadDesign: () => void
  busy: boolean
  designing: boolean
  receipt?: DesignReceipt
}) {
  const Icon = FORMAT_ICON[ad.format]
  // Days running is the honest proxy for "this is working" — nobody keeps
  // paying for a loser. It is shown next to the source's own tier, never
  // instead of it.
  const isWinning = (ad.performanceTier ?? '').toLowerCase() === 'winning'

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-black/40">
        {ad.imageUrl ? (
          <img
            src={ad.imageUrl}
            alt={`${ad.brand} ad creative`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Icon size={26} className="text-white/15" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          {ad.performanceTier && (
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-bold backdrop-blur-sm ${
                isWinning ? 'bg-emerald-500/25 text-emerald-200' : 'bg-cyan/25 text-cyan'
              }`}
            >
              {ad.performanceTier}
            </span>
          )}
          {typeof ad.daysActive === 'number' && (
            <span className="rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white/75 backdrop-blur-sm">
              {ad.daysActive.toLocaleString()}d live
            </span>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2.5 pt-8">
          <Icon size={12} className="shrink-0 text-white/60" />
          <p className="truncate text-[12px] font-semibold text-white">{ad.brand}</p>
          {ad.videoLength ? (
            <span className="ml-auto shrink-0 text-[11px] text-white/50">{ad.videoLength}s</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {ad.title && <p className="line-clamp-2 text-[13px] font-medium text-white/85">{ad.title}</p>}
        <p className="line-clamp-3 text-[12px] leading-relaxed text-white/55">{ad.body || '—'}</p>

        <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/35">
          {ad.ctaText && <span className="text-white/50">{ad.ctaText}</span>}
          {ad.transcript && <span>Transcribed</span>}
          {ad.shareUrl && (
            <a
              href={ad.shareUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1 text-white/45 transition-colors hover:text-cyan"
            >
              Original <ExternalLink size={11} />
            </a>
          )}
        </div>

        {receipt && (
          <p
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] ${
              receipt.ok
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-white/[0.04] text-white/50'
            }`}
          >
            {receipt.ok ? <Check size={12} /> : null}
            {receipt.message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClone}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-cyan/40 bg-cyan/10 px-3 py-2 text-[13px] font-semibold text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-40"
          >
            <Copy size={13} /> Clone
          </button>
          <button
            type="button"
            onClick={onReadDesign}
            disabled={!ad.imageUrl || designing}
            title={
              ad.imageUrl
                ? 'Read this ad’s design and bank it in the Vault'
                : 'No still available to read'
            }
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/15 bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-white/75 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {designing ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
            Design
          </button>
        </div>
      </div>
    </div>
  )
}

function CloneEditor({
  reference,
  onChange,
  onCancel,
  onSend,
}: {
  reference: CloneReference
  onChange: (r: CloneReference) => void
  onCancel: () => void
  onSend: () => void
}) {
  const set = (key: keyof CreativeDNA, v: string) => onChange({ ...reference, [key]: v })
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <Copy size={16} className="text-cyan" />
            <p className="font-display text-sm font-semibold text-white">
              Review Creative DNA{reference.sourceLabel ? ` — ${reference.sourceLabel}` : ''}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-white/40 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
              Taxonomy tag
            </p>
            <TaxonomyChips taxonomy={reference.taxonomy} />
          </div>

          {DNA_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
                {f.label}
              </span>
              {f.long ? (
                <textarea
                  value={reference[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/85 focus:border-cyan/40 focus:outline-none"
                />
              ) : (
                <input
                  value={reference[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-white/85 focus:border-cyan/40 focus:outline-none"
                />
              )}
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm text-white/50 hover:text-white/80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            className="inline-flex items-center gap-2 rounded-full bg-cyan px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Send to Reactor <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
