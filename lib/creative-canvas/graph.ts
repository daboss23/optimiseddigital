/**
 * Creative Canvas — graph model.
 *
 * The Creative Canvas is the structured creative operating layer between the
 * Campaign Reactor (strategy → concepts) and the Studio (one finished ad). This
 * module turns a finished run into the canvas's initial node graph: one lane
 * per concept, a fixed left-to-right message spine per lane, and — in montage
 * mode — one scene node per production-brief frame.
 *
 * Pure data (no React, no DOM) so the surface, the detail panel, and tests can
 * share the shapes. Positions are computed here so the layout is deterministic
 * and structured — never a free-form spiderweb.
 */

import type { Concept } from '@/components/campaign-reactor/ReactorRunContext'
import type { Accent } from '@/components/reactor/ui'

/* ------------------------------- Node kinds ------------------------------- */

export type CanvasNodeKind = 'hook' | 'message' | 'proof' | 'visual' | 'scene' | 'cta' | 'output'

export interface KindDef {
  kind: CanvasNodeKind
  label: string
  accent: Accent
  hint: string
  /** Whether Regenerate is offered for this node kind. */
  regen: boolean
  /** Whether Branch (controlled alternates) is offered. */
  branch: boolean
}

export const KIND_DEFS: Record<CanvasNodeKind, KindDef> = {
  hook: {
    kind: 'hook',
    label: 'Hook',
    accent: 'emerald',
    hint: 'The scroll-stopper — first line, before the fold',
    regen: true,
    branch: true,
  },
  message: {
    kind: 'message',
    label: 'Message',
    accent: 'cyan',
    hint: 'The argument — mechanism, story, and stakes',
    regen: true,
    branch: true,
  },
  proof: {
    kind: 'proof',
    label: 'Proof',
    accent: 'blue',
    hint: 'What grounds this — the winning assets it draws from',
    // Regeneration is allowed (a card reassigned INTO the proof role needs a
    // proof written for it) — retrieved-evidence proof nodes stay safe because
    // they arrive locked by default, and locked nodes never regenerate.
    regen: true,
    branch: false,
  },
  visual: {
    kind: 'visual',
    label: 'Visual Direction',
    accent: 'violet',
    hint: 'What the creative shows',
    regen: true,
    branch: true,
  },
  scene: {
    kind: 'scene',
    label: 'Scene',
    accent: 'violet',
    hint: 'One beat of the montage',
    regen: true,
    branch: false,
  },
  cta: {
    kind: 'cta',
    label: 'CTA',
    accent: 'amber',
    hint: 'The ask — headline and button',
    regen: true,
    branch: true,
  },
  output: {
    kind: 'output',
    label: 'Output',
    accent: 'pink',
    hint: 'The assembled ad unit — send it to the Studio',
    regen: false,
    branch: false,
  },
}

/* ------------------------------ Canvas modes ------------------------------ */

/** The canvas adapts its structure to what the brief asked for. */
export type CanvasMode = 'montage' | 'video' | 'static' | 'mixed'

export const MODE_LABELS: Record<CanvasMode, string> = {
  montage: 'Montage / Scene Flow',
  video: 'Short-Form Video',
  static: 'Static Image',
  mixed: 'Mixed Deliverables',
}

export function canvasMode(outputs: string[] | undefined, montage: boolean): CanvasMode {
  const o = (outputs ?? []).map((s) => s.toLowerCase())
  if (montage || o.some((s) => /montage|scene/.test(s))) return 'montage'
  const video = o.some((s) => /video|ugc/.test(s))
  const still = o.some((s) => /static|carousel/.test(s))
  if (video && still) return 'mixed'
  if (video) return 'video'
  if (still) return 'static'
  return 'mixed'
}

/* ------------------------------ Format tracks ------------------------------ */

/**
 * A format track — one tab inside the campaign. One campaign carries ONE
 * shared strategy layer; each selected creative format opens as its own tab
 * with its own canvas flow and node structure. Formats are never mixed into
 * a single graph.
 */
export interface CanvasTrack {
  id: CanvasMode
  label: string
}

