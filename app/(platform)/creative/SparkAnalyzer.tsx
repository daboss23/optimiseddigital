'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  ImageIcon,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { CLONE_STORAGE_KEY, taxonomyToTags, type CreativeTaxonomy } from '@/lib/taxonomy'
import type { CreativeDNA, LayoutZone, VisualDNA } from '@/lib/spark'

/** One dissected ad as returned by /api/spark/analyze. */
interface AnalyzedAd {
  label: string
  dna: CreativeDNA
  visual: VisualDNA | null
  taxonomy?: CreativeTaxonomy
}
import { cn } from '@/lib/utils'

const PLATFORMS = [
  'Meta Ads',
  'Facebook Ad Library',
  'TikTok',
  'YouTube',
  'Uploaded / Other',
] as const

const DNA_ROWS: { key: keyof CreativeDNA; label: string }[] = [
  { key: 'hook', label: 'Hook' },
  { key: 'opening', label: 'Opening' },
  { key: 'storyStructure', label: 'Story Structure' },
  { key: 'ctaStructure', label: 'CTA Structure' },
  { key: 'offerPresentation', label: 'Offer Presentation' },
  { key: 'editingStyle', label: 'Editing Style' },
  { key: 'visualStyle', label: 'Visual Style' },
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
}

/**
 * Downscale a dropped/pasted image to a vision-friendly size before upload.
 * Keeps payloads small (hosts cap request bodies around 4.5MB) without costing
 * legibility — the model reads type and layout fine at 1400px on the long edge.
 * GIFs are passed through untouched so animation frames aren't flattened oddly.
 */
async function toDataUrl(file: File): Promise<string | null> {
  if (!ACCEPTED.includes(file.type)) return null

  const readAsDataUrl = () =>
    new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })

  if (file.type === 'image/gif') return readAsDataUrl()

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return readAsDataUrl()
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    // PNG keeps crisp edges on flat-colour ad graphics; photos ride JPEG.
    return file.type === 'image/png' && w * h < 1_200_000
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.86)
  } catch {
    return readAsDataUrl()
  }
}

