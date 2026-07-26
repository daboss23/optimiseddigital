'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import { AlertTriangle, FlaskConical, RotateCcw, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { accentClass } from '@/components/reactor/ui'
import { INTELLIGENCE, INTELLIGENCE_IDS, type IntelligenceId } from '@/lib/agents'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'
import {
  ACTIVE_STATUSES,
  derivePhases,
  reportedAgents,
  type AgentStatus,
} from '@/lib/campaign-reactor/workflow'
import { AGENT_VISUAL, OPUS_CORE, OPUS_OUTPUT_STROKE } from './visuals'
import { AgentIntelligenceCard } from './AgentIntelligenceCard'
import { OpusReactorCore, type OpusSegment } from './OpusReactorCore'
import { AgentConnectionPath, type ConnDirection, type Point } from './AgentConnectionPath'
import { IntelligencePacket } from './IntelligencePacket'
import { EmergingStrategyPanel } from './EmergingStrategyPanel'
import { ReactorPhaseTimeline } from './ReactorPhaseTimeline'
import { TechnicalTelemetryDrawer } from './TechnicalTelemetryDrawer'
import { ConceptResultCard } from './ConceptResultCard'

export interface WorkflowControls {
  angle: string
  isVideoConcept: (c: Concept) => boolean
  hasRefs: boolean
  faceCount: number
  refVideoCount: number
  copied: string | null
  onCopy: (text: string) => void
  onAnimate: (c: Concept, image: string) => void
  onGenerateUGC: (c: Concept) => void
  onConfigureInStudio: (c: Concept) => void
  onLaunchCanvas: (c: Concept) => void
  onPushToMeta: (c: Concept) => Promise<{ ok: boolean; message: string }>
  onRetry: () => void
}

interface Geo {
  w: number
  h: number
  agents: Partial<Record<IntelligenceId, Point>>
  opusIn: Point
  opusOut: Point
  out: Point
}

interface Flying {
  id: number
  from: Point
  to: Point
  label: string
  colorClass?: string
  opus?: boolean
}

/** Map an agent's live status to its energy-channel presentation + direction. */
function connStateFor(status: AgentStatus): {
  active: boolean
  complete: boolean
  dim: boolean
  direction: ConnDirection
} {
  switch (status) {
    case 'retrieving':
      // OPUS just delegated — energy flows out to the agent (activation).
      return { active: true, complete: false, dim: false, direction: 'reverse' }
    case 'analysing':
    case 'reporting':
      // The agent is working/returning — energy flows back into OPUS.
      return { active: true, complete: false, dim: false, direction: 'forward' }
    case 'complete':
      return { active: false, complete: true, dim: false, direction: 'forward' }
    default:
      // dormant · queued · notRequired · error → quiet, faded channel.
      return { active: false, complete: false, dim: true, direction: 'forward' }
  }
}

