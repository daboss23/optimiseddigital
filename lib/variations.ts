/**
 * Per-creative variation system — the single source of truth.
 *
 * A VARIATION is a meaningfully different execution of one creative format.
 * It is NOT a resized export, and it is NOT a separate deliverable: every
 * selected format carries its own count and its own "what should vary" lever,
 * configured under that format's size cards on the Formats step.
 *
 * Everything that touches variations reads from this module — the modal UI, the
 * orchestrator prompt, the submit gate, the Ignition summary and the outcome
 * attribution — so the count the builder picks, the instruction OPUS receives,
 * the number of cards that come back and the lever ORACLE learns from can never
 * drift apart. Same discipline as `lib/meta-ads.ts`.
 *
 * WHY THE LEVER MATTERS: holding everything constant except one lever is what
 * makes a variation set attributable. Two ads that differ in every respect
 * teach nothing when one wins; five ads that differ only in their hook teach
 * which hook won. That stamp rides through to `campaign_outcomes` so the Meta
 * performance ingest grades a controlled test rather than a pile of one-offs.
 */

import type { IterationAxis } from './taxonomy'

/* ------------------------------- The count -------------------------------- */

/**
 * The variation ladder. Deliberately stops at 4.
 *
 * Every concept costs a production brief, an ad package, a NEURO pre-test and a
 * real image/video render, all inside ONE streamed function bounded by
 * `REACTOR_BUDGET_MS` (280s against a 300s host ceiling). Four formats at ×4
 * already crowds that budget; a ×10 ladder would routinely trip the run's
 * time-limit path and hand back a truncated campaign. Raise this only when the
 * hosting plan allows a longer function, or when rendering moves off the
 * request path.
 */
export const VARIATION_COUNTS = [1, 2, 3, 4] as const
export const MIN_VARIATIONS = 1
export const MAX_VARIATIONS = 4

/** The count a newly selected format starts on. */
export const DEFAULT_VARIATION_COUNT = 2

/** Clamp any inbound number (client payload, legacy field) onto the ladder. */
export function clampVariationCount(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return MIN_VARIATIONS
  return Math.min(Math.max(v, MIN_VARIATIONS), MAX_VARIATIONS)
}

/* ------------------------------ The methods ------------------------------- */

export const VARIATION_METHODS = ['smart-mix', 'hooks', 'angles', 'visual-execution', 'copy'] as const
export type VariationMethod = (typeof VARIATION_METHODS)[number]

/** The method a format starts on the first time the builder goes above ×1. */
export const DEFAULT_VARIATION_METHOD: VariationMethod = 'smart-mix'

export function isVariationMethod(v: unknown): v is VariationMethod {
  return typeof v === 'string' && (VARIATION_METHODS as readonly string[]).includes(v)
}

/** Fall back to the recommended method rather than rejecting an unknown value. */
export function coerceVariationMethod(v: unknown): VariationMethod {
  return isVariationMethod(v) ? v : DEFAULT_VARIATION_METHOD
}

/**
 * Pill labels. Short on purpose — the control sits under the size grid and must
 * stay visually quieter than the count cards. The internal id stays descriptive
 * (`visual-execution`) while the builder reads "Visuals".
 */
export const VARIATION_METHOD_LABEL: Record<VariationMethod, string> = {
  'smart-mix': 'Smart Mix',
  hooks: 'Hooks',
  angles: 'Angles',
  'visual-execution': 'Visuals',
  copy: 'Copy',
}

/* ------------------------------- The formats ------------------------------ */

/**
 * The creative families variation language is written for. Derived from the
 * selected deliverable by regex rather than exact string match, so a renamed
 * or newly added deliverable degrades to the closest family instead of
 * throwing — the same tolerance the orchestrator's own output-type expansion
 * uses.
 */
export const VARIATION_FORMATS = ['static', 'video', 'ugc', 'carousel', 'montage'] as const
export type VariationFormat = (typeof VARIATION_FORMATS)[number]

/**
 * Copy-only outputs — a hook, a headline, a VSL opener. These are NOT creative
 * formats and carry no variation settings.
 *
 * They need their own answer rather than falling through to a default, because
 * a default swallows them: with `static` as the fallback, "Hook" and "Static
 * Creative" landed in the same bucket, and whichever came first in the brief
 * decided the count for both. That is exactly how a ×3 static run shipped one
 * static.
 */
const COPY_ONLY_RE = /^(hook|headline|primary text|description|cta|caption|vsl)/i

/**
 * The creative family an output belongs to, or null when it is copy rather than
 * a creative format. Callers that must have a family (rendering a summary for a
 * deliverable the builder actually selected) fall back to `static` themselves,
 * so the null case stays visible at every call site instead of being hidden here.
 */
