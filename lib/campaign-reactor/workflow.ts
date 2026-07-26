/**
 * Campaign Reactor — live workflow normalization layer.
 *
 * Turns the REAL Campaign Reactor SSE events (emitted by
 * `app/api/campaign-reactor/route.ts`) into a structured, render-ready workflow
 * state that drives the live agent animation. This is a pure reducer — no React,
 * no fabricated activity. Every status, finding, and count is derived from an
 * event the backend actually sent. If a layer is never consulted, it stays
 * dormant and is marked "Not Required" when the run completes.
 *
 * The Workbench/ReactorRunContext dispatches each parsed SSE event through
 * `reduceWorkflow`, so the workflow state lives in the existing run state — not
 * a competing store.
 */

import { INTELLIGENCE, INTELLIGENCE_IDS, isIntelligenceId, type IntelligenceId } from '@/lib/agents'

/* ----------------------------------- Types -------------------------------- */

export type AgentStatus =
  | 'dormant'
  | 'queued'
  | 'retrieving'
  | 'analysing'
  | 'reporting'
  | 'complete'
  | 'error'
  | 'notRequired'

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  dormant: 'Dormant',
  queued: 'Queued',
  retrieving: 'Retrieving',
  analysing: 'Analysing',
  reporting: 'Reporting',
  complete: 'Complete',
  error: 'Error',
  notRequired: 'Not Required',
}

/** Statuses that mean the layer is currently working (drives the scan glow). */
export const ACTIVE_STATUSES: AgentStatus[] = ['retrieving', 'analysing', 'reporting']

export type OpusPhase =
  | 'idle'
  | 'initialising'
  | 'delegating'
  | 'receiving'
  | 'synthesising'
  | 'evaluating'
  | 'generating'
  | 'ready'
  | 'error'

export const OPUS_PHASE_LABEL: Record<OpusPhase, string> = {
  idle: 'Idle',
  initialising: 'Initialising Intelligence Network',
  delegating: 'Delegating Analysis',
  receiving: 'Receiving Intelligence',
  synthesising: 'Synthesising Strategy',
  evaluating: 'Evaluating Concepts',
  generating: 'Generating Outputs',
  ready: 'Campaign Ready',
  error: 'Reactor Fault',
}

const OPUS_RANK: Record<OpusPhase, number> = {
  idle: 0,
  initialising: 1,
  delegating: 2,
  receiving: 2,
  synthesising: 3,
  evaluating: 4,
  generating: 5,
  ready: 6,
  error: 7,
}

export type PhaseId =
  | 'initialise'
  | 'knowledge'
  | 'market'
  | 'creative'
  | 'copy'
  | 'memory'
  | 'synthesis'
  | 'render'
  | 'pretest'
  | 'concepts'
  | 'complete'

export type PhaseStatus = 'pending' | 'active' | 'complete' | 'skipped' | 'error'

interface PhaseDef {
  id: PhaseId
  label: string
  /** When set, this phase mirrors a specific intelligence layer's lifecycle. */
  agent?: IntelligenceId
}

export const PHASE_DEFS: PhaseDef[] = [
  { id: 'initialise', label: 'Initialise' },
  { id: 'knowledge', label: 'Retrieve Knowledge', agent: 'atlas' },
  { id: 'market', label: 'Market Analysis', agent: 'nova' },
  { id: 'creative', label: 'Creative Analysis', agent: 'spark' },
  { id: 'copy', label: 'Copy Analysis', agent: 'echo' },
  { id: 'memory', label: 'Strategic Memory', agent: 'oracle' },
  { id: 'synthesis', label: 'Synthesis' },
  { id: 'render', label: 'Render Creative' },
  { id: 'pretest', label: 'NEURO Pre-Test' },
  { id: 'concepts', label: 'Generate Concepts' },
  { id: 'complete', label: 'Complete' },
]

export interface Finding {
  system: string
  title: string
}

export interface AgentRuntime {
  id: IntelligenceId
  status: AgentStatus
  /** The focused question OPUS delegated (when the backend reports it). */
  question?: string
  /** Real retrieval hits attributed to this layer during its consult. */
  findings: Finding[]
  /** The layer's one-line report (real model output). */
  summary?: string
  /** Builder-facing confidence band the backend computed from hit volume. */
  confidence?: string
}

