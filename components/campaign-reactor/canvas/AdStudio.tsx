'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Atom,
  Check,
  Copy as CopyIcon,
  Film,
  Globe,
  ImageIcon,
  Loader2,
  MessageCircle,
  Monitor,
  Rocket,
  Share2,
  Smartphone,
  Sparkles,
  ThumbsUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { accentClass, Pill } from '@/components/reactor/ui'
import { NEURO_AXES, NEURO_PASS_MARK, type NeuroScore } from '@/lib/reactor-inputs'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'
import {
  blocksInCategory,
  buildBlocks,
  CATEGORY_DEFS,
  type BlockCategory,
  type CanvasBlock,
} from '@/lib/campaign-reactor/canvas'
import {
  DESCRIPTION_MAX,
  HEADLINE_MAX,
  META_CTA_LABELS,
  META_CTA_OPTIONS,
  PRIMARY_TEXT_FOLD,
  formatForAdsManager,
  validateAdPackage,
  type MetaAdPackage,
  type MetaCta,
} from '@/lib/meta-ads'

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which surface the preview is imitating. The same ad is a different ad on the
 * two: the feed column is narrower on a phone, and the "See more" fold cuts the
 * body far earlier — the whole reason the hook has to land inside 125 chars.
 */
export type Device = 'mobile' | 'desktop'

/**
 * Where the desktop feed truncates the primary text. Meta shows substantially
 * more before "See more" on a wide column than on a phone; the mobile figure is
 * PRIMARY_TEXT_FOLD, which is the one the copy is written against.
 */
const DESKTOP_TEXT_FOLD = 500

/** Feed column width per device, matching Meta's real rendering widths. */
const DEVICE_WIDTH: Record<Device, string> = {
  mobile: 'max-w-[380px]',
  desktop: 'max-w-[500px]',
}

/** Split a Meta primary text into its hook (first line/sentence) + body. */
function splitPrimary(primary: string): { hook: string; body: string } {
  const t = (primary ?? '').trim()
  if (!t) return { hook: '', body: '' }
  const nl = t.indexOf('\n')
  if (nl !== -1) return { hook: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() }
  const m = t.match(/^.*?[.!?](\s|$)/)
  if (m && m[0].length < t.length) return { hook: m[0].trim(), body: t.slice(m[0].length).trim() }
  return { hook: t, body: '' }
}

/**
 * Concepts that can supply the ad's creative (a still or a clip).
 *
 * Type is only the first test. A concept that is CARRYING a render — because it
 * was reopened from the ledger, or because the run already rendered it — is a
 * creative source whatever it happens to be called. Judging on the type string
 * alone is how a creative the user just clicked ends up not being the one the
 * Studio opens with.
 */
const isVisualType = (c: Concept) => c.type.includes('Concept')
const carriesMedia = (c: Concept) => Boolean(c.imageUrl || c.videoUrl)
const isVisual = (c: Concept) => isVisualType(c) || carriesMedia(c)

/** The best-scoring concept carrying a complete ad package — the auto seed. */
function bestPackaged(concepts: Concept[]): Concept | undefined {
  return concepts
    .filter((c) => c.adPackage)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
}

/* -------------------------------------------------------------------------- */
/*  Editable field chrome — label + live character count                       */
/* -------------------------------------------------------------------------- */

