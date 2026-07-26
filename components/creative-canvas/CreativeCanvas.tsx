'use client'

/**
 * Creative Canvas — the structured creative operating layer.
 *
 * Sits between the Campaign Reactor (strategy → scored concepts) and the
 * Studio (one finished Meta ad). The system builds the first strategic
 * structure from the run — one lane per concept, a fixed message spine, scene
 * nodes in montage mode — and the user shapes it: edit, branch, regenerate one
 * node at a time, lock what works, render scenes, then send a lane to the
 * Studio for finishing.
 *
 * Never a blank whiteboard: with no run yet it teaches; with a run it arrives
 * pre-structured. Strategy (angle · awareness · sophistication · audience ·
 * offer) stays pinned at the top and travels with every regeneration.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowRight,
  Atom,
  Check,
  Film,
  GitBranch,
  ImageIcon,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { accentClass } from '@/components/reactor/ui'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'
import type { MetaAdPackage, MetaCta } from '@/lib/meta-ads'
import {
  BRANCH_DY,
  buildCanvasGraph,
  canvasTracks,
  conceptsForTrack,
  isVisualConcept,
  KIND_DEFS,
  MODE_LABELS,
  NODE_W,
  type CanvasMode,
  type CanvasNodeData,
  type CanvasNodeKind,
} from '@/lib/creative-canvas/graph'

/* -------------------------------------------------------------------------- */
/*  Props + shared context                                                    */
/* -------------------------------------------------------------------------- */

export interface CanvasStrategy {
  campaignName?: string
  angle?: string
  awareness?: string
  sophistication?: string
  audience?: string
  offer?: string
  offerName?: string
  outputs?: string[]
  montage?: boolean
}

interface CreativeCanvasProps {
  strategy: CanvasStrategy
  imageModel?: string
  videoModel?: string
  onSendToStudio: (c: Concept) => void
  onConfigure: () => void
  /** Leaves full-screen immersive mode, back to the Reactor. */
  onExit: () => void
  /** Which format tab to land on (e.g. 'montage' when launched via the montage CTA). */
  initialTab?: CanvasMode
}

/** Render state for a visual/scene node's media. */
interface NodeMedia {
  status: 'idle' | 'rendering' | 'animating' | 'done' | 'error'
  imageUrl?: string
  videoUrl?: string
  error?: string
  /** Where this media came from — the Reactor's auto-render, or rendered here. */
  source?: 'reactor' | 'canvas'
}

const IDLE_MEDIA: NodeMedia = { status: 'idle' }

interface CanvasCtx {
  mediaFor: (id: string) => NodeMedia
  renderStill: (id: string) => void
  regenBusy: (id: string) => boolean
}

const Ctx = createContext<CanvasCtx | null>(null)
const useCanvas = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('Canvas node rendered outside CreativeCanvas')
  return ctx
}

type CanvasRFNode = Node<CanvasNodeData>

/** The creative slots a card can be dragged INTO a new role for — every
 * content card supports semantic repositioning: Proof can become the Hook, a
 * Hook can become the CTA, a Scene can become the opener. Only Output is
 * structurally fixed: it is the lane's assembled unit, not a creative role. */
const REASSIGNABLE_KINDS: CanvasNodeKind[] = ['hook', 'message', 'proof', 'visual', 'scene', 'cta']

/** Swap a card's kind label into its title, keeping any " — Alt N" suffix. */
function relabelForKind(kind: CanvasNodeKind, oldTitle: string): string {
  const suffix = oldTitle.match(/—\s*Alt\s*\d+$/)
  return suffix ? `${KIND_DEFS[kind].label} ${suffix[0]}` : KIND_DEFS[kind].label
}

/** A card was dropped onto a different-kind slot — awaiting the user's call
 * on whether the ROLE follows the position (the position swap already applied). */
interface PendingReassign {
  draggedId: string
  targetId: string
  draggedOriginalPos: { x: number; y: number }
  targetOriginalPos: { x: number; y: number }
  draggedKind: CanvasNodeKind
  targetKind: CanvasNodeKind
}

/* -------------------------------------------------------------------------- */
/*  The node card                                                             */
/* -------------------------------------------------------------------------- */