export function variationFormat(output: string): VariationFormat | null {
  const l = output.toLowerCase()
  if (COPY_ONLY_RE.test(l.trim())) return null
  if (/ugc|testimonial/.test(l)) return 'ugc'
  if (/carousel/.test(l)) return 'carousel'
  if (/montage|scene/.test(l)) return 'montage'
  if (/video|motion|founder/.test(l)) return 'video'
  if (/static|image|concept|creative|campaign|event/.test(l)) return 'static'
  return null
}

/** Singular noun for the live summary — "3 UGC variations", "1 Static creative". */
export const FORMAT_NOUN: Record<VariationFormat, string> = {
  static: 'Static',
  video: 'Video',
  ugc: 'UGC',
  carousel: 'Carousel',
  montage: 'Montage',
}

/* --------------------------- The method × format matrix ------------------- */

/**
 * What each lever means for each format, in the builder's words.
 *
 * `summary` completes the live line under the configuration ("… · different
 * headlines and first-read statements"). `directive` is the instruction OPUS
 * receives. They are written as a pair so the promise on screen and the
 * instruction on the wire say the same thing.
 *
 * Language is format-aware because generic language is wrong language: a static
 * ad has no "first three seconds", a UGC clip has no "first card", and a
 * carousel has no "spoken opening". A lever described in terms the format can't
 * express is an instruction the model has to reinterpret — which is exactly how
 * a controlled variation set quietly becomes five unrelated ads.
 */
interface MethodCopy {
  summary: string
  directive: string
}

const MATRIX: Record<VariationFormat, Record<VariationMethod, MethodCopy>> = {
  static: {
    'smart-mix': {
      summary: 'different headlines, proof treatments and visual concepts',
      directive:
        'Distribute the differences across the headline, the proof treatment and the visual concept. Every version must still read as the same campaign — one recognisable offer, one recognisable promise.',
    },
    hooks: {
      summary: 'different headlines and first-read statements',
      directive:
        'Hold the concept, the proof and the visual construction constant. Change ONLY the headline — the first statement the eye lands on. Each version takes a genuinely different attention device (direct problem, specific number, named member result, contrarian claim, question).',
    },
    angles: {
      summary: 'different strategic messages',
      directive:
        'Hold the offer, the audience and the objective constant. Change the strategic entry point — the reason this audience should care right now. A different angle per version, each one a distinct argument for the same offer.',
    },
    'visual-execution': {
      summary: 'different visual executions',
      directive:
        'Hold the central message, the headline promise and the proof constant. Change ONLY the visual construction — composition, imagery, design treatment, colour role assignment. The words may be reset to fit the layout but must not change what they claim.',
    },
    copy: {
      summary: 'different primary copy, headlines and CTAs',
      directive:
        'Hold the strategic concept and the visual direction constant. Change the written execution — primary text, headline, description and CTA treatment. Same picture, same argument, different words.',
    },
  },
  video: {
    'smart-mix': {
      summary: 'different openings, narratives and visual treatments',
      directive:
        'Distribute the differences across the opening, the narrative shape and the visual treatment. Every version must remain recognisably the same campaign.',
    },
    hooks: {
      summary: 'different opening scenes and opening lines',
      directive:
        'Hold the narrative, the proof and the production treatment constant. Change ONLY the first three seconds — the opening scene and opening line. Each version takes a genuinely different attention device.',
    },
    angles: {
      summary: 'different narrative approaches',
      directive:
        'Hold the offer, the audience and the objective constant. Change the narrative approach — the argument the video makes for the same offer.',
    },
    'visual-execution': {
      summary: 'different scenes, compositions and production treatments',
      directive:
        'Hold the script intent and the message constant. Change ONLY the visual production — scenes, compositions, setting, shot treatment and pacing.',
    },
    copy: {
      summary: 'different scripts, supers and CTAs',
      directive:
        'Hold the visual treatment and the strategic concept constant. Change the written execution — script lines, on-screen supers, headline and CTA.',
    },
  },
  ugc: {
    'smart-mix': {
      summary: 'different hooks, deliveries and opening moments',
      directive:
        'Distribute the differences across the spoken hook, the delivery and the opening moment. Every version must remain recognisably the same campaign.',
    },
    hooks: {
      summary: 'different spoken openings and first three seconds',
      directive:
        'Hold the story, the proof and the creator direction constant. Change ONLY the spoken opening — the first line out of the creator’s mouth and the moment it is delivered in.',
    },
    angles: {
      summary: 'different reasons the audience should care',
      directive:
        'Hold the offer, the audience and the objective constant. Change the reason this creator gives for why it matters — a distinct argument per version.',
    },
    'visual-execution': {
      summary: 'different creators, settings and shot treatments',
      directive:
        'Hold the script intent and the message constant. Change ONLY the on-camera execution — creator archetype, setting, framing and shot treatment.',
    },
    copy: {
      summary: 'different scripts, headlines and CTAs',
      directive:
        'Hold the creator direction and the strategic concept constant. Change the spoken script, the headline and the CTA treatment.',
    },
  },
  carousel: {
    'smart-mix': {
      summary: 'different first cards, proof orders and story structures',
      directive:
        'Distribute the differences across the first card, the order proof is revealed in and the overall story structure. Every version must remain recognisably the same campaign.',
    },
    hooks: {
      summary: 'different first-card messages',
      directive:
        'Hold the card sequence, the proof and the design system constant. Change ONLY card one — the message that decides whether the swipe happens.',
    },
    angles: {
      summary: 'different stories and strategic approaches',
      directive:
        'Hold the offer, the audience and the objective constant. Change the story the sequence tells — a distinct argument per version.',
    },
    'visual-execution': {
      summary: 'different card compositions and design treatments',
      directive:
        'Hold the card messages and the sequence constant. Change ONLY the design — card composition, imagery and treatment.',
    },
    copy: {
      summary: 'different card copy, headlines and CTAs',
      directive:
        'Hold the design system and the strategic concept constant. Change the card copy, the headline and the CTA treatment.',
    },
  },
  montage: {
    'smart-mix': {
      summary: 'different openings, scene orders and pacing',
      directive:
        'Distribute the differences across the opening sequence, the scene order and the pacing. Every version must remain recognisably the same campaign.',
    },
    hooks: {
      summary: 'different opening sequences',
      directive:
        'Hold the scene inventory, the narrative emphasis and the treatment constant. Change ONLY the opening sequence — the first scene and how it enters.',
    },
    angles: {
      summary: 'different narrative emphasis',
      directive:
        'Hold the offer, the audience and the objective constant. Change what the montage argues — which thread the scene flow emphasises.',
    },
    'visual-execution': {
      summary: 'different footage selections and scene treatments',
      directive:
        'Hold the narrative and the message constant. Change ONLY the footage selection, the scene treatment and the cut rhythm.',
    },
    copy: {
      summary: 'different supers, voiceover and CTA treatments',
      directive:
        'Hold the scene flow and the strategic concept constant. Change the on-screen supers, the voiceover lines and the CTA treatment.',
    },
  },
}

