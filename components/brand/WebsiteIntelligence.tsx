'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Globe,
  Link2,
  Loader2,
  Check,
  AlertCircle,
  RefreshCw,
  Eye,
  Trash2,
  Radar,
  ArrowRight,
  RotateCw,
  FileText,
  Palette,
  type LucideIcon,
} from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import type {
  AnalyzeEvent,
  WebsiteSummary,
  WebsiteProfiles,
  BrandAssets,
} from '@/lib/website-intelligence'

const inputCls =
  'w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-glow focus:outline-none focus:ring-1 focus:ring-glow/40 transition-colors'

const PANEL_ID = 'website-intelligence-panel'
const UNKNOWN = 'Not confidently identified'

/* ---------------------------- Analysis streaming -------------------------- */

async function streamAnalyze(url: string, onEvent: (e: AnalyzeEvent) => void): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/vault/website/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  } catch {
    onEvent({ type: 'error', message: 'Could not reach the analysis service. Try again.' })
    return
  }

  if (!res.ok || !res.body) {
    let message = 'Website analysis failed.'
    try {
      const j = await res.json()
      message = j.error || message
    } catch {
      /* non-JSON error */
    }
    onEvent({ type: 'error', message })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as AnalyzeEvent)
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/* ------------------------------ Progress list ----------------------------- */

function ProgressList({ steps, done }: { steps: string[]; done: boolean }) {
  return (
    <ul className="space-y-2">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const active = isLast && !done
        return (
          <li key={`${step}-${i}`} className="flex items-center gap-2.5 text-sm">
            {active ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-glow" />
            ) : (
              <Check size={14} className="shrink-0 text-success" />
            )}
            <span className={active ? 'text-white/80' : 'text-white/45'}>{step}</span>
          </li>
        )
      })}
    </ul>
  )
}

/* --------------------------- Website Link input --------------------------- */

type InputPhase =
  | { kind: 'idle' }
  | { kind: 'analyzing'; steps: string[] }
  | { kind: 'complete'; summary: WebsiteSummary }
  | { kind: 'error'; message: string }