export interface Packet {
  id: number
  /** Origin: an intelligence layer (finding → OPUS) or OPUS (strategy → output). */
  from: IntelligenceId | 'opus'
  to: 'opus' | 'output'
  label: string
}

export interface PhaseEntry {
  id: PhaseId
  label: string
  status: PhaseStatus
}

export interface WorkflowSeed {
  angle?: string
  audience?: string
  awareness?: string
  offer?: string
  outputs?: string[]
}

export interface WorkflowState {
  active: boolean
  finished: boolean
  demo: boolean
  opusPhase: OpusPhase
  agents: Record<IntelligenceId, AgentRuntime>
  /**
   * Every layer currently mid-consult, in the order they were delegated to.
   * OPUS batches independent consults into a single turn, so more than one
   * layer is routinely working at once.
   */
  activeAgents: IntelligenceId[]
  /** The most recently delegated layer still working — the core's headline. */
  activeAgent: IntelligenceId | null
  /** Append-only packet log; the view layer animates new entries. */
  packets: Packet[]
  packetSeq: number
  /** Every retrieval across the run — drives the "sources consulted" count. */
  retrievals: Finding[]
  /** Increments each time a finding lands at OPUS (drives the receive flare). */
  receiveCount: number
  generationStarted: boolean
  /** A visual creative (image/video) render has been kicked off this run. */
  renderStarted: boolean
  /** The NEURO predicted-response pre-test has begun / finished. */
  pretestStarted: boolean
  pretestComplete: boolean
  startedAt: number | null
  endedAt: number | null
  error: string | null
  lastDelegateDone: boolean
  config: WorkflowSeed
}

/* ------------------------------- Construction ----------------------------- */

function freshAgents(): Record<IntelligenceId, AgentRuntime> {
  return INTELLIGENCE_IDS.reduce(
    (acc, id) => {
      acc[id] = { id, status: 'dormant', findings: [] }
      return acc
    },
    {} as Record<IntelligenceId, AgentRuntime>,
  )
}

export function startWorkflow(seed: WorkflowSeed = {}): WorkflowState {
  return {
    active: true,
    finished: false,
    demo: false,
    opusPhase: 'initialising',
    agents: freshAgents(),
    activeAgents: [],
    activeAgent: null,
    packets: [],
    packetSeq: 0,
    retrievals: [],
    receiveCount: 0,
    generationStarted: false,
    renderStarted: false,
    pretestStarted: false,
    pretestComplete: false,
    startedAt: Date.now(),
    endedAt: null,
    error: null,
    lastDelegateDone: false,
    config: seed,
  }
}

export function idleWorkflow(): WorkflowState {
  return { ...startWorkflow(), active: false, opusPhase: 'idle', startedAt: null }
}

/* --------------------------------- Helpers -------------------------------- */

function bump(cur: OpusPhase, next: OpusPhase): OpusPhase {
  if (next === 'error') return 'error'
  if (cur === 'error') return cur
  // Allow same-tier swaps (delegating ⇄ receiving); never regress otherwise.
  if (OPUS_RANK[next] >= OPUS_RANK[cur]) return next
  return cur
}

/** Resolve the lowercase layer id from a delegate event (prefers `id`). */
function resolveAgentId(ev: Record<string, unknown>): IntelligenceId | null {
  const raw = (ev.id as string) || ''
  if (isIntelligenceId(raw)) return raw
  const codename = ((ev.agent as string) || '').toLowerCase()
  return isIntelligenceId(codename) ? codename : null
}