/** The builder-facing tail of the live summary line for one configuration. */
export function methodSummary(format: VariationFormat, method: VariationMethod): string {
  return MATRIX[format][method].summary
}

/** The orchestrator instruction for one configuration. */
export function methodDirective(format: VariationFormat, method: VariationMethod): string {
  return MATRIX[format][method].directive
}

/* --------------------------- Controlled-variation rule -------------------- */

/**
 * What every version in a set must hold constant, whatever the lever.
 *
 * Without this the model drifts: asked for five hook variations it starts
 * inventing new offers by version four, and the set stops being a test. Stated
 * once here and injected once per run rather than repeated per format.
 */
export const CONTROLLED_VARIATION_RULE = [
  'CONTROLLED VARIATION — every version inside one format’s set must hold ALL of the following constant:',
  'the selected audience, the campaign offer, the campaign objective, the brand voice, the required proof standard, and every compliance constraint.',
  'Versions are alternative executions of ONE campaign, never separate campaigns. If two versions could plausibly belong to different offers, they are wrong.',
  'Each version must name, in its basis, the specific difference it carries — the one lever that moved (e.g. "Hook: specific-dollar claim"). That label is what the performance loop grades the set by, so it must be concrete, not "variation 2".',
].join(' ')

/* ------------------------------ Prompt block ------------------------------ */

export interface VariationConfig {
  /** The deliverable label exactly as the builder selected it. */
  output: string
  count: number
  method: VariationMethod
}

/**
 * Build the per-format variation block for the orchestrator system prompt.
 *
 * Replaces the old single global "produce N of everything" line: each format
 * carries its own count and its own lever, so a run can legitimately ask for
 * three hook variations of the video and one static.
 */
export function variationPromptBlock(configs: VariationConfig[]): string {
  const active = configs.filter((c) => c.count > 1)
  const lines: string[] = [
    'DELIVERABLE COUNTS — produce exactly this many concepts for each format, no more and no less:',
  ]

  for (const c of configs) {
    const fmt = variationFormat(c.output) ?? 'static'
    if (c.count <= 1) {
      lines.push(`• ${c.output} — 1 concept.`)
      continue
    }
    lines.push(
      `• ${c.output} — ${c.count} concepts, varying ${VARIATION_METHOD_LABEL[c.method].toUpperCase()}. ${methodDirective(fmt, c.method)}`,
    )
  }

  if (active.length > 0) lines.push('', CONTROLLED_VARIATION_RULE)

  lines.push(
    '',
    'Do NOT split one format into several internal concept categories, and do NOT generate an extra "core" concept on top of the counts above — the number stated is the TOTAL for that format.',
  )

  return lines.join('\n')
}

