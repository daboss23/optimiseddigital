'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Atom,
  Check,
  Copy as CopyIcon,
  Film,
  ImageIcon,
  Loader2,
  PenLine,
  Play,
  Plus,
  Sparkles,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'
import { AdPreviewCard } from '@/components/campaign-reactor/canvas/AdPreviewCard'
import {
  autoComposition,
  buildBlocks,
  composeAd,
  composedToText,
  type Composition,
} from '@/lib/campaign-reactor/canvas'
import {
  ASPECT_OPTIONS,
  aspectBox,
  DEFAULT_ASPECT,
  mediaConcepts,
} from '@/lib/campaign-reactor/flow'

interface ModelOption {
  id: string
  label: string
  configured: boolean
}

/** Render state for a free generator node (Weave-style, not tied to a concept). */
interface GenState {
  status: 'idle' | 'working' | 'done' | 'error'
  url?: string
  error?: string
  model?: string
  provider?: string
}

const IDLE_GEN: GenState = { status: 'idle' }

/* -------------------------------------------------------------------------- */
/*  Shared flow context — nodes read live run state + controls from here, so   */
/*  React Flow's node `data` can stay minimal and never goes stale.            */
/* -------------------------------------------------------------------------- */

interface FlowCtx {
  /* Concept pipeline (auto-seeded from a reactor run) */
  conceptAt: (i: number) => Concept | undefined
  control: (i: number) => { model: string; aspect: string }
  setModel: (i: number, m: string) => void
  setAspect: (i: number, a: string) => void
  run: (i: number) => void
  imageFor: (c: Concept) => string | undefined
  videoUrlFor: (c: Concept) => string | undefined
  stateFor: (c: Concept) => { busy: boolean; error?: string }
  imageModels: ModelOption[]
  videoModels: ModelOption[]
  angle?: string
  offerName?: string
  composition: { ad: ReturnType<typeof composeAd>; copy: () => void; copied: boolean }
  /* Free nodes (prompts + standalone generators the user wires up) */
  textFor: (id: string) => string
  setText: (id: string, v: string) => void
  genFor: (id: string) => GenState
  genControl: (id: string) => { model: string; aspect: string }
  setGenModel: (id: string, m: string) => void
  setGenAspect: (id: string, a: string) => void
  runGen: (id: string) => void
  removeNode: (id: string) => void
  /** What is currently wired into a generator — drives the node's input chip. */
  wiredInputs: (id: string) => { promptSources: number; imageUrl?: string }
}

const FlowContext = createContext<FlowCtx | null>(null)
const useFlow = () => {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('Flow node rendered outside CreativeFlow')
  return ctx
}

/* -------------------------------------------------------------------------- */
/*  Small styled selects (native — no extra UI dependency)                     */
/* -------------------------------------------------------------------------- */

function MiniSelect({
  value,
  onChange,
  children,
  title,
}: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
  title?: string
}) {
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className="nodrag w-full cursor-pointer rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 outline-none transition-colors hover:border-white/20 focus:border-glow/40"
    >
      {children}
    </select>
  )
}