function CanvasNodeView({ id, data, selected }: NodeProps<CanvasRFNode>) {
  const { mediaFor, renderStill, regenBusy } = useCanvas()
  const def = KIND_DEFS[data.kind]
  const media = mediaFor(id)
  const visual = data.kind === 'scene' || data.kind === 'visual'
  // The output node never has its own "render" button — it only ever shows
  // whatever the Reactor already produced for this lane (montage preview).
  const outputPreview = data.kind === 'output' && (media.imageUrl || media.videoUrl || media.status === 'rendering')
  const busy = regenBusy(id)

  return (
    <div
      className={cn('canvas-node', accentClass[def.accent])}
      data-selected={selected}
      data-branch={data.branchIdx > 0}
      data-approved={data.approved}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--acc))]" />
          <span className="acc-text-hi truncate text-[9px] font-bold uppercase tracking-[0.14em]">
            {def.label}
            {data.branchIdx > 0 ? ` · Alt ${data.branchIdx}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {busy && <Loader2 size={11} className="animate-spin text-[#38E8FF]" />}
          {data.locked && <Lock size={10} className="text-white/45" />}
          {data.approved && <Check size={11} className="text-emerald-400" />}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <p className="mb-1 line-clamp-1 text-[11px] font-semibold text-white/85">{data.title}</p>
        <p className="line-clamp-4 whitespace-pre-line text-[11px] leading-snug text-white/60">
          {data.text || <span className="text-white/30">Empty — select to write it.</span>}
        </p>
        {data.sub && <p className="mt-1.5 line-clamp-1 text-[9px] text-white/30">{data.sub}</p>}

        {visual && (
          <div className="mt-2">
            {media.status === 'done' && media.videoUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={media.videoUrl} muted loop playsInline autoPlay className="w-full rounded-lg border border-white/10" />
            ) : media.imageUrl ? (
              <span className="relative block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={media.imageUrl} alt={data.title} className="w-full rounded-lg border border-white/10 object-cover" />
                {(media.status === 'rendering' || media.status === 'animating') && (
                  <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50">
                    <Loader2 size={16} className="animate-spin text-white/80" />
                  </span>
                )}
              </span>
            ) : media.status === 'rendering' ? (
              <span className="grid h-20 w-full place-items-center rounded-lg border border-white/10 bg-white/[0.02]">
                <Loader2 size={15} className="animate-spin text-[#38E8FF]" />
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  renderStill(id)
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] font-semibold text-white/55 transition-colors hover:border-[#38E8FF]/40 hover:text-white"
              >
                <ImageIcon size={11} /> Render this {data.kind}
              </button>
            )}
            {media.status === 'error' && (
              <p className="mt-1 text-[9px] text-warning">{media.error ?? 'Render failed'}</p>
            )}
            {media.source && (
              <p className="mt-1 text-[9px] text-white/25">
                {media.source === 'reactor' ? '⚡ From your run' : '✎ Rendered here'}
              </p>
            )}
          </div>
        )}

        {outputPreview && (
          <div className="mt-2">
            {media.status === 'done' && media.videoUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={media.videoUrl} muted loop playsInline autoPlay className="w-full rounded-lg border border-white/10" />
            ) : media.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.imageUrl} alt={data.title} className="w-full rounded-lg border border-white/10 object-cover" />
            ) : (
              <span className="grid h-16 w-full place-items-center rounded-lg border border-white/10 bg-white/[0.02]">
                <Loader2 size={14} className="animate-spin text-[#38E8FF]" />
              </span>
            )}
            <p className="mt-1 text-[9px] text-white/25">⚡ From your run</p>
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { canvas: CanvasNodeView }

/* -------------------------------------------------------------------------- */
/*  Strategy chips — the pinned intelligence bar                              */
/* -------------------------------------------------------------------------- */

function StrategyChip({ label, value }: { label: string; value?: string }) {
  if (!value || value === 'No Preference') return null
  return (
    <span className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/70">
      <span className="shrink-0 text-white/35">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/*  The Creative Canvas                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Full-screen immersive mode (hard rule) — the Creative Canvas takes over the
 * entire viewport the moment it mounts. Portaled to document.body so it visibly
 * covers the platform sidebar/topbar rather than living inside the dashboard's
 * `command-surface` column; body scroll is locked while it's open; Escape (or
 * the Exit control) hands control back to the Reactor.
 */
export function CreativeCanvas(props: CreativeCanvasProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Escape-to-exit lives in the active tab's CanvasInner (layered: it closes
    // a context menu or clears a selection first, and only exits full-screen
    // once nothing else is open) — this effect only owns the scroll lock.
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  if (!mounted) return null

  return createPortal(
    <div className="canvas-immersive fixed inset-0 z-[100]">
      <CampaignShell {...props} />
    </div>,
    document.body,
  )
}

/**
 * The campaign shell — ONE campaign, ONE shared strategy layer, one format
 * tab per selected deliverable family. The strategy bar and chip row are
 * campaign-level (they power every format identically); each tab below is a
 * self-contained canvas with its own mode-specific node structure. Tabs are
 * lazy-mounted on first visit and kept alive after, so switching formats
 * never loses in-progress edits, branches, or renders.
 */
function CampaignShell({
  strategy,
  imageModel,
  videoModel,
  onSendToStudio,
  onConfigure,
  onExit,
  initialTab,
}: CreativeCanvasProps) {
  const { concepts } = useReactorRun()
  const tracks = useMemo(
    () => canvasTracks(strategy.outputs, Boolean(strategy.montage)),
    [strategy.outputs, strategy.montage],
  )
  const [active, setActive] = useState<CanvasMode>(() =>
    initialTab && tracks.some((t) => t.id === initialTab) ? initialTab : tracks[0].id,
  )
  // Tabs mount on first visit and stay mounted (hidden) after — React Flow
  // must be visible at mount to measure, and kept-alive tabs preserve edits.
  const [visited, setVisited] = useState<Set<CanvasMode>>(() => new Set([active]))

  useEffect(() => {
    if (!tracks.some((t) => t.id === active)) {
      setActive(tracks[0].id)
      setVisited((v) => new Set(v).add(tracks[0].id))
    }
  }, [tracks, active])

  const selectTab = (id: CanvasMode) => {
    setActive(id)
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)))
  }

  /* ------------------------------- Empty state ------------------------------ */
  if (concepts.length === 0) {
    return (
      <div className="canvas-shell relative grid h-full w-full place-items-center p-8 text-center">
        <button
          type="button"
          onClick={onExit}
          className="absolute right-5 top-5 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-semibold text-white/55 transition-colors hover:border-white/25 hover:text-white"
        >
          <X size={13} /> Exit Canvas
        </button>
        <div className="canvas-lift w-full max-w-3xl">
          <span className="mx-auto mb-8 grid h-20 w-20 place-items-center rounded-3xl border border-[#4D8DFF]/30 bg-gradient-to-br from-[#4D8DFF]/[0.14] to-transparent shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_24px_60px_-30px_rgba(56,232,255,0.55)] backdrop-blur-xl">
            <Workflow size={38} className="text-[#38E8FF]" />
          </span>
          <h3 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
            The Creative Canvas
          </h3>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">
            Where strategy becomes creative structure. Fire the reactor and the system builds the
            first structure for you — hooks, message, proof, scenes, and CTA as connected nodes you
            can shape, branch, and regenerate one piece at a time.
          </p>
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
            {[
              { Icon: Sparkles, t: 'Pre-structured', d: 'Never a blank board — the run arrives organized.' },
              { Icon: GitBranch, t: 'Branch', d: 'Alternate hooks and CTAs as controlled variants.' },
              { Icon: RefreshCw, t: 'Regenerate', d: 'One node at a time, strategy held constant.' },
            ].map(({ Icon, t, d }) => (
              <div
                key={t}
                className="group relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-white/[0.12] via-white/[0.04] to-transparent p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-30px_50px_-30px_rgba(0,0,0,0.5),0_24px_60px_-34px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all duration-300 hover:-translate-y-1 hover:border-[#4D8DFF]/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_28px_64px_-30px_rgba(56,232,255,0.4)]"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-[#4D8DFF]/25 bg-[#4D8DFF]/[0.08]">
                  <Icon size={20} className="text-[#38E8FF]" />
                </span>
                <p className="text-sm font-semibold text-white">{t}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/45">{d}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onConfigure}
            className="mt-10 inline-flex items-center gap-2 rounded-full border border-[#4D8DFF]/35 bg-gradient-to-br from-[#4D8DFF]/20 to-[#4D8DFF]/[0.06] px-7 py-3.5 text-base font-semibold text-[#38E8FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_44px_-26px_rgba(56,232,255,0.6)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-[#4D8DFF]/55 hover:from-[#4D8DFF]/30"
          >
            <Atom size={16} /> Open the campaign brief
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="canvas-shell flex h-full w-full flex-col rounded-none border-0">
      {/* --------------------- Campaign bar (shared) --------------------- */}
      <div className="canvas-lift flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.26em] text-[#38E8FF]/80">
            <Workflow size={13} /> Creative Canvas
          </span>
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <span className="truncate font-display text-sm font-semibold text-white">
            {strategy.campaignName?.trim() || 'Untitled campaign'}
          </span>
          {tracks.length > 1 ? (
            // One campaign → one tab per selected format. Same strategy layer
            // powers every tab; only the creative flow inside differs.
            <div className="inline-flex rounded-full border border-[#4D8DFF]/25 bg-white/[0.04] p-1">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTab(t.id)}
                  aria-pressed={active === t.id}
                  className={cn(
                    'rounded-full px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    active === t.id
                      ? 'bg-[#4D8DFF]/[0.16] text-[#38E8FF]'
                      : 'text-white/45 hover:text-white/75',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="inline-flex items-center rounded-full border border-[#4D8DFF]/30 bg-[#4D8DFF]/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#38E8FF]">
              {MODE_LABELS[tracks[0].id]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onConfigure}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.03] px-3.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:border-white/25 hover:text-white"
          >
            <SlidersHorizontal size={12} /> Re-brief
          </button>
          <button
            type="button"
            onClick={onExit}
            title="Exit Canvas (Esc)"
            className="grid h-8 w-8 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Shared strategy layer — pinned once, powering every format tab */}
      <div className="canvas-lift flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-5 py-2.5">
        <StrategyChip label="Angle" value={strategy.angle} />
        <StrategyChip label="Awareness" value={strategy.awareness} />
        <StrategyChip label="Sophistication" value={strategy.sophistication} />
        <StrategyChip label="Audience" value={strategy.audience} />
        <StrategyChip label="Offer" value={strategy.offerName?.trim() || strategy.offer} />
      </div>

      {/* ---------------- Format tabs — one canvas per format ---------------- */}
      {tracks
        .filter((t) => visited.has(t.id))
        .map((t) => (
          <div
            key={t.id}
            className={cn('canvas-lift min-h-0 flex-1 flex-col', active === t.id ? 'flex' : 'hidden')}
          >
            <ReactFlowProvider>
              <CanvasInner
                mode={t.id}
                concepts={conceptsForTrack(concepts, t.id)}
                active={active === t.id}
                strategy={strategy}
                imageModel={imageModel}
                videoModel={videoModel}
                onSendToStudio={onSendToStudio}
                onExit={onExit}
              />
            </ReactFlowProvider>
          </div>
        ))}
    </div>
  )
}

interface CanvasInnerProps {
  mode: CanvasMode
  concepts: Concept[]
  /** Whether this tab is the visible one — gates keyboard handling. */
  active: boolean
  strategy: CanvasStrategy
  imageModel?: string
  videoModel?: string
  onSendToStudio: (c: Concept) => void
  onExit: () => void
}

function CanvasInner({ mode, concepts, active, strategy, imageModel, videoModel, onSendToStudio, onExit }: CanvasInnerProps) {
  const { imageFor, videoFor, creativeStateFor } = useReactorRun()

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasRFNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [media, setMedia] = useState<Record<string, NodeMedia>>({})
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({})
  const [direction, setDirection] = useState('')

  /* ------------------- Build the opening structure per run ------------------ */
  const rf = useReactFlow()
  const builtKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${mode}:${concepts.map((c) => c.text).join('|')}`
    if (!concepts.length || builtKeyRef.current === key) return
    builtKeyRef.current = key
    const graph = buildCanvasGraph(concepts, mode)
    setNodes(
      graph.nodes.map((n) => ({ id: n.id, position: n.position, data: n.data, type: 'canvas' as const })),
    )
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep' as const,
        className: e.branch ? 'canvas-edge-branch' : undefined,
      })),
    )
    setSelectedId(null)
    setMedia({})
    // Land the viewport on the opening of the first lane at a readable zoom —
    // the rest of the structure is one pan away, never a wall of tiny cards.
    const opening = graph.nodes
      .filter((n) => n.data.lane === 0)
      .slice(0, 4)
      .map((n) => ({ id: n.id }))
    window.setTimeout(() => {
      void rf.fitView({ nodes: opening, padding: 0.2, maxZoom: 0.9, duration: 500 })
    }, 300)
  }, [concepts, mode, setNodes, setEdges, rf])

  const laneConcepts = useMemo(() => {
    const lanes = concepts.filter(isVisualConcept).slice(0, 4)
    if (lanes.length === 0 && concepts.length > 0) {
      lanes.push([...concepts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0])
    }
    return lanes
  }, [concepts])

  // Nodes whose media has been touched by a manual render/animate in the
  // Canvas — once a user renders their own take, the Reactor's auto-generated
  // creative must never silently overwrite it again.
  const manualMediaRef = useRef<Set<string>>(new Set())

  /* --------------- Seed cards from what the Reactor already rendered -------- *
   * The Reactor auto-generates one creative per concept the moment a run
   * lands (Workbench's auto-gen effect). That asset belongs on the lane's
   * primary visual node (non-montage) or the output node (montage, where the
   * single combined render is a preview — each scene still renders on its
   * own). This keeps the Canvas from ever opening on empty cards when the
   * work already exists. */
  useEffect(() => {
    const targetKind: CanvasNodeKind = mode === 'montage' ? 'output' : 'visual'
    setMedia((prev) => {
      let changed = false
      const next = { ...prev }
      laneConcepts.forEach((c, lane) => {
        const nodeId = nodes.find(
          (n) => n.data.lane === lane && n.data.kind === targetKind && n.data.branchIdx === 0,
        )?.id
        if (!nodeId || manualMediaRef.current.has(nodeId)) return
        const img = imageFor(c)
        const vid = videoFor(c)
        const state = creativeStateFor(c)
        const rendering = state?.status === 'working' || vid?.status === 'rendering'
        const videoUrl = vid?.status === 'done' ? vid.url : undefined
        const desired: NodeMedia = videoUrl
          ? { status: 'done', videoUrl, imageUrl: img, source: 'reactor' }
          : img
            ? { status: 'done', imageUrl: img, source: 'reactor' }
            : rendering
              ? { status: 'rendering', source: 'reactor' }
              : IDLE_MEDIA
        const existing = prev[nodeId]
        if (
          !existing ||
          existing.status !== desired.status ||
          existing.imageUrl !== desired.imageUrl ||
          existing.videoUrl !== desired.videoUrl
        ) {
          next[nodeId] = desired
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [laneConcepts, mode, nodes, imageFor, videoFor, creativeStateFor])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  /* ------------------------------ Node helpers ------------------------------ */

  const patchNode = useCallback(
    (id: string, patch: Partial<CanvasNodeData>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)))
    },
    [setNodes],
  )

  /** The lane's kept context for a coherent single-node regeneration. */
  const laneContext = useCallback(
    (lane: number, excludeId: string) =>
      nodes
        .filter((n) => n.data.lane === lane && n.id !== excludeId && n.data.text.trim())
        .filter((n) => n.data.branchIdx === 0 || n.data.approved)
        .map((n) => `${n.data.title}: ${n.data.text}`)
        .slice(0, 6),
    [nodes],
  )

  /** Shared regeneration call — kind/title/text passed explicitly so a card
   * that just changed role (semantic reassignment) can regenerate INTO its
   * new role without waiting on a state read-back. */
  const runRegenerate = useCallback(
    async (id: string, lane: number, kind: CanvasNodeKind, title: string, currentText: string) => {
      setRegenerating((r) => ({ ...r, [id]: true }))
      try {
        const res = await fetch('/api/canvas/regenerate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind,
            title,
            current: currentText,
            strategy,
            context: laneContext(lane, id),
            direction: direction.trim() || undefined,
          }),
        }).then((r) => r.json())
        if (res.ok && res.text) patchNode(id, { text: res.text })
      } catch {
        /* regeneration is best-effort — the current version stands */
      } finally {
        setRegenerating((r) => ({ ...r, [id]: false }))
      }
    },
    [strategy, laneContext, direction, patchNode],
  )

  const regenerate = useCallback(
    async (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node || node.data.locked || regenerating[id]) return
      void runRegenerate(id, node.data.lane, node.data.kind, node.data.title, node.data.text)
    },
    [nodes, regenerating, runRegenerate],
  )

  /* --------------------- Semantic reassignment on drag ---------------------- *
   * Structured freedom: cards can be dragged anywhere, but dropping a card
   * onto a different-kind slot in its own lane means the user may be asking
   * it to take on that slot's role. The position swap always happens; the
   * ROLE only changes if the user confirms it in the modal. */

  const dragOriginRef = useRef<Record<string, { x: number; y: number }>>({})

  const onNodeDragStart = useCallback((_: unknown, node: CanvasRFNode) => {
    dragOriginRef.current[node.id] = { x: node.position.x, y: node.position.y }
  }, [])

  const onNodeDragStop = useCallback(
    (_: unknown, node: CanvasRFNode) => {
      const origin = dragOriginRef.current[node.id]
      delete dragOriginRef.current[node.id]
      if (!origin) return
      // Only primary cards can change role — alternates are for comparing and
      // approving, not relocating into a different slot. The DRAGGED card can
      // be any kind (a Proof card dropped onto Hook is the signature case);
      // only the TARGET's slot is restricted to positions a card can become.
      if (node.data.branchIdx > 0 || node.data.kind === 'output') return
      const target = nodes.find(
        (n) =>
          n.id !== node.id &&
          n.data.lane === node.data.lane &&
          n.data.branchIdx === 0 &&
          n.data.kind !== node.data.kind &&
          REASSIGNABLE_KINDS.includes(n.data.kind) &&
          Math.hypot(n.position.x - node.position.x, n.position.y - node.position.y) < NODE_W * 0.65,
      )
      if (!target) return
      const targetOrigin = { x: target.position.x, y: target.position.y }
      // The visual move always applies immediately; the modal below only
      // decides whether the semantic ROLE follows the new position.
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === node.id) return { ...n, position: targetOrigin }
          if (n.id === target.id) return { ...n, position: origin }
          return n
        }),
      )
      setPendingReassign({
        draggedId: node.id,
        targetId: target.id,
        draggedOriginalPos: origin,
        targetOriginalPos: targetOrigin,
        draggedKind: node.data.kind,
        targetKind: target.data.kind,
      })
    },
    [nodes, setNodes],
  )

  const resolveReassign = useCallback(
    (choice: 'cosmetic' | 'reassign' | 'reassignRegenerate' | 'cancel') => {
      const p = pendingReassign
      if (!p) return
      if (choice === 'cancel') {
        setNodes((ns) =>
          ns.map((n) => {
            if (n.id === p.draggedId) return { ...n, position: p.draggedOriginalPos }
            if (n.id === p.targetId) return { ...n, position: p.targetOriginalPos }
            return n
          }),
        )
        setPendingReassign(null)
        return
      }
      if (choice === 'cosmetic') {
        setPendingReassign(null)
        return
      }
      // reassign / reassignRegenerate — the two cards trade kind + title.
      const draggedNode = nodes.find((n) => n.id === p.draggedId)
      const targetNode = nodes.find((n) => n.id === p.targetId)
      const draggedTitle = draggedNode ? relabelForKind(p.targetKind, draggedNode.data.title) : KIND_DEFS[p.targetKind].label
      const targetTitle = targetNode ? relabelForKind(p.draggedKind, targetNode.data.title) : KIND_DEFS[p.draggedKind].label
      setNodes((ns) =>
        ns.map((n) => {
          // A role change unlocks the card — its old lock guarded the old
          // role's content, not the new one.
          if (n.id === p.draggedId) return { ...n, data: { ...n.data, kind: p.targetKind, title: draggedTitle, locked: false } }
          if (n.id === p.targetId) return { ...n, data: { ...n.data, kind: p.draggedKind, title: targetTitle, locked: false } }
          return n
        }),
      )
      if (choice === 'reassignRegenerate') {
        if (draggedNode) void runRegenerate(p.draggedId, draggedNode.data.lane, p.targetKind, draggedTitle, draggedNode.data.text)
        if (targetNode) void runRegenerate(p.targetId, targetNode.data.lane, p.draggedKind, targetTitle, targetNode.data.text)
      }
      setPendingReassign(null)
    },
    [pendingReassign, nodes, setNodes, runRegenerate],
  )

  /** Branch: a controlled alternate stacked under the original, dashed in. */
  const branchNode = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id)
      if (!src) return
      const siblings = nodes.filter(
        (n) => n.data.lane === src.data.lane && n.data.kind === src.data.kind,
      )
      const idx = siblings.length
      const altId = `${id}-alt${idx}`
      const baseTitle = src.data.title.replace(/ — Alt \d+$/, '')
      setNodes((ns) => [
        ...ns,
        {
          id: altId,
          type: 'canvas' as const,
          position: { x: src.position.x + 24, y: src.position.y + BRANCH_DY * idx },
          data: {
            ...src.data,
            title: `${baseTitle} — Alt ${idx}`,
            branchIdx: idx,
            approved: false,
            locked: false,
          },
        },
      ])
      setEdges((es) => {
        const incoming = es.filter((e) => e.target === id)
        const outgoing = es.filter((e) => e.source === id)
        return [
          ...es,
          ...incoming.map((e) => ({
            id: `${e.source}→${altId}`,
            source: e.source,
            target: altId,
            type: 'smoothstep' as const,
            className: 'canvas-edge-branch',
          })),
          ...outgoing.map((e) => ({
            id: `${altId}→${e.target}`,
            source: altId,
            target: e.target,
            type: 'smoothstep' as const,
            className: 'canvas-edge-branch',
          })),
        ]
      })
      setSelectedId(altId)
    },
    [nodes, setNodes, setEdges],
  )

  /** Approve an alternate — it becomes the lane's active take for its kind. */
  const approveNode = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node) return
      const next = !node.data.approved
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id === id) return { ...n, data: { ...n.data, approved: next } }
          if (n.data.lane === node.data.lane && n.data.kind === node.data.kind && next)
            return { ...n, data: { ...n.data, approved: false } }
          return n
        }),
      )
    },
    [nodes, setNodes],
  )

  /** Remove an alternate or a scene, reconnecting the spine around it. */
  const removeNode = useCallback(
    (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node) return
      const incoming = edges.filter((e) => e.target === id)
      const outgoing = edges.filter((e) => e.source === id)
      setNodes((ns) => ns.filter((n) => n.id !== id))
      setEdges((es) => {
        const kept = es.filter((e) => e.source !== id && e.target !== id)
        // Scenes sit on the spine — heal it so the sequence stays connected.
        if (node.data.kind === 'scene' && node.data.branchIdx === 0) {
          for (const i of incoming)
            for (const o of outgoing)
              kept.push({ id: `${i.source}→${o.target}`, source: i.source, target: o.target, type: 'smoothstep' as const })
        }
        return kept
      })
      if (selectedId === id) setSelectedId(null)
    },
    [nodes, edges, setNodes, setEdges, selectedId],
  )

  /** Insert a fresh scene right after the selected one (montage shaping). */
  const addSceneAfter = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id)
      if (!src || src.data.kind !== 'scene') return
      const newId = `${id}-plus-${Date.now().toString(36)}`
      const lane = src.data.lane
      // Make room: everything on this lane to the right shifts one column.
      setNodes((ns) => [
        ...ns.map((n) =>
          n.data.lane === lane && n.position.x > src.position.x && n.data.branchIdx === 0
            ? { ...n, position: { ...n.position, x: n.position.x + NODE_W + 60 } }
            : n,
        ),
        {
          id: newId,
          type: 'canvas' as const,
          position: { x: src.position.x + NODE_W + 60, y: src.position.y },
          data: {
            ...src.data,
            title: 'New scene',
            text: '',
            sub: src.data.sub,
            approved: false,
            locked: false,
            branchIdx: 0,
            sceneIdx: (src.data.sceneIdx ?? 0) + 1,
          },
        },
      ])
      setEdges((es) => {
        const out = es.find((e) => e.source === id && !es.some((x) => x.id === e.id && x.className))
        const kept = es.filter((e) => e.id !== out?.id)
        kept.push({ id: `${id}→${newId}`, source: id, target: newId, type: 'smoothstep' as const })
        if (out) kept.push({ id: `${newId}→${out.target}`, source: newId, target: out.target, type: 'smoothstep' as const })
        return kept
      })
      setSelectedId(newId)
    },
    [nodes, setNodes, setEdges],
  )

  /* ------------------------------- Rendering -------------------------------- */

  const aspectRatio = mode === 'static' ? '1:1' : '9:16'

  const renderStill = useCallback(
    async (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node) return
      manualMediaRef.current.add(id)
      setMedia((m) => ({ ...m, [id]: { status: 'rendering', source: 'canvas' } }))
      try {
        const prompt = `${node.data.prompt ?? node.data.text}\n\nRender as a premium Meta ad creative for The Professional Builder — photographic, on-site builder context, high contrast, room for text overlay.${strategy.angle ? ` Campaign angle: ${strategy.angle}.` : ''}`
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, aspectRatio, model: imageModel }),
        }).then((r) => r.json())
        if (res.success && res.imageUrl) {
          setMedia((m) => ({ ...m, [id]: { status: 'done', imageUrl: res.imageUrl, source: 'canvas' } }))
        } else {
          setMedia((m) => ({
            ...m,
            [id]: {
              status: 'error',
              error: res.error || (res.demo ? 'No image key set — add FAL_KEY or HF_CREDENTIALS' : 'Render failed'),
            },
          }))
        }
      } catch {
        setMedia((m) => ({ ...m, [id]: { status: 'error', error: 'Render failed' } }))
      }
    },
    [nodes, aspectRatio, imageModel, strategy.angle],
  )

  const pollVideo = useCallback(async (id: string, requestId: string, model?: string, responseUrl?: string) => {
    const q = `${model ? `&model=${encodeURIComponent(model)}` : ''}${responseUrl ? `&responseUrl=${encodeURIComponent(responseUrl)}` : ''}`
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      try {
        const res = await fetch(`/api/generate-video?requestId=${encodeURIComponent(requestId)}${q}`).then((r) => r.json())
        if (res.status === 'completed' && res.videoUrl) {
          setMedia((m) => ({ ...m, [id]: { ...m[id], status: 'done', videoUrl: res.videoUrl } }))
          return
        }
        if (res.status === 'failed' || res.status === 'nsfw') {
          setMedia((m) => ({ ...m, [id]: { ...m[id], status: 'error', error: 'Animation failed' } }))
          return
        }
      } catch {
        /* transient — keep polling */
      }
    }
    setMedia((m) => ({ ...m, [id]: { ...m[id], status: 'error', error: 'Animation timed out' } }))
  }, [])

  const animateScene = useCallback(
    async (id: string) => {
      const node = nodes.find((n) => n.id === id)
      const still = media[id]?.imageUrl
      if (!node) return
      manualMediaRef.current.add(id)
      setMedia((m) => ({ ...m, [id]: { ...m[id], status: 'animating', source: 'canvas' } }))
      try {
        const body = still
          ? { imageUrl: still, mode: 'image-to-video', model: videoModel, aspectRatio, prompt: node.data.text }
          : { prompt: node.data.text, mode: 'text-to-video', model: videoModel, aspectRatio }
        const res = await fetch('/api/generate-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json())
        if (res.success && res.requestId) {
          void pollVideo(id, res.requestId, res.modelId, res.responseUrl)
        } else {
          setMedia((m) => ({
            ...m,
            [id]: {
              ...m[id],
              status: 'error',
              error: res.error || (res.demo ? 'No video key set — add FAL_KEY or HF_CREDENTIALS' : 'Animation failed'),
            },
          }))
        }
      } catch {
        setMedia((m) => ({ ...m, [id]: { ...m[id], status: 'error', error: 'Animation failed' } }))
      }
    },
    [nodes, media, videoModel, aspectRatio, pollVideo],
  )

  /* ---------------------------- Send to Studio ------------------------------ */

  /** The lane's active take for a kind — the approved alternate, else primary. */
  const activeText = useCallback(
    (lane: number, kind: CanvasNodeKind): string => {
      const pool = nodes.filter((n) => n.data.lane === lane && n.data.kind === kind)
      const chosen = pool.find((n) => n.data.approved) ?? pool.find((n) => n.data.branchIdx === 0)
      return chosen?.data.text.trim() ?? ''
    },
    [nodes],
  )

  const sendLaneToStudio = useCallback(
    (lane: number) => {
      const src = laneConcepts[lane]
      if (!src) return
      const hook = activeText(lane, 'hook')
      const message = activeText(lane, 'message')
      const headline = activeText(lane, 'cta')
      const primaryText = [hook, message].filter(Boolean).join('\n\n') || src.text
      const pkg: MetaAdPackage = {
        primaryText,
        headline: headline || src.adPackage?.headline || 'The Professional Builder',
        description: src.adPackage?.description,
        cta: (src.adPackage?.cta ?? 'LEARN_MORE') as MetaCta,
      }
      onSendToStudio({ ...src, text: primaryText, adPackage: pkg })
    },
    [laneConcepts, activeText, onSendToStudio],
  )

  /* ------------------------------ Keyboard shortcuts ------------------------ *
   * Delete/Backspace removes the selected alternate or scene; Cmd/Ctrl+D
   * duplicates (branches) it. Escape is layered so one press does the most
   * local thing: close the context menu, else clear the selection, else exit
   * full-screen Canvas — never more than one of those per press. While the
   * reassignment modal is open, Escape does nothing; that decision needs an
   * explicit choice. Ignored while typing in the detail panel's fields. */
  useEffect(() => {
    // Only the visible format tab listens — hidden kept-alive tabs must never
    // swallow (or double-handle) the campaign's keyboard input.
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (e.key === 'Escape' && !typing) {
        if (contextMenu) setContextMenu(null)
        else if (pendingReassign) return
        else if (selectedId) setSelectedId(null)
        else onExit()
        return
      }
      if (typing || !selectedId) return
      const node = nodes.find((n) => n.id === selectedId)
      if (!node) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && (node.data.branchIdx > 0 || node.data.kind === 'scene')) {
        e.preventDefault()
        removeNode(selectedId)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && KIND_DEFS[node.data.kind].branch) {
        e.preventDefault()
        branchNode(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selectedId, nodes, removeNode, branchNode, contextMenu, pendingReassign, onExit])

  /* --------------------------------- Canvas --------------------------------- */

  const def = selected ? KIND_DEFS[selected.data.kind] : null

  return (
    <Ctx.Provider value={{ mediaFor: (id) => media[id] ?? IDLE_MEDIA, renderStill, regenBusy: (id) => Boolean(regenerating[id]) }}>
      <div className="relative flex h-full min-h-0 flex-1 flex-col">
        {/* --------------------- Canvas + detail panel --------------------- */}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="relative min-h-0">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => {
                setSelectedId(null)
                setContextMenu(null)
              }}
              onNodeDragStart={onNodeDragStart}
              onNodeDragStop={onNodeDragStop}
              onNodeContextMenu={(e, n) => {
                e.preventDefault()
                setSelectedId(n.id)
                // Anchor to the card's own on-screen rect rather than the
                // synthetic event's clientX/Y, which xyflow can report in
                // flow-space rather than viewport-space depending on zoom/pan.
                const cardEl = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node')
                const rect = cardEl?.getBoundingClientRect()
                const x = rect ? Math.min(rect.left + 12, window.innerWidth - 210) : e.clientX
                const y = rect ? Math.min(rect.top + 12, window.innerHeight - 260) : e.clientY
                setContextMenu({ id: n.id, x, y })
              }}
              minZoom={0.25}
              maxZoom={1.4}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Cross} gap={30} size={3} color="rgba(255,150,110,0.10)" />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </div>

          {/* ------------------------- Detail panel ------------------------- */}
          <aside className="hidden min-h-0 overflow-y-auto border-l border-white/[0.08] p-4 lg:block">
            {!selected || !def ? (
              <div className="space-y-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                  Direction Deck
                </p>
                <p className="text-xs leading-relaxed text-white/45">
                  The system built this structure from your run — every lane is one concept, left to
                  right: hook → message → proof → {mode === 'montage' ? 'scenes' : 'visual'} → CTA →
                  output. Select any node to shape it.
                </p>
                <ul className="space-y-2">
                  {[
                    ['Edit', 'Rewrite any node by hand — your words always win.'],
                    ['Regenerate', 'One node at a time; strategy and locked nodes are held constant.'],
                    ['Branch', 'Spin controlled alternates of a hook or CTA, then approve the winner.'],
                    ['Drag to reassign', 'Every card is movable — drop any card onto any other slot and the system asks whether its ROLE should follow. Proof can become the Hook, a Hook can become the CTA.'],
                    ['Render', 'Scenes and visuals render stills, then animate into clips.'],
                    ['Send to Studio', 'The active lane becomes a launch-ready Meta ad unit.'],
                  ].map(([t, d]) => (
                    <li key={t} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                      <p className="text-[11px] font-semibold text-white/80">{t}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-white/40">{d}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] leading-snug text-white/30">
                  Right-click any card for quick actions. ⌘/Ctrl+D duplicates the selected card;
                  Delete removes an alternate or scene.
                </p>
                <button
                  type="button"
                  onClick={() => sendLaneToStudio(0)}
                  className="fire-btn fire-btn--sm inline-flex w-full items-center justify-center gap-1.5 font-bold uppercase tracking-wide text-white"
                >
                  Send to Studio <ArrowRight size={12} />
                </button>
              </div>
            ) : (
              <div className={cn('space-y-3.5', accentClass[def.accent])}>
                <div>
                  <p className="acc-text-hi flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--acc))]" /> {def.label}
                  </p>
                  <p className="mt-1 font-display text-sm font-semibold text-white">{selected.data.title}</p>
                  <p className="mt-0.5 text-[10px] text-white/35">{def.hint}</p>
                </div>

                <textarea
                  value={selected.data.text}
                  onChange={(e) => patchNode(selected.id, { text: e.target.value })}
                  disabled={selected.data.locked}
                  rows={selected.data.kind === 'cta' ? 2 : 7}
                  placeholder={def.hint}
                  className="w-full resize-none rounded-xl border border-white/12 bg-white/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-white placeholder:text-white/25 outline-none transition-colors focus:border-[#38E8FF]/40 disabled:opacity-50"
                />

                {def.regen && (
                  <input
                    value={direction}
                    onChange={(e) => setDirection(e.target.value)}
                    placeholder={`Optional steer — e.g. "harder on identity, no numbers"`}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white placeholder:text-white/25 outline-none transition-colors focus:border-[#38E8FF]/35"
                  />
                )}

                <div className="grid grid-cols-2 gap-2">
                  {def.regen && (
                    <button
                      type="button"
                      onClick={() => regenerate(selected.id)}
                      disabled={selected.data.locked || Boolean(regenerating[selected.id])}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#4D8DFF]/30 bg-[#4D8DFF]/[0.08] px-3 py-2 text-[11px] font-semibold text-[#38E8FF] transition-colors hover:bg-[#4D8DFF]/15 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {regenerating[selected.id] ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      Regenerate
                    </button>
                  )}
                  {def.branch && (
                    <button
                      type="button"
                      onClick={() => branchNode(selected.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/65 transition-colors hover:border-white/25 hover:text-white"
                    >
                      <GitBranch size={12} /> Branch
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => patchNode(selected.id, { locked: !selected.data.locked })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/65 transition-colors hover:border-white/25 hover:text-white"
                  >
                    {selected.data.locked ? <LockOpen size={12} /> : <Lock size={12} />}
                    {selected.data.locked ? 'Unlock' : 'Lock'}
                  </button>
                  <button
                    type="button"
                    onClick={() => approveNode(selected.id)}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition-colors',
                      selected.data.approved
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                        : 'border-white/12 bg-white/[0.03] text-white/65 hover:border-emerald-400/35 hover:text-emerald-300',
                    )}
                  >
                    <Check size={12} /> {selected.data.approved ? 'Approved' : 'Approve'}
                  </button>
                  {selected.data.kind === 'scene' && (
                    <button
                      type="button"
                      onClick={() => addSceneAfter(selected.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/65 transition-colors hover:border-white/25 hover:text-white"
                    >
                      <Plus size={12} /> Add scene after
                    </button>
                  )}
                  {(selected.data.branchIdx > 0 || selected.data.kind === 'scene') && (
                    <button
                      type="button"
                      onClick={() => removeNode(selected.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/50 transition-colors hover:border-danger/40 hover:text-danger"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                  )}
                </div>

                {(selected.data.kind === 'scene' || selected.data.kind === 'visual') && (
                  <div className="space-y-2 border-t border-white/[0.07] pt-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
                      Production
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => renderStill(selected.id)}
                        disabled={media[selected.id]?.status === 'rendering'}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/65 transition-colors hover:border-[#38E8FF]/40 hover:text-white disabled:opacity-45"
                      >
                        <ImageIcon size={12} /> Render still
                      </button>
                      <button
                        type="button"
                        onClick={() => animateScene(selected.id)}
                        disabled={media[selected.id]?.status === 'animating'}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold text-white/65 transition-colors hover:border-[#38E8FF]/40 hover:text-white disabled:opacity-45"
                      >
                        <Film size={12} /> Animate
                      </button>
                    </div>
                    <p className="text-[10px] leading-snug text-white/30">
                      Stills render on {imageModel ?? 'the best configured model'}; animation runs on{' '}
                      {videoModel ?? 'the best configured model'} at {aspectRatio}.
                    </p>
                  </div>
                )}

                {selected.data.sub && (
                  <p className="border-t border-white/[0.07] pt-3 text-[10px] leading-snug text-white/35">
                    {selected.data.sub}
                  </p>
                )}
                {typeof selected.data.score === 'number' && (
                  <p className="text-[10px] text-white/35">
                    Lane rubric score:{' '}
                    <span className="font-semibold text-white/60">{selected.data.score}/10</span>
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => sendLaneToStudio(selected.data.lane)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#4D8DFF]/30 bg-[#4D8DFF]/[0.08] px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[#38E8FF] transition-colors hover:bg-[#4D8DFF]/15"
                >
                  Send this lane to Studio <ArrowRight size={12} />
                </button>
              </div>
            )}
          </aside>
        </div>

        {/* --------------------- Semantic reassignment modal --------------------- */}
        {pendingReassign && (
          <ReassignModal pending={pendingReassign} onResolve={resolveReassign} />
        )}

        {/* ------------------------------ Context menu ---------------------------- */}
        {contextMenu && (
          <CanvasContextMenu
            menu={contextMenu}
            node={nodes.find((n) => n.id === contextMenu.id) ?? null}
            onClose={() => setContextMenu(null)}
            onRegenerate={regenerate}
            onBranch={branchNode}
            onLock={(id) => {
              const n = nodes.find((nn) => nn.id === id)
              if (n) patchNode(id, { locked: !n.data.locked })
            }}
            onApprove={approveNode}
            onDelete={removeNode}
            onSendToStudio={(id) => {
              const n = nodes.find((nn) => nn.id === id)
              if (n) sendLaneToStudio(n.data.lane)
            }}
          />
        )}
      </div>
    </Ctx.Provider>
  )
}

/* -------------------------------------------------------------------------- */
/*  Semantic reassignment — confirmation modal                                */
/* -------------------------------------------------------------------------- */

function ReassignModal({
  pending,
  onResolve,
}: {
  pending: PendingReassign
  onResolve: (choice: 'cosmetic' | 'reassign' | 'reassignRegenerate' | 'cancel') => void
}) {
  const draggedLabel = KIND_DEFS[pending.draggedKind].label
  const targetLabel = KIND_DEFS[pending.targetKind].label

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="canvas-node w-[380px] !cursor-default border-[#4D8DFF]/35 bg-[#0b1024]/85 backdrop-blur-xl p-5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#38E8FF]">
          <GitBranch size={12} /> Position changed role
        </p>
        <p className="mt-2.5 text-[14px] leading-snug text-white">
          This <span className="font-semibold">{draggedLabel}</span> card will now become the{' '}
          <span className="font-semibold">{targetLabel}</span>. Lock it in?
        </p>
        <p className="mt-1.5 text-[11px] leading-snug text-white/40">
          The card swapped position with the {targetLabel.toLowerCase()} card. Choose whether its
          role changes with it.
        </p>
        <div className="mt-4 space-y-1.5">
          <button
            type="button"
            onClick={() => onResolve('reassignRegenerate')}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#4D8DFF]/40 bg-[#4D8DFF]/[0.1] px-3 py-2.5 text-[12px] font-semibold text-[#38E8FF] transition-colors hover:bg-[#4D8DFF]/20"
          >
            <RefreshCw size={12} /> Reassign &amp; regenerate for the new role
          </button>
          <button
            type="button"
            onClick={() => onResolve('reassign')}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/14 bg-white/[0.04] px-3 py-2.5 text-[12px] font-semibold text-white/75 transition-colors hover:border-white/25 hover:text-white"
          >
            Reassign role, keep the current words
          </button>
          <button
            type="button"
            onClick={() => onResolve('cosmetic')}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[12px] font-medium text-white/55 transition-colors hover:border-white/20 hover:text-white/80"
          >
            Keep visual move only — no role change
          </button>
          <button
            type="button"
            onClick={() => onResolve('cancel')}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium text-white/35 transition-colors hover:text-white/60"
          >
            Cancel — undo the move
          </button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Right-click context menu                                                  */
/* -------------------------------------------------------------------------- */

function CanvasContextMenu({
  menu,
  node,
  onClose,
  onRegenerate,
  onBranch,
  onLock,
  onApprove,
  onDelete,
  onSendToStudio,
}: {
  menu: { id: string; x: number; y: number }
  node: CanvasRFNode | null
  onClose: () => void
  onRegenerate: (id: string) => void
  onBranch: (id: string) => void
  onLock: (id: string) => void
  onApprove: (id: string) => void
  onDelete: (id: string) => void
  onSendToStudio: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Escape is handled centrally in CanvasInner (it needs to know whether a
  // menu, a selection, or nothing is open, and act on only the first of
  // those) — this effect only owns the click-outside-to-close behavior.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  if (!node) return null
  const def = KIND_DEFS[node.data.kind]
  const canRemove = node.data.branchIdx > 0 || node.data.kind === 'scene'

  const item = (label: string, onClick: () => void, danger?: boolean) => (
    <button
      type="button"
      onClick={() => {
        onClick()
        onClose()
      }}
      className={cn(
        'flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors',
        danger ? 'text-danger hover:bg-danger/10' : 'text-white/75 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      style={{ left: menu.x, top: menu.y }}
      className="fixed z-[110] w-48 overflow-hidden rounded-xl border border-white/12 bg-[#0b1024]/90 backdrop-blur-xl py-1.5 shadow-2xl"
    >
      <p className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white/30">{def.label}</p>
      {def.regen && item('Regenerate', () => onRegenerate(node.id))}
      {def.branch && item('Branch / Duplicate', () => onBranch(node.id))}
      {item(node.data.locked ? 'Unlock' : 'Lock', () => onLock(node.id))}
      {item(node.data.approved ? 'Unapprove' : 'Approve', () => onApprove(node.id))}
      {item('Send lane to Studio', () => onSendToStudio(node.id))}
      {canRemove && <div className="my-1 h-px bg-white/10" />}
      {canRemove && item('Delete', () => onDelete(node.id), true)}
    </div>
  )
}