const TRACK_LABELS: Partial<Record<CanvasMode, string>> = {
  static: 'Image',
  video: 'Video',
  montage: 'Montage',
}

/**
 * Derive the campaign's format tabs from the brief's deliverables, in a fixed
 * presentation order (Image → Video → Montage → Variations → Recommended).
 * Selecting one format yields one track; the tab bar only appears at 2+.
 */
export function canvasTracks(outputs: string[] | undefined, montage: boolean): CanvasTrack[] {
  const o = (outputs ?? []).map((s) => s.toLowerCase())
  const tracks: CanvasTrack[] = []
  const add = (id: CanvasMode) => {
    if (!tracks.some((t) => t.id === id)) tracks.push({ id, label: TRACK_LABELS[id] ?? MODE_LABELS[id] })
  }
  if (o.some((s) => /static|carousel/.test(s))) add('static')
  if (o.some((s) => /video|ugc/.test(s))) add('video')
  if (montage || o.some((s) => /montage|scene/.test(s))) add('montage')
  if (tracks.length === 0) {
    const single = canvasMode(outputs, montage)
    tracks.push({ id: single, label: TRACK_LABELS[single] ?? MODE_LABELS[single] })
  }
  return tracks
}

/**
 * The concepts a track builds its lanes from. Each format tab pulls the run's
 * concepts that match its medium; when the run produced nothing tagged for a
 * format, the tab falls back to all visual concepts so it is never empty —
 * the shared strategy still powers it, only the flow shape differs.
 */
export function conceptsForTrack(concepts: Concept[], track: CanvasMode): Concept[] {
  const visual = concepts.filter(isVisualConcept)
  const pick = (re: RegExp) => visual.filter((c) => re.test(c.type))
  let matched: Concept[]
  switch (track) {
    case 'static':
      matched = pick(/static|campaign|event/i)
      break
    case 'video':
      matched = pick(/video|founder|testimonial/i)
      break
    case 'montage':
      // Montage lanes need a scene sequence — prefer concepts with briefs.
      matched = visual.filter((c) => c.productionBrief?.frames?.length)
      break
    default:
      matched = visual
  }
  return matched.length ? matched : concepts
}

/* ------------------------------- Node data -------------------------------- */

/**
 * The data payload of every canvas node. Indexed by React Flow, so it must
 * stay a plain record — live run lookups (media, loading states) happen via
 * context in the component layer, never in here.
 */
export interface CanvasNodeData {
  kind: CanvasNodeKind
  title: string
  text: string
  /** Small supporting line (basis, CTA type, scene direction …). */
  sub?: string
  score?: number
  locked: boolean
  approved: boolean
  /** Which concept lane this node belongs to. */
  lane: number
  /** Scene order inside a montage lane. */
  sceneIdx?: number
  /** 0 = primary; >0 = controlled alternate created by Branch. */
  branchIdx: number
  /** Render prompt for visual/scene nodes (falls back to text). */
  prompt?: string
  [key: string]: unknown
}

export interface CanvasGraphNode {
  id: string
  position: { x: number; y: number }
  data: CanvasNodeData
}

export interface CanvasGraphEdge {
  id: string
  source: string
  target: string
  branch?: boolean
}

export interface CanvasGraph {
  nodes: CanvasGraphNode[]
  edges: CanvasGraphEdge[]
  mode: CanvasMode
}

/* ------------------------------ Layout grid ------------------------------- */

export const NODE_W = 250
const COL_GAP = 60
const COL_W = NODE_W + COL_GAP
export const LANE_H = 320
export const BRANCH_DY = 165

/* ------------------------------- Utilities -------------------------------- */

/** Split primary text into hook (first line/sentence) + the rest. */
export function splitHook(text: string): { hook: string; body: string } {
  const t = (text ?? '').trim()
  if (!t) return { hook: '', body: '' }
  const nl = t.indexOf('\n')
  if (nl !== -1) return { hook: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() }
  const m = t.match(/^.*?[.!?](\s|$)/)
  if (m && m[0].length < t.length) return { hook: m[0].trim(), body: t.slice(m[0].length).trim() }
  return { hook: t, body: '' }
}

