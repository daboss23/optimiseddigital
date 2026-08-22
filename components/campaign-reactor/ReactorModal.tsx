'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  ArrowRight,
  Atom,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Clapperboard,
  Film,
  GalleryHorizontalEnd,
  ImageIcon,
  Loader2,
  Megaphone,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tag,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { FaceLibrary } from '@/components/reactor/FaceLibrary'
import { type AngleEvidence, type CreativeSize } from '@/lib/reactor-inputs'
import {
  OPENMONTAGE_BADGE,
  isMontageDeliverable,
  montageMotionKey,
  montageStillKey,
  sizesForModel,
  resolveModelPick,
  type ModelMenu,
} from '@/lib/model-menu'
import type { IsolateConfig } from '@/lib/taxonomy'
import {
  DEFAULT_VARIATION_COUNT,
  DEFAULT_VARIATION_METHOD,
  VARIATION_COUNTS,
  VARIATION_METHODS,
  VARIATION_METHOD_LABEL,
  variationSummary,
  type VariationMethod,
} from '@/lib/variations'

// The launch sequence — six bold steps, each a moment, not a form field. `orb`
// is the short label under the stepper node; `label` titles the step.
const STEPS = [
  { orb: 'Brief', label: 'The Brief', sub: 'Name it, set the offer and direction, and pick what to build.' },
  { orb: 'Formats', label: 'Formats & Sizes', sub: 'Choose the render model and dimensions for each creative.' },
  { orb: 'Audience', label: 'Audience & Market', sub: 'Who you are speaking to — and how sophisticated the market is.' },
  { orb: 'Feed', label: 'Performance Feed', sub: 'Plug live Meta ad performance into this run.' },
  { orb: 'Brand', label: 'On Brand', sub: 'Apply your brand voice, tone, and compliance.' },
  { orb: 'Ignition', label: 'Ignition', sub: 'Review the configuration and fire the reactor.' },
] as const

const LAST_STEP = STEPS.length

/**
 * A strategic input field. The platform recommends, the recommendation is
 * visible and pre-selected, and the user can accept, override, choose No
 * Preference, or (where allowed) create a custom value — all from one control.
 */
export interface StrategicField {
  options: string[]
  /** Optional one-line explanations rendered under each option (label → text). */
  descriptions?: Record<string, string>
  /** The currently selected native option, or '' when custom / no-preference. */
  value: string
  recommended: string | null
  /** Strategic reasoning behind the recommendation (angle field). */
  recommendation?: {
    reason?: string
    confidence?: number
    evidence?: AngleEvidence | null
  }
  noPreference: boolean
  thinking: boolean
  custom: {
    allowed: boolean
    active: boolean
    value: string
    placeholder: string
    examples: string[]
  }
  onSelect: (label: string) => void
  onCustom: () => void
  onCustomChange: (v: string) => void
  onNoPreference: () => void
}

// Everything the modal needs to render the full input set lives in Workbench
// state and is threaded through here so the manual controls keep their existing
// recommendation wiring.
export interface ReactorForm {
  // Step 1 — campaign name, brief, deliverables
  campaignName: string
  setCampaignName: (v: string) => void
  brief: string
  setBrief: (v: string) => void
  // Angle is inferred by the agents — kept for the Quick Launch read + payload,
  // no longer an editable field in the guided flow.
  angleField: StrategicField
  // Creative Deliverables — Static / Video / UGC / Carousel. OPUS recommends
  // from the brief; the user picks one or all.
  outputTypeList: string[]
  outputs: string[]
  toggleOutput: (v: string) => void
  recommendedDeliverables: string[]
  deliverablesReason: string
  // Step 2 — formats & sizes: selected aspect ratios per deliverable, plus that
  // deliverable's own variation count and lever. Every format configures
  // independently — changing Video's count never touches Static's.
  dimensions: Record<string, string[]>
  toggleDimension: (deliverable: string, ratio: string) => void
  variationCounts: Record<string, number>
  setVariationCount: (deliverable: string, n: number) => void
  variationMethods: Record<string, VariationMethod>
  setVariationMethod: (deliverable: string, method: VariationMethod) => void
  // Render model per deliverable — the system recommends, the user can override.
  // Menus are keyed by deliverable; a null menu means the reactor decides fully.
  modelMenus: Record<string, ModelMenu | null>
  // Montage's two real model picks (still + motion) — set only when a montage
  // deliverable is selected. OpenMontage itself is never a pick.
  montageMenus: { still: ModelMenu; motion: ModelMenu } | null
  models: Record<string, string>
  setModel: (deliverable: string, modelId: string) => void
  // Reference images/videos for consistent-character UGC (shown when UGC is picked).
  onFaceChange: (images: string[], videos: string[]) => void
  refCount: number
  // Step 3 — awareness, sophistication, audience
  awarenessField: StrategicField
  sophisticationField: StrategicField
  audienceField: StrategicField
  offerField: StrategicField
  offerName: string
  setOfferName: (v: string) => void
  // Step 4 — Meta Ads performance feed: 'off' (standalone), 'pipeboard', 'meta'.
  metaProvider: string
  setMetaProvider: (v: string) => void
  // Step 5 — on brand
  onBrand: boolean
  setOnBrand: (v: boolean) => void
  // Whether the system is currently analyzing the brief.
  suggesting: boolean
  // Quick Launch — extract offer/audience/positioning from a website into the
  // brief. Resolves with the domain on success, or an error message.
  extractSite: (url: string) => Promise<{ ok: boolean; domain?: string; error?: string }>
  // Step 6 — optional isolation test ("iterate one thing"). null = free generation.
  isolate: IsolateConfig | null
  setIsolate: (v: IsolateConfig | null) => void
  // Set when the run was launched from the Ad Library with a clone reference.
  cloneLabel: string | null
}