function FieldLabel({
  label,
  count,
  max,
  hint,
}: {
  label: string
  count?: number
  max?: number
  hint?: string
}) {
  const over = typeof count === 'number' && typeof max === 'number' && count > max
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-white/60">{label}</span>
      <span className="flex items-center gap-2">
        {hint && <span className="text-[10px] text-white/30">{hint}</span>}
        {typeof count === 'number' && typeof max === 'number' && (
          <span className={cn('text-[10px] tabular', over ? 'font-semibold text-warning' : 'text-white/35')}>
            {count}/{max}
          </span>
        )}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  NEURO pre-test readout — predicted response for the configured ad          */
/* -------------------------------------------------------------------------- */

function PretestBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 8 ? 'bg-success' : value >= NEURO_PASS_MARK ? 'bg-glow' : 'bg-warning'
  return (
    <div className="flex items-center gap-2">
      <span className="w-[5rem] shrink-0 text-[10px] uppercase tracking-wide text-white/45">{label}</span>
      <div className="flex flex-1 gap-0.5" aria-hidden>
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < value ? tone : 'bg-white/10'}`} />
        ))}
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] font-medium text-white/70">{value}</span>
    </div>
  )
}

function PretestPanel({ neuro, demo }: { neuro: NeuroScore; demo?: boolean }) {
  return (
    <div className="rounded-xl border border-glow/15 bg-glow/[0.04] p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-glow/80">
          <Activity size={11} /> Predicted Response{demo ? ' (demo)' : ''}
        </span>
        <Pill tone={neuro.overall >= 8 ? 'success' : neuro.overall >= NEURO_PASS_MARK ? 'primary' : 'warning'}>
          {neuro.overall}/10
        </Pill>
      </div>
      <div className="space-y-1">
        {NEURO_AXES.map(({ key, label }) => (
          <PretestBar key={key} label={label} value={neuro[key]} />
        ))}
      </div>
      {neuro.reason && <p className="mt-2 text-[11px] text-white/55">{neuro.reason}</p>}
      <p className="mt-1 text-[10px] italic text-white/30">
        Estimate from neuromarketing principles — a prediction, not measured brain data.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  OPUS recommendation chips — the run's winning parts, one lane per field    */
/* -------------------------------------------------------------------------- */

function SuggestionLane({
  category,
  blocks,
  onApply,
}: {
  category: BlockCategory
  blocks: CanvasBlock[]
  onApply: (text: string) => void
}) {
  const def = CATEGORY_DEFS[category]
  const options = blocksInCategory(blocks, category).slice(0, 4)
  if (!options.length) return null
  return (
    <div className={cn('space-y-1.5', accentClass[def.accent])}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--acc))]" />
        <span className="acc-text-hi text-[10px] font-bold uppercase tracking-wider">{def.label}</span>
        <span className="text-[10px] text-white/30">— tap to use</span>
      </span>
      <div className="grid gap-1.5">
        {options.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onApply(b.text)}
            className="flex w-full items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2 text-left transition-colors hover:border-[rgb(var(--acc)/0.45)] hover:bg-[rgb(var(--acc)/0.07)]"
          >
            <span className="min-w-0 flex-1">
              <span className="block line-clamp-2 text-[11px] leading-snug text-white/75">{b.text}</span>
              {b.basis && (
                <span className="mt-0.5 block line-clamp-1 text-[9px] text-white/30">
                  <span className="acc-text">Grounded in</span> · {b.basis}
                </span>
              )}
            </span>
            {typeof b.score === 'number' && (
              <span className="shrink-0 rounded-full border border-white/10 px-1.5 text-[9px] font-medium text-white/45">
                {b.score}/10
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  The live Facebook feed preview — a real, light-mode Meta ad card           */
/* -------------------------------------------------------------------------- */

function FacebookAdPreview({
  primaryText,
  headline,
  description,
  ctaText,
  imageUrl,
  videoUrl,
  rendering,
  device,
}: {
  primaryText: string
  headline: string
  description: string
  ctaText: string
  imageUrl?: string
  videoUrl?: string
  rendering: boolean
  device: Device
}) {
  // The fold is REAL here, not annotated. Everything past it is hidden until
  // "See more" is clicked, because that is the decision the scroller actually
  // makes — showing the rest greyed out let a hook that dies at char 130 still
  // look fine in the preview. Desktop truncates far later than mobile.
  const fold = device === 'mobile' ? PRIMARY_TEXT_FOLD : DESKTOP_TEXT_FOLD
  const [expanded, setExpanded] = useState(false)
  // Switching device changes where the cut falls — re-collapse so the new
  // fold is what you see.
  useEffect(() => setExpanded(false), [device, primaryText])

  const above = primaryText.slice(0, fold)
  const below = primaryText.slice(fold)

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white shadow-[0_18px_44px_-22px_rgba(0,0,0,0.9)]">
      {/* Page header */}
      <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-cyan text-[11px] font-bold text-white">
          TPB
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold leading-tight text-[#050505]">
            The Professional Builder
          </span>
          <span className="flex items-center gap-1 text-[12px] leading-tight text-[#65676B]">
            Sponsored · <Globe size={11} />
          </span>
        </span>
      </div>

      {/* Primary text, cut at the fold exactly as Meta cuts it */}
      <p className="whitespace-pre-line px-3.5 pb-2.5 text-[14px] leading-snug text-[#050505]">
        {expanded ? primaryText : above}
        {below && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title={`Meta shows the first ${fold} characters on ${device} before the "See more" fold`}
            className="ml-1 align-baseline text-[14px] font-semibold text-[#65676B] hover:underline"
          >
            … See more
          </button>
        )}
      </p>

      {/* Creative */}
      {videoUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={videoUrl} controls playsInline className="max-h-[420px] w-full bg-black object-contain" />
      ) : imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Ad creative" className="w-full object-cover" />
      ) : (
        <div className="grid aspect-square w-full place-items-center bg-[#F0F2F5]">
          {rendering ? (
            <span className="flex items-center gap-2 text-[13px] text-[#65676B]">
              <Loader2 size={16} className="animate-spin" /> Rendering creative…
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2 text-[#8A8D91]">
              <ImageIcon size={26} />
              <span className="text-[12px]">Pick a creative from the run below</span>
            </span>
          )}
        </div>
      )}

      {/* Link footer — domain, headline, description + CTA button */}
      <div className="flex items-center justify-between gap-3 bg-[#F0F2F5] px-3.5 py-2.5">
        <span className="min-w-0">
          <span className="block truncate text-[11px] uppercase tracking-wide text-[#65676B]">
            theprobuilder.com
          </span>
          <span className="block truncate text-[15px] font-semibold leading-snug text-[#050505]">
            {headline || 'Your headline'}
          </span>
          {description && (
            <span className="block truncate text-[12px] text-[#65676B]">{description}</span>
          )}
        </span>
        <span className="shrink-0 rounded-md bg-[#E4E6EB] px-3.5 py-2 text-[13px] font-semibold text-[#050505]">
          {ctaText}
        </span>
      </div>

      {/* Social row — sells the in-feed realism */}
      <div className="flex items-center justify-around border-t border-[#E4E6EB] px-3.5 py-1.5">
        {[
          { Icon: ThumbsUp, label: 'Like' },
          { Icon: MessageCircle, label: 'Comment' },
          { Icon: Share2, label: 'Share' },
        ].map(({ Icon, label }) => (
          <span key={label} className="flex items-center gap-1.5 py-1 text-[12px] font-medium text-[#65676B]">
            <Icon size={14} /> {label}
          </span>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  The Studio — edit the ad on the left, watch the real Meta unit update      */
/* -------------------------------------------------------------------------- */

export function AdStudio({
  offerName,
  seed,
  onConfigure,
}: {
  offerName?: string
  seed?: Concept | null
  onConfigure: () => void
}) {
  const { concepts, generateCreative, imageFor, videoFor, creativeStateFor } = useReactorRun()

  // The creative the user arrived from belongs to the Studio even when the run
  // that made it is gone (reopened from the ledger after a refresh, where
  // `concepts` is empty). Seed first, then the run — deduped by text, so the
  // clicked ad is always the first tile on the rail and never a duplicate.
  const sourceConcepts = useMemo(() => {
    const all = seed ? [seed, ...concepts] : concepts
    const seen = new Set<string>()
    return all.filter((c) => (seen.has(c.text) ? false : (seen.add(c.text), true)))
  }, [seed, concepts])

  const blocks = useMemo(() => buildBlocks(sourceConcepts, offerName), [sourceConcepts, offerName])
  const visualConcepts = useMemo(() => sourceConcepts.filter(isVisual), [sourceConcepts])

  /* ------------------------------ Ad fields -------------------------------- */
  const [hook, setHook] = useState('')
  const [body, setBody] = useState('')
  const [headline, setHeadline] = useState('')
  const [description, setDescription] = useState('')
  const [cta, setCta] = useState<MetaCta>('LEARN_MORE')
  // The concept whose render is the ad's creative — media resolves live, so a
  // still-rendering creative pops in the moment it finishes.
  const [creativeConcept, setCreativeConcept] = useState<Concept | null>(null)
  const [copied, setCopied] = useState(false)
  // Which surface the preview imitates. Mobile first: it is where the fold is
  // tightest and where most of the spend lands.
  const [device, setDevice] = useState<Device>('mobile')

  // Seed the editor from the concept sent via "Configure in Studio" (or the
  // best-scoring packaged concept when arriving without one). Re-seeds only
  // when the source changes so in-progress edits are never clobbered.
  const seedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const source = seed ?? bestPackaged(sourceConcepts)
    if (!source) return
    const key = `${seed ? 'seed' : 'auto'}:${source.text}`
    if (seedKeyRef.current === key) return
    seedKeyRef.current = key

    const pkg = source.adPackage
    if (pkg) {
      const { hook: h, body: b } = splitPrimary(pkg.primaryText)
      setHook(h)
      setBody(b)
      setHeadline(pkg.headline ?? '')
      setDescription(pkg.description ?? '')
      const c = (pkg.cta ?? '').toUpperCase() as MetaCta
      setCta(META_CTA_OPTIONS.includes(c) ? c : 'LEARN_MORE')
    }
    // The creative you arrived from is the creative you edit. When the source
    // is a visual concept, that render IS the ad — no picking required. Falling
    // back, prefer a concept whose creative has actually landed over the first
    // visual one: an unrendered pick shows "Pick a creative from the run below"
    // on a Studio that had a finished ad available all along.
    // The creative you clicked is the creative you edit. A source that is
    // visual — by type OR because it is carrying a render — is selected
    // directly, so the still on the card you opened is the still in the ad.
    // Only a copy-only source (a bare Hook) falls back to a sibling render.
    setCreativeConcept(
      isVisual(source)
        ? source
        : (visualConcepts.find((c) => imageFor(c) || videoFor(c)) ?? visualConcepts[0] ?? null),
    )
    // visualConcepts derives from sourceConcepts — the inputs below cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, concepts])

  // The seed arrives before its render finishes on a fresh run, so a Studio
  // opened early would sit empty even though a sibling concept had a finished
  // creative. Once any render lands, adopt it — but never overwrite a creative
  // the user is already looking at or picked by hand.
  useEffect(() => {
    if (creativeConcept) return
    const ready = visualConcepts.find((c) => imageFor(c) || videoFor(c))
    if (ready) setCreativeConcept(ready)
  }, [creativeConcept, visualConcepts, imageFor, videoFor])

  /* ------------------------- Live creative resolution ---------------------- */
  const video = creativeConcept ? videoFor(creativeConcept) : undefined
  const image = creativeConcept ? imageFor(creativeConcept) : undefined
  const creativeState = creativeConcept ? creativeStateFor(creativeConcept) : undefined
  const rendering = creativeState?.status === 'working' || video?.status === 'rendering'
  const videoUrl = video?.status === 'done' ? video.url : undefined

  const onGenerate = useCallback(() => {
    if (creativeConcept) generateCreative(creativeConcept, {})
  }, [creativeConcept, generateCreative])

  /* ------------------------------ The ad unit ------------------------------ */
  const primaryText = [hook.trim(), body.trim()].filter(Boolean).join('\n\n')
  const pkg: MetaAdPackage = {
    primaryText,
    headline: headline.trim(),
    description: description.trim() || undefined,
    cta,
  }
  const issues = validateAdPackage(pkg)
  const hasErrors = issues.some((i) => i.severity === 'error')

  /* --------------- Pre-test (NEURO) + Push Creative to Meta ---------------- */
  const [pretest, setPretest] = useState<{
    status: 'idle' | 'testing' | 'done'
    neuro?: NeuroScore
    demo?: boolean
  }>({ status: 'idle' })
  const [push, setPush] = useState<{
    status: 'idle' | 'pushing' | 'done' | 'error'
    message?: string
  }>({ status: 'idle' })

  // The ad changed — the old pre-test and push result no longer describe it.
  useEffect(() => {
    setPretest((p) => (p.status === 'done' ? { status: 'idle' } : p))
    setPush((p) => (p.status === 'idle' || p.status === 'pushing' ? p : { status: 'idle' }))
  }, [primaryText, headline, description, cta])

  const runPretest = useCallback(async () => {
    setPretest({ status: 'testing' })
    try {
      const res = await fetch('/api/studio/pretest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pkg: { primaryText, headline: headline.trim(), description: description.trim() || undefined, cta },
          conceptType: creativeConcept?.type ?? 'Studio Ad',
        }),
      }).then((r) => r.json())
      if (res.ok && res.neuro) setPretest({ status: 'done', neuro: res.neuro as NeuroScore, demo: res.demo })
      else setPretest({ status: 'idle' })
    } catch {
      setPretest({ status: 'idle' })
    }
  }, [primaryText, headline, description, cta, creativeConcept])

  const pushToMeta = useCallback(async () => {
    setPush({ status: 'pushing' })
    try {
      const res = await fetch('/api/meta/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pkg: { primaryText, headline: headline.trim(), description: description.trim() || undefined, cta },
          imageUrl: image,
          videoUrl,
          name: creativeConcept?.type,
        }),
      }).then((r) => r.json())
      if (res.ok) {
        setPush({
          status: 'done',
          message: `Creative ${res.creativeId ? `#${res.creativeId} ` : ''}is in your Meta creative library — attach it to an ad set in Ads Manager.`,
        })
      } else {
        setPush({ status: 'error', message: res.error || 'Meta rejected the creative.' })
      }
    } catch {
      setPush({ status: 'error', message: 'Could not reach Meta — try again.' })
    }
  }, [primaryText, headline, description, cta, image, videoUrl, creativeConcept])

  const copyForAdsManager = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        formatForAdsManager(creativeConcept?.type ?? 'Studio Ad', pkg),
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable — leave the button as-is */
    }
    // pkg is rebuilt each render from the fields below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeConcept, hook, body, headline, description, cta])

  /* --------------------------------- Empty --------------------------------- */
  // Empty means nothing to edit — not merely "this session has no run". A
  // creative reopened from the ledger arrives with no run behind it and must
  // still open.
  if (sourceConcepts.length === 0) {
    return (
      <div className="reactor-panel glass grid min-h-[460px] place-items-center p-8 text-center">
        <div className="max-w-sm">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
            <Sparkles size={26} className="text-glow/60" />
          </span>
          <h3 className="font-display text-base font-semibold text-white">The Studio is empty</h3>
          <p className="mx-auto mt-1.5 text-sm text-white/45">
            Fire the reactor first — it drafts the ad and renders the creative automatically. Then
            hit “Configure in Studio” on the one you like to edit it here as a real Meta ad.
          </p>
          <button
            type="button"
            onClick={onConfigure}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-glow/30 bg-glow/10 px-5 py-2.5 text-sm font-semibold text-glow transition-colors hover:bg-glow/20"
          >
            <Atom size={14} /> Open the campaign brief
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="reactor-panel glass overflow-hidden p-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-glow/70">Ad Studio</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
              issues.some((i) => i.severity === 'error')
                ? 'border-warning/30 bg-warning/[0.08] text-warning'
                : 'border-success/30 bg-success/10 text-success',
            )}
          >
            {issues.some((i) => i.severity === 'error') ? (
              <AlertTriangle size={11} />
            ) : (
              <Check size={11} />
            )}
            {issues.some((i) => i.severity === 'error') ? 'Needs attention' : 'Launch-ready'}
          </span>
        </div>
        <button
          type="button"
          onClick={copyForAdsManager}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-glow/30 bg-glow/10 px-3 py-1.5 text-[11px] font-semibold text-glow transition-colors hover:bg-glow/20"
        >
          {copied ? <Check size={12} /> : <CopyIcon size={12} />}
          {copied ? 'Copied' : 'Copy for Ads Manager'}
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* ------------------------------ Editor ------------------------------ */}
        <section className="order-last space-y-4 border-b border-border p-5 lg:order-first lg:border-b-0 lg:border-r">
          <div>
            <FieldLabel
              label="Hook — first line"
              count={hook.length}
              max={PRIMARY_TEXT_FOLD}
              hint="Lands before the “See more” fold"
            />
            <textarea
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              rows={2}
              placeholder="The scroll-stopper — one contrarian, specific line."
              className="w-full resize-none rounded-xl border border-white/12 bg-black/40 px-3.5 py-2.5 text-[14px] leading-snug text-white placeholder:text-white/25 outline-none transition-colors focus:border-glow/40"
            />
          </div>

          <div>
            <FieldLabel label="Primary text — the argument" />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Proof, mechanism, and the ask — the body of the ad."
              className="w-full resize-none rounded-xl border border-white/12 bg-black/40 px-3.5 py-2.5 text-[14px] leading-snug text-white placeholder:text-white/25 outline-none transition-colors focus:border-glow/40"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel label="Headline" count={headline.length} max={HEADLINE_MAX} />
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Under the creative, next to the button"
                className="w-full rounded-xl border border-white/12 bg-black/40 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-glow/40"
              />
            </div>
            <div>
              <FieldLabel label="Description" count={description.length} max={DESCRIPTION_MAX} />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional proof line"
                className="w-full rounded-xl border border-white/12 bg-black/40 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-glow/40"
              />
            </div>
          </div>

          <div>
            <FieldLabel label="CTA button" hint="Meta button types" />
            <div className="flex flex-wrap gap-1.5">
              {META_CTA_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCta(option)}
                  aria-pressed={cta === option}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                    cta === option
                      ? 'border-glow/50 bg-glow/15 text-glow'
                      : 'border-white/12 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white/80',
                  )}
                >
                  {META_CTA_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          {/* Creative rail — swap in any render from this run */}
          {visualConcepts.length > 0 && (
            <div>
              <FieldLabel label="Creative" hint="Renders from this run" />
              <div className="flex flex-wrap gap-2">
                {visualConcepts.map((c, i) => {
                  const img = imageFor(c)
                  const vid = videoFor(c)
                  const active = creativeConcept?.text === c.text
                  return (
                    <button
                      key={`${c.type}-${i}`}
                      type="button"
                      onClick={() => setCreativeConcept(c)}
                      title={c.type}
                      aria-pressed={active}
                      className={cn(
                        'relative h-16 w-16 overflow-hidden rounded-lg border transition-all',
                        active
                          ? 'border-glow/60 shadow-[0_0_0_2px_rgba(94,168,255,0.35)]'
                          : 'border-white/12 hover:border-white/30',
                      )}
                    >
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={c.type} className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-white/[0.03] text-white/35">
                          {/video|testimonial/i.test(c.type) ? <Film size={16} /> : <ImageIcon size={16} />}
                        </span>
                      )}
                      {vid?.status === 'done' && (
                        <span className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded bg-black/70 text-white">
                          <Film size={9} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {creativeConcept && !image && !videoUrl && !rendering && (
                <button
                  type="button"
                  onClick={onGenerate}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-glow/30 bg-glow/10 px-3 py-1.5 text-[11px] font-semibold text-glow transition-colors hover:bg-glow/20"
                >
                  <ImageIcon size={12} /> Generate this creative
                </button>
              )}
            </div>
          )}

          {/* Compliance readout — same validator as the launch gate */}
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-warning/20 bg-warning/[0.04] p-3">
              {issues.map((issue, ii) => (
                <li
                  key={ii}
                  className={cn(
                    'flex items-start gap-1.5 text-[11px]',
                    issue.severity === 'error' ? 'text-danger' : 'text-warning',
                  )}
                >
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          {/* OPUS recommendations — winning parts from the run, one tap to use */}
          <div className="space-y-3 border-t border-white/[0.07] pt-4">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/60">
              <Sparkles size={12} className="text-glow" /> OPUS recommendations
            </span>
            <SuggestionLane category="hook" blocks={blocks} onApply={setHook} />
            <SuggestionLane category="headline" blocks={blocks} onApply={setHeadline} />
            <SuggestionLane category="body" blocks={blocks} onApply={setBody} />
          </div>
        </section>

        {/* ----------------------------- Preview ------------------------------ */}
        <section className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12px] text-white/45">
              <Atom size={13} className="text-glow" />
              Live preview — exactly how the ad reads in the Meta feed.
            </p>
            {/* The fold lands in a different place on each surface, so the
                device is part of the preview, not a cosmetic choice. */}
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
              {([
                { id: 'mobile' as const, label: 'Mobile', icon: Smartphone },
                { id: 'desktop' as const, label: 'Desktop', icon: Monitor },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDevice(id)}
                  aria-pressed={device === id}
                  className={cn(
                    'inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-colors',
                    device === id
                      ? 'bg-primary/15 text-glow'
                      : 'text-white/45 hover:text-white/80',
                  )}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className={cn('mx-auto space-y-3 transition-[max-width]', DEVICE_WIDTH[device])}>
            <FacebookAdPreview
              primaryText={primaryText}
              headline={headline.trim()}
              description={description.trim()}
              ctaText={META_CTA_LABELS[cta]}
              imageUrl={image}
              videoUrl={videoUrl}
              rendering={Boolean(rendering)}
              device={device}
            />

            {/* Pre-test before spend, then push the finished creative to Meta */}
            {pretest.status === 'done' && pretest.neuro && (
              <PretestPanel neuro={pretest.neuro} demo={pretest.demo} />
            )}
            <div className="grid gap-2">
              <button
                type="button"
                onClick={runPretest}
                disabled={pretest.status === 'testing' || !primaryText.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-glow/30 bg-glow/10 px-4 py-2.5 text-[12px] font-semibold text-glow transition-colors hover:bg-glow/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pretest.status === 'testing' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Activity size={13} />
                )}
                {pretest.status === 'testing'
                  ? 'Pre-testing against neuromarketing principles…'
                  : pretest.status === 'done'
                    ? 'Re-run pre-test'
                    : 'Pre-test this ad — predicted response before spend'}
              </button>
              <button
                type="button"
                onClick={pushToMeta}
                disabled={push.status === 'pushing' || hasErrors || !primaryText.trim() || !headline.trim()}
                title={hasErrors ? 'Fix the compliance issues first' : undefined}
                className="fire-btn fire-btn--md inline-flex w-full items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.14em] text-white"
              >
                {push.status === 'pushing' ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Pushing to Meta…
                  </>
                ) : (
                  <>
                    <Rocket size={15} /> Push Creative to Meta
                  </>
                )}
              </button>
              {push.status === 'done' && (
                <p className="flex items-start gap-1.5 rounded-xl border border-success/25 bg-success/[0.06] p-2.5 text-[11px] text-success">
                  <Check size={12} className="mt-0.5 shrink-0" /> {push.message}
                </p>
              )}
              {push.status === 'error' && (
                <p className="flex items-start gap-1.5 rounded-xl border border-warning/25 bg-warning/[0.06] p-2.5 text-[11px] text-warning">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {push.message}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
