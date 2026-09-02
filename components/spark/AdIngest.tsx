'use client'

// SPARK visual ad ingest — the one place a winning Meta ad enters the platform.
//
// Drop an ad in and three things happen: its DESIGN is read (palette measured
// from the real pixels, layout mapped, on-ad copy transcribed), the design is
// banked in the Knowledge Vault as a retrievable pattern, and it becomes
// something you can act on immediately — clone it into a finished ad for your
// own offer, or hand it to the Campaign Reactor as proven direction.
//
// The same component serves the Creative page and the Knowledge Vault; only the
// framing copy differs, because the capability is identical and a second
// implementation would drift.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ImageIcon,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
} from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { CLONE_STORAGE_KEY, taxonomyToTags, type CreativeTaxonomy } from '@/lib/taxonomy'
import { measureCanvasPalette, type MeasuredSwatch } from '@/lib/palette'
import { cn } from '@/lib/utils'
import type { CreativeDNA, LayoutZone, VisualDNA } from '@/lib/spark'

/** One dissected ad as returned by /api/spark/analyze. */
interface AnalyzedAd {
  label: string
  dna: CreativeDNA
  visual: VisualDNA | null
  taxonomy?: CreativeTaxonomy
}

/** The finished rebuild returned by /api/spark/clone. */
interface CloneResult {
  imageUrl: string | null
  model: string | null
  copy: { headline: string; highlight: string; support: string[]; cta: string }
  prompt: string
  rationale: string
  renderError?: string
}

const DNA_ROWS: { key: keyof CreativeDNA; label: string }[] = [
  { key: 'hook', label: 'Hook' },
  { key: 'opening', label: 'Opening' },
  { key: 'storyStructure', label: 'Story' },
  { key: 'ctaStructure', label: 'CTA' },
  { key: 'offerPresentation', label: 'Offer' },
  { key: 'editingStyle', label: 'Editing' },
  { key: 'visualStyle', label: 'Visual style' },
]

/** Top-to-bottom order for the layout map. */
const ZONE_ORDER: { zone: LayoutZone; label: string }[] = [
  { zone: 'top', label: 'Top' },
  { zone: 'upper-middle', label: 'Upper middle' },
  { zone: 'middle', label: 'Middle' },
  { zone: 'lower-middle', label: 'Lower middle' },
  { zone: 'bottom', label: 'Bottom' },
  { zone: 'full-bleed', label: 'Full bleed' },
]

const MAX_IMAGES = 4
/**
 * How many already-banked ads stay visible as a session shelf. It is a memory
 * aid — "these are already in" — not storage: the design itself lives in the
 * Vault as a retrievable chunk, so the source image has no job left to do.
 */
const BANKED_STRIP_MAX = 12
/**
 * Claude downsamples anything larger than ~1568px on the long edge, so this is
 * the most detail that survives the trip. It matters most for a contact sheet:
 * every pixel spent here is a pixel of headline legibility in a 10-ad grid.
 */
const MAX_EDGE = 1568
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

interface Upload {
  id: string
  dataUrl: string
  name: string
  /** The ad's real colours, measured off the canvas before upload. */
  palette: MeasuredSwatch[]
}

/**
 * Downscale a dropped/pasted image to a vision-friendly size AND measure its
 * true palette off the same canvas.
 *
 * Measuring here is the whole reason the colours are right: the pixels are in
 * hand, so the palette is sampled rather than guessed, and a vivid accent that
 * covers 4% of the ad — the red band behind one word — can't go missing.
 * GIFs are passed through untouched so animation frames aren't flattened oddly.
 */
async function prepareImage(file: File): Promise<{ dataUrl: string; palette: MeasuredSwatch[] } | null> {
  if (!ACCEPTED.includes(file.type)) return null

  const readAsDataUrl = () =>
    new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })

  const passthrough = async () => {
    const dataUrl = await readAsDataUrl()
    return dataUrl ? { dataUrl, palette: [] as MeasuredSwatch[] } : null
  }

  if (file.type === 'image/gif') return passthrough()

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return passthrough()
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const palette = measureCanvasPalette(canvas)

    // PNG keeps crisp edges on flat-colour ad graphics; photos ride JPEG.
    const dataUrl =
      file.type === 'image/png' && w * h < 1_200_000
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.86)
    return { dataUrl, palette }
  } catch {
    return passthrough()
  }
}

export interface AdIngestProps {
  /**
   * 'vault' frames this as banking design intelligence; 'studio' frames it as
   * studying a creative. The capability is the same either way.
   */
  variant?: 'studio' | 'vault'
}