export function SparkAnalyzer() {
  const router = useRouter()
  const [platform, setPlatform] = useState<string>(PLATFORMS[0])
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [ads, setAds] = useState<AnalyzedAd[]>([])
  const [active, setActive] = useState(0)
  const [stored, setStored] = useState<boolean | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const current = ads[active] ?? null

  const addFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => ACCEPTED.includes(f.type))
    if (!images.length) return
    setError(null)
    const converted = await Promise.all(images.map(async (f) => ({ file: f, url: await toDataUrl(f) })))
    setUploads((prev) => {
      const next = [...prev]
      for (const { file, url: dataUrl } of converted) {
        if (!dataUrl || next.length >= MAX_IMAGES) continue
        next.push({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`, dataUrl, name: file.name })
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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    void addFiles(Array.from(e.dataTransfer.files))
  }

  const removeUpload = (id: string) => setUploads((prev) => prev.filter((u) => u.id !== id))

  const reset = () => {
    setAds([])
    setActive(0)
    setStored(null)
    setNotes([])
    setError(null)
  }

  const analyze = async () => {
    setBusy(true)
    reset()
    try {
      const res = await fetch('/api/spark/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          url: url.trim() || undefined,
          text: text.trim() || undefined,
          images: uploads.map((u) => u.dataUrl),
        }),
      }).then((r) => r.json())

      setNotes(Array.isArray(res.notes) ? res.notes : [])
      if (res.success && Array.isArray(res.ads) && res.ads.length) {
        setAds(res.ads as AnalyzedAd[])
        setActive(0)
        setStored(Boolean(res.stored))
      } else {
        setError(res.error || 'Analysis failed')
      }
    } catch {
      setError('Analysis failed — try again.')
    } finally {
      setBusy(false)
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
          sourceLabel: `${platform} · ${ads.length > 1 ? `${label} · ` : ''}${dna.patternType}`,
        }),
      )
    } catch {
      /* private mode — the reactor just won't pre-load the reference */
    }
    router.push('/campaign-reactor')
  }

  const selectClass =
    'w-full rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/60'
  const canAnalyze = uploads.length > 0 || text.trim().length > 0 || url.trim().length > 0

  return (
    <Panel>
      <PanelHeader
        icon={<Sparkles size={16} />}
        accent="amber"
        title="SPARK · Winning Creative Intelligence"
        subtitle="Drop in winning ads — SPARK reads each one's design and words, then stores both as retrievable patterns."
        accessory={
          ads.length > 1 ? (
            <Pill tone="primary">{ads.length} ads read</Pill>
          ) : current ? (
            <Pill tone="primary">{current.dna.patternType}</Pill>
          ) : undefined
        }
      />

      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {/* ------------------------------ Input side ------------------------------ */}
        <div className="space-y-3">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'rounded-xl border-2 border-dashed p-5 text-center transition-colors',
              dragging ? 'border-primary/70 bg-primary/[0.07]' : 'border-white/12 bg-surface/30',
            )}
          >
            <ImageIcon size={22} className={cn('mx-auto mb-2', dragging ? 'text-glow' : 'text-white/25')} />
            <p className="text-sm font-medium text-white/80">Drag ads in, or paste a screenshot</p>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-white/35">
              JPEG, PNG, WebP or GIF · up to {MAX_IMAGES} images. SPARK reads the colours, the layout,
              where the headline and hook sit, and what they say. Drop a whole swipe board and every ad
              on it is separated and dissected on its own — sharpest results come from bigger, clearer
              screenshots.
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

          {uploads.length > 0 && (
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
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
              Platform
            </p>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectClass}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p} className="bg-card">
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
              Creative URL (optional)
            </p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Image link, YouTube URL, or a page containing the ad"
              className={selectClass}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-white/35">
              Direct image links are read straight away. YouTube auto-transcribes. Boards and ad-library
              pages that render with JavaScript can&apos;t be fetched — screenshot those and drop them in.
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
              Script / Transcript / Notes
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Optional with an image — add the body copy or what made it win to sharpen the read."
              className="h-[110px] w-full resize-none rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/60"
            />
          </div>

          <button
            type="button"
            onClick={analyze}
            disabled={busy || !canAnalyze}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-glow transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {busy ? 'SPARK analyzing…' : uploads.length ? 'Analyze Ad Design' : 'Extract Creative DNA'}
          </button>

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

        {/* ------------------------------ Result side ----------------------------- */}
        <div className="rounded-xl border border-border bg-surface/30 p-4">
          {!current && !busy && (
            <div className="grid h-full min-h-[220px] place-items-center text-center">
              <p className="max-w-xs text-sm text-white/35">
                The teardown appears here — palette, layout map, where each element sits and what it
                says, plus the pattern, hook, story, CTA and offer structure. Drop a board screenshot
                and every ad on it is dissected separately.
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
              {ads.length > 1 && (
                <div>
                  <SectionLabel>
                    {ads.length} ads found — each dissected separately
                  </SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {ads.map((ad, i) => (
                      <button
                        key={`${ad.label}-${i}`}
                        type="button"
                        onClick={() => setActive(i)}
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
                <Pill>{current.dna.creativeCategory}</Pill>
                {current.visual && <Pill tone="success">Design read</Pill>}
                {stored ? (
                  <Pill tone="success">
                    {ads.length > 1 ? `${ads.length} patterns stored` : 'Stored as pattern'}
                  </Pill>
                ) : (
                  <Pill tone="warning">Not stored — configure Supabase + Voyage</Pill>
                )}
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

              <div>
                <SectionLabel>Written DNA</SectionLabel>
                <dl className="space-y-2">
                  {DNA_ROWS.map((row) => (
                    <div key={row.key} className="grid grid-cols-[110px_1fr] gap-2">
                      <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                        {row.label}
                      </dt>
                      <dd className="text-[13px] text-white/75">{current.dna[row.key]}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <button
                type="button"
                onClick={sendToReactor}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Build a campaign from this ad <ArrowRight size={15} />
              </button>
              <p className="text-center text-[11px] leading-relaxed text-white/35">
                Sends {ads.length > 1 ? `“${current.label}”` : 'the'} structure
                {current.visual ? ' and design' : ''} to the Campaign Reactor as proven direction.
                {ads.length > 1 ? ' All ' + ads.length + ' are already stored as patterns.' : ''} OPUS
                writes fresh TPB copy and can adapt the design where the angle calls for it.
              </p>
            </div>
          )}
        </div>
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

/**
 * Colour swatches. Rendered as SVG `fill` attributes rather than inline styles —
 * the palette is data from the model, so it can't be expressed as static
 * Tailwind classes, and `fill` is a presentation attribute, not a style block.
 */
function Swatches({ palette }: { palette: VisualDNA['palette'] }) {
  if (!palette.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {palette.map((c) => (
        <div key={`${c.hex}-${c.role}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5">
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
        <SectionLabel>Palette</SectionLabel>
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
                        <p className="mt-0.5 border-l-2 border-primary/40 pl-2 text-[13px] italic text-white/80">
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

      <dl className="space-y-2">
        {[
          { k: 'Typography', v: visual.typography },
          { k: 'Imagery', v: visual.imagery },
          { k: 'Eye flow', v: visual.focalFlow },
          { k: 'Contrast', v: visual.contrastDevice },
        ].map((row) => (
          <div key={row.k} className="grid grid-cols-[110px_1fr] gap-2">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">{row.k}</dt>
            <dd className="text-[13px] text-white/75">{row.v}</dd>
          </div>
        ))}
      </dl>

      {visual.designPrinciples.length > 0 && (
        <div>
          <SectionLabel>Design principles to reuse</SectionLabel>
          <ul className="space-y-1.5">
            {visual.designPrinciples.map((p) => (
              <li key={p} className="flex gap-2 text-[13px] text-white/75">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