/** The ✕ that removes a user-added node (seeded pipeline nodes don't get one). */
function RemoveButton({ id }: { id: string }) {
  const { removeNode } = useFlow()
  return (
    <button
      type="button"
      title="Remove node"
      onClick={() => removeNode(id)}
      className="nodrag grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
    >
      <X size={11} />
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/*  Brief node — the campaign root                                            */
/* -------------------------------------------------------------------------- */

function BriefNode() {
  const { angle, offerName } = useFlow()
  return (
    <div className="w-[220px] rounded-xl border border-glow/30 bg-[#0b0f17]/90 p-3 shadow-[0_0_40px_-20px_rgba(94,168,255,0.8)] backdrop-blur">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Atom size={13} className="text-glow" />
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          Campaign Brief
        </span>
      </div>
      <p className="text-[12px] font-medium text-white/85">{angle?.trim() || 'Agent-decided angle'}</p>
      {offerName?.trim() && <p className="mt-0.5 text-[11px] text-white/45">Offer · {offerName}</p>}
      <p className="mt-2 text-[10px] text-white/30">Every node below is grounded in this run.</p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-glow/60 !bg-glow" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Prompt node — free-form creative direction the user wires into generators  */
/* -------------------------------------------------------------------------- */

function PromptNode({ id }: NodeProps) {
  const { textFor, setText } = useFlow()
  return (
    <div className="w-[250px] rounded-xl border border-amber-400/30 bg-[#0b0f17]/92 p-3 shadow-[0_0_36px_-22px_rgba(251,191,36,0.9)] backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          <PenLine size={12} className="text-amber-300" /> Prompt
        </span>
        <RemoveButton id={id} />
      </div>
      <textarea
        value={textFor(id)}
        onChange={(e) => setText(id, e.target.value)}
        rows={4}
        placeholder="Describe the shot — subject, setting, mood, camera…"
        className="nodrag nowheel w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[12px] leading-snug text-white/85 placeholder:text-white/25 outline-none transition-colors focus:border-amber-400/40"
      />
      <p className="mt-1.5 text-[10px] text-white/30">Wire this into an image or video generator.</p>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-amber-300/70 !bg-amber-300"
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Generator node — a standalone image / video render step (Weave-style)      */
/* -------------------------------------------------------------------------- */

function GenNode({ id, data }: NodeProps) {
  const { kind } = data as { kind: 'image' | 'video' }
  const flow = useFlow()
  const isVideo = kind === 'video'
  const gen = flow.genFor(id)
  const ctrl = flow.genControl(id)
  const models = isVideo ? flow.videoModels : flow.imageModels
  const wired = flow.wiredInputs(id)
  const ownText = flow.textFor(id)
  const busy = gen.status === 'working'
  const hasPrompt = Boolean(ownText.trim()) || wired.promptSources > 0
  const canRun = !busy && (hasPrompt || (isVideo && Boolean(wired.imageUrl)))

  return (
    <div
      className={cn(
        'w-[260px] overflow-hidden rounded-xl border bg-[#0b0f17]/92 backdrop-blur',
        isVideo ? 'border-violet-400/25' : 'border-cyan-400/25',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-white/30 !bg-white/40" />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">
          {isVideo ? (
            <Film size={12} className="text-violet-300" />
          ) : (
            <ImageIcon size={12} className="text-cyan-300" />
          )}
          {isVideo ? 'Video Generator' : 'Image Generator'}
        </span>
        <RemoveButton id={id} />
      </div>

      {/* Preview */}
      <div className={cn('relative w-full overflow-hidden border-b border-white/[0.06] bg-black/40', aspectBox(ctrl.aspect))}>
        {isVideo && gen.status === 'done' && gen.url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={gen.url} controls className="h-full w-full object-cover" />
        ) : !isVideo && gen.status === 'done' && gen.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gen.url} alt="Generated creative" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
            {busy ? (
              <Loader2 size={22} className="animate-spin text-glow/70" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.03]">
                {isVideo ? <Film size={18} className="text-white/40" /> : <ImageIcon size={18} className="text-white/40" />}
              </span>
            )}
            <p className="text-[11px] leading-snug text-white/40">
              {busy
                ? isVideo
                  ? 'Rendering video — this takes a few minutes…'
                  : 'Rendering…'
                : hasPrompt || wired.imageUrl
                  ? 'Ready to render.'
                  : 'Connect a prompt node, or write one below.'}
            </p>
          </div>
        )}
        {gen.status === 'error' && gen.error && (
          <span className="absolute inset-x-0 bottom-0 bg-danger/20 px-2 py-1 text-[10px] text-danger">
            {gen.error}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-2 p-3">
        {/* Input chip — what's wired in from upstream nodes */}
        <div className="flex flex-wrap items-center gap-1">
          {wired.promptSources > 0 && (
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-200/90">
              {wired.promptSources} prompt{wired.promptSources > 1 ? 's' : ''} wired
            </span>
          )}
          {isVideo && wired.imageUrl && (
            <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-cyan-200/90">
              Image → video
            </span>
          )}
        </div>
        <textarea
          value={ownText}
          onChange={(e) => flow.setText(id, e.target.value)}
          rows={2}
          placeholder={isVideo ? 'Optional — motion / scene direction' : 'Optional — extra art direction'}
          className="nodrag nowheel w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] leading-snug text-white/80 placeholder:text-white/25 outline-none transition-colors focus:border-glow/40"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <MiniSelect value={ctrl.model} onChange={(v) => flow.setGenModel(id, v)} title="Model">
            <option value="auto">Auto model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.configured ? '' : ' (no key)'}
              </option>
            ))}
          </MiniSelect>
          <MiniSelect value={ctrl.aspect} onChange={(v) => flow.setGenAspect(id, v)} title="Ad dimensions">
            {ASPECT_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label} {a.ratio}
              </option>
            ))}
          </MiniSelect>
        </div>
        <button
          type="button"
          onClick={() => flow.runGen(id)}
          disabled={!canRun}
          className="nodrag inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-glow/30 bg-glow/10 px-3 py-1.5 text-[11px] font-semibold text-glow transition-colors hover:bg-glow/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {busy
            ? 'Rendering…'
            : gen.status === 'done'
              ? 'Re-run'
              : isVideo
                ? 'Generate video'
                : 'Generate image'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-glow/60 !bg-glow" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Media node — a runnable generation step seeded from a run's concept        */
/* -------------------------------------------------------------------------- */

function MediaNode({ data }: NodeProps) {
  const { conceptIndex } = data as { conceptIndex: number }
  const flow = useFlow()
  const concept = flow.conceptAt(conceptIndex)
  if (!concept) return null

  const isVideo = /video|testimonial/i.test(concept.type)
  const ctrl = flow.control(conceptIndex)
  const image = flow.imageFor(concept)
  const videoUrl = flow.videoUrlFor(concept)
  const { busy, error } = flow.stateFor(concept)
  const models = isVideo ? flow.videoModels : flow.imageModels
  const hasOutput = Boolean(image || videoUrl)

  return (
    <div className="w-[260px] overflow-hidden rounded-xl border border-white/10 bg-[#0b0f17]/92 backdrop-blur">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-white/30 !bg-white/40" />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wider text-white/80">
          {isVideo ? <Film size={12} className="text-violet-300" /> : <ImageIcon size={12} className="text-cyan-300" />}
          {concept.type}
        </span>
        {typeof concept.score === 'number' && (
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-1.5 text-[10px] text-white/55">
            {concept.score}/10
          </span>
        )}
      </div>

      {/* Preview */}
      <div className={cn('relative w-full overflow-hidden border-b border-white/[0.06] bg-black/40', aspectBox(ctrl.aspect))}>
        {videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={videoUrl} controls className="h-full w-full object-cover" />
        ) : image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={concept.type} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center">
            {busy ? (
              <Loader2 size={22} className="animate-spin text-glow/70" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.03]">
                {isVideo ? <Film size={18} className="text-white/40" /> : <ImageIcon size={18} className="text-white/40" />}
              </span>
            )}
            <p className="line-clamp-3 text-[11px] leading-snug text-white/45">{concept.text}</p>
          </div>
        )}
        {error && (
          <span className="absolute inset-x-0 bottom-0 bg-danger/20 px-2 py-1 text-[10px] text-danger">{error}</span>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-2 p-3">
        {concept.basis && (
          <p className="line-clamp-1 text-[10px] text-white/35">
            <span className="text-glow/70">Grounded in</span> · {concept.basis}
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <MiniSelect value={ctrl.model} onChange={(v) => flow.setModel(conceptIndex, v)} title="Model">
            <option value="auto">Auto model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.configured ? '' : ' (no key)'}
              </option>
            ))}
          </MiniSelect>
          <MiniSelect value={ctrl.aspect} onChange={(v) => flow.setAspect(conceptIndex, v)} title="Ad dimensions">
            {ASPECT_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label} {a.ratio}
              </option>
            ))}
          </MiniSelect>
        </div>
        <button
          type="button"
          onClick={() => flow.run(conceptIndex)}
          disabled={busy}
          className="nodrag inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-glow/30 bg-glow/10 px-3 py-1.5 text-[11px] font-semibold text-glow transition-colors hover:bg-glow/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {busy ? 'Rendering…' : hasOutput ? 'Re-run' : isVideo ? 'Generate video' : 'Generate image'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-glow/60 !bg-glow" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Composition node — the live finished ad (reuses the Studio preview card)   */