export function AdIngest({ variant = 'studio' }: AdIngestProps) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [showExtras, setShowExtras] = useState(false)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [ads, setAds] = useState<AnalyzedAd[]>([])
  const [active, setActive] = useState(0)
  const [stored, setStored] = useState(false)
  const [live, setLive] = useState(true)
  const [reason, setReason] = useState<string | null>(null)
  const [goal, setGoal] = useState('')
  const [cloning, setCloning] = useState(false)
  const [clone, setClone] = useState<CloneResult | null>(null)
  const [cloneError, setCloneError] = useState<string | null>(null)
  // Ads whose DNA is already in the Vault this session. They leave the tray the
  // moment they are banked — the tray is a queue of what is ABOUT to be read, so
  // anything still sitting in it would be read again on the next ingest.
  const [banked, setBanked] = useState<Upload[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const current = ads[active] ?? null

  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => ACCEPTED.includes(f.type))
    if (!images.length) return
    setError(null)
    const prepared = await Promise.all(
      images.map(async (f) => ({ file: f, result: await prepareImage(f) })),
    )
    setUploads((prev) => {
      const next = [...prev]
      for (const { file, result } of prepared) {
        if (!result || next.length >= MAX_IMAGES) continue
        next.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
          dataUrl: result.dataUrl,
          name: file.name,
          palette: result.palette,
        })
      }
      return next
    })
  }, [])

  // Paste anywhere on the page drops the ad straight in — the fastest path from
  // "screenshot a winning ad" to "analyze it".
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => ACCEPTED.includes(f.type))
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addFiles])

  const removeUpload = (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id))

  const resetResults = () => {
    setAds([])
    setActive(0)
    setStored(false)
    setLive(true)
    setReason(null)
    setNotes([])
    setError(null)
    setClone(null)
    setCloneError(null)
  }

  const analyze = async () => {
    setBusy(true)
    resetResults()
    const submitted = uploads
    try {
      const res = await fetch('/api/spark/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim() || undefined,
          text: text.trim() || undefined,
          images: uploads.map((u) => u.dataUrl),
          palettes: uploads.map((u) => u.palette),
        }),
      }).then((r) => r.json())

      setNotes(Array.isArray(res.notes) ? res.notes : [])
      if (res.success && Array.isArray(res.ads) && res.ads.length) {
        setAds(res.ads as AnalyzedAd[])
        setActive(0)
        setStored(Boolean(res.stored))
        setLive(res.live !== false)
        setReason(typeof res.reason === 'string' ? res.reason : null)

        // A real read empties the queue: the DNA is banked, so the source images
        // have done their job and must not ride along into the next ingest. A
        // sample read banked nothing — leave those images in place to retry.
        if (vault && res.live !== false && submitted.length) {
          const ids = new Set(submitted.map((u) => u.id))
          setUploads((prev) => prev.filter((u) => !ids.has(u.id)))
          setBanked((prev) => [...submitted, ...prev].slice(0, BANKED_STRIP_MAX))
          setUrl('')
          setText('')
        }
      } else {
        setError(res.error || 'Analysis failed')
      }
    } catch {
      setError('Analysis failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  // Rebuild the read design as a finished ad for this business, right here.
  const cloneAd = async () => {
    if (!current?.visual) return
    setCloning(true)
    setClone(null)
    setCloneError(null)
    try {
      const res = await fetch('/api/spark/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visual: current.visual,
          dna: current.dna,
          goal: goal.trim() || undefined,
          aspectRatio: current.visual.aspectRatio,
        }),
      }).then((r) => r.json())

      if (res.success) {
        setClone(res as CloneResult)
        if (res.renderError) setCloneError(res.renderError)
      } else {
        setCloneError(res.error || 'Clone failed')
      }
    } catch {
      setCloneError('Clone failed — try again.')
    } finally {
      setCloning(false)
    }
  }

  // Hand the analyzed reference to the Reactor. sessionStorage keeps the payload
  // out of the URL; the Workbench reads and clears it on mount, then the visual
  // read rides into OPUS's prompt as design direction for the production brief.
  const sendToReactor = () => {
    if (!current) return
    const { dna, visual, taxonomy, label } = current
    try {
      sessionStorage.setItem(
        CLONE_STORAGE_KEY,
        JSON.stringify({
          hook: dna.hook,
          opening: dna.opening,
          storyStructure: dna.storyStructure,
          ctaStructure: dna.ctaStructure,
          editingStyle: dna.editingStyle,
          offerPresentation: dna.offerPresentation,
          visualStyle: dna.visualStyle,
          summary: dna.summary,
          taxonomy,
          visual: visual ?? undefined,
          sourceLabel: `${ads.length > 1 ? `${label} · ` : ''}${dna.patternType}`,
        }),
      )
    } catch {
      /* private mode — the reactor just won't pre-load the reference */
    }
    router.push('/campaign-reactor')
  }

  const inputClass =
    'w-full rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-primary/60'
  const canAnalyze = uploads.length > 0 || text.trim().length > 0 || url.trim().length > 0
  const vault = variant === 'vault'

  return (
    <Panel>
      <PanelHeader
        icon={<Sparkles size={16} />}
        accent="amber"
        title={vault ? 'Ad Design DNA' : 'SPARK · Winning Creative Intelligence'}
        subtitle={
          vault
            ? 'The visual section of the Vault. Drop winning Meta ads in — palette, layout, placement and on-ad copy are read and stored as knowledge SPARK and OPUS retrieve when a brief needs a proven design.'
            : 'Drop a winning Meta ad in. SPARK reads its design, banks it, and rebuilds it for your offer.'
        }
        accessory={
          ads.length > 1 ? (
            <Pill tone="primary">{ads.length} ads read</Pill>
          ) : current ? (
            <Pill tone="primary">{current.dna.patternType}</Pill>
          ) : undefined
        }
      />

      {/* The Vault is an INGEST surface, not a workbench: one column, drop box,
          and a receipt of what was banked. The teardown, the clone and the
          hand-off to the Reactor live on the Creative page, where you are
          actually working on an ad rather than filing one. */}
      <div className={cn('gap-4 p-5', vault ? 'flex flex-col' : 'grid lg:grid-cols-2')}>
        {/* ------------------------------ Input side ------------------------------ */}
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void addFiles(Array.from(e.dataTransfer.files))
            }}
            className={cn(
              'rounded-xl border-2 border-dashed p-5 text-center transition-colors',
              dragging ? 'border-primary/70 bg-primary/[0.07]' : 'border-white/12 bg-surface/30',
            )}
          >
            <ImageIcon size={22} className={cn('mx-auto mb-2', dragging ? 'text-glow' : 'text-white/25')} />
            <p className="text-sm font-medium text-white/80">Drag ads in, or paste a screenshot</p>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-white/35">
              Up to {MAX_IMAGES} images. Colours are measured from the real pixels; layout, placement
              and on-ad copy are read. Drop a whole swipe board and every ad on it is dissected on its
              own.
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/80 transition-colors hover:border-white/25 hover:text-white"
            >
              <Upload size={14} /> Choose images
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(',')}
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </div>

          {/* The ignition sits directly under the drop zone — the eye lands on
              the box, then on the button, before any thumbnails appear. */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={analyze}
              disabled={busy || !canAnalyze}
              className="fire-btn fire-btn--md tap-target inline-flex items-center gap-2 font-display font-bold uppercase tracking-wide text-white"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {busy
                ? vault
                  ? 'Ingesting…'
                  : 'Reading the ad…'
                : vault
                  ? 'Ingest Visual Creative DNA'
                  : uploads.length
                    ? 'Read this ad'
                    : 'Extract Creative DNA'}
            </button>
          </div>

          {uploads.length > 0 && (
            <>
              {vault && (
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Queued to ingest · {uploads.length}
                </p>
              )}
            <div className="grid grid-cols-4 gap-2">
              {uploads.map((u) => (
                <div key={u.id} className="group relative overflow-hidden rounded-lg border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u.dataUrl} alt={u.name} className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeUpload(u.id)}
                    aria-label={`Remove ${u.name}`}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white/70 transition-colors hover:bg-danger/80 hover:text-white"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            </>
          )}

          {/* Already in the Vault. Shown so you can see at a glance what has been
              banked this session and keep dropping the next one — never re-read,
              because it is no longer in the queue. */}
          {vault && banked.length > 0 && (
            <div className="rounded-xl border border-success/20 bg-success/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-success/80">
                  <Check size={12} /> Banked this session · {banked.length}
                </p>
                <button
                  type="button"
                  onClick={() => setBanked([])}
                  className="min-h-[32px] text-[11px] font-medium text-white/40 transition-colors hover:text-white/75"
                >
                  Clear shelf
                </button>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {banked.map((u) => (
                  <div
                    key={u.id}
                    className="relative overflow-hidden rounded-lg border border-success/25"
                    title={`${u.name} — design DNA is in the Vault`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u.dataUrl} alt={u.name} className="aspect-square w-full object-cover opacity-45" />
                    <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-success/90 text-black">
                      <Check size={11} />
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                The design intelligence — palette, layout, placement, on-ad copy — is stored and
                retrievable. These thumbnails are a session reminder only; clearing them changes
                nothing in the Vault.
              </p>
            </div>
          )}

          {/* Everything optional lives behind one toggle — the drop zone is the
              path 95% of reads take, and two always-open text fields made it
              look like work was required before anything would happen. */}
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            className="flex min-h-[36px] items-center gap-1.5 text-[12px] font-medium text-white/45 transition-colors hover:text-white/75"
          >
            <ChevronDown size={13} className={cn('transition-transform', showExtras && 'rotate-180')} />
            Add a link or notes
          </button>

          {showExtras && (
            <div className="space-y-3">
              <div>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Direct image link, or a YouTube URL to transcribe"
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-white/35">
                  Ad-library and board pages render with JavaScript and can&apos;t be fetched —
                  screenshot those and drop them in.
                </p>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Body copy, or what made this ad win — sharpens the read."
                className={cn(inputClass, 'h-[88px] resize-none')}
              />
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/[0.06] p-2.5 text-[12px] text-danger">
              {error}
            </p>
          )}
          {notes.map((n) => (
            <p key={n} className="rounded-lg border border-warning/25 bg-warning/[0.05] p-2.5 text-[12px] text-warning">
              {n}
            </p>
          ))}
        </div>

        {/* -------------------- Vault: a receipt, not a teardown ------------------- */}
        {vault && !live && current && !busy && <SampleWarning reason={reason} />}
        {vault && ads.length > 0 && live && !busy && (
          <VaultReceipt ads={ads} stored={stored} />
        )}

        {/* ------------------------------ Result side ----------------------------- */}
        {!vault && (
        <div className="rounded-xl border border-border bg-surface/30 p-4">
          {!current && !busy && (
            <div className="grid h-full min-h-[220px] place-items-center text-center">
              <p className="max-w-xs text-sm text-white/35">
                The teardown appears here — measured palette, layout map, where each element sits and
                what it says. Then clone it into a finished ad for your own offer, or send it to the
                Reactor as proven direction.
              </p>
            </div>
          )}

          {busy && (
            <div className="grid h-full min-h-[220px] place-items-center">
              <span className="flex items-center gap-2 text-sm text-glow">
                <Loader2 size={16} className="animate-spin" />
                {uploads.length ? 'Separating and reading each ad…' : 'Extracting Creative DNA…'}
              </span>
            </div>
          )}

          {current && !busy && (
            <div className="space-y-4">
              {/* A read that didn't happen is never dressed up as one. */}
              {!live && <SampleWarning reason={reason} />}

              {ads.length > 1 && (
                <div>
                  <SectionLabel>{ads.length} ads found — each dissected separately</SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {ads.map((ad, i) => (
                      <button
                        key={`${ad.label}-${i}`}
                        type="button"
                        onClick={() => {
                          setActive(i)
                          setClone(null)
                          setCloneError(null)
                        }}
                        className={cn(
                          'min-h-[36px] max-w-full truncate rounded-full border px-3 py-1.5 text-left text-[12px] font-medium transition-colors',
                          i === active
                            ? 'border-primary/50 bg-primary/15 text-glow'
                            : 'border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white/80',
                        )}
                      >
                        {i + 1}. {ad.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="primary">{current.dna.patternType}</Pill>
                {live && current.visual && <Pill tone="success">Design read</Pill>}
                {stored ? (
                  <Pill tone="success">
                    {ads.length > 1 ? `${ads.length} banked in the Vault` : 'Banked in the Vault'}
                  </Pill>
                ) : live ? (
                  <Pill tone="warning">Not banked — configure Supabase + Voyage</Pill>
                ) : null}
              </div>

              {taxonomyToTags(current.taxonomy).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {taxonomyToTags(current.taxonomy).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-white/55"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {current.visual && <VisualTeardown visual={current.visual} />}

              <Collapsible label="Written DNA">
                <dl className="space-y-2">
                  {DNA_ROWS.map((row) => (
                    <div key={row.key} className="grid grid-cols-[92px_1fr] gap-2">
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                        {row.label}
                      </dt>
                      <dd className="text-[13px] text-white/75">{current.dna[row.key]}</dd>
                    </div>
                  ))}
                </dl>
              </Collapsible>

              {/* ------------------------------ Actions ---------------------------- */}
              {current.visual && (
                <div className="space-y-2.5 rounded-lg border border-primary/25 bg-primary/[0.04] p-3">
                  <SectionLabel>Clone this design for your offer</SectionLabel>
                  <input
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="What is your ad selling? (blank = your connected brand)"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={cloneAd}
                    disabled={cloning || !live}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {cloning ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                    {cloning ? 'Rebuilding the design…' : 'Clone into a finished ad'}
                  </button>
                  <p className="text-[11px] leading-relaxed text-white/40">
                    Rebuilds this exact layout, palette and contrast device with fresh copy for your
                    business — the structure, never the words.
                  </p>
                </div>
              )}

              {cloneError && (
                <p className="rounded-lg border border-warning/30 bg-warning/[0.06] p-2.5 text-[12px] text-warning">
                  {cloneError}
                </p>
              )}

              {clone && <ClonePreview clone={clone} />}

              <button
                type="button"
                onClick={sendToReactor}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:border-white/30 hover:text-white"
              >
                Build a full campaign from this ad <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
        )}
      </div>
    </Panel>
  )
}

/* --------------------------------- sub-parts -------------------------------- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">{children}</p>
  )
}

/** A read that didn't happen is never dressed up as one. */
function SampleWarning({ reason }: { reason: string | null }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/[0.07] p-3">
      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
      <div>
        <p className="text-[12.5px] font-semibold text-warning">
          Sample structure — not a read of your ad
        </p>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/55">
          {reason ?? 'The vision read was unavailable.'} Nothing was stored in the Vault.
        </p>
      </div>
    </div>
  )
}

/**
 * What the Vault banked. Not a teardown — a receipt: one line per ad, the
 * colours that were measured, and confirmation that the design is now
 * retrievable. The full read lives on the Creative page.
 */
function VaultReceipt({ ads, stored }: { ads: AnalyzedAd[]; stored: boolean }) {
  return (
    <div className="rounded-xl border border-success/25 bg-success/[0.04] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Check size={15} className="text-success" />
        <p className="text-[13px] font-semibold text-white/85">
          {ads.length === 1 ? '1 design ingested' : `${ads.length} designs ingested`}
        </p>
        {stored ? (
          <Pill tone="success">Retrievable by every agent</Pill>
        ) : (
          <Pill tone="warning">Not banked — configure Supabase + Voyage</Pill>
        )}
      </div>

      <ul className="space-y-2">
        {ads.map((ad, i) => (
          <li
            key={`${ad.label}-${i}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
          >
            <span className="text-[13px] font-medium text-white/80">{ad.label}</span>
            <span className="text-[11px] text-white/40">{ad.dna.patternType}</span>
            {ad.visual && (
              <>
                <span className="text-[11px] text-white/40">
                  {ad.visual.aspectRatio} · {ad.visual.elements.length} placements
                </span>
                <span className="flex gap-1">
                  {ad.visual.palette.slice(0, 6).map((c) => (
                    <svg key={c.hex} width="14" height="14" viewBox="0 0 14 14" aria-label={c.role}>
                      <rect x="0" y="0" width="14" height="14" rx="3" fill={c.hex} />
                      <rect
                        x="0.5"
                        y="0.5"
                        width="13"
                        height="13"
                        rx="2.5"
                        fill="none"
                        stroke="rgba(255,255,255,0.2)"
                      />
                    </svg>
                  ))}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11.5px] leading-relaxed text-white/45">
        Palette, layout, element placement and on-ad copy are stored with each design. SPARK and OPUS
        pull from these when a brief calls for a proven layout — the Reactor builds on the
        best-fitting one automatically when you haven&apos;t attached a reference.
      </p>
    </div>
  )
}

/** A labelled disclosure — keeps the secondary detail out of the first read. */
function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[32px] w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 transition-colors hover:text-white/70"
      >
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
        {label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

/**
 * Colour swatches. Rendered as SVG `fill` attributes rather than inline styles —
 * the palette is data from the read, so it can't be expressed as static
 * Tailwind classes, and `fill` is a presentation attribute, not a style block.
 */
function Swatches({ palette }: { palette: VisualDNA['palette'] }) {
  if (!palette.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {palette.map((c) => (
        <div
          key={`${c.hex}-${c.role}`}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
            <rect x="0" y="0" width="22" height="22" rx="5" fill={c.hex} />
            <rect x="0.5" y="0.5" width="21" height="21" rx="4.5" fill="none" stroke="rgba(255,255,255,0.18)" />
          </svg>
          <div className="leading-tight">
            <p className="font-mono text-[11px] uppercase text-white/75">{c.hex}</p>
            <p className="text-[10px] text-white/40">{c.role}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ClonePreview({ clone }: { clone: CloneResult }) {
  return (
    <div className="space-y-3 rounded-lg border border-success/25 bg-success/[0.04] p-3">
      <SectionLabel>Your ad, built on that design</SectionLabel>
      {clone.imageUrl ? (
        <a href={clone.imageUrl} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={clone.imageUrl}
            alt="Cloned ad creative"
            className="w-full rounded-lg border border-white/10"
          />
        </a>
      ) : (
        <p className="text-[12px] text-white/45">
          No image provider rendered this one — the copy and render prompt below are still ready to
          use.
        </p>
      )}

      <dl className="space-y-1.5">
        {[
          { k: 'Headline', v: clone.copy.headline },
          { k: 'Highlight', v: clone.copy.highlight },
          { k: 'Support', v: clone.copy.support.join(' · ') },
          { k: 'CTA', v: clone.copy.cta },
        ]
          .filter((row) => row.v)
          .map((row) => (
            <div key={row.k} className="grid grid-cols-[74px_1fr] gap-2">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">{row.k}</dt>
              <dd className="text-[13px] text-white/80">{row.v}</dd>
            </div>
          ))}
      </dl>

      {clone.rationale && <p className="text-[11.5px] leading-relaxed text-white/45">{clone.rationale}</p>}

      <Collapsible label="Render prompt">
        <p className="rounded-lg border border-white/10 bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed text-white/55">
          {clone.prompt}
        </p>
      </Collapsible>
    </div>
  )
}

function VisualTeardown({ visual }: { visual: VisualDNA }) {
  const zones = ZONE_ORDER.map((z) => ({
    ...z,
    items: visual.elements.filter((e) => e.zone === z.zone),
  })).filter((z) => z.items.length > 0)

  return (
    <div className="space-y-4">
      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Palette size={11} /> Design read
          </span>
        </SectionLabel>
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[13px] text-white/80">{visual.layout}</p>
          <p className="mt-1 text-[11px] text-white/40">
            {visual.format} · {visual.aspectRatio} · {visual.textDensity}
          </p>
        </div>
      </div>

      <div>
        <SectionLabel>Palette — measured from the ad</SectionLabel>
        <Swatches palette={visual.palette} />
      </div>

      {zones.length > 0 && (
        <div>
          <SectionLabel>Layout map — where everything sits</SectionLabel>
          <div className="overflow-hidden rounded-lg border border-white/10">
            {zones.map((z) => (
              <div key={z.zone} className="border-b border-white/[0.07] last:border-b-0">
                <div className="bg-white/[0.03] px-3 py-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
                    {z.label}
                  </p>
                </div>
                <div className="space-y-2 px-3 py-2.5">
                  {z.items.map((el, i) => (
                    <div key={`${el.element}-${i}`}>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[12px] font-semibold text-glow">{el.element}</span>
                        <span className="text-[11px] text-white/40">{el.position}</span>
                      </div>
                      {el.text && (
                        <p className="mt-0.5 whitespace-pre-line border-l-2 border-primary/40 pl-2 text-[13px] italic text-white/80">
                          “{el.text}”
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-white/45">{el.treatment}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Why it stops the scroll</SectionLabel>
        <p className="rounded-lg border border-success/25 bg-success/[0.05] p-3 text-[13px] text-white/80">
          {visual.scrollStopReason}
        </p>
      </div>

      <Collapsible label="Craft detail">
        <div className="space-y-2">
          <dl className="space-y-2">
            {[
              { k: 'Typography', v: visual.typography },
              { k: 'Imagery', v: visual.imagery },
              { k: 'Eye flow', v: visual.focalFlow },
              { k: 'Contrast', v: visual.contrastDevice },
            ].map((row) => (
              <div key={row.k} className="grid grid-cols-[92px_1fr] gap-2">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">{row.k}</dt>
                <dd className="text-[13px] text-white/75">{row.v}</dd>
              </div>
            ))}
          </dl>
          {visual.designPrinciples.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {visual.designPrinciples.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] text-white/75">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Collapsible>
    </div>
  )
}
