'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Atom, Loader2, Workflow } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/reactor/ui'
import {
  ReactorModal,
  type ReactorForm,
  type StrategicField,
} from '@/components/campaign-reactor/ReactorModal'
import {
  LiveAgentWorkflow,
  type WorkflowControls,
} from '@/components/campaign-reactor/workflow/LiveAgentWorkflow'
import { reactorOutputTypes, winningAngles } from '@/lib/reactor-data'
import { INTEL_SOURCES, intelSourceLabel } from '@/lib/intelligence-sources'
import {
  awarenessOptions,
  sophisticationOptions,
  audienceOptions,
  offerOptions,
  defaultBrandSettings,
  customDirective,
  CREATIVE_SIZES,
  DEFAULT_SIZE,
  NO_PREFERENCE,
  type AngleEvidence,
  type DirectiveOption,
  type ReactorInputs,
  type ReactorSuggestion,
} from '@/lib/reactor-inputs'
import {
  modelMenuFor,
  montageMenus,
  isMontageDeliverable,
  montageStillKey,
  montageMotionKey,
  resolveModelPick,
  sizesForModel,
  type ModelMenu,
} from '@/lib/model-menu'
import { recommendVideoModel } from '@/lib/video/recommend'
import type { ModelAvailability } from '@/lib/video/types'
import { recommendImageModel } from '@/lib/image/recommend'
import type { ImageModelAvailability } from '@/lib/image/types'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'
import { CreativeLedger } from '@/components/campaign-reactor/CreativeLedger'
import { CLONE_STORAGE_KEY, type CloneReference, type IsolateConfig } from '@/lib/taxonomy'
import type { CanvasMode } from '@/lib/creative-canvas/graph'

// The native campaign-angle choices (the No Preference / Custom sentinels are
// added by the dropdown itself).
const ANGLE_NAMES = winningAngles.map((a) => a.name)

// A panel-shaped placeholder while a view surface streams in — never a blank
// box, per the platform's empty/loading rules.
function SurfaceLoading({ label }: { label: string }) {
  return (
    <Panel className="min-h-[480px]">
      <div className="grid min-h-[480px] place-items-center px-6 text-center">
        <div className="flex items-center gap-2.5 text-sm text-glow/70">
          <Loader2 size={15} className="animate-spin" />
          {label}
        </div>
      </div>
    </Panel>
  )
}

// The Canvas (React Flow) and Studio are heavy surfaces the reactor view never
// touches — a run can be fired, watched, and shipped without either. Splitting
// them out keeps that first load lean, which matters most on a phone. Both are
// browser-only (measurement, drag, portals), so SSR stays off.
const CreativeCanvas = dynamic(
  () => import('@/components/creative-canvas/CreativeCanvas').then((m) => m.CreativeCanvas),
  { ssr: false, loading: () => <SurfaceLoading label="Opening Creative Canvas…" /> },
)
const AdStudio = dynamic(
  () => import('@/components/campaign-reactor/canvas/AdStudio').then((m) => m.AdStudio),
  { ssr: false, loading: () => <SurfaceLoading label="Opening Studio…" /> },
)