/* -------------------------------------------------------------------------- */

function CompositionNode() {
  const { composition } = useFlow()
  return (
    <div className="w-[340px] rounded-xl border border-white/10 bg-[#0b0f17]/92 p-3 backdrop-blur">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-white/30 !bg-white/40" />
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          <Sparkles size={12} className="text-glow" /> Live Ad Composition
        </span>
        <button
          type="button"
          onClick={composition.copy}
          className="nodrag inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-glow/30 bg-glow/10 px-2 py-1 text-[10px] font-semibold text-glow transition-colors hover:bg-glow/20"
        >
          {composition.copied ? <Check size={11} /> : <CopyIcon size={11} />}
          {composition.copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <AdPreviewCard ad={composition.ad} />
      <p className="mt-2 text-[10px] text-white/30">
        Assembled from OPUS&rsquo;s top-scoring copy + the run&rsquo;s visual. Switch to Studio to remix the copy.
      </p>
    </div>
  )
}

const nodeTypes = {
  brief: BriefNode,
  prompt: PromptNode,
  gen: GenNode,
  media: MediaNode,
  composition: CompositionNode,
}

/* -------------------------------------------------------------------------- */
/*  The canvas                                                                */
/* -------------------------------------------------------------------------- */

function FlowInner({ offerName, angle }: { offerName?: string; angle?: string }) {
  const { concepts, generateCreative, imageFor, videoFor, creativeStateFor } = useReactorRun()
  const { screenToFlowPosition } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  const media = useMemo(() => mediaConcepts(concepts), [concepts])
  const blocks = useMemo(() => buildBlocks(concepts, offerName), [concepts, offerName])

  /* --------------------------- Pipeline controls --------------------------- */
  const [overrides, setOverrides] = useState<Record<number, { model?: string; aspect?: string }>>({})
  const [defaultAspect, setDefaultAspect] = useState<string>(DEFAULT_ASPECT)
  const [imageModels, setImageModels] = useState<ModelOption[]>([])
  const [videoModels, setVideoModels] = useState<ModelOption[]>([])
  const [composition, setComposition] = useState<Composition>(() => autoComposition(blocks))
  const [copied, setCopied] = useState(false)

  /* ----------------------------- Free-node state --------------------------- */
  // Prompt / art-direction text per node id (prompt nodes + generators' own field).
  const [texts, setTexts] = useState<Record<string, string>>({})
  // Model/aspect per free generator node.
  const [genCtrls, setGenCtrls] = useState<Record<string, { model?: string; aspect?: string }>>({})
  // Render state per free generator node.
  const [genStates, setGenStates] = useState<Record<string, GenState>>({})

  useEffect(() => {
    fetch('/api/image/models')
      .then((r) => r.json())
      .then((d) => Array.isArray(d.models) && setImageModels(d.models))
      .catch(() => {})
    fetch('/api/video/models')
      .then((r) => r.json())
      .then((d) => Array.isArray(d.models) && setVideoModels(d.models))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setComposition(autoComposition(blocks))
    setOverrides({})
  }, [blocks])

  const control = useCallback(
    (i: number) => ({
      model: overrides[i]?.model ?? 'auto',
      aspect: overrides[i]?.aspect ?? defaultAspect,
    }),
    [overrides, defaultAspect],
  )
  const setModel = useCallback(
    (i: number, model: string) => setOverrides((o) => ({ ...o, [i]: { ...o[i], model } })),
    [],
  )
  const setAspect = useCallback(
    (i: number, aspect: string) => setOverrides((o) => ({ ...o, [i]: { ...o[i], aspect } })),
    [],
  )

  const run = useCallback(
    (i: number) => {
      const c = concepts[i]
      if (!c) return
      const { model, aspect } = control(i)
      const isVideo = /video|testimonial/i.test(c.type)
      generateCreative(c, {
        imageModel: !isVideo && model !== 'auto' ? model : undefined,
        videoModel: isVideo && model !== 'auto' ? model : undefined,
        aspectRatio: aspect,
      })
    },
    [concepts, control, generateCreative],
  )

  const ad = useMemo(() => composeAd(blocks, composition), [blocks, composition])
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(composedToText(ad))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }, [ad])

  /* ------------------------------- Graph ---------------------------------- */
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const idCounter = useRef(0)
  const nextId = (prefix: string) => {
    idCounter.current += 1
    return `${prefix}-${idCounter.current}`
  }

  // User-drawn wires — animated like the seeded pipeline, deletable by selection.
  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds)),
    [setEdges],
  )

  // Blank-canvas starter graph — the Weave-style hello world: a prompt wired
  // into an image generator, whose output feeds a video generator.
  const seedStarter = useCallback(() => {
    const promptId = nextId('prompt')
    const imgId = nextId('gen-img')
    const vidId = nextId('gen-vid')
    setTexts((t) => ({
      ...t,
      [promptId]:
        'A builder in his 40s on a framed-up site at golden hour, tool belt on, looking at plans — cinematic, photographic, high contrast.',
    }))
    const starterNodes: Node[] = [
      { id: promptId, type: 'prompt', position: { x: 0, y: 140 }, data: {} },
      { id: imgId, type: 'gen', position: { x: 340, y: 20 }, data: { kind: 'image' } },
      { id: vidId, type: 'gen', position: { x: 700, y: 120 }, data: { kind: 'video' } },
    ]
    const starterEdges: Edge[] = [
      { id: `u-${promptId}-${imgId}`, source: promptId, target: imgId, animated: true },
      { id: `u-${imgId}-${vidId}`, source: imgId, target: vidId, animated: true },
    ]
    return { starterNodes, starterEdges }
  }, [])

  // Re-seed the concept pipeline whenever the set of media concepts changes (a
  // new run lands). User-added prompt/generator nodes and their wires survive.
  const seedKey = useMemo(() => media.map((m) => `${m.index}:${m.concept.type}`).join('|'), [media])
  useEffect(() => {
    let surviving = new Set<string>()
    let starterEdges: Edge[] = []
    setNodes((prev) => {
      const free = prev.filter((n) => n.type === 'prompt' || n.type === 'gen')
      let next: Node[]
      if (media.length === 0) {
        if (free.length) {
          next = free
        } else {
          const starter = seedStarter()
          next = starter.starterNodes
          starterEdges = starter.starterEdges
        }
      } else {
        const colX = 360
        const gap = 260
        const totalH = Math.max(media.length, 1) * gap
        next = [
          { id: 'brief', type: 'brief', position: { x: 0, y: totalH / 2 - 60 }, data: {} },
          ...media.map((m, row) => ({
            id: `media-${m.index}`,
            type: 'media',
            position: { x: colX, y: row * gap },
            data: { conceptIndex: m.index },
          })),
          {
            id: 'composition',
            type: 'composition',
            position: { x: colX + 360, y: totalH / 2 - 200 },
            data: {},
          },
          // Park surviving free nodes below the pipeline so nothing overlaps.
          ...free.map((n, i) =>
            n.position.y > totalH
              ? n
              : { ...n, position: { x: n.position.x, y: totalH + 80 + i * 40 } },
          ),
        ]
      }
      surviving = new Set(next.map((n) => n.id))
      return next
    })
    setEdges((prev) => {
      const userEdges = prev.filter(
        (e) => !e.id.startsWith('e-') && surviving.has(e.source) && surviving.has(e.target),
      )
      const seeded: Edge[] =
        media.length === 0
          ? []
          : [
              ...media.map((m) => ({ id: `e-brief-${m.index}`, source: 'brief', target: `media-${m.index}` })),
              ...media.map((m) => ({ id: `e-${m.index}-comp`, source: `media-${m.index}`, target: 'composition' })),
            ]
      return [...seeded, ...userEdges, ...starterEdges]
    })
    // seedStarter is stable; nodes/edges setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, media, setNodes, setEdges])

  /* --------------------------- Free-node behavior -------------------------- */
  const textFor = useCallback((id: string) => texts[id] ?? '', [texts])
  const setText = useCallback((id: string, v: string) => setTexts((t) => ({ ...t, [id]: v })), [])
  const genFor = useCallback((id: string) => genStates[id] ?? IDLE_GEN, [genStates])
  const genControl = useCallback(
    (id: string) => {
      const isVideo = nodes.find((n) => n.id === id)?.data?.kind === 'video'
      return {
        model: genCtrls[id]?.model ?? 'auto',
        aspect: genCtrls[id]?.aspect ?? (isVideo ? '9:16' : defaultAspect),
      }
    },
    [genCtrls, defaultAspect, nodes],
  )
  const setGenModel = useCallback(
    (id: string, model: string) => setGenCtrls((c) => ({ ...c, [id]: { ...c[id], model } })),
    [],
  )
  const setGenAspect = useCallback(
    (id: string, aspect: string) => setGenCtrls((c) => ({ ...c, [id]: { ...c[id], aspect } })),
    [],
  )

  // Resolve everything wired into a generator: prompt text from upstream prompt
  // nodes + concept nodes, and (for video) the first upstream still to animate.
  const resolveInputs = useCallback(
    (id: string) => {
      const parts: string[] = []
      let imageUrl: string | undefined
      let promptSources = 0
      for (const e of edges) {
        if (e.target !== id) continue
        const n = nodes.find((nn) => nn.id === e.source)
        if (!n) continue
        if (n.type === 'prompt') {
          const t = (texts[n.id] ?? '').trim()
          if (t) {
            parts.push(t)
            promptSources += 1
          }
        } else if (n.type === 'media') {
          const c = concepts[(n.data as { conceptIndex: number }).conceptIndex]
          if (c) {
            parts.push(c.text)
            promptSources += 1
            if (!imageUrl) imageUrl = imageFor(c)
          }
        } else if (n.type === 'brief') {
          if (angle?.trim()) {
            parts.push(`Campaign angle: ${angle.trim()}`)
            promptSources += 1
          }
        } else if (n.type === 'gen') {
          const g = genStates[n.id]
          const kind = (n.data as { kind?: string }).kind
          if (kind === 'image' && g?.status === 'done' && g.url && !imageUrl) imageUrl = g.url
        }
      }
      return { parts, imageUrl, promptSources }
    },
    [edges, nodes, texts, concepts, imageFor, genStates, angle],
  )

  const wiredInputs = useCallback(
    (id: string) => {
      const { imageUrl, promptSources } = resolveInputs(id)
      return { promptSources, imageUrl }
    },
    [resolveInputs],
  )

  // Poll a free video render to completion (same cadence as the run provider).
  const pollGen = useCallback(
    async (id: string, requestId: string, model?: string, responseUrl?: string) => {
      const modelQuery = model ? `&model=${encodeURIComponent(model)}` : ''
      const responseQuery = responseUrl ? `&responseUrl=${encodeURIComponent(responseUrl)}` : ''
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 4000))
        try {
          const res = await fetch(
            `/api/generate-video?requestId=${encodeURIComponent(requestId)}${modelQuery}${responseQuery}`,
          ).then((r) => r.json())
          if (res.status === 'completed' && res.videoUrl) {
            setGenStates((s) => ({
              ...s,
              [id]: { status: 'done', url: res.videoUrl, model: res.modelId ?? model, provider: res.provider },
            }))
            return
          }
          if (res.status === 'failed' || res.status === 'nsfw') {
            setGenStates((s) => ({ ...s, [id]: { status: 'error', error: 'Render failed' } }))
            return
          }
        } catch {
          /* transient — keep polling */
        }
      }
      setGenStates((s) => ({ ...s, [id]: { status: 'error', error: 'Render timed out' } }))
    },
    [],
  )

  const runGen = useCallback(
    async (id: string) => {
      const node = nodes.find((n) => n.id === id)
      if (!node) return
      const kind = (node.data as { kind?: string }).kind
      const { parts, imageUrl } = resolveInputs(id)
      const own = (texts[id] ?? '').trim()
      const prompt = [own, ...parts].filter(Boolean).join('\n\n')
      const ctrl = genControl(id)
      const model = ctrl.model !== 'auto' ? ctrl.model : undefined

      setGenStates((s) => ({ ...s, [id]: { status: 'working' } }))
      try {
        if (kind === 'image') {
          const res = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: `${prompt}\n\nRender as a premium Meta ad creative — photographic, high contrast, leave room for text overlay.`,
              aspectRatio: ctrl.aspect,
              model,
            }),
          }).then((r) => r.json())
          if (res.success && res.imageUrl) {
            setGenStates((s) => ({
              ...s,
              [id]: { status: 'done', url: res.imageUrl, model: res.model, provider: res.provider },
            }))
          } else {
            setGenStates((s) => ({
              ...s,
              [id]: {
                status: 'error',
                error:
                  res.error ||
                  (res.demo ? 'No image API key set — add FAL_KEY or HF_CREDENTIALS' : 'Generation failed'),
              },
            }))
          }
        } else {
          const body = imageUrl
            ? {
                imageUrl,
                mode: 'image-to-video',
                model,
                aspectRatio: ctrl.aspect,
                prompt: prompt || 'Cinematic motion for a premium builder ad.',
              }
            : {
                prompt,
                mode: 'text-to-video',
                model,
                aspectRatio: ctrl.aspect,
              }
          const res = await fetch('/api/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then((r) => r.json())
          if (res.success && res.requestId) {
            setGenStates((s) => ({ ...s, [id]: { status: 'working', model: res.modelId, provider: res.provider } }))
            void pollGen(id, res.requestId, res.modelId, res.responseUrl)
          } else {
            setGenStates((s) => ({
              ...s,
              [id]: {
                status: 'error',
                error:
                  res.error ||
                  (res.demo ? 'No video API key set — add FAL_KEY or HF_CREDENTIALS' : 'Video render failed'),
              },
            }))
          }
        }
      } catch {
        setGenStates((s) => ({ ...s, [id]: { status: 'error', error: 'Generation failed' } }))
      }
    },
    [nodes, resolveInputs, texts, genControl, pollGen],
  )

  const removeNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id))
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
    },
    [setNodes, setEdges],
  )

  // Drop a new node at the visual center of the canvas, slightly staggered so
  // repeated adds never stack perfectly on top of each other.
  const addNode = useCallback(
    (type: 'prompt' | 'image' | 'video') => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      const base = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 }
      const jitter = (idCounter.current % 5) * 28
      const id = type === 'prompt' ? nextId('prompt') : nextId(type === 'image' ? 'gen-img' : 'gen-vid')
      const node: Node =
        type === 'prompt'
          ? { id, type: 'prompt', position: { x: base.x - 125 + jitter, y: base.y - 80 + jitter }, data: {} }
          : {
              id,
              type: 'gen',
              position: { x: base.x - 130 + jitter, y: base.y - 120 + jitter },
              data: { kind: type },
            }
      setNodes((ns) => [...ns, node])
    },
    [screenToFlowPosition, setNodes],
  )

  const ctxValue: FlowCtx = useMemo(
    () => ({
      conceptAt: (i: number) => concepts[i],
      control,
      setModel,
      setAspect,
      run,
      imageFor,
      videoUrlFor: (c: Concept) => {
        const v = videoFor(c)
        return v?.status === 'done' ? v.url : undefined
      },
      stateFor: (c: Concept) => {
        const cs = creativeStateFor(c)
        const v = videoFor(c)
        return {
          busy: cs?.status === 'working' || v?.status === 'rendering',
          error: cs?.status === 'error' ? cs.message || 'Failed' : v?.status === 'error' ? 'Render failed' : undefined,
        }
      },
      imageModels,
      videoModels,
      angle,
      offerName,
      composition: { ad, copy, copied },
      textFor,
      setText,
      genFor,
      genControl,
      setGenModel,
      setGenAspect,
      runGen,
      removeNode,
      wiredInputs,
    }),
    [
      concepts, control, setModel, setAspect, run, imageFor, videoFor, creativeStateFor,
      imageModels, videoModels, angle, offerName, ad, copy, copied,
      textFor, setText, genFor, genControl, setGenModel, setGenAspect, runGen, removeNode, wiredInputs,
    ],
  )

  return (
    <FlowContext.Provider value={ctxValue}>
      <div ref={wrapperRef} className="tpb-flow relative h-[72vh] min-h-[520px] w-full">
        {/* Node palette — build the graph Weave-style */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0b0f17]/90 p-1.5 backdrop-blur">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-white/45">Add</span>
          <button
            type="button"
            onClick={() => addNode('prompt')}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/20"
          >
            <Plus size={11} /> Prompt
          </button>
          <button
            type="button"
            onClick={() => addNode('image')}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20"
          >
            <Plus size={11} /> Image
          </button>
          <button
            type="button"
            onClick={() => addNode('video')}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[11px] font-semibold text-violet-200 transition-colors hover:bg-violet-400/20"
          >
            <Plus size={11} /> Video
          </button>
        </div>

        {/* Flow-level default dimensions */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b0f17]/90 px-2.5 py-1.5 backdrop-blur">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Default size</span>
          <select
            value={defaultAspect}
            onChange={(e) => setDefaultAspect(e.target.value)}
            className="cursor-pointer rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 outline-none hover:border-white/20"
          >
            {ASPECT_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label} {a.ratio}
              </option>
            ))}
          </select>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ animated: true, style: { stroke: 'rgb(94 168 255 / 0.45)', strokeWidth: 1.5 } }}
          connectionLineStyle={{ stroke: 'rgb(251 191 36 / 0.6)', strokeWidth: 1.5 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(255 255 255 / 0.06)" />
          <MiniMap pannable zoomable className="!bg-[#0b0f17]" maskColor="rgb(5 8 14 / 0.7)" nodeColor="rgb(94 168 255 / 0.4)" />
          <Controls className="!border-white/10 !bg-[#0b0f17]" />
        </ReactFlow>
      </div>
    </FlowContext.Provider>
  )
}

export function CreativeFlow({
  offerName,
  angle,
  onConfigure,
}: {
  offerName?: string
  angle?: string
  onConfigure: () => void
}) {
  const { concepts } = useReactorRun()

  return (
    <div className="reactor-panel glass overflow-hidden p-0">
      {concepts.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5">
          <p className="text-xs text-white/45">
            <span className="font-semibold text-white/70">Blank canvas</span> — write a prompt, wire
            it into a generator, and render. Or fire the reactor and the winning concepts land here
            as a ready-made pipeline.
          </p>
          <button
            type="button"
            onClick={onConfigure}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-glow/30 bg-glow/10 px-3.5 py-1.5 text-xs font-semibold text-glow transition-colors hover:bg-glow/20"
          >
            <Atom size={12} /> Open the campaign brief
          </button>
        </div>
      )}
      <ReactFlowProvider>
        <FlowInner offerName={offerName} angle={angle} />
      </ReactFlowProvider>
    </div>
  )
}