function clip(s: string, n = 26): string {
  const t = s.replace(/^[-•*\s]+/, '').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** A short, real label for the packet a layer sends into OPUS. */
function packetLabelFor(agent: AgentRuntime): string {
  // ORACLE's historical-winners report → a clean count chip.
  const m = agent.summary?.match(/Retrieved\s+(\d+)\s+matching\s+historical\s+winner/i)
  if (m) return `${m[1]} historical winner${m[1] === '1' ? '' : 's'}`
  const title = agent.findings[0]?.title
  if (title) return clip(title)
  if (agent.summary) return clip(agent.summary)
  return INTELLIGENCE[agent.id].intelligenceLabel
}

function pushPacket(state: WorkflowState, from: Packet['from'], to: Packet['to'], label: string) {
  const id = state.packetSeq + 1
  state.packetSeq = id
  state.packets = [...state.packets, { id, from, to, label }]
}

/* --------------------------------- Reducer -------------------------------- */

/**
 * Fold a single raw SSE event into the workflow state. Unknown event types are
 * passed through unchanged. The caller owns immutability at the boundary (we
 * shallow-clone here so React sees a new reference).
 */
export function reduceWorkflow(prev: WorkflowState, ev: Record<string, unknown>): WorkflowState {
  const type = ev.type as string
  const state: WorkflowState = {
    ...prev,
    agents: { ...prev.agents },
  }

  switch (type) {
    case 'step': {
      const text = String(ev.text ?? '')
      if (!state.startedAt) state.startedAt = Date.now()
      state.active = true
      if (/demo mode/i.test(text)) state.demo = true

      if (/synthesi/i.test(text)) {
        state.opusPhase = bump(state.opusPhase, 'synthesising')
      }
      if (/rubric|learnings|self-critique|scoring|evaluat/i.test(text)) {
        state.opusPhase = bump(state.opusPhase, 'evaluating')
      }
      if (/generating still|rendering |render(ing)?\b/i.test(text)) {
        state.opusPhase = bump(state.opusPhase, 'generating')
        state.generationStarted = true
        state.renderStarted = true
      }
      // NEURO predicted-response pre-test lifecycle — its own visible stage so
      // the back half of the run keeps advancing instead of resting on one node.
      if (/neuro[\s—-]+pre-?test complete|pre-test complete/i.test(text)) {
        state.pretestStarted = true
        state.pretestComplete = true
      } else if (/neuro|pre-?test|predicted response/i.test(text)) {
        state.pretestStarted = true
      }
      return state
    }

    case 'retrieval': {
      const finding: Finding = {
        system: String(ev.system ?? ''),
        title: String(ev.title ?? ''),
      }
      state.retrievals = [...state.retrievals, finding]
      // Prefer the layer the backend named. Falling back to "whoever started
      // most recently" is only correct for a single in-flight consult, and
      // OPUS is explicitly told to batch them.
      const id = resolveAgentId(ev) ?? state.activeAgent
      if (id) {
        const a = state.agents[id]
        const exists = a.findings.some((f) => f.title === finding.title && f.system === finding.system)
        state.agents[id] = {
          ...a,
          status: 'analysing',
          findings: exists ? a.findings : [...a.findings, finding],
        }
      }
      return state
    }

    case 'delegate': {
      const id = resolveAgentId(ev)
      if (!id) return state
      const status = ev.status as string
      if (status === 'start') {
        // Additive: a second layer starting does not evict the first.
        state.activeAgents = state.activeAgents.includes(id)
          ? state.activeAgents
          : [...state.activeAgents, id]
        state.activeAgent = id
        state.lastDelegateDone = false
        state.agents[id] = {
          ...state.agents[id],
          status: 'retrieving',
          question: (ev.question as string) || state.agents[id].question,
        }
        state.opusPhase = bump(state.opusPhase, 'delegating')
      } else if (status === 'done') {
        const merged: AgentRuntime = {
          ...state.agents[id],
          status: 'complete',
          summary: (ev.summary as string) || state.agents[id].summary,
          confidence: (ev.confidence as string) || state.agents[id].confidence,
        }
        state.agents[id] = merged
        // Hand the headline to whichever layer is still working, instead of
        // blanking it while its siblings are mid-consult.
        state.activeAgents = state.activeAgents.filter((a) => a !== id)
        state.activeAgent = state.activeAgents[state.activeAgents.length - 1] ?? null
        state.lastDelegateDone = true
        state.receiveCount += 1
        state.opusPhase = bump(state.opusPhase, 'receiving')
        pushPacket(state, id, 'opus', packetLabelFor(merged))
      }
      return state
    }

    case 'media': {
      state.generationStarted = true
      state.renderStarted = true
      state.opusPhase = bump(state.opusPhase, 'generating')
      return state
    }

    case 'concept': {
      state.generationStarted = true
      // Concepts only stream once NEURO has passed them, so their arrival
      // confirms the pre-test stage landed.
      state.pretestStarted = true
      state.pretestComplete = true
      state.opusPhase = bump(state.opusPhase, 'generating')
      const concept = ev.concept as { type?: string } | undefined
      if (concept?.type) pushPacket(state, 'opus', 'output', clip(concept.type, 22))
      return state
    }

    case 'error': {
      state.error = String(ev.message ?? 'Reactor failed')
      state.opusPhase = 'error'
      state.active = false
      state.finished = true
      state.endedAt = Date.now()
      // Every layer still mid-consult when the run faulted — not just the
      // most recent one — is the one that got cut off.
      for (const id of state.activeAgents) {
        state.agents[id] = { ...state.agents[id], status: 'error' }
      }
      state.activeAgents = []
      state.activeAgent = null
      return state
    }

    case 'done': {
      state.active = false
      state.finished = true
      state.endedAt = Date.now()
      state.activeAgents = []
      state.activeAgent = null
      state.opusPhase = state.opusPhase === 'error' ? 'error' : 'ready'
      // Any layer that never reported is genuinely Not Required for this run;
      // a layer cut off mid-stream still produced evidence, so mark it complete.
      for (const id of INTELLIGENCE_IDS) {
        const a = state.agents[id]
        if (a.status === 'dormant' || a.status === 'queued') {
          state.agents[id] = { ...a, status: 'notRequired' }
        } else if (a.status === 'retrieving' || a.status === 'analysing' || a.status === 'reporting') {
          state.agents[id] = { ...a, status: 'complete' }
        }
      }
      return state
    }

    default:
      return state
  }
}

/* ------------------------- Derived view selectors ------------------------- */

/** Build the bottom phase timeline from the live agent + run state. */
export function derivePhases(state: WorkflowState): PhaseEntry[] {
  const anyAgentTouched = INTELLIGENCE_IDS.some((id) => state.agents[id].status !== 'dormant')
  const reachedSynthesis = OPUS_RANK[state.opusPhase] >= OPUS_RANK.synthesising
  const reachedGenerate = state.generationStarted

  return PHASE_DEFS.map((def): PhaseEntry => {
    let status: PhaseStatus = 'pending'

    if (def.agent) {
      const a = state.agents[def.agent]
      if (a.status === 'error') status = 'error'
      else if (a.status === 'complete') status = 'complete'
      else if (ACTIVE_STATUSES.includes(a.status)) status = 'active'
      else if (a.status === 'notRequired') status = 'skipped'
      else status = state.finished ? 'skipped' : 'pending'
    } else if (def.id === 'initialise') {
      if (state.error && !anyAgentTouched) status = 'error'
      else if (anyAgentTouched || reachedSynthesis || state.finished) status = 'complete'
      else if (state.active) status = 'active'
    } else if (def.id === 'synthesis') {
      if (state.renderStarted || state.pretestStarted || reachedGenerate || state.opusPhase === 'ready')
        status = 'complete'
      else if (reachedSynthesis) status = 'active'
      else if (state.finished) status = 'skipped'
    } else if (def.id === 'render') {
      // Optional stage — only visual runs render creative. Complete once the
      // pre-test/concepts move past it; skipped if the run finishes copy-only.
      if (state.pretestStarted || state.opusPhase === 'ready') status = state.renderStarted ? 'complete' : 'skipped'
      else if (state.renderStarted) status = 'active'
      else if (state.finished) status = 'skipped'
    } else if (def.id === 'pretest') {
      if (state.pretestComplete || state.opusPhase === 'ready') status = 'complete'
      else if (state.pretestStarted) status = 'active'
      else if (state.finished) status = 'skipped'
    } else if (def.id === 'concepts') {
      if (state.opusPhase === 'ready') status = 'complete'
      else if (reachedGenerate) status = 'active'
      else if (state.finished) status = 'skipped'
    } else if (def.id === 'complete') {
      if (state.opusPhase === 'ready') status = 'complete'
      else if (state.error) status = 'error'
    }

    return { id: def.id, label: def.label, status }
  })
}

export function elapsedLabel(state: WorkflowState): string | null {
  if (!state.startedAt) return null
  const end = state.endedAt ?? Date.now()
  const secs = Math.max(0, Math.round((end - state.startedAt) / 1000))
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/** Layers that actually contributed evidence this run (for the summary). */
export function reportedAgents(state: WorkflowState): IntelligenceId[] {
  return INTELLIGENCE_IDS.filter((id) => {
    const s = state.agents[id].status
    return s === 'complete' || ACTIVE_STATUSES.includes(s)
  })
}