export function WebsiteLinkInput({ onChanged }: { onChanged: () => void }) {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<InputPhase>({ kind: 'idle' })

  const analyze = useCallback(async () => {
    const target = url.trim()
    if (!target) return
    setPhase({ kind: 'analyzing', steps: ['ATLAS initialised'] })
    await streamAnalyze(target, (e) => {
      if (e.type === 'progress') {
        setPhase((p) =>
          p.kind === 'analyzing'
            ? { kind: 'analyzing', steps: [...p.steps.filter((s) => s !== e.message), e.message] }
            : p,
        )
      } else if (e.type === 'complete') {
        setPhase({ kind: 'complete', summary: e.summary })
        onChanged()
      } else if (e.type === 'error') {
        setPhase({ kind: 'error', message: e.message })
      }
    })
  }, [url, onChanged])

  const reset = () => {
    setPhase({ kind: 'idle' })
    setUrl('')
  }

  const viewIntelligence = () => {
    document.getElementById(PANEL_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (phase.kind === 'analyzing') {
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Radar size={16} className="animate-pulse text-glow" />
          <span className="font-display text-sm font-semibold text-white">
            ATLAS is analysing the website…
          </span>
        </div>
        <ProgressList steps={phase.steps} done={false} />
      </div>
    )
  }

  if (phase.kind === 'complete') {
    const { summary } = phase
    const partial = summary.failedPages.length > 0
    return (
      <div className="rounded-xl border border-success/30 bg-success/[0.04] p-5">
        <div className="mb-4 flex items-center gap-2">
          {partial ? (
            <AlertCircle size={16} className="text-warning" />
          ) : (
            <Check size={16} className="text-success" />
          )}
          <span className="font-display text-sm font-semibold text-white">
            {partial ? 'Website analysis partially complete' : 'Website analysis complete'}
          </span>
        </div>

        <CompletionMetrics summary={summary} />

        {partial && (
          <p className="mt-3 text-[11px] text-warning/80">
            {summary.failedPages.length} page{summary.failedPages.length === 1 ? '' : 's'} could not
            be analysed — the rest of the intelligence is ready.
          </p>
        )}
        {!summary.stored && (
          <p className="mt-3 text-[11px] text-white/40">
            Captured in demo mode — configure Supabase + Voyage to persist this website to the Vault.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={viewIntelligence}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-glow transition-all hover:bg-primary/20 hover:shadow-glow"
          >
            <Eye size={15} /> View Website Intelligence
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-4 py-2 text-sm font-medium text-white/70 transition-all hover:border-white/20 hover:text-white"
          >
            <ArrowRight size={15} /> Continue using Reactor
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
          Website URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Link2
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  analyze()
                }
              }}
              placeholder="https://companywebsite.com"
              className={`${inputCls} pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={analyze}
            disabled={!url.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-glow transition-all hover:bg-primary/20 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-40 sm:w-48"
          >
            <Radar size={15} /> Analyse Website
          </button>
        </div>
      </div>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-white/45">
        <Globe size={14} className="mt-0.5 shrink-0 text-glow/70" />
        ATLAS will analyse the company’s public website and create an initial intelligence profile
        for the Knowledge Vault.
      </p>

      {phase.kind === 'error' && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/[0.05] px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] text-danger">
            <AlertCircle size={13} /> {phase.message}
          </span>
          <button
            type="button"
            onClick={analyze}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/60 px-2.5 py-1 text-[11px] font-medium text-white/70 hover:text-white"
          >
            <RotateCw size={12} /> Retry
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Metric cards ------------------------------ */

const METRIC_DEFS: { key: keyof WebsiteSummary['metrics']; label: string }[] = [
  { key: 'pagesScanned', label: 'Pages scanned' },
  { key: 'pagesIndexed', label: 'Pages indexed' },
  { key: 'intelligenceSignals', label: 'Intelligence signals' },
  { key: 'offersFound', label: 'Offers found' },
  { key: 'audiencesDetected', label: 'Audiences detected' },
  { key: 'proofAssets', label: 'Proof assets' },
]

function CompletionMetrics({ summary }: { summary: WebsiteSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {METRIC_DEFS.map((m) => (
        <div key={m.key} className="rounded-lg border border-border bg-surface/40 px-3 py-2.5">
          <div className="font-display text-lg font-bold text-glow">{summary.metrics[m.key]}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/40">{m.label}</div>
        </div>
      ))}
    </div>
  )
}

/* --------------------------- Profile rendering ---------------------------- */

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`mt-0.5 text-sm ${value === UNKNOWN ? 'italic text-white/30' : 'text-white/80'}`}>
        {value}
      </div>
    </div>
  )
}

function ChipList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span
            key={`${label}-${i}`}
            className="rounded-md border border-border bg-surface/50 px-2 py-1 text-[12px] text-white/70"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  )
}

function QuoteList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={`${label}-${i}`}
            className="rounded-lg border border-border bg-surface/40 px-3 py-2 text-[13px] leading-relaxed text-white/70"
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyHint({ shown }: { shown: boolean }) {
  if (shown) return null
  return <p className="text-[12px] italic text-white/30">Not confidently identified from this website.</p>
}

type TabId =
  | 'overview'
  | 'brand'
  | 'colours'
  | 'logo'
  | 'audience'
  | 'offers'
  | 'messaging'
  | 'proof'
  | 'pages'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'brand', label: 'Brand' },
  { id: 'colours', label: 'Colours' },
  { id: 'logo', label: 'Logo' },
  { id: 'audience', label: 'Audience' },
  { id: 'offers', label: 'Offers' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'proof', label: 'Proof' },
  { id: 'pages', label: 'Pages' },
]

/* ----------------------------- Colours + Logo ---------------------------- */

/** Readable text colour for a swatch label — dark ink on light fills. */
function readableInk(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Perceived luminance (Rec. 601).
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0a0a0a' : '#ffffff'
}

function ColoursTab({ assets }: { assets?: BrandAssets }) {
  const colors = assets?.colors ?? []
  if (!colors.length) {
    return (
      <EmptyBrandAsset
        title="No brand colours captured yet"
        body="Colours are read from your site's markup on analysis. Hit Refresh above to capture the palette your website actually paints with."
      />
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-white/40">
        The colours your site actually uses, ranked by how often they appear in the markup.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {colors.map((c) => (
          <div key={c.hex} className="overflow-hidden rounded-xl border border-border bg-surface/40">
            <div
              className="flex h-24 items-end justify-end p-2"
              style={{ backgroundColor: c.hex }}
            >
              <span
                className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: 'rgba(0,0,0,0.18)', color: readableInk(c.hex) }}
              >
                {c.hex}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="font-mono text-[12px] text-white/75">{c.hex}</span>
              <span className="text-[10px] text-white/35">×{c.weight}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LogoTab({ assets, domain }: { assets?: BrandAssets; domain: string }) {
  // The captured logo, with the site's favicon as an always-available fallback
  // so a connected site is never a blank square.
  const captured = assets?.logoUrl ?? null
  const fallback = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-white/40">
        The logo declared by your site (og:image or icon). Composited onto creatives, never
        regenerated.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white/[0.03] p-6">
          <span className="text-[10px] uppercase tracking-wider text-white/40">On dark</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={captured ?? fallback}
            alt={`${domain} logo`}
            className="max-h-24 max-w-full object-contain"
            onError={(e) => {
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
            }}
          />
        </div>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-white p-6">
          <span className="text-[10px] uppercase tracking-wider text-black/40">On light</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={captured ?? fallback}
            alt={`${domain} logo`}
            className="max-h-24 max-w-full object-contain"
            onError={(e) => {
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback
            }}
          />
        </div>
      </div>
      {captured && (
        <a
          href={captured}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[11px] text-white/35 hover:text-glow"
        >
          {captured}
        </a>
      )}
    </div>
  )
}

function EmptyBrandAsset({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface/20 px-6 py-12 text-center">
      <Palette size={30} className="mb-3 text-white/15" />
      <p className="font-display text-sm font-semibold text-white/70">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-white/40">{body}</p>
    </div>
  )
}

function ProfileBody({
  tab,
  p,
  pages,
  assets,
  domain,
}: {
  tab: TabId
  p: WebsiteProfiles
  pages: WebsiteSummary['pages']
  assets?: BrandAssets
  domain: string
}) {
  if (tab === 'colours') return <ColoursTab assets={assets} />
  if (tab === 'logo') return <LogoTab assets={assets} domain={domain} />
  if (tab === 'overview') {
    return (
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Field label="Company" value={p.brand.companyName} />
        <Field label="Industry" value={p.brand.industry} />
        <Field label="Positioning" value={p.brand.positioning} />
        <Field label="Primary audience" value={p.audience.primaryAudiences[0] ?? UNKNOWN} />
        <Field label="Primary offer" value={p.offer.primaryOffer} />
        <Field label="Brand voice" value={p.brand.brandVoice} />
      </div>
    )
  }
  if (tab === 'brand') {
    const has =
      p.brand.valuePropositions.length +
        p.brand.differentiators.length +
        p.brand.primaryPromises.length +
        p.brand.authoritySignals.length >
      0
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Field label="Business model" value={p.brand.businessModel} />
          <Field label="Tone" value={p.brand.tone} />
        </div>
        <ChipList label="Value propositions" items={p.brand.valuePropositions} />
        <ChipList label="Differentiators" items={p.brand.differentiators} />
        <ChipList label="Primary promises" items={p.brand.primaryPromises} />
        <ChipList label="Authority signals" items={p.brand.authoritySignals} />
        <EmptyHint shown={has} />
      </div>
    )
  }
  if (tab === 'audience') {
    const a = p.audience
    const has =
      a.primaryAudiences.length + a.problems.length + a.desires.length + a.outcomes.length > 0
    return (
      <div className="space-y-4">
        <p className="text-[11px] text-white/40">Company-stated audience intelligence — not verified market research.</p>
        <ChipList label="Primary audiences" items={a.primaryAudiences} />
        <ChipList label="Secondary audiences" items={a.secondaryAudiences} />
        <ChipList label="Customer types" items={a.customerTypes} />
        <QuoteList label="Problems mentioned" items={a.problems} />
        <QuoteList label="Desires mentioned" items={a.desires} />
        <QuoteList label="Outcomes promised" items={a.outcomes} />
        <ChipList label="Audience language" items={a.audienceLanguage} />
        <EmptyHint shown={has} />
      </div>
    )
  }
  if (tab === 'offers') {
    const o = p.offer
    const has =
      o.products.length + o.services.length + o.programs.length + (o.primaryOffer !== UNKNOWN ? 1 : 0) > 0
    return (
      <div className="space-y-4">
        <Field label="Primary offer" value={o.primaryOffer} />
        <ChipList label="Products" items={o.products} />
        <ChipList label="Services" items={o.services} />
        <ChipList label="Programs" items={o.programs} />
        <ChipList label="Secondary offers" items={o.secondaryOffers} />
        <ChipList label="Lead magnets" items={o.leadMagnets} />
        <ChipList label="Events" items={o.events} />
        <ChipList label="Calls to action" items={o.callsToAction} />
        <ChipList label="Pricing (stated)" items={o.pricing} />
        <ChipList label="Guarantees (stated)" items={o.guarantees} />
        <EmptyHint shown={has} />
      </div>
    )
  }
  if (tab === 'messaging') {
    const m = p.messaging
    const has = m.themes.length + m.headlines.length + m.claims.length + m.commonPhrases.length > 0
    return (
      <div className="space-y-4">
        <ChipList label="Recurring themes" items={m.themes} />
        <QuoteList label="Headlines" items={m.headlines} />
        <ChipList label="Common phrases" items={m.commonPhrases} />
        <ChipList label="Brand vocabulary" items={m.vocabulary} />
        <QuoteList label="Claims" items={m.claims} />
        <ChipList label="Emotional language" items={m.emotionalLanguage} />
        <ChipList label="Calls to action" items={m.callsToAction} />
        <ChipList label="Differentiators" items={m.differentiators} />
        <ChipList label="Identity language" items={m.identityLanguage} />
        <ChipList label="Transformation language" items={m.transformationLanguage} />
        <EmptyHint shown={has} />
      </div>
    )
  }
  if (tab === 'proof') {
    const pr = p.proof
    const has =
      pr.testimonials.length + pr.caseStudies.length + pr.results.length + pr.statistics.length > 0
    return (
      <div className="space-y-4">
        <p className="text-[11px] text-white/40">Company-provided claims unless independently verified.</p>
        <QuoteList label="Testimonials" items={pr.testimonials} />
        <QuoteList label="Case studies" items={pr.caseStudies} />
        <QuoteList label="Success stories" items={pr.successStories} />
        <ChipList label="Results" items={pr.results} />
        <ChipList label="Statistics" items={pr.statistics} />
        <ChipList label="Awards" items={pr.awards} />
        <ChipList label="Partnerships" items={pr.partnerships} />
        <ChipList label="Certifications" items={pr.certifications} />
        <ChipList label="Authority signals" items={pr.authoritySignals} />
        <EmptyHint shown={has} />
      </div>
    )
  }
  // Pages
  return (
    <ul className="space-y-2">
      {pages.map((pg) => (
        <li
          key={pg.url}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface/40 px-3 py-2.5"
        >
          <FileText size={15} className="shrink-0 text-glow/70" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white/80" title={pg.title}>
              {pg.title || pg.url}
            </div>
            <a
              href={pg.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-[11px] text-white/35 hover:text-glow"
            >
              {pg.url}
            </a>
          </div>
          <Pill>{pg.pageType}</Pill>
        </li>
      ))}
    </ul>
  )
}

/* ----------------------- Website Intelligence panel ----------------------- */

export function WebsiteIntelligencePanel({
  reloadKey,
  onChanged,
}: {
  reloadKey: number
  onChanged: () => void
}) {
  const [website, setWebsite] = useState<WebsiteSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabId>('overview')
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/vault/website', { cache: 'no-store' }).then((r) => r.json())
      if (res.success) setWebsite(res.website)
    } catch {
      /* leave existing state */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const refresh = useCallback(async () => {
    if (!website) return
    setRefreshing('Starting refresh…')
    await streamAnalyze(website.url, (e) => {
      if (e.type === 'progress') setRefreshing(e.message)
      else if (e.type === 'complete') {
        setRefreshing(null)
        setWebsite(e.summary)
        onChanged()
      } else if (e.type === 'error') {
        setRefreshing(null)
      }
    })
  }, [website, onChanged])

  const disconnect = useCallback(async () => {
    if (!website) return
    if (!window.confirm(`Disconnect ${website.domain} and remove its intelligence from the Vault?`)) {
      return
    }
    setBusy(true)
    try {
      await fetch(`/api/vault/website?domain=${encodeURIComponent(website.domain)}`, {
        method: 'DELETE',
      })
      setWebsite(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [website, onChanged])

  // The panel only exists once a website has been connected.
  if (loading && !website) return null
  if (!website) return null

  const lastScanned = website.lastScanned
    ? new Date(website.lastScanned).toLocaleString()
    : 'Not yet recorded'

  // A site whose pages indexed but whose profiles are blank reads as a healthy
  // connection with nothing to say — the two states are indistinguishable in
  // the fields themselves, and only one of them is worth re-running. Cover all
  // three causes, including a scan banked before extraction health was
  // recorded (no flags, no profiles: still worth a retry).
  const failed = website.extractionFailed ?? []
  const nothingDerived = website.metrics.profilesCreated === 0 && website.pages.length > 0
  const extractionNotice = website.extractionSkipped
    ? 'Pages were indexed, but no ANTHROPIC_API_KEY was configured for the scan, so no intelligence was derived. Set the key, then retry.'
    : failed.length >= 5 || (nothingDerived && failed.length === 0)
      ? 'Pages were indexed, but no intelligence profiles came out of them. The fields below are blank because extraction produced nothing — not because the site says nothing. Retry to rebuild them.'
      : failed.length > 0
        ? `${failed.join(' and ')} intelligence could not be derived. Those fields are blank because extraction failed, not because the site says nothing.`
        : null

  return (
    <Panel className="scroll-mt-6" >
      <div id={PANEL_ID} />
      <PanelHeader
        icon={<Radar size={16} />}
        accent="cyan"
        title="Website Intelligence"
        subtitle="ATLAS-generated intelligence from the connected website."
        accessory={
          <Pill tone={website.stored ? 'success' : 'warning'}>
            <Globe size={12} /> {website.stored ? 'Connected' : 'Demo'}
          </Pill>
        }
      />

      <div className="space-y-5 p-5">
        {/* Connected website + actions */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-white/40">Connected website</div>
            <a
              href={website.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-display text-sm font-semibold text-white hover:text-glow"
            >
              {website.domain}
            </a>
            <div className="mt-0.5 text-[11px] text-white/35">Last analysed: {lastScanned}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={RefreshCw} label="Refresh" onClick={refresh} disabled={!!refreshing || busy} />
            <ActionButton
              icon={Eye}
              label="View profile"
              onClick={() => setTab('overview')}
              disabled={!!refreshing || busy}
            />
            <ActionButton
              icon={Trash2}
              label="Disconnect"
              onClick={disconnect}
              disabled={!!refreshing || busy}
              danger
            />
          </div>
        </div>

        {refreshing && (
          <div className="flex items-center gap-2 rounded-lg border border-glow/30 bg-primary/[0.04] px-3 py-2 text-[12px] text-glow">
            <Loader2 size={13} className="animate-spin" /> {refreshing}
          </div>
        )}

        {/* An extraction that failed reads identically to a site that states
            nothing — every field shows "Not confidently identified". Only this
            tells the two apart, and only one of them is worth a re-run. */}
        {extractionNotice && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2">
            <span className="flex items-start gap-2 text-[12px] leading-relaxed text-warning">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>
                {extractionNotice}
                {website.extractionError && (
                  <span className="mt-1 block text-[11px] text-warning/70">
                    Reason: {website.extractionError}
                  </span>
                )}
              </span>
            </span>
            <button
              type="button"
              onClick={refresh}
              disabled={!!refreshing || busy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
            >
              <RotateCw size={12} /> Retry extraction
            </button>
          </div>
        )}

        {/* Summary metrics */}
        <CompletionMetrics summary={website} />

        {/* Profile tabs */}
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
                  active
                    ? 'border-primary/40 bg-primary/15 text-glow shadow-glow'
                    : 'border-border bg-surface/40 text-white/50 hover:border-white/20 hover:text-white/80'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        <ProfileBody
          tab={tab}
          p={website.profiles}
          pages={website.pages}
          assets={website.brandAssets}
          domain={website.domain}
        />
      </div>
    </Panel>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-border bg-surface/60 text-white/60 hover:border-danger/40 hover:bg-danger/10 hover:text-danger'
          : 'border-border bg-surface/60 text-white/70 hover:border-glow/40 hover:text-glow'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  )
}