/** Concepts that carry a creative (the canvas's lanes). */
export const isVisualConcept = (c: Concept) => c.type.includes('Concept')

/* ------------------------------ Graph builder ----------------------------- */

const MAX_LANES = 4

/**
 * Build the canvas's opening structure from a finished run. The system builds
 * the first strategic structure; the user shapes, branches, and directs it.
 */
export function buildCanvasGraph(concepts: Concept[], mode: CanvasMode): CanvasGraph {
  const lanes = concepts.filter(isVisualConcept).slice(0, MAX_LANES)
  // A copy-only run still gets one lane built from the best-scoring concept.
  if (lanes.length === 0 && concepts.length > 0) {
    lanes.push([...concepts].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0])
  }

  const nodes: CanvasGraphNode[] = []
  const edges: CanvasGraphEdge[] = []

  lanes.forEach((c, lane) => {
    const y = lane * LANE_H
    const pkg = c.adPackage
    const { hook, body } = pkg ? splitHook(pkg.primaryText) : splitHook(c.text)
    const brief = c.productionBrief
    const id = (kind: string, i = 0) => `l${lane}-${kind}${i ? `-${i}` : ''}`
    let col = 0

    const push = (
      kind: CanvasNodeKind,
      nodeId: string,
      data: Partial<CanvasNodeData> & { title: string; text: string },
    ) => {
      nodes.push({
        id: nodeId,
        position: { x: col * COL_W, y },
        data: {
          kind,
          locked: false,
          approved: false,
          lane,
          branchIdx: 0,
          score: c.score,
          ...data,
        } as CanvasNodeData,
      })
      col += 1
    }

    const link = (a: string, b: string) => edges.push({ id: `${a}→${b}`, source: a, target: b })

    // The message spine: hook → message → proof → scenes|visual → cta → output.
    push('hook', id('hook'), {
      title: `Hook — ${c.type}`,
      text: hook || c.text,
      sub: KIND_DEFS.hook.hint,
    })

    push('message', id('message'), {
      title: mode === 'video' || mode === 'montage' ? 'Script / VO' : 'Message',
      text: body || c.text,
      sub: KIND_DEFS.message.hint,
    })
    link(id('hook'), id('message'))

    let prev = id('message')
    if (c.basis) {
      push('proof', id('proof'), {
        title: 'Proof & Grounding',
        text: c.basis,
        sub: 'Retrieved from the Vault — locked by default',
        locked: true,
      })
      link(prev, id('proof'))
      prev = id('proof')
    }

    if (mode === 'montage' && brief?.frames?.length) {
      brief.frames.forEach((f, i) => {
        const sid = id('scene', i + 1)
        push('scene', sid, {
          title: f.label || `Scene ${i + 1}`,
          text: f.description,
          sub: brief.creativeType,
          sceneIdx: i,
          prompt: f.description,
        })
        link(prev, sid)
        prev = sid
      })
    } else {
      const visualText = brief?.frames?.length
        ? brief.frames.map((f, i) => `${f.label || `Frame ${i + 1}`}: ${f.description}`).join('\n')
        : c.text
      push('visual', id('visual'), {
        title: 'Visual Direction',
        text: visualText,
        sub: brief?.creativeType ?? c.type,
        prompt: visualText,
      })
      link(prev, id('visual'))
      prev = id('visual')
    }

    push('cta', id('cta'), {
      title: 'CTA',
      text: pkg?.headline ?? '',
      sub: pkg?.cta ? `Button: ${pkg.cta.replace(/_/g, ' ')}` : KIND_DEFS.cta.hint,
    })
    link(prev, id('cta'))

    push('output', id('output'), {
      title: c.type,
      text: 'Launch-ready ad unit assembled from this lane.',
      sub: typeof c.score === 'number' ? `Rubric ${c.score}/10` : undefined,
    })
    link(id('cta'), id('output'))
  })

  return { nodes, edges, mode }
}