export function LiveAgentWorkflow(controls: WorkflowControls) {
  const {
    workflow,
    concepts,
    telemetry,
    phase,
    error,
    imageFor,
    imageMetaFor,
    videoFor,
    creativeStateFor,
  } = useReactorRun()

  const prefersReduced = useReducedMotion()
  const reduced = prefersReduced ?? false

  /* ----------------------------- Responsiveness ---------------------------- */
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  /* ----- Pause ambient motion while the tab is hidden (performance) -------- */
  const [docHidden, setDocHidden] = useState(false)
  useEffect(() => {
    const onVis = () => setDocHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    onVis()
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /* ------------------------------ Measurement ------------------------------ */
  const stageRef = useRef<HTMLDivElement | null>(null)
  const opusRef = useRef<HTMLDivElement | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)
  const agentEls = useRef<Partial<Record<IntelligenceId, HTMLDivElement | null>>>({})
  const setAgentEl = useCallback(
    (id: IntelligenceId) => (el: HTMLDivElement | null) => {
      agentEls.current[id] = el
    },
    [],
  )
  const [geo, setGeo] = useState<Geo | null>(null)

  const measure = useCallback(() => {
    const stage = stageRef.current
    if (!stage || !isDesktop) {
      setGeo(null)
      return
    }
    const sr = stage.getBoundingClientRect()
    const agents: Partial<Record<IntelligenceId, Point>> = {}
    for (const id of INTELLIGENCE_IDS) {
      const el = agentEls.current[id]
      if (el) {
        const r = el.getBoundingClientRect()
        agents[id] = { x: r.right - sr.left, y: r.top + r.height / 2 - sr.top }
      }
    }
    let opusIn: Point = { x: sr.width / 2, y: sr.height / 2 }
    let opusOut: Point = opusIn
    if (opusRef.current) {
      const r = opusRef.current.getBoundingClientRect()
      const cy = r.top + r.height / 2 - sr.top
      opusIn = { x: r.left - sr.left, y: cy }
      opusOut = { x: r.right - sr.left, y: cy }
    }
    let out: Point = { x: sr.width, y: sr.height / 2 }
    if (outputRef.current) {
      const r = outputRef.current.getBoundingClientRect()
      out = { x: r.left - sr.left, y: r.top - sr.top + 44 }
    }
    setGeo({ w: sr.width, h: sr.height, agents, opusIn, opusOut, out })
  }, [isDesktop])

  // Recompute when layout-affecting state changes (statuses, phase, concept count).
  const layoutSig = useMemo(
    () =>
      INTELLIGENCE_IDS.map((id) => workflow.agents[id].status).join('|') +
      workflow.opusPhase +
      concepts.length +
      (isDesktop ? 'd' : 'm'),
    [workflow.agents, workflow.opusPhase, concepts.length, isDesktop],
  )
  useLayoutEffect(() => {
    measure()
  }, [measure, layoutSig])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(stage)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  /* ----------------------------- Flying packets ---------------------------- */
  const [flying, setFlying] = useState<Flying[]>([])
  const seenRef = useRef(0)

  // New run resets the packet log to empty — clear in-flight + the cursor.
  useEffect(() => {
    if (workflow.packets.length === 0) {
      seenRef.current = 0
      setFlying([])
    }
  }, [workflow.packets.length])

  useEffect(() => {
    const all = workflow.packets
    if (all.length <= seenRef.current) return
    const fresh = all.slice(seenRef.current)
    seenRef.current = all.length
    if (!geo || reduced || !isDesktop) return
    const add: Flying[] = []
    for (const p of fresh) {
      if (p.from === 'opus') {
        add.push({ id: p.id, from: geo.opusOut, to: geo.out, label: p.label, opus: true })
      } else {
        const from = geo.agents[p.from]
        if (from) {
          add.push({
            id: p.id,
            from,
            to: geo.opusIn,
            label: p.label,
            colorClass: accentClass[AGENT_VISUAL[p.from].accent],
          })
        }
      }
    }
    if (add.length) setFlying((f) => [...f, ...add])
  }, [workflow.packets, geo, reduced, isDesktop])

  const removeFlying = useCallback((id: number) => {
    setFlying((f) => f.filter((x) => x.id !== id))
  }, [])

  /* -------------------------------- Derived -------------------------------- */
  const phases = useMemo(() => derivePhases(workflow), [workflow])
  const activeCodename = workflow.activeAgent ? INTELLIGENCE[workflow.activeAgent].codename : undefined
  const segments = useMemo<OpusSegment[]>(
    () =>
      INTELLIGENCE_IDS.map((id) => ({
        accent: AGENT_VISUAL[id].accent,
        lit: workflow.agents[id].status === 'complete',
      })),
    [workflow.agents],
  )
  const opusProps = {
    phase: workflow.opusPhase,
    activeCodename,
    inputs: workflow.receiveCount,
    receiveSignal: workflow.receiveCount,
    reduced,
    segments,
  }
  const runError = workflow.error || error
  const convergenceActive =
    INTELLIGENCE_IDS.some((id) => ACTIVE_STATUSES.includes(workflow.agents[id].status)) ||
    workflow.opusPhase === 'receiving' ||
    workflow.opusPhase === 'synthesising'

  /* ------------------------------- Fault state ----------------------------- */
  const [faultAck, setFaultAck] = useState(false)
  useEffect(() => {
    if (phase === 'firing') setFaultAck(false)
  }, [phase])
  const canContinue = concepts.length > 0 || reportedAgents(workflow).length > 0

  /* ------------------------------- Renderers ------------------------------- */
  const renderAgents = (withRefs: boolean) =>
    INTELLIGENCE_IDS.map((id) => (
      <AgentIntelligenceCard
        key={id}
        id={id}
        agent={workflow.agents[id]}
        reduced={reduced}
        cardRef={withRefs ? setAgentEl(id) : undefined}
      />
    ))

  const conceptsBlock =
    concepts.length > 0 ? (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-white">
            Generated Concepts
          </h3>
          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            {concepts.length}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:gap-3 xl:grid-cols-2">
          {concepts.map((c, i) => (
            <ConceptResultCard
              key={`${c.type}-${i}`}
              concept={c}
              index={i}
              image={imageFor(c)}
              imageMeta={imageMetaFor(c)}
              video={videoFor(c)}
              creativeState={creativeStateFor(c)}
              wantsVideo={controls.isVideoConcept(c)}
              hasRefs={controls.hasRefs}
              faceCount={controls.faceCount}
              refVideoCount={controls.refVideoCount}
              copied={controls.copied === c.text}
              onCopy={() => controls.onCopy(c.text)}
              onAnimate={(img) => controls.onAnimate(c, img)}
              onGenerateUGC={() => controls.onGenerateUGC(c)}
              onConfigureInStudio={() => controls.onConfigureInStudio(c)}
              onLaunchCanvas={() => controls.onLaunchCanvas(c)}
              onPushToMeta={() => controls.onPushToMeta(c)}
            />
          ))}
        </div>
      </div>
    ) : null

  return (
    <div className={cn('space-y-5', docHidden && 'reactor-paused')}>
      {/* Status header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-glow/70">
            Live Agent Workflow
          </span>
          {workflow.demo && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
              <FlaskConical size={10} /> Demo Intelligence Run
            </span>
          )}
        </div>
        {phase === 'firing' && !runError && (
          <span className="flex items-center gap-1.5 text-[11px] text-white/45">
            <span className="h-1.5 w-1.5 rounded-full bg-glow animate-pulse-glow" />
            Reactor operating
          </span>
        )}
      </div>

      {/* Reactor fault — clean, human-readable, premium */}
      {runError && !faultAck && (
        <div className="reactor-fault">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="reactor-fault__icon">
                <AlertTriangle size={18} />
              </span>
              <div className="max-w-xl">
                <p className="font-display text-sm font-bold uppercase tracking-[0.16em] text-danger">
                  Reactor Fault
                </p>
                <p className="mt-1 text-sm text-white/80">{runError}</p>
                <p className="mt-1 text-[11px] text-white/40">
                  Completed intelligence is preserved below. Full step detail is in Run Diagnostics.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={controls.onRetry}
                className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-3 py-1.5 text-[11px] font-semibold text-danger transition-colors hover:bg-danger/20"
              >
                <RotateCcw size={12} /> Retry Reactor
              </button>
              {canContinue && (
                <button
                  type="button"
                  onClick={() => setFaultAck(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/[0.08]"
                >
                  Continue with Available Intelligence <ArrowRight size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {runError && faultAck && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/[0.04] px-3 py-2 text-[11px] text-danger/70">
          <AlertTriangle size={12} className="shrink-0" />
          Reactor fault — continued with available intelligence. See Run Diagnostics for detail.
        </div>
      )}

      {/* ------------------------------- Desktop ------------------------------ */}
      {isDesktop ? (
        <div className="reactor-panel glass p-6 xl:p-8">
          <div ref={stageRef} className="reactor-stage relative">
            <div className="reactor-stage-bg" aria-hidden="true" />
            {geo && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${geo.w} ${geo.h}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <radialGradient id="conv-bloom">
                    <stop offset="0%" stopColor="#FFE3C8" stopOpacity="0.95" />
                    <stop offset="45%" stopColor="#38E8FF" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#FF6A3D" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="conv-core">
                    <stop offset="0%" stopColor="#FFF3E8" stopOpacity="1" />
                    <stop offset="55%" stopColor="#FFB07A" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#38E8FF" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {INTELLIGENCE_IDS.map((id) => {
                  const from = geo.agents[id]
                  if (!from) return null
                  const cs = connStateFor(workflow.agents[id].status)
                  return (
                    <AgentConnectionPath
                      key={id}
                      gid={`conn-${id}`}
                      from={from}
                      to={geo.opusIn}
                      color={AGENT_VISUAL[id].stroke}
                      toColor={OPUS_CORE}
                      active={cs.active}
                      complete={cs.complete}
                      dim={cs.dim}
                      direction={cs.direction}
                      reduced={reduced}
                      paused={docHidden}
                    />
                  )
                })}
                <AgentConnectionPath
                  gid="conn-output"
                  from={geo.opusOut}
                  to={geo.out}
                  color={OPUS_CORE}
                  toColor={OPUS_OUTPUT_STROKE}
                  tipColor="#E9F2FF"
                  active={workflow.opusPhase === 'generating'}
                  complete={workflow.opusPhase === 'ready'}
                  dim={!workflow.generationStarted && workflow.opusPhase !== 'ready'}
                  reduced={reduced}
                  paused={docHidden}
                />

                {/* Convergence flare where every channel meets the core */}
                <g>
                  {/* Soft outer bloom */}
                  <circle
                    cx={geo.opusIn.x}
                    cy={geo.opusIn.y}
                    r={26}
                    fill="url(#conv-bloom)"
                    className={cn('conv-bloom', convergenceActive && !reduced && 'conv-bloom--on')}
                  />
                  {/* Bright hot core — the impact point */}
                  <circle
                    cx={geo.opusIn.x}
                    cy={geo.opusIn.y}
                    r={12}
                    fill="url(#conv-core)"
                    className={cn('conv-core', convergenceActive && !reduced && 'conv-core--on')}
                  />
                  {/* Expanding arrival pulse — energy collecting into the core */}
                  {convergenceActive && !reduced && (
                    <circle
                      cx={geo.opusIn.x}
                      cy={geo.opusIn.y}
                      r={10}
                      fill="none"
                      stroke="#FFC89E"
                      strokeWidth={1.3}
                      opacity={0}
                    >
                      <animate
                        attributeName="r"
                        values="9;30"
                        dur="2.4s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.5;0"
                        dur="2.4s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                </g>
              </svg>
            )}

            <div className="relative grid grid-cols-[minmax(0,290px)_minmax(0,1fr)_minmax(0,380px)] items-center gap-8 xl:gap-10">
              <div className="space-y-3">{renderAgents(true)}</div>
              <div className="flex justify-center">
                <OpusReactorCore
                  {...opusProps}
                  coreRef={(el) => {
                    opusRef.current = el
                  }}
                />
              </div>
              <div ref={outputRef}>
                <EmergingStrategyPanel workflow={workflow} conceptCount={concepts.length} />
              </div>
            </div>

            {/* Flying intelligence packets (desktop, motion enabled) */}
            {!reduced && (
              <div className="pointer-events-none absolute inset-0 overflow-visible">
                <AnimatePresence>
                  {flying.map((p) => (
                    <IntelligencePacket
                      key={p.id}
                      from={p.from}
                      to={p.to}
                      label={p.label}
                      colorClass={p.colorClass}
                      opus={p.opus}
                      onDone={() => removeFlying(p.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* --------------------------- Tablet / Mobile --------------------------
           No measured SVG channels here: the desktop stage positions agent
           cards around the core and draws energy paths between the measured
           rectangles, which needs horizontal room the phone does not have.
           The same live state is carried by the core, the per-agent cards, and
           the strategy panel — stacked in the order the run moves through
           them. */
        <div className="reactor-panel glass space-y-4 p-3 sm:space-y-5 sm:p-6">
          <div className="flex justify-center py-1 sm:py-2">
            <OpusReactorCore {...opusProps} />
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            {renderAgents(false)}
          </div>
          <EmergingStrategyPanel workflow={workflow} conceptCount={concepts.length} />
        </div>
      )}

      {/* Generated concepts (full width, below the network) */}
      {conceptsBlock}

      {/* Execution phases + Run Diagnostics */}
      <ReactorPhaseTimeline phases={phases} reduced={reduced} />
      <TechnicalTelemetryDrawer telemetry={telemetry} firing={phase === 'firing'} failed={!!runError} />
    </div>
  )
}