interface ReactorModalProps {
  open: boolean
  onClose: () => void
  onFire: () => void
  form: ReactorForm
}

// Section label — brighter and larger than the old dull micro-caps.
function SectionLabel({
  children,
  thinking,
}: {
  children: React.ReactNode
  thinking?: boolean
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <p className="sec-label">{children}</p>
      {thinking ? (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#38E8FF]/80">
          <Loader2 size={10} className="animate-spin" /> analyzing…
        </span>
      ) : null}
    </div>
  )
}

const CUSTOM_SENTINEL = '__custom__'
const NO_PREF_LABEL = 'No Preference'

/**
 * Recommendation-aware dropdown. Renders the recommended option at the top with
 * a glow + checkmark + "Recommended" badge, then the other options, then a
 * Custom… reveal (when allowed) and a universal No Preference. The current
 * selection is visible on the trigger without opening the menu.
 */
function StrategicSelect({ field }: { field: StrategicField }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const { value, recommended, noPreference, custom } = field
  const isRecommendedSelected = !custom.active && !noPreference && !!value && value === recommended

  // Ordered menu: recommended first (if any), then the rest, deduped.
  const ordered = useMemo(() => {
    if (!recommended) return field.options
    return [recommended, ...field.options.filter((o) => o !== recommended)]
  }, [field.options, recommended])

  const choose = (label: string) => {
    if (label === CUSTOM_SENTINEL) field.onCustom()
    else if (label === NO_PREF_LABEL) field.onNoPreference()
    else field.onSelect(label)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-4 py-3.5 text-left text-[15px] outline-none transition-all ${
          isRecommendedSelected
            ? 'border-[#4D8DFF]/55 bg-[#4D8DFF]/[0.08] text-white shadow-[0_0_0_1px_rgba(77, 141, 255,0.16),0_0_26px_-6px_rgba(77, 141, 255,0.5)]'
            : 'border-white/12 bg-white/[0.05] text-white hover:border-[#38E8FF]/40'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {isRecommendedSelected && <Sparkles size={15} className="shrink-0 text-[#38E8FF]" />}
          <span className="truncate">
            {custom.active ? (
              custom.value || 'Custom…'
            ) : noPreference ? (
              <span className="text-white/68">No Preference</span>
            ) : value ? (
              <>
                {value}
                {isRecommendedSelected && (
                  <span className="ml-2 text-[13px] text-[#38E8FF]">• Recommended</span>
                )}
              </>
            ) : (
              <span className="text-white/60">Select…</span>
            )}
          </span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 text-white/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-[70] mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-white/12 bg-[#0b1024]/90 backdrop-blur-xl p-1.5 shadow-2xl">
          {ordered.map((opt) => {
            const isRec = opt === recommended
            const isSel = !custom.active && !noPreference && opt === value
            return (
              <button
                key={opt}
                type="button"
                onClick={() => choose(opt)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  isRec
                    ? 'bg-[#4D8DFF]/[0.09] text-white hover:bg-[#4D8DFF]/15'
                    : 'text-white/92 hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex min-w-0 flex-1 items-start gap-2">
                  {isRec ? (
                    <Check size={14} className="mt-0.5 shrink-0 text-[#38E8FF]" />
                  ) : isSel ? (
                    <Check size={14} className="mt-0.5 shrink-0 text-white/75" />
                  ) : (
                    <span className="w-[14px] shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className={`block truncate ${isRec ? 'font-semibold' : ''}`}>{opt}</span>
                    {field.descriptions?.[opt] && (
                      <span className="mt-0.5 block text-[11px] leading-snug text-white/60">
                        {field.descriptions[opt]}
                      </span>
                    )}
                  </span>
                </span>
                {isRec && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#4D8DFF]/40 bg-[#4D8DFF]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#38E8FF]">
                    <Sparkles size={9} /> Recommended
                  </span>
                )}
              </button>
            )
          })}

          <div className="my-1.5 h-px bg-white/10" />

          {custom.allowed && (
            <button
              type="button"
              onClick={() => choose(CUSTOM_SENTINEL)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                custom.active ? 'bg-white/[0.06] text-white' : 'text-white/85 hover:bg-white/[0.06]'
              }`}
            >
              {custom.active ? (
                <Check size={14} className="shrink-0 text-white/75" />
              ) : (
                <span className="w-[14px] shrink-0" />
              )}
              <span>Custom…</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => choose(NO_PREF_LABEL)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
              noPreference ? 'bg-white/[0.06] text-white' : 'text-white/70 hover:bg-white/[0.06]'
            }`}
          >
            {noPreference ? (
              <Check size={14} className="shrink-0 text-white/75" />
            ) : (
              <span className="w-[14px] shrink-0" />
            )}
            <span>No Preference</span>
          </button>
        </div>
      )}

      {/* The selected stage's meaning, kept visible after the menu closes. */}
      {!open && !custom.active && !noPreference && value && field.descriptions?.[value] && (
        <p className="mt-2 text-xs leading-relaxed text-white/60">{field.descriptions[value]}</p>
      )}

      {custom.active && (
        <div className="mt-2.5">
          <input
            value={custom.value}
            onChange={(e) => field.onCustomChange(e.target.value)}
            placeholder={custom.placeholder}
            autoFocus
            className="launch-input px-4 py-3 text-[15px]"
          />
          {custom.examples.length > 0 && (
            <p className="mt-2 text-xs text-white/55">e.g. {custom.examples.join(' · ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// Icon + one-line blurb for each creative deliverable.
function deliverableMeta(label: string) {
  const l = label.toLowerCase()
  if (l.includes('ugc'))
    return { Icon: Smartphone, blurb: 'Creator-style, phone-shot talking-head ads that feel native.' }
  if (l.includes('carousel'))
    return { Icon: GalleryHorizontalEnd, blurb: 'Multi-card swipe ads — proof, steps, or a story arc.' }
  if (l.includes('montage') || l.includes('scene'))
    return { Icon: Film, blurb: 'A multi-scene sequence — hook, proof, payoff — shaped in the Creative Canvas.' }
  if (l.includes('video'))
    return { Icon: Clapperboard, blurb: 'Founder VSLs, testimonials & cinematic on-site B-roll.' }
  return { Icon: ImageIcon, blurb: 'Proof statics, founder photos & concept stills.' }
}

/**
 * The variation block for ONE creative format — count cards, the lever pills,
 * and the live summary — rendered directly under that format's size grid.
 *
 * It is per-format rather than global because the decision is per-format: three
 * hook variations of a video and one static is a normal campaign, and a single
 * shared number could not express it. Each instance reads and writes only its
 * own deliverable's entry, so the formats never interfere.
 */
function VariationControls({
  deliverable,
  sizes,
  count,
  method,
  onCount,
  onMethod,
}: {
  deliverable: string
  sizes: string[]
  count: number
  method: VariationMethod
  onCount: (n: number) => void
  onMethod: (m: VariationMethod) => void
}) {
  const multiple = count > 1

  return (
    <div className="space-y-2.5 pt-1">
      <SectionLabel>Variations</SectionLabel>
      <div className="grid grid-cols-4 gap-2">
        {VARIATION_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onCount(n)}
            aria-pressed={count === n}
            aria-label={`${n} ${n === 1 ? 'creative' : 'creatives'} of ${deliverable}`}
            className={`count-card px-2 py-2 text-center ${count === n ? 'is-on' : ''}`}
          >
            <span className="block font-display text-base font-bold text-white">×{n}</span>
            <span className="block text-[10px] leading-tight text-white/60">
              {n === 1 ? 'Single creative' : `${n} creatives`}
            </span>
          </button>
        ))}
      </div>

      {/* Kept mounted at ×1 rather than unmounted, so the lever the builder
          already chose is still here when they go back up to ×2. */}
      <div className="method-reveal" data-open={multiple} aria-hidden={!multiple}>
        <div className="space-y-2 pt-1.5">
          <SectionLabel>What should vary?</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {VARIATION_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                tabIndex={multiple ? 0 : -1}
                onClick={() => onMethod(m)}
                aria-pressed={method === m}
                className={`method-pill px-3 py-1.5 text-xs font-semibold ${method === m ? 'is-on' : ''}`}
              >
                {VARIATION_METHOD_LABEL[m]}
                {m === DEFAULT_VARIATION_METHOD && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#38E8FF]">
                    Rec
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-white/60">{variationSummary(deliverable, count, method, sizes)}</p>
    </div>
  )
}

/**
 * Render-model dropdown for one deliverable. The system's pick leads the menu
 * with the Recommended badge and is pre-selected; every other registry model is
 * one tap away. Each option carries its one-line strength note, so choosing a
 * model is a decision, not a guess.
 */
function ModelSelect({
  menu,
  pick,
  onPick,
}: {
  menu: ModelMenu
  pick: string | undefined
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const resolved = resolveModelPick(menu, pick)
  const current = menu.options.find((o) => o.id === resolved) ?? menu.options[0]
  const isRecommendedSelected = current.id === menu.recommendedId
  const ordered = [
    ...menu.options.filter((o) => o.id === menu.recommendedId),
    ...menu.options.filter((o) => o.id !== menu.recommendedId),
  ]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-[13px] outline-none transition-all ${
          isRecommendedSelected
            ? 'border-[#4D8DFF]/45 bg-[#4D8DFF]/[0.06] text-white'
            : 'border-white/12 bg-white/[0.05] text-white hover:border-[#38E8FF]/40'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {isRecommendedSelected && <Sparkles size={13} className="shrink-0 text-[#38E8FF]" />}
          <span className="truncate">
            {current.label}
            {isRecommendedSelected && (
              <span className="ml-2 text-[12px] text-[#38E8FF]">• Recommended</span>
            )}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-white/60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-[70] mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-white/12 bg-[#0b1024]/90 backdrop-blur-xl p-1.5 shadow-2xl">
          {ordered.map((o) => {
            const isRec = o.id === menu.recommendedId
            const isSel = o.id === current.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onPick(o.id)
                  setOpen(false)
                }}
                className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
                  isRec
                    ? 'bg-[#4D8DFF]/[0.09] text-white hover:bg-[#4D8DFF]/15'
                    : 'text-white/92 hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex min-w-0 flex-1 items-start gap-2">
                  {isSel ? (
                    <Check size={13} className={`mt-0.5 shrink-0 ${isRec ? 'text-[#38E8FF]' : 'text-white/75'}`} />
                  ) : (
                    <span className="w-[13px] shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className={`block truncate ${isRec ? 'font-semibold' : ''}`}>
                      {o.label}
                      {!o.configured && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-white/45">
                          key needed
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/60">{o.note}</span>
                  </span>
                </span>
                {isRec && (
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-[#4D8DFF]/40 bg-[#4D8DFF]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#38E8FF]">
                    <Sparkles size={9} /> Recommended
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {isRecommendedSelected && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-white/55">
          <Sparkles size={10} className="mt-0.5 shrink-0 text-[#38E8FF]/70" />
          {menu.reason}
        </p>
      )}
    </div>
  )
}

// A tiny aspect-ratio preview box for the Formats step.
function RatioPreview({ ratio }: { ratio: string }) {
  const box =
    ratio === '9:16' ? 'h-7 w-4' : ratio === '16:9' ? 'h-4 w-7' : 'h-5 w-5'
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center">
      <span className={`${box} rounded-[3px] border border-current`} />
    </span>
  )
}

// The three Meta performance feed options, rendered as bold selectable cards.
const FEED_OPTIONS = [
  {
    id: 'off',
    Icon: CircleOff,
    title: 'Standalone',
    tag: 'No Meta data',
    desc: 'Fire on your intelligence vault alone. No live ad performance is read.',
  },
  {
    id: 'pipeboard',
    Icon: Activity,
    title: 'Pipeboard',
    tag: 'Hosted Meta Ads MCP',
    desc: 'OPUS reads live Meta ad performance through Pipeboard’s hosted connector.',
  },
  {
    id: 'meta',
    Icon: Radio,
    title: 'Meta Direct',
    tag: 'First-party Ads MCP',
    desc: 'Connect straight to Meta’s first-party Ads MCP at mcp.facebook.com.',
  },
] as const

// What a strategic field shows in the final review summary.
function fieldSummary(field: StrategicField): string {
  if (field.custom.active) return field.custom.value.trim() || 'Custom (unset)'
  if (field.noPreference) return 'No Preference — Reactor decides'
  return field.value || 'No Preference — Reactor decides'
}

/**
 * The Ignition deliverables breakdown — every selected format listed on its own
 * with its sizes, its variation count and the lever that separates them.
 *
 * Deliberately NOT collapsed into one global line: a run can legitimately be
 * "3 hook variations of the video, 1 static", and a single "×N variations"
 * summary would misreport it. The total counts VERSIONS, not exported assets —
 * a size is a placement adaptation of a variation, never another variation, so
 * counting sizes here would promise files the run does not produce.
 */
function DeliverablesSummary({ form }: { form: ReactorForm }) {
  if (form.outputs.length === 0) {
    return <SummaryRow label="Deliverables" value="Reactor decides" />
  }

  const total = form.outputs.reduce(
    (n, o) => n + (form.variationCounts[o] ?? DEFAULT_VARIATION_COUNT),
    0,
  )

  return (
    <div className="flex gap-3 text-sm">
      <span className="w-24 shrink-0 text-[11px] uppercase tracking-[0.08em] text-white/55">
        Deliverables
      </span>
      <div className="min-w-0 space-y-1.5">
        {form.outputs.map((o) => (
          <div key={o}>
            <span className="block text-white/95">{o}</span>
            <span className="block text-[11px] text-white/60">
              {variationSummary(
                o,
                form.variationCounts[o] ?? DEFAULT_VARIATION_COUNT,
                form.variationMethods[o] ?? DEFAULT_VARIATION_METHOD,
                form.dimensions[o] ?? [],
              )}
            </span>
          </div>
        ))}
        {form.outputs.length > 1 && (
          <span className="block border-t border-white/10 pt-1.5 text-[11px] font-semibold text-white/75">
            {total} creative{total === 1 ? '' : 's'} this run
          </span>
        )}
      </div>
    </div>
  )
}

// "Static — FLUX.1 · Montage — FLUX.1 stills / Seedance 2.0 motion" line.
function modelsSummary(form: ReactorForm): string {
  const parts = form.outputs
    .map((o) => {
      const short = o.replace(/ Creatives?$/, '').replace(' / Scene Flow', '')
      if (isMontageDeliverable(o) && form.montageMenus) {
        const { still, motion } = form.montageMenus
        const stillModel = still.options.find((m) => m.id === resolveModelPick(still, form.models[montageStillKey(o)]))
        const motionModel = motion.options.find((m) => m.id === resolveModelPick(motion, form.models[montageMotionKey(o)]))
        if (!stillModel || !motionModel) return ''
        return `${short} — ${stillModel.label} stills / ${motionModel.label} motion`
      }
      const menu = form.modelMenus[o] ?? null
      if (!menu) return ''
      const pick = resolveModelPick(menu, form.models[o])
      const model = menu.options.find((m) => m.id === pick)
      return model ? `${short} — ${model.label}` : ''
    })
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Reactor decides'
}

export function ReactorModal({ open, onClose, onFire, form }: ReactorModalProps) {
  const [step, setStep] = useState(1)
  // Two ways in: Quick Launch (one input → fire, everything auto-decided) and
  // the guided five-step flow. New sessions land on Quick Launch.
  const [mode, setMode] = useState<'quick' | 'guided'>('quick')

  useEffect(() => {
    if (open) {
      setStep(1)
      setMode('quick')
    }
  }, [open])

  const dirty = useMemo(
    () =>
      form.brief.trim() !== '' ||
      form.offerName.trim() !== '' ||
      !form.awarenessField.noPreference ||
      !form.sophisticationField.noPreference ||
      !form.audienceField.noPreference ||
      !form.offerField.noPreference ||
      form.onBrand === false,
    [form],
  )

  const requestClose = () => {
    if (dirty && !window.confirm('Discard inputs and close?')) return
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty])

  // The brief is a full-screen sheet on a phone — without this the page behind
  // scrolls under it, so dismissing the modal lands the user somewhere they
  // never navigated to. `overscroll-contain` on the body handles the rubber
  // band; this handles the scroll itself.
  useEffect(() => {
    if (!open) return
    const { body } = document
    const prev = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = prev
    }
  }, [open])

  // The modal renders through a portal on <body> (see the return below), which
  // only exists client-side.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // One scroll container is reused for every step, so its scroll position
  // carries over between them — you scroll down to reach "Next" on one step and
  // the next step opens already scrolled to the bottom. Reset it to the top on
  // every step change so each step starts at its heading.
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyScrollRef.current?.scrollTo({ top: 0 })
  }, [step])

  if (!open || !mounted) return null

  const fire = () => {
    onClose()
    onFire()
  }

  const meta = STEPS[step - 1]

  // How many ads this run will actually produce: the sum of every format's own
  // variation count.
  //
  // NOT multiplied by the selected sizes, which is what this counted before.
  // The reactor renders one creative per concept at the requested ratio — it
  // does not export the same ad once per size — so counting sizes promised
  // files the run never delivers. A size is a placement adaptation of a
  // variation, never another variation.
  const runTotal = form.outputs.reduce(
    (total, o) => total + (form.variationCounts[o] ?? DEFAULT_VARIATION_COUNT),
    0,
  )
  const progress = (step / LAST_STEP) * 100
  const feedTitle = FEED_OPTIONS.find((f) => f.id === form.metaProvider)?.title ?? 'Standalone'

  // Portaled to <body>. `.command-surface` (the frame this modal is rendered
  // inside) sets `isolation: isolate`, which scopes the overlay's z-index to
  // that frame — the sticky topbar then painted over the top of the sheet.
  // Escaping to the document root puts the modal above the whole shell.
  return createPortal(
    <div
      className="launch-overlay fixed inset-0 z-[70] grid place-items-center p-0 sm:px-4 sm:py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      {/* Full-bleed sheet on a phone, centred panel from tablet up. `dvh`
          rather than `vh` because mobile browser chrome shrinks the viewport
          as it collapses — with `vh` the footer sits under the URL bar. */}
      <div className="launch-panel flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none sm:h-auto sm:max-h-[92vh] sm:w-[760px] sm:max-w-[calc(100vw-2rem)] sm:rounded-[1.75rem]">
        {mode === 'quick' ? (
          <QuickLaunch
            form={form}
            onFire={fire}
            onGuided={() => setMode('guided')}
            onClose={requestClose}
          />
        ) : (
          <>
        {/* Ignition progress */}
        <div className="launch-progress">
          <i style={{ width: `${progress}%` }} />
        </div>

        {/* Header — eyebrow, stepper, title */}
        <div className="border-b border-white/10 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-7 sm:pb-5 sm:pt-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="launch-eyebrow">
              <Atom size={14} className="text-[#38E8FF]" />
              New Creative Campaign
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode('quick')}
                className="launch-nav !px-3 !py-1.5 !text-[11px]"
              >
                <Zap size={13} className="text-[#38E8FF]" /> Quick Launch
              </button>
              <button
                type="button"
                onClick={requestClose}
                className="tap-target grid h-10 w-10 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const n = i + 1
              const state = n === step ? 'active' : n < step ? 'done' : 'upcoming'
              return (
                <div key={s.label} className="flex flex-1 items-center gap-1.5 last:flex-none">
                  <div className="flex flex-col items-center gap-2">
                    <button
                      type="button"
                      disabled={state === 'upcoming'}
                      onClick={() => state === 'done' && setStep(n)}
                      data-state={state}
                      className={`launch-orb ${state === 'done' ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {state === 'done' ? <Check size={14} /> : n}
                    </button>
                    <span
                      className={`hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.1em] sm:block ${
                        state === 'active'
                          ? 'text-[#38E8FF]'
                          : state === 'done'
                            ? 'text-white/70'
                            : 'text-white/40'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {n < STEPS.length && (
                    <div className="launch-orb-line -mt-6" data-done={n < step} />
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-4 sm:mt-6">
            <h2 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
              {meta.label}
            </h2>
            <p className="mt-1 text-[13px] text-white/65 sm:text-sm">{meta.sub}</p>
          </div>
        </div>

        {/* Body */}
        <div
          ref={bodyScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-6"
        >
          {step === 1 && (
            <div className="animate-fade-up space-y-6">
              {/* Campaign Name and Offer Name sit on one line because they are
                  the two names in play and were being confused for each other.
                  The distinction is WHO READS THEM: the campaign name is
                  internal filing, the offer name is what the market is told it
                  gets — so each carries a one-line note saying exactly that. */}
              <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
                <div>
                  <SectionLabel>
                    <span className="inline-flex items-center gap-1.5">
                      <Tag size={16} /> Campaign Name
                    </span>
                  </SectionLabel>
                  <input
                    value={form.campaignName}
                    onChange={(e) => form.setCampaignName(e.target.value)}
                    placeholder={`e.g. "Q3 Cold Traffic — Automation"`}
                    className="launch-input px-4 py-3.5 text-[15px]"
                  />
                  <p className="mt-2 text-xs leading-relaxed text-white/55">
                    Internal label, for finding this campaign later. Never appears in an ad.
                  </p>
                </div>
                <div>
                  <SectionLabel>
                    <span className="inline-flex items-center gap-1.5">
                      <Megaphone size={16} /> Offer Name
                    </span>
                  </SectionLabel>
                  <input
                    value={form.offerName}
                    onChange={(e) => form.setOfferName(e.target.value)}
                    placeholder={`e.g. "AI Automation Masterclass"`}
                    className="launch-input px-4 py-3.5 text-[15px]"
                  />
                </div>
              </div>

              <div>
                <SectionLabel thinking={form.suggesting}>Campaign Offer</SectionLabel>
                <p className="-mt-1 mb-2.5 text-sm text-white/60">
                  The TYPE of offer, not its name — it sets the friction, the proof burden and the
                  CTA frame the concepts are written to.
                </p>
                <StrategicSelect field={form.offerField} />
              </div>

              <div>
                <SectionLabel thinking={form.suggesting}>Campaign Brief</SectionLabel>
                <p className="-mt-1 mb-2.5 text-sm text-white/60">
                  Optional but high-leverage. Direction, tone, proof asset, creative constraints —
                  the agents read this first and infer the angle for you.
                </p>
                <textarea
                  value={form.brief}
                  onChange={(e) => form.setBrief(e.target.value)}
                  placeholder={`e.g. "Cold traffic. Owner-led businesses doing $1M–$5M who are still doing the work manually. Lead with a named client result and the time it took. Sell the shift in how they operate, not the tool. No hype, no countdown timers."`}
                  className="launch-input h-44 resize-none px-4 py-3.5 text-[15px] leading-relaxed sm:h-28"
                />
              </div>

              <div>
                <SectionLabel thinking={form.suggesting}>Creative Deliverables</SectionLabel>
                <p className="-mt-1 mb-3 text-sm text-white/60">
                  Pick one or all — you’ll set sizes for each next. Copy is written into every
                  concept.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {form.outputTypeList.map((o) => {
                    const on = form.outputs.includes(o)
                    const rec = form.recommendedDeliverables.includes(o)
                    const { Icon, blurb } = deliverableMeta(o)
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => form.toggleOutput(o)}
                        className={`pick-card p-4 text-left ${on ? 'is-on' : ''}`}
                      >
                        <div className="mb-3 flex items-start justify-between">
                          <span className="pick-ic">
                            <Icon size={20} />
                          </span>
                          <span className="pick-check">
                            <Check size={13} strokeWidth={3} />
                          </span>
                        </div>
                        <p className="font-display text-base font-semibold text-white">{o}</p>
                        <p className="mt-1 text-xs leading-relaxed text-white/65">{blurb}</p>
                        {rec && (
                          <span className="mt-2.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#38E8FF]">
                            <Sparkles size={10} /> Recommended
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {form.deliverablesReason && form.recommendedDeliverables.length > 0 && (
                  <p className="mt-3 flex items-start gap-1.5 text-xs text-white/65">
                    <Sparkles size={12} className="mt-0.5 shrink-0 text-[#38E8FF]" />
                    <span>{form.deliverablesReason}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-fade-up space-y-4">
              {form.outputs.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-10 text-center">
                  <GalleryHorizontalEnd size={30} className="mx-auto mb-3 text-white/35" />
                  <p className="text-sm text-white/65">
                    Pick at least one creative on the previous step to choose its sizes.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-white/60">
                    Pick the render model for each creative — the system pre-selects the best fit —
                    then choose its sizes. Dimensions adapt to whichever model you choose.
                  </p>
                  {form.outputs.map((o) => {
                    const { Icon } = deliverableMeta(o)

                    // Montage has two real picks (still + motion) — OpenMontage
                    // sequences them, it never renders anything itself.
                    if (isMontageDeliverable(o) && form.montageMenus) {
                      const { still, motion } = form.montageMenus
                      const stillPick = resolveModelPick(still, form.models[montageStillKey(o)])
                      const motionPick = resolveModelPick(motion, form.models[montageMotionKey(o)])
                      const sizes: CreativeSize[] = sizesForModel(motion, motionPick ?? undefined)
                      const chosen = form.dimensions[o] ?? []
                      return (
                        <div key={o} className="space-y-2.5">
                          <SectionLabel>
                            <span className="inline-flex items-center gap-1.5">
                              <Icon size={12} /> {o}
                            </span>
                          </SectionLabel>
                          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
                            <Film size={13} className="mt-0.5 shrink-0 text-[#38E8FF]" />
                            <span className="min-w-0">
                              <span className="text-[12px] font-semibold text-white">{OPENMONTAGE_BADGE.label}</span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-white/65">
                                {OPENMONTAGE_BADGE.note}
                              </span>
                            </span>
                          </div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
                            Still Model — renders every scene
                          </p>
                          <ModelSelect
                            menu={still}
                            pick={form.models[montageStillKey(o)]}
                            onPick={(id) => form.setModel(montageStillKey(o), id)}
                          />
                          <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                            Motion Model — animates every scene
                          </p>
                          <ModelSelect
                            menu={motion}
                            pick={form.models[montageMotionKey(o)]}
                            onPick={(id) => form.setModel(montageMotionKey(o), id)}
                          />
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-1">
                            {sizes.map((s) => {
                              const on = chosen.includes(s.ratio)
                              return (
                                <button
                                  key={s.ratio}
                                  type="button"
                                  onClick={() => form.toggleDimension(o, s.ratio)}
                                  className={`pick-card flex items-center gap-2.5 p-3 text-left ${on ? 'is-on' : ''}`}
                                >
                                  <RatioPreview ratio={s.ratio} />
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-semibold text-white">
                                      {s.label}
                                    </span>
                                    <span className="block text-[11px] text-white/65">
                                      {s.ratio} · {s.use}
                                    </span>
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                          <VariationControls
                            deliverable={o}
                            sizes={chosen}
                            count={form.variationCounts[o] ?? DEFAULT_VARIATION_COUNT}
                            method={form.variationMethods[o] ?? DEFAULT_VARIATION_METHOD}
                            onCount={(n) => form.setVariationCount(o, n)}
                            onMethod={(m) => form.setVariationMethod(o, m)}
                          />
                        </div>
                      )
                    }

                    const menu = form.modelMenus[o] ?? null
                    const pick = resolveModelPick(menu, form.models[o])
                    const sizes: CreativeSize[] = sizesForModel(menu, pick ?? undefined)
                    const chosen = form.dimensions[o] ?? []
                    return (
                      <div key={o} className="space-y-2.5">
                        <SectionLabel>
                          <span className="inline-flex items-center gap-1.5">
                            <Icon size={12} /> {o}
                          </span>
                        </SectionLabel>
                        {menu === null ? (
                          <div className="rounded-xl border border-[#4D8DFF]/20 bg-[#4D8DFF]/[0.04] px-4 py-3.5">
                            <p className="flex items-start gap-2 text-sm text-white/75">
                              <Wand2 size={14} className="mt-0.5 shrink-0 text-[#38E8FF]" />
                              The reactor picks the winning format for this brief — model and sizes
                              are decided by the system, grounded in what has already worked.
                            </p>
                          </div>
                        ) : (
                          <>
                            <ModelSelect
                              menu={menu}
                              pick={form.models[o]}
                              onPick={(id) => form.setModel(o, id)}
                            />
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                              {sizes.map((s) => {
                                const on = chosen.includes(s.ratio)
                                return (
                                  <button
                                    key={s.ratio}
                                    type="button"
                                    onClick={() => form.toggleDimension(o, s.ratio)}
                                    className={`pick-card flex items-center gap-2.5 p-3 text-left ${on ? 'is-on' : ''}`}
                                  >
                                    <RatioPreview ratio={s.ratio} />
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-semibold text-white">
                                        {s.label}
                                      </span>
                                      <span className="block text-[11px] text-white/65">
                                        {s.ratio} · {s.use}
                                      </span>
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                            <VariationControls
                              deliverable={o}
                              sizes={chosen}
                              count={form.variationCounts[o] ?? DEFAULT_VARIATION_COUNT}
                              method={form.variationMethods[o] ?? DEFAULT_VARIATION_METHOD}
                              onCount={(n) => form.setVariationCount(o, n)}
                              onMethod={(m) => form.setVariationMethod(o, m)}
                            />
                          </>
                        )}
                      </div>
                    )
                  })}

                  {/* The run total. Kept from the global-knob version of this
                      step — the number of ads a fire will produce is worth
                      seeing where it is decided — but summed from the
                      per-format counts rather than one multiplier, since there
                      is no longer a single count to multiply by. */}
                  {form.outputs.length > 0 && (
                    <p className="border-t border-white/10 pt-4 text-xs text-white/55">
                      <span className="font-semibold text-white/80">
                        {runTotal} ad{runTotal === 1 ? '' : 's'}
                      </span>{' '}
                      this run, across {form.outputs.length} creative
                      {form.outputs.length === 1 ? '' : 's'}.
                    </p>
                  )}

                  {form.outputs.some((o) => /ugc/i.test(o)) && (
                    <div className="border-t border-white/10 pt-4">
                      <FaceLibrary onChange={form.onFaceChange} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="animate-fade-up space-y-6">
              <div>
                <SectionLabel thinking={form.suggesting}>Awareness Stage</SectionLabel>
                <p className="-mt-1 mb-2.5 text-sm text-white/60">
                  How much the prospect already knows — it decides how much the ad has to explain
                  before it can sell. The system reads your brief and picks the stage for you.
                </p>
                <StrategicSelect field={form.awarenessField} />
              </div>

              <div>
                <SectionLabel thinking={form.suggesting}>Market Sophistication</SectionLabel>
                <p className="-mt-1 mb-2.5 text-sm text-white/60">
                  How many times this market has already been pitched — it decides what kind of
                  claim still lands. The system reads your brief and picks the stage for you.
                </p>
                <StrategicSelect field={form.sophisticationField} />
              </div>

              <div>
                <SectionLabel thinking={form.suggesting}>Audience Type</SectionLabel>
                <StrategicSelect field={form.audienceField} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="animate-fade-up space-y-3">
              <SectionLabel>Meta Performance Feed</SectionLabel>
              <p className="-mt-1 text-sm text-white/60">
                Controls whether OPUS reads live Meta ad performance during this run. Unconfigured
                sources fall back automatically.
              </p>
              <div className="space-y-2.5 pt-1">
                {FEED_OPTIONS.map(({ id, Icon, title, tag, desc }) => {
                  const on = form.metaProvider === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => form.setMetaProvider(id)}
                      className={`pick-card flex w-full items-center gap-4 p-4 text-left ${on ? 'is-on' : ''}`}
                    >
                      <span className="pick-ic shrink-0">
                        <Icon size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-base font-semibold text-white">{title}</span>
                          <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/68">
                            {tag}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-white/65">{desc}</span>
                      </span>
                      <span className="pick-check shrink-0">
                        <Check size={13} strokeWidth={3} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="animate-fade-up space-y-4">
              <button
                type="button"
                onClick={() => form.setOnBrand(!form.onBrand)}
                className={`pick-card flex w-full items-start gap-4 p-5 text-left ${form.onBrand ? 'is-on' : ''}`}
              >
                <span className="pick-ic shrink-0">
                  <ShieldCheck size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold text-white">On Brand</p>
                  <p className="mt-1 text-sm leading-relaxed text-white/65">
                    Pulls your real brand — voice, offer, audience language, proof and colours —
                    from your Brand Intelligence tab and applies it to every concept the reactor
                    writes.
                  </p>
                </div>
                <span
                  className={`mt-1 flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    form.onBrand ? 'bg-[#4D8DFF]' : 'bg-white/15'
                  }`}
                >
                  <span
                    className={`h-6 w-6 rounded-full bg-white shadow transition-transform ${
                      form.onBrand ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
              <p className="px-1 text-sm leading-relaxed text-white/60">
                {form.onBrand
                  ? 'The reactor pulls your connected brand profile (voice, offer, audience, proof, colours) into every concept. Connect a site on the Brand Intelligence tab to enrich this; without one it applies your default brand voice.'
                  : 'Concepts will be generated without brand anchoring — the brief and inputs only.'}
              </p>
            </div>
          )}

          {step === 6 && (
            <div className="animate-fade-up space-y-5">
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                <SummaryRow label="Campaign" value={form.campaignName.trim() || 'Untitled campaign'} />
                <SummaryRow label="Audience" value={fieldSummary(form.audienceField)} />
                <SummaryRow label="Awareness" value={fieldSummary(form.awarenessField)} />
                <SummaryRow label="Sophistication" value={fieldSummary(form.sophisticationField)} />
                <SummaryRow label="Offer" value={fieldSummary(form.offerField)} />
                <SummaryRow label="CTA name" value={form.offerName.trim() || '—'} />
                <DeliverablesSummary form={form} />
                <SummaryRow label="Models" value={modelsSummary(form)} />
                {form.refCount > 0 && (
                  <SummaryRow
                    label="References"
                    value={`${form.refCount} reference${form.refCount === 1 ? '' : 's'} locked for UGC`}
                  />
                )}
                <SummaryRow label="Perf. feed" value={feedTitle} />
                <SummaryRow label="On Brand" value={form.onBrand ? 'On' : 'Off'} />
                {form.brief.trim() && (
                  <div className="flex gap-3 border-t border-white/10 pt-2.5">
                    <span className="w-24 shrink-0 text-[11px] uppercase tracking-[0.08em] text-white/55">
                      Brief
                    </span>
                    <span className="line-clamp-2 text-white/85">{form.brief.trim()}</span>
                  </div>
                )}
                {form.cloneLabel && <SummaryRow label="Cloning" value={form.cloneLabel} />}
                {form.isolate && form.isolate.values.length > 0 && (
                  <SummaryRow
                    label="Test"
                    value={`Iterating ${form.isolate.axis} · ${form.isolate.values.join(', ')}`}
                  />
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={fire}
                  className="fire-btn fire-btn--lg flex w-full items-center justify-center gap-2 font-display font-bold uppercase tracking-wide text-white"
                >
                  <Atom size={18} /> Fire Reactor
                </button>
                <p className="mt-2.5 text-center text-[11px] uppercase tracking-[0.14em] text-white/55">
                  OPUS · Strategic synthesis · Self-critique scoring
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer — pinned above the home indicator so Back/Next stay
            reachable with a thumb rather than scrolling off a tall step. */}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-7 sm:py-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="launch-nav tap-target"
            >
              <ChevronLeft size={16} /> Back
            </button>
          ) : (
            <span />
          )}

          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45 sm:text-[11px]">
            Step {step} of {LAST_STEP}
          </span>

          {step < LAST_STEP ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="launch-nav launch-nav--primary tap-target"
            >
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <span />
          )}
        </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// Quick Launch — one bold input, an optional website extract, a live read of
// what the agents inferred, and a single Fire button. Everything not set here is
// decided by the reactor. The escape hatch drops into the full guided flow.
function QuickLaunch({
  form,
  onFire,
  onGuided,
  onClose,
}: {
  form: ReactorForm
  onFire: () => void
  onGuided: () => void
  onClose: () => void
}) {
  const reads: { label: string; value: string }[] = [
    { label: 'Angle', value: form.angleField.recommended ?? '' },
    { label: 'Audience', value: form.audienceField.recommended ?? '' },
    { label: 'Offer', value: form.offerField.recommended ?? '' },
  ].filter((r) => r.value)
  const hasBrief = form.brief.trim().length >= 12
  const showReads = hasBrief && (reads.length > 0 || form.recommendedDeliverables.length > 0)

  return (
    <>
      <div className="launch-progress">
        <i style={{ width: '100%' }} />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-7 sm:pb-4 sm:pt-5">
        <span className="launch-eyebrow">
          <Zap size={14} className="text-[#38E8FF]" />
          Quick Launch
        </span>
        <button
          type="button"
          onClick={onClose}
          className="tap-target grid h-10 w-10 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-7">
        <div className="animate-fade-up space-y-5 sm:space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Fire a campaign in one line.
            </h2>
            <p className="mt-1.5 text-[13px] text-white/65 sm:text-sm">
              Describe what you want — the reactor infers the angle, audience, offer, and creative,
              then builds it. Nothing else required.
            </p>
          </div>

          <div>
            <SectionLabel thinking={form.suggesting}>Your Campaign</SectionLabel>
            <textarea
              value={form.brief}
              onChange={(e) => form.setBrief(e.target.value)}
              placeholder={`e.g. "A founder video for owner-led businesses doing $1M–$5M who are still doing the work manually. Lead with a named client who got 15 hours a week back. Drive masterclass registrations."`}
              className="launch-input h-44 resize-none px-4 py-3.5 text-[15px] leading-relaxed sm:h-32"
            />
          </div>

          {/* Live read of what the reactor inferred from the brief */}
          <div className="rounded-xl border border-[#4D8DFF]/20 bg-[#4D8DFF]/[0.05] px-4 py-3">
            {form.suggesting ? (
              <p className="flex items-center gap-2 text-xs text-white/70">
                <Loader2 size={13} className="animate-spin text-[#38E8FF]" /> Reading your brief…
              </p>
            ) : showReads ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#38E8FF]">
                  <Sparkles size={11} /> Reactor read
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {reads.map((r) => (
                    <span
                      key={r.label}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/85"
                    >
                      <span className="text-white/60">{r.label}</span> {r.value}
                    </span>
                  ))}
                  {form.recommendedDeliverables.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1 rounded-full border border-[#4D8DFF]/30 bg-[#4D8DFF]/10 px-2.5 py-1 text-[11px] text-[#38E8FF]"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-white/65">
                Angle, audience, offer, and creative are all decided for you. Add a line above and
                the reactor’s read appears here.
              </p>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={onFire}
              className="fire-btn fire-btn--lg flex w-full items-center justify-center gap-2 font-display font-bold uppercase tracking-wide text-white"
            >
              <Atom size={18} /> Fire Reactor
            </button>
            <p className="mt-2.5 text-center text-[11px] uppercase tracking-[0.14em] text-white/55">
              OPUS · Strategic synthesis · Self-critique scoring
            </p>
          </div>

          <button
            type="button"
            onClick={onGuided}
            /* Centred on a desktop, where the label is one line and centring
               reads as balance. On a phone it wraps, and a wrapped centred
               label between two pinned icons reads as a mistake — so there the
               icons bookend a left-aligned label instead. */
            className="group flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left text-sm font-medium text-white/75 transition-colors hover:border-white/20 hover:text-white sm:justify-center sm:text-center"
          >
            <SlidersHorizontal size={15} className="shrink-0" />
            <span className="flex-1 sm:flex-none">Prefer full control? Set it up step-by-step</span>
            <ArrowRight
              size={15}
              className="shrink-0 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        </div>
      </div>
    </>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-24 shrink-0 text-[11px] uppercase tracking-[0.08em] text-white/55">
        {label}
      </span>
      <span className="text-white/95">{value}</span>
    </div>
  )
}