export function Workbench() {
  // Run + media state lives in the persistent platform-layout provider, so an
  // in-flight reactor run survives navigating to another dashboard and back.
  const {
    phase,
    concepts,
    streamReactor,
    generateCreative,
    animate,
    generateUGC,
    imageFor,
    videoFor,
  } = useReactorRun()
  const [modalOpen, setModalOpen] = useState(false)
  // Optional isolation test ("iterate one thing") — null = free generation.
  const [isolate, setIsolate] = useState<IsolateConfig | null>(null)
  // A reference handed over from the Ad Library ("Clone & Iterate") to reproduce.
  const [cloneReference, setCloneReference] = useState<CloneReference | null>(null)

  // Pick up a clone reference stashed by the Ad Library, then clear it so a
  // refresh doesn't silently re-clone. Opens the modal ready to configure + fire.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CLONE_STORAGE_KEY)
      if (!raw) return
      sessionStorage.removeItem(CLONE_STORAGE_KEY)
      setCloneReference(JSON.parse(raw) as CloneReference)
      setModalOpen(true)
    } catch {
      /* nothing to clone */
    }
  }, [])
  // Output surface: the autonomous reactor (default hero), the Creative Canvas
  // (structured creative direction — shape, branch, and sequence the run), or
  // the Studio (finish one ad as a real Meta unit).
  const [view, setView] = useState<'reactor' | 'canvas' | 'studio'>('reactor')
  // Which format tab the Canvas lands on — set by intent-carrying entrances
  // (the montage CTA), cleared for the generic toggle so the campaign opens
  // on its first selected format.
  const [canvasTab, setCanvasTab] = useState<CanvasMode | undefined>(undefined)
  // Selected intelligence source IDs — the agents recommend a subset from the
  // brief (behind the scenes); OPUS runs on this set. Empty until the brief
  // produces recommendations, then defaulted to the full set at fire time.
  const [activeInputs, setActiveInputs] = useState<string[]>([])
  // Strategic fields start at No Preference; Strategic Intelligence fills in the
  // recommendation once the brief has substance. The user can override, choose
  // No Preference, or enter a custom value.
  const [angle, setAngle] = useState<string>(NO_PREFERENCE)
  // Campaign name — the first question in the guided flow; a label for the run.
  const [campaignName, setCampaignName] = useState('')
  // Deliverables start empty — OPUS recommends a subset from the brief, which is
  // auto-selected until the user overrides.
  const [outputs, setOutputs] = useState<string[]>([])
  const [recommendedDeliverables, setRecommendedDeliverables] = useState<string[]>([])
  const [deliverablesReason, setDeliverablesReason] = useState('')
  // Selected aspect ratios per deliverable (Formats step). Each selected
  // deliverable is seeded with its default size so the step is never blank.
  const [dimensions, setDimensions] = useState<Record<string, string[]>>({})
  // How many distinct versions of every image/video creative the reactor makes.
  const [variations, setVariations] = useState(2)
  // The concept the user sent into the Studio via "Configure in Studio".
  const [studioSeed, setStudioSeed] = useState<Concept | null>(null)
  // Strategic reasoning for the recommended angle (Dynamic Strategy Engine).
  const [angleReason, setAngleReason] = useState('')
  const [angleConfidence, setAngleConfidence] = useState<number | undefined>(undefined)
  const [angleEvidence, setAngleEvidence] = useState<AngleEvidence | null>(null)
  // Strategic fields (the guided step-by-step inputs)
  const [brief, setBrief] = useState('')
  const [awareness, setAwareness] = useState(awarenessOptions[0])
  const [sophistication, setSophistication] = useState(sophisticationOptions[0])
  const [audience, setAudience] = useState(audienceOptions[0])
  const [offer, setOffer] = useState(offerOptions[0])
  const [offerName, setOfferName] = useState('')
  // Custom strategic values — advanced users can supply an angle / audience /
  // offer the menu doesn't have. The custom text becomes the live value.
  const [angleCustom, setAngleCustom] = useState(false)
  const [customAngle, setCustomAngle] = useState('')
  const [audienceCustom, setAudienceCustom] = useState(false)
  const [customAudience, setCustomAudience] = useState('')
  const [offerCustom, setOfferCustom] = useState(false)
  const [customOffer, setCustomOffer] = useState('')
  // The labels Strategic Intelligence recommends for each field (drives the
  // visible "• Recommended" badge, independent of what the user has selected).
  const [rec, setRec] = useState<{
    angle?: string
    awareness?: string
    sophistication?: string
    audience?: string
    offer?: string
  }>({})
  const [onBrand, setOnBrand] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  // Available models (from the API) — the reactor auto-selects the best one for
  // the chosen deliverables; the run always sends 'auto'.
  const [videoModels, setVideoModels] = useState<ModelAvailability[]>([])
  const [videoModel] = useState<string>('auto')
  const [imageModels, setImageModels] = useState<ImageModelAvailability[]>([])
  const [imageModel] = useState<string>('auto')
  // Meta Ads performance feed for the run: 'off' (standalone), 'pipeboard', 'meta'.
  const [metaProvider, setMetaProvider] = useState<string>('pipeboard')
  // Render model per deliverable ('auto' until the user overrides the system pick).
  const [deliverableModels, setDeliverableModels] = useState<Record<string, string>>({})
  // Reference assets for consistent-character UGC (Seedance reference-to-video).
  // Collected on the Formats step when UGC Creative is selected; the selected
  // image/video URLs flow into every "Generate UGC" call after firing.
  const [faceUrls, setFaceUrls] = useState<string[]>([])
  const [refVideos, setRefVideos] = useState<string[]>([])
  const hasRefs = faceUrls.length > 0 || refVideos.length > 0
  const handleFaceSelection = useCallback((images: string[], videos: string[]) => {
    setFaceUrls(images.slice(0, 9))
    setRefVideos(videos.slice(0, 3))
  }, [])

  // Load the model menus once so the reactor can recommend the best model.
  useEffect(() => {
    fetch('/api/video/models')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models)) setVideoModels(d.models as ModelAvailability[])
      })
      .catch(() => {})
    fetch('/api/image/models')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.models)) setImageModels(d.models as ImageModelAvailability[])
      })
      .catch(() => {})
  }, [])

  // The brief wizard IS the entry point — it opens automatically when the user
  // arrives with no run in flight (there is no separate CTA button). A dismissed
  // wizard stays closed; the topbar button re-raises it via the event below.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current) return
    autoOpened.current = true
    if (typeof window !== 'undefined') {
      // Strip the legacy ?modal=open param so refresh/share URLs stay clean.
      const params = new URLSearchParams(window.location.search)
      if (params.get('modal') === 'open') {
        params.delete('modal')
        const qs = params.toString()
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
      }
    }
    if (phase === 'idle') setModalOpen(true)
    // Mount-time decision only — phase changes after arrival must not re-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Topbar "New Creative Campaign" button signals this when already on the page.
  useEffect(() => {
    const open = () => setModalOpen(true)
    window.addEventListener('open-reactor-modal', open)
    return () => window.removeEventListener('open-reactor-modal', open)
  }, [])

  // System recommendation based on the selected deliverables, recomputed live.
  const recommendation = useMemo(
    () => (videoModels.length ? recommendVideoModel(outputs, videoModels) : null),
    [outputs, videoModels],
  )
  // Image model: same pattern.
  const imageRecommendation = useMemo(
    () => (imageModels.length ? recommendImageModel(outputs, imageModels) : null),
    [outputs, imageModels],
  )

  // Per-deliverable model menus (the Formats step) — the system's pick leads,
  // the user can pin any registry model, and sizes adapt to the chosen model.
  // Montage is excluded here (modelMenuFor returns null for it) — it gets its
  // own two-picker menu below.
  const modelMenus = useMemo(() => {
    const menus: Record<string, ModelMenu | null> = {}
    for (const o of outputs) menus[o] = modelMenuFor(o, imageModels, videoModels)
    return menus
  }, [outputs, imageModels, videoModels])

  const montageDeliverable = outputs.find(isMontageDeliverable)
  // The montage deliverable's two REAL model menus (still + motion) — what
  // actually answers "what model does montage use." OpenMontage sequences
  // them; it is never itself selectable.
  const montageModelMenus = useMemo(
    () => (montageDeliverable ? montageMenus(montageDeliverable, imageModels, videoModels) : null),
    [montageDeliverable, imageModels, videoModels],
  )

  const setDeliverableModel = useCallback((deliverable: string, modelId: string) => {
    touchedRef.current.add(`model:${deliverable}`)
    setDeliverableModels((prev) => ({ ...prev, [deliverable]: modelId }))
  }, [])

  // A user-pinned model beats the heuristic recommendation for its media kind.
  // Montage's still/motion picks travel under compound keys.
  const pinnedVideo = [
    'Video Creative',
    'UGC Creative',
    ...(montageDeliverable ? [montageMotionKey(montageDeliverable)] : []),
  ]
    .map((d) => (deliverableModels[d] && deliverableModels[d] !== 'auto' ? deliverableModels[d] : undefined))
    .find(Boolean)
  const pinnedImage = [
    'Static Creative',
    'Carousel Creatives',
    'Creative Variations',
    ...(montageDeliverable ? [montageStillKey(montageDeliverable)] : []),
  ]
    .map((d) => (deliverableModels[d] && deliverableModels[d] !== 'auto' ? deliverableModels[d] : undefined))
    .find(Boolean)

  // What we actually send: the user's pin, else the recommendation.
  const resolvedVideoModel =
    pinnedVideo ?? (videoModel === 'auto' ? recommendation?.modelId : videoModel)
  const resolvedImageModel =
    pinnedImage ?? (imageModel === 'auto' ? imageRecommendation?.modelId : imageModel)

  // The montage path is active whenever the deliverable was picked — it
  // unlocks the "Launch in Creative Canvas" handoff.
  const montageSelected = Boolean(montageDeliverable)

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) =>
    set(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val])
  const toggleOutput = (val: string) => {
    touchedRef.current.add('outputs')
    toggle(outputs, setOutputs, val)
  }
  // Toggle an aspect ratio for a deliverable, but never leave it with zero sizes.
  const toggleDimension = (deliverable: string, ratio: string) => {
    setDimensions((prev) => {
      const current = prev[deliverable] ?? []
      const next = current.includes(ratio)
        ? current.filter((r) => r !== ratio)
        : [...current, ratio]
      return { ...prev, [deliverable]: next.length ? next : current }
    })
  }

  // Keep the Formats selection in sync with the chosen deliverables AND the
  // chosen model: seed each newly selected deliverable with its default size,
  // drop any deselected, and prune ratios the pinned model cannot render.
  useEffect(() => {
    setDimensions((prev) => {
      const next: Record<string, string[]> = {}
      let changed = false
      for (const o of outputs) {
        const isMontage = isMontageDeliverable(o) && montageModelMenus
        const menu = isMontage ? montageModelMenus!.motion : (modelMenus[o] ?? null)
        const pickKey = isMontage ? montageMotionKey(o) : o
        const supported = menu
          ? sizesForModel(menu, resolveModelPick(menu, deliverableModels[pickKey]) ?? undefined).map((s) => s.ratio)
          : (CREATIVE_SIZES[o]?.map((s) => s.ratio) ?? [])
        const kept = (prev[o] ?? []).filter((r) => supported.includes(r as (typeof supported)[number]))
        if (kept.length) {
          next[o] = kept
          if (kept.length !== (prev[o]?.length ?? 0)) changed = true
        } else {
          const def = DEFAULT_SIZE[o] ?? CREATIVE_SIZES[o]?.[0]?.ratio
          const seed = def && supported.includes(def) ? def : supported[0]
          next[o] = seed ? [seed] : []
          changed = true
        }
      }
      if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
  }, [outputs, modelMenus, montageModelMenus, deliverableModels])

  /* ----------------------- Agent pre-selection (suggest) ------------------- */
  // The reactor strategist pre-picks a concrete angle / awareness / audience /
  // offer from the brief, so each field already shows the agent's choice. The
  // user can override any of them; a manual change locks that field.
  const [suggesting, setSuggesting] = useState(false)
  const touchedRef = useRef<Set<string>>(new Set())
  const markTouched = (field: string) => {
    touchedRef.current.add(field)
  }
  // User-driven setters (lock the field against further auto-suggestion).
  const setAngleUser = (v: string) => {
    markTouched('angle')
    setAngle(v)
  }
  const setAwarenessUser = (v: DirectiveOption) => {
    markTouched('awareness')
    setAwareness(v)
  }
  const setSophisticationUser = (v: DirectiveOption) => {
    markTouched('sophistication')
    setSophistication(v)
  }
  const setAudienceUser = (v: DirectiveOption) => {
    markTouched('audience')
    setAudience(v)
  }
  const setOfferUser = (v: DirectiveOption) => {
    markTouched('offer')
    setOffer(v)
  }

  // Debounced: once the brief has enough substance, ask the agent for its picks
  // and apply them to any field the user hasn't manually set.
  useEffect(() => {
    if (!modalOpen || brief.trim().length < 12) return
    const t = setTimeout(async () => {
      setSuggesting(true)
      try {
        const { suggestion } = (await fetch('/api/campaign-reactor/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief, angle }),
        }).then((r) => r.json())) as { suggestion?: ReactorSuggestion }
        if (!suggestion) return
        // Record what the platform recommends — drives the visible badge even if
        // the user later overrides. The angle is free-form (Dynamic Strategy
        // Engine): a sharper angle than the base categories is adopted as-is.
        setRec({
          angle: suggestion.angle || undefined,
          awareness: awarenessOptions.some((x) => x.label === suggestion.awareness)
            ? suggestion.awareness
            : undefined,
          sophistication: sophisticationOptions.some((x) => x.label === suggestion.sophistication)
            ? suggestion.sophistication
            : undefined,
          audience: audienceOptions.some((x) => x.label === suggestion.audience)
            ? suggestion.audience
            : undefined,
          offer: offerOptions.some((x) => x.label === suggestion.offer)
            ? suggestion.offer
            : undefined,
        })
        setAngleReason(suggestion.angleReason || '')
        setAngleConfidence(suggestion.angleConfidence)
        setAngleEvidence(suggestion.evidence ?? null)
        setRecommendedDeliverables(suggestion.deliverables ?? [])
        setDeliverablesReason(suggestion.deliverablesReason || '')

        const touched = touchedRef.current
        // Auto-select the recommendation only where the user hasn't acted.
        if (!touched.has('angle') && suggestion.angle) {
          setAngle(suggestion.angle)
        }
        if (!touched.has('awareness')) {
          const o = awarenessOptions.find((x) => x.label === suggestion.awareness)
          if (o) setAwareness(o)
        }
        if (!touched.has('sophistication')) {
          const o = sophisticationOptions.find((x) => x.label === suggestion.sophistication)
          if (o) setSophistication(o)
        }
        if (!touched.has('audience')) {
          const o = audienceOptions.find((x) => x.label === suggestion.audience)
          if (o) setAudience(o)
        }
        if (!touched.has('offer')) {
          const o = offerOptions.find((x) => x.label === suggestion.offer)
          if (o) setOffer(o)
        }
        if (!touched.has('outputs') && suggestion.deliverables?.length) {
          setOutputs(suggestion.deliverables)
        }
        // Intelligence sources: auto-select what the agents picked (no UI — this
        // feeds OPUS behind the scenes).
        if (suggestion.intelligenceSources?.length && !touched.has('inputs')) {
          setActiveInputs(
            suggestion.intelligenceSources.filter((s) => s.recommended).map((s) => s.id),
          )
        }
      } catch {
        /* suggestion is best-effort — leave fields as they are */
      } finally {
        setSuggesting(false)
      }
    }, 800)
    return () => clearTimeout(t)
    // angle is read as a hint only; excluded from deps to avoid a re-suggest loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, modalOpen])

  // Quick Launch website extraction — pull a business's own offer / audience /
  // positioning off their site and fold it into the brief, so a one-input launch
  // still fires grounded in their real intel. Best-effort; never blocks.
  const extractSite = useCallback(async (rawUrl: string) => {
    try {
      const res = await fetch('/api/campaign-reactor/extract-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl }),
      }).then((r) => r.json())
      if (res?.ok && res.intel) {
        setBrief((prev) => {
          const block = `From ${res.domain}:\n${res.intel}`
          return prev.trim() ? `${prev.trim()}\n\n${block}` : block
        })
        return { ok: true as const, domain: res.domain as string }
      }
      return { ok: false as const, error: (res?.error as string) || 'Could not read that site.' }
    } catch {
      return { ok: false as const, error: 'Could not reach that site. Check the address.' }
    }
  }, [])

  // Fire from the modal — assembles the full ReactorInputs from every step plus
  // the classic payload fields, then posts into the shared SSE pipeline.
  const fire = () => {
    const reactorInputsPayload: ReactorInputs = {
      campaignName,
      brief,
      angle,
      angleIsAgentDecided: angle === NO_PREFERENCE || angle.trim() === '',
      outputTypes: outputs,
      outputTypesAgentDecided: outputs.length === 0,
      dimensions,
      models: deliverableModels,
      variations,
      awarenessStage: awareness.label,
      awarenessDirective: awareness.directive,
      sophisticationStage: sophistication.label,
      sophisticationDirective: sophistication.directive,
      audienceType: audience.label,
      audienceDirective: audience.directive,
      offerType: offer.label,
      offerTypeDirective: offer.directive,
      offerName,
      onBrandEnabled: onBrand,
      brandSettings: defaultBrandSettings,
    }
    // Intelligence sourcing is automatic — use the agent's picks, or the full
    // set when the brief was too thin to produce a recommendation.
    const sources = activeInputs.length ? activeInputs : INTEL_SOURCES.map((s) => s.id)
    streamReactor({
      angle,
      inputs: sources.map(intelSourceLabel),
      outputs: outputs.length ? outputs : reactorOutputTypes,
      videoModel: resolvedVideoModel,
      imageModel: resolvedImageModel,
      metaProvider,
      reactorInputs: reactorInputsPayload,
      // Only sent when a valid test is configured — additive, keeps free
      // generation the default (the reactor ignores an absent isolate block).
      ...(isolate && isolate.values.length > 0 ? { isolate } : {}),
      // Reproduce a cloned reference's structure when one was handed over.
      ...(cloneReference ? { cloneReference } : {}),
    })
  }

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  // A concept whose brief is a moving creative (Video / Testimonial / UGC)
  // renders a video ad; everything else renders a still.
  const isVideoConcept = (c: Concept) => /video|testimonial|ugc/i.test(c.type)

  /**
   * Does this concept carry a visual deliverable that should auto-render?
   *
   * The brief's deliverables are named in the "Creative" vocabulary (Static
   * Creative, Video Creative, UGC Creative, Carousel Creatives, Creative
   * Variations — see `reactorOutputTypes`), while the reactor's internal
   * taxonomy still emits the older "Concept" names (Static / Founder /
   * Testimonial Concept). Both are real, so both must render — gating on the
   * literal word "Concept" silently skipped every live "Static Creative" run
   * and left the card on its "renders when a provider is configured"
   * placeholder with no error to explain it.
   *
   * Copy-only deliverables (Hooks, Headlines) are excluded: they have no
   * production brief to render from. "Montage / Scene Flow" is deliberately
   * excluded too — it has its own Creative Canvas scene pipeline.
   */
  const isVisualConcept = (c: Concept) =>
    /concept|creative/i.test(c.type) && !/hook|headline|primary text|angle/i.test(c.type)

  // The render size for a concept — the first ratio picked on the Formats step
  // for its deliverable family, falling back to the platform defaults.
  const aspectFor = useCallback(
    (c: Concept) => {
      const video = isVideoConcept(c)
      const key = video ? 'Video Creative' : 'Static Creative'
      return dimensions[key]?.[0] ?? (video ? '9:16' : '1:1')
    },
    [dimensions],
  )

  // Thin wrappers: the run logic lives in the persistent provider; here we just
  // thread the current model picks + reference library into each call.
  const runCreative = useCallback(
    (c: Concept) =>
      generateCreative(c, {
        imageModel: resolvedImageModel,
        videoModel: resolvedVideoModel,
        aspectRatio: aspectFor(c),
      }),
    [generateCreative, resolvedImageModel, resolvedVideoModel, aspectFor],
  )
  const runAnimate = (c: Concept, imageUrl: string) =>
    animate(c, imageUrl, { videoModel: resolvedVideoModel })
  const runUGC = (c: Concept) =>
    generateUGC(c, { videoModel: resolvedVideoModel, faceUrls, refVideos })

  // The system creates the ad, not the user: once the run lands, every visual
  // concept renders its creative automatically (when a provider is configured).
  // A new firing resets the ledger so the next run auto-renders too.
  const autoGenRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (phase === 'firing') {
      autoGenRef.current = new Set()
      return
    }
    if (phase !== 'done') return
    const canImage = imageModels.some((m) => m.configured)
    const canVideo = videoModels.some((m) => m.configured)
    for (const c of concepts) {
      if (!isVisualConcept(c)) continue
      if (autoGenRef.current.has(c.text)) continue
      if (isVideoConcept(c) ? !canVideo : !canImage) continue
      autoGenRef.current.add(c.text)
      if (imageFor(c) || videoFor(c)) continue
      runCreative(c)
    }
  }, [phase, concepts, imageModels, videoModels, imageFor, videoFor, runCreative])

  // "Configure in Studio" — carry the concept (copy + creative) into the Studio
  // editor so the user refines a real ad instead of starting from parts.
  const configureInStudio = useCallback((c: Concept) => {
    setStudioSeed(c)
    setView('studio')
  }, [])

  // "Creative Canvas" — take the run into the structured direction layer to
  // shape, branch, and reassign the concept's parts before finishing.
  const launchCanvas = useCallback((_c: Concept) => {
    setCanvasTab(undefined)
    setView('canvas')
  }, [])

  // "Push to Meta" fast lane straight from the card — publishes the concept's
  // launch-ready ad unit (adPackage + rendered still) into the Meta creative
  // library, bypassing the Studio pre-test. Returns a status for inline feedback.
  const pushConceptToMeta = useCallback(
    async (c: Concept): Promise<{ ok: boolean; message: string }> => {
      if (!c.adPackage) {
        return { ok: false, message: 'This concept has no ad package to push.' }
      }
      try {
        const res = await fetch('/api/meta/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pkg: c.adPackage, imageUrl: imageFor(c), name: c.type }),
        }).then((r) => r.json())
        if (res.ok) {
          return {
            ok: true,
            message: `Creative ${res.creativeId ? `#${res.creativeId} ` : ''}is in your Meta library — attach it to an ad set in Ads Manager.`,
          }
        }
        return { ok: false, message: res.error || 'Meta rejected the creative.' }
      } catch {
        return { ok: false, message: 'Could not reach Meta — try again.' }
      }
    },
    [imageFor],
  )

  // Keep the custom audience/offer DirectiveOption in sync with the typed text so
  // its directive instructs OPUS to treat the value as a hard constraint.
  const applyCustomAudience = (v: string) =>
    setAudience({ label: v, directive: customDirective('audience', v) })
  const applyCustomOffer = (v: string) =>
    setOffer({ label: v, directive: customDirective('offer', v) })

  // The four strategic dropdowns, each recommendation-aware and override-friendly.
  const angleField: StrategicField = {
    options: ANGLE_NAMES,
    value: angleCustom || angle === NO_PREFERENCE ? '' : angle,
    recommended: rec.angle ?? null,
    recommendation: rec.angle
      ? { reason: angleReason, confidence: angleConfidence, evidence: angleEvidence }
      : undefined,
    noPreference: angle === NO_PREFERENCE && !angleCustom,
    thinking: suggesting,
    custom: {
      allowed: true,
      active: angleCustom,
      value: customAngle,
      placeholder: 'Name your campaign angle',
      examples: ['Profit Leak', 'Margin Erosion', 'Builder Burnout', 'Owner Dependency'],
    },
    onSelect: (label) => {
      setAngleCustom(false)
      setAngleUser(label)
    },
    onCustom: () => {
      markTouched('angle')
      setAngleCustom(true)
      setAngle(customAngle)
    },
    onCustomChange: (v) => {
      setCustomAngle(v)
      setAngle(v)
    },
    onNoPreference: () => {
      setAngleCustom(false)
      setAngleUser(NO_PREFERENCE)
    },
  }

  const awarenessField: StrategicField = {
    options: awarenessOptions.slice(1).map((o) => o.label),
    descriptions: Object.fromEntries(
      awarenessOptions
        .filter((o) => o.description)
        .map((o) => [o.label, o.description as string]),
    ),
    value: awareness === awarenessOptions[0] ? '' : awareness.label,
    recommended: rec.awareness ?? null,
    noPreference: awareness === awarenessOptions[0],
    thinking: suggesting,
    custom: { allowed: false, active: false, value: '', placeholder: '', examples: [] },
    onSelect: (label) => {
      const o = awarenessOptions.find((x) => x.label === label)
      if (o) setAwarenessUser(o)
    },
    onCustom: () => {},
    onCustomChange: () => {},
    onNoPreference: () => setAwarenessUser(awarenessOptions[0]),
  }

  const sophisticationField: StrategicField = {
    options: sophisticationOptions.slice(1).map((o) => o.label),
    descriptions: Object.fromEntries(
      sophisticationOptions
        .filter((o) => o.description)
        .map((o) => [o.label, o.description as string]),
    ),
    value: sophistication === sophisticationOptions[0] ? '' : sophistication.label,
    recommended: rec.sophistication ?? null,
    noPreference: sophistication === sophisticationOptions[0],
    thinking: suggesting,
    custom: { allowed: false, active: false, value: '', placeholder: '', examples: [] },
    onSelect: (label) => {
      const o = sophisticationOptions.find((x) => x.label === label)
      if (o) setSophisticationUser(o)
    },
    onCustom: () => {},
    onCustomChange: () => {},
    onNoPreference: () => setSophisticationUser(sophisticationOptions[0]),
  }

  const audienceField: StrategicField = {
    options: audienceOptions.slice(1).map((o) => o.label),
    value: audienceCustom || audience === audienceOptions[0] ? '' : audience.label,
    recommended: rec.audience ?? null,
    noPreference: audience === audienceOptions[0] && !audienceCustom,
    thinking: suggesting,
    custom: {
      allowed: true,
      active: audienceCustom,
      value: customAudience,
      placeholder: 'Describe the audience',
      examples: ['Residential Builders', '$2M–$10M Revenue', '5–20 Staff', 'Owner Operators'],
    },
    onSelect: (label) => {
      setAudienceCustom(false)
      const o = audienceOptions.find((x) => x.label === label)
      if (o) setAudienceUser(o)
    },
    onCustom: () => {
      markTouched('audience')
      setAudienceCustom(true)
      applyCustomAudience(customAudience)
    },
    onCustomChange: (v) => {
      setCustomAudience(v)
      applyCustomAudience(v)
    },
    onNoPreference: () => {
      setAudienceCustom(false)
      setAudienceUser(audienceOptions[0])
    },
  }

  const offerField: StrategicField = {
    options: offerOptions.slice(1).map((o) => o.label),
    value: offerCustom || offer === offerOptions[0] ? '' : offer.label,
    recommended: rec.offer ?? null,
    noPreference: offer === offerOptions[0] && !offerCustom,
    thinking: suggesting,
    custom: {
      allowed: true,
      active: offerCustom,
      value: customOffer,
      placeholder: 'Name your offer',
      examples: ['Builder Profit Audit', 'The Owner Freedom Blueprint', 'The 45-Hour Builder System'],
    },
    onSelect: (label) => {
      setOfferCustom(false)
      const o = offerOptions.find((x) => x.label === label)
      if (o) setOfferUser(o)
    },
    onCustom: () => {
      markTouched('offer')
      setOfferCustom(true)
      applyCustomOffer(customOffer)
    },
    onCustomChange: (v) => {
      setCustomOffer(v)
      applyCustomOffer(v)
    },
    onNoPreference: () => {
      setOfferCustom(false)
      setOfferUser(offerOptions[0])
    },
  }

  // Everything the modal renders, threaded from this component's state.
  const form: ReactorForm = {
    campaignName,
    setCampaignName,
    brief,
    setBrief,
    angleField,
    outputTypeList: reactorOutputTypes,
    outputs,
    toggleOutput,
    recommendedDeliverables,
    deliverablesReason,
    dimensions,
    toggleDimension,
    variations,
    setVariations,
    modelMenus,
    montageMenus: montageModelMenus,
    models: deliverableModels,
    setModel: setDeliverableModel,
    awarenessField,
    sophisticationField,
    audienceField,
    offerField,
    offerName,
    setOfferName,
    metaProvider,
    setMetaProvider,
    onBrand,
    setOnBrand,
    suggesting,
    extractSite,
    onFaceChange: handleFaceSelection,
    refCount: faceUrls.length + refVideos.length,
    isolate,
    setIsolate,
    cloneLabel: cloneReference?.sourceLabel ?? (cloneReference ? 'Cloned reference' : null),
  }

  // Everything the live agent workflow needs to keep the production actions
  // (Generate Image/Video, Animate, UGC, Log outcome, Copy) working — the run
  // logic still lives in the persistent provider; these just thread the current
  // model picks, reference library, and angle into each call.
  const workflowControls: WorkflowControls = {
    angle,
    isVideoConcept,
    hasRefs,
    faceCount: faceUrls.length,
    refVideoCount: refVideos.length,
    copied,
    onCopy: copy,
    onAnimate: runAnimate,
    onGenerateUGC: runUGC,
    onConfigureInStudio: configureInStudio,
    onLaunchCanvas: launchCanvas,
    onPushToMeta: pushConceptToMeta,
    onRetry: fire,
  }

  return (
    <div className="space-y-6">
      {/* The brief wizard opens itself on arrival — the top row only carries the
          run status and the output-surface toggle. */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        {phase === 'firing' ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-glow/80">
            <Loader2 size={13} className="animate-spin" /> Reactor firing — agents are working
            through your brief.
          </span>
        ) : phase === 'done' && montageSelected && view !== 'canvas' ? (
          // The montage path lands here: scenes are rendered — hand the whole
          // sequence to the Creative Canvas for shaping, branching, and assembly.
          <button
            type="button"
            onClick={() => {
              setCanvasTab('montage')
              setView('canvas')
            }}
            className="fire-btn fire-btn--md inline-flex items-center gap-2 font-display font-bold uppercase tracking-wide text-white"
          >
            <Workflow size={15} /> Launch in Creative Canvas
          </button>
        ) : (
          <span />
        )}
        {/* Output surface toggle — watch the reactor work, shape the run in the
            Creative Canvas, or finish one ad in the Studio. Full width on a
            phone so each segment clears the touch-target floor. */}
        <div className="inline-flex w-full rounded-full border border-white/10 bg-white/[0.03] p-1 sm:w-auto">
          {(['reactor', 'canvas', 'studio'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (v === 'canvas') setCanvasTab(undefined)
                setView(v)
              }}
              aria-pressed={view === v}
              className={`tap-target flex-1 rounded-full px-3.5 py-2 text-xs font-semibold capitalize transition-colors sm:flex-none sm:min-h-0 sm:py-1.5 ${
                view === v ? 'bg-glow/15 text-glow' : 'text-white/45 hover:text-white/70'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Output — the reactor (autonomous run), the Creative Canvas (structured
          creative direction over the run), or the Studio (finish one ad).
          In reactor mode: before firing, the empty state; once fired, the live
          agent workflow (raw telemetry collapses into a drawer inside it). */}
      {view === 'canvas' ? (
        <CreativeCanvas
          strategy={{
            campaignName,
            angle: angle === NO_PREFERENCE ? undefined : angle,
            awareness: awareness.label,
            sophistication: sophistication.label,
            audience: audience.label,
            offer: offer.label,
            offerName,
            outputs,
            montage: montageSelected,
          }}
          imageModel={resolvedImageModel}
          videoModel={resolvedVideoModel}
          onSendToStudio={configureInStudio}
          onConfigure={() => setModalOpen(true)}
          onExit={() => setView('reactor')}
          initialTab={canvasTab}
        />
      ) : view === 'studio' ? (
        <AdStudio
          offerName={offerName}
          seed={studioSeed}
          onConfigure={() => setModalOpen(true)}
        />
      ) : phase === 'idle' ? (
        <Panel className="min-h-[480px]">
          <PanelHeader
            icon={<Atom size={16} className="animate-pulse-glow" />}
            accent="cyan"
            title="Generated Concepts"
            subtitle="Synthesized from your active intelligence layer"
          />
          <div className="grid place-items-center px-6 py-24 text-center">
            <Atom size={40} className="mb-4 text-white/15" />
            <p className="max-w-sm text-sm text-white/40">
              Answer the campaign brief, then fire the reactor. The agent walks your frameworks,
              retrieves what has already worked, and drafts grounded concepts.
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="ghost-btn mt-5 px-5 py-2.5 text-sm"
            >
              <Atom size={14} /> Open the campaign brief
            </button>
          </div>
        </Panel>
      ) : (
        <LiveAgentWorkflow {...workflowControls} />
      )}

      {/* The shelf under the workbench — finished creatives, kept across
          refreshes. Hidden while the immersive Canvas/Studio views are up so it
          never sits under a full-screen surface. */}
      {view === 'reactor' && <CreativeLedger onOpen={configureInStudio} />}

      <ReactorModal open={modalOpen} onClose={() => setModalOpen(false)} onFire={fire} form={form} />
    </div>
  )
}