/* ------------------------------ Live summary ------------------------------ */

/**
 * The one-line summary under a format's configuration on the Formats step, and
 * the same line reused on the Ignition review so the two can never disagree.
 *
 * Sizes are deliberately absent from the variation count: a size is a placement
 * adaptation of a variation, never another variation.
 */
export function variationSummary(output: string, count: number, method: VariationMethod, sizes: string[] = []): string {
  const fmt = variationFormat(output) ?? 'static'
  const noun = FORMAT_NOUN[fmt]
  const head = count > 1 ? `${count} ${noun} variations` : `1 ${noun} creative`
  const parts = [head]
  if (sizes.length > 0) parts.push(sizes.join(' + '))
  if (count > 1) parts.push(methodSummary(fmt, method))
  return parts.join(' · ')
}

/* ---------------------------- Outcome attribution ------------------------- */

/**
 * The variation methods that map cleanly onto an existing ORACLE iteration axis.
 *
 * Only two do, and that is deliberate — `isolatedAxis` is a closed taxonomy the
 * Isolation Configurator writes to, and forcing "angles" or "copy" into it
 * would file them under a value that does not describe them. Those sets are
 * still fully attributable through `variationMethod` + the per-version label;
 * they simply do not claim an axis they are not testing.
 */
export const METHOD_ITERATION_AXIS: Partial<Record<VariationMethod, IterationAxis>> = {
  hooks: 'hook',
  'visual-execution': 'visualFormat',
}

/* --------------------------- Resolving a request -------------------------- */

/** The variation-bearing fields of a reactor request, kept structural so this
 *  module stays free of a circular import back to `reactor-inputs`. */
export interface VariationRequest {
  outputTypes?: string[]
  variationCounts?: Record<string, number>
  variationMethods?: Record<string, VariationMethod>
  /** @deprecated legacy global count — seeds every format when the maps are absent. */
  variations?: number
}

/**
 * Resolve one config per selected deliverable, in the order the builder picked
 * them. This is the single place the legacy global `variations` field is
 * honoured: an older client (or a stored request) that sends only that number
 * applies it to every format, so nothing silently drops to ×1.
 *
 * Anything unselected, unrecognised or out of range lands on the defaults
 * rather than throwing — a malformed count must never take down a run.
 */
export function resolveVariationConfigs(req: VariationRequest): VariationConfig[] {
  const outputs = req.outputTypes ?? []
  const legacy = req.variations === undefined ? undefined : clampVariationCount(req.variations)

  return outputs
    // Copy-only deliverables are dropped rather than defaulted to ×1: leaving
    // them in gave the creative families a phantom sibling that competed for
    // the same bucket in the count gate and the demo fan-out.
    .filter((output) => variationFormat(output) !== null)
    .map((output) => ({
      output,
      count: clampVariationCount(req.variationCounts?.[output] ?? legacy ?? MIN_VARIATIONS),
      method: coerceVariationMethod(req.variationMethods?.[output]),
    }))
}

/** Total concepts a request should yield — the number of cards the run owes. */
export function totalVariations(configs: VariationConfig[]): number {
  return configs.reduce((n, c) => n + c.count, 0)
}

/* ------------------------------- Demo mode -------------------------------- */

/**
 * Per-lever variant labels for the keyless demo run.
 *
 * The demo exists to prove the wiring, so it must tell the SAME story the live
 * path does: pick Hooks and the demo's versions differ by hook and say so, on
 * the same `variationLabel` field a real run stamps. A generic "Variation 2"
 * here would make the no-key walkthrough demonstrate a system that does not
 * exist.
 */
export const DEMO_VARIATION_LABELS: Record<VariationMethod, string[]> = {
  'smart-mix': ['Direct problem open', 'After-state open', 'Contrarian claim', 'Named member proof'],
  hooks: ['Direct problem hook', 'Specific-dollar hook', 'Member-result hook', 'Contrarian hook'],
  angles: ['Profit leak', 'Time freedom', 'Operator to owner', 'Cash-flow control'],
  'visual-execution': ['Split-screen before/after', 'Single stark stat', 'On-site documentary', 'Bold type block'],
  copy: ['Short punch copy', 'Story-led primary', 'Objection-first', 'Proof-stacked'],
}

/** The demo's one-line explanation of how a version differs, for its concept text. */
export const DEMO_VARIATION_TWISTS: Record<VariationMethod, string> = {
  'smart-mix': 'different opening, proof asset and visual treatment, same offer',
  hooks: 'same concept and visual, a different attention device on top',
  angles: 'a different strategic reason to care, same offer and audience',
  'visual-execution': 'same message and promise, rebuilt as a different composition',
  copy: 'same picture and argument, rewritten',
}
