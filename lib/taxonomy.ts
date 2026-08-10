// Fixed creative taxonomy — the closed vocabularies that make the "iterate one
// thing" loop measurable.
//
// The Reactor generates from free-form retrieval — great for range, useless for
// comparison. "Iterate one thing" only works if the thing you changed is tagged
// from a FIXED, CLOSED list, not a sentence the model invented that run. Fixed
// labels are what let ORACLE later say "Urgency hooks beat Question hooks 2x"
// instead of comparing unique snowflakes.
//
// Same const-array + derived-type pattern as CREATIVE_PATTERNS in lib/spark.ts.
//
// HOOK_STYLES / VISUAL_FORMATS / ASSET_TYPES are FORMAT-level — they describe how
// a creative is built, not who it is for — so they are brand-agnostic and carry
// over from proven ad-analytics taxonomies unchanged. PERSONA_SEEDS and
// PAIN_POINT_SEEDS are TPB-SPECIFIC (trades/construction business owners being
// coached, per lib/reactor-inputs.ts + lib/spark.ts CREATIVE_PATTERNS), and are
// SEED lists — the configurator allows "+ add new" so they grow from real runs
// rather than staying static. Derive new ones from campaign_outcomes, never the
// demo brand's end-customer (Summit Build Co's home-buyers are the wrong layer).
//
// This module is PURE (data + types + string helpers) so it is safe to import
// from client components (the isolation-mode configurator needs AXIS_META and the
// vocab). The Claude-backed classifier that consumes these lists lives in the
// server-only module lib/taxonomy-classify.ts to keep the SDK out of the client
// bundle — mirroring how lib/spark.ts isolates its Anthropic call.
//
// The VisualDNA import below is `import type` — erased at compile time, so it
// carries no runtime dependency on lib/spark.ts (and its Anthropic import) into
// the client bundle. Keep it type-only.

import type { VisualDNA } from '@/lib/spark'

/* ------------------------------- Vocabularies ------------------------------ */

/** How the opening earns the scroll-stop. One value per concept. */
export const HOOK_STYLES = [
  'Question',
  'Storytelling',
  'If/Then',
  'Contrast',
  'Relatability',
  'Curiosity',
  'Offer Only',
  'Aspirational',
  'Urgency',
  'Contrarian',
  'Explainer',
  'Direct Address',
] as const
export type HookStyle = (typeof HOOK_STYLES)[number]

/** How the creative is shot/edited — the visual structure. */
export const VISUAL_FORMATS = [
  'Montage',
  'Feature Benefit Pointout',
  'Split Screen',
  'Static-to-Video Hybrid',
  'Problem Agitation',
  'Greenscreen',
  'Review',
  'Expert Explainer',
  'Social Comments',
  'B-Roll',
  'Meme',
  'Transformation',
  'Behind The Scenes',
  'Grid Swap',
] as const
export type VisualFormat = (typeof VISUAL_FORMATS)[number]

/** What kind of asset it fundamentally is. */
export const ASSET_TYPES = [
  'Image With Text',
  'UGC Mashup',
  'Lifestyle-Product Image with Text',
  'Animation',
  'Hybrid',
] as const
export type AssetType = (typeof ASSET_TYPES)[number]

/**
 * Seed personas — TPB's trades/construction business-OWNER segments (the people
 * the coaching creative targets), NOT the demo brand's home-buyers. Extensible:
 * the configurator offers "+ add new" and real runs grow the list. Kept as a
 * plain string[] (not a locked union) precisely because it is meant to grow.
 */
export const PERSONA_SEEDS: readonly string[] = [
  'Solo Operator',
  'Sub-$1M Builder',
  'Scaling Builder ($1–5M)',
  'Overwhelmed Owner',
  'Tradie Turned Business Owner',
  'Established Director',
]

/**
 * Seed pain points — the coaching pains TPB's creative speaks to, mapped to the
 * angle/pattern vocabulary already in the app (Profit / Time Freedom / Systems /
 * Owner Identity → Profit Leak / No Time / Chaos / Stuck as Operator). Extensible.
 */
export const PAIN_POINT_SEEDS: readonly string[] = [
  'Profit Leak',
  'No Time / Weekends Gone',
  'Chaos / No Systems',
  'Can’t Scale Past Myself',
  'Stuck as Operator Not Owner',
  'Cash-Flow Stress',
  'Bad Hires / Team Problems',
]

/* -------------------------------- Axes ------------------------------------- */

/** The five things a test can isolate. Order = configurator tab order. */
export const ITERATION_AXES = ['hook', 'persona', 'painPoint', 'visualFormat', 'assetType'] as const
export type IterationAxis = (typeof ITERATION_AXES)[number]

/**
 * One taxonomy tag per axis, every value drawn from the fixed/seed lists above.
 * This is the field ORACLE groups by — the atomic unit of comparison that makes
 * "iterate one thing" produce a real answer. All optional so a partially-tagged
 * concept (or a legacy backfill that only recovered some axes) is still valid.
 */
export interface CreativeTaxonomy {
  hookStyle?: string
  visualFormat?: string
  assetType?: string
  persona?: string
  painPoint?: string
}

/** The CreativeTaxonomy key each iteration axis writes to. */
export const AXIS_TAXONOMY_KEY: Record<IterationAxis, keyof CreativeTaxonomy> = {
  hook: 'hookStyle',
  persona: 'persona',
  painPoint: 'painPoint',
  visualFormat: 'visualFormat',
  assetType: 'assetType',
}

export interface AxisMeta {
  axis: IterationAxis
  /** Configurator tab label. */
  label: string
  /** The CreativeTaxonomy field this axis sets. */
  key: keyof CreativeTaxonomy
  /** The pickable values. Format axes are closed; persona/pain are seeds. */
  values: readonly string[]
  /** True when the value list is a growable seed rather than a closed union. */
  extensible: boolean
}

export const AXIS_META: Record<IterationAxis, AxisMeta> = {
  hook: { axis: 'hook', label: 'Hook', key: 'hookStyle', values: HOOK_STYLES, extensible: false },
  persona: { axis: 'persona', label: 'Persona', key: 'persona', values: PERSONA_SEEDS, extensible: true },
  painPoint: {
    axis: 'painPoint',
    label: 'Pain point',
    key: 'painPoint',
    values: PAIN_POINT_SEEDS,
    extensible: true,
  },
  visualFormat: {
    axis: 'visualFormat',
    label: 'Visual format',
    key: 'visualFormat',
    values: VISUAL_FORMATS,
    extensible: false,
  },
  assetType: { axis: 'assetType', label: 'Asset type', key: 'assetType', values: ASSET_TYPES, extensible: false },
}

/** Ordered axis metadata for rendering the configurator tabs. */
export const AXIS_LIST: AxisMeta[] = ITERATION_AXES.map((a) => AXIS_META[a])

/**
 * Isolation-mode selection — shared by the configurator UI and the reactor
 * request payload so the client and server agree on the shape. `values` are the
 * (≤3) values of `axis` under test; `lockedTaxonomy` holds every other axis
 * fixed; `notes` is the optional strategist directive.
 */
export interface IsolateConfig {
  axis: IterationAxis
  values: string[]
  lockedTaxonomy: CreativeTaxonomy
  notes?: string
}

/**
 * A cloned reference's Creative DNA the reactor reproduces STRUCTURALLY — shared
 * by the Ad Library UI, the sessionStorage handoff, and the reactor payload so
 * the shape can't drift. All optional (a winner may only carry a summary + tags).
 */
export interface CloneReference {
  hook?: string
  opening?: string
  storyStructure?: string
  ctaStructure?: string
  editingStyle?: string
  offerPresentation?: string
  visualStyle?: string
  summary?: string
  taxonomy?: CreativeTaxonomy
  sourceLabel?: string
  /**
   * The DESIGN read of the reference, when SPARK actually saw the ad (palette,
   * layout, element placement, scroll-stop mechanism). Drives the production
   * brief the image models render from — see `visualDirectionBlock`.
   */
  visual?: VisualDNA
  /**
   * True when this reference was pulled from the Vault by the platform rather
   * than attached by the strategist. Only its DESIGN carries — the copy beats
   * of an unrelated winner are not what the brief asked to clone — so
   * `cloneBlock` renders it as design direction instead of a clone order.
   */
  designOnly?: boolean
}

/** sessionStorage key handing a clone reference from the Ad Library to the reactor. */
export const CLONE_STORAGE_KEY = 'tpb:cloneReference'

/** First canonical value of each axis — the cold-start / demo lock defaults. */
export function defaultLockedTaxonomy(): CreativeTaxonomy {
  return {
    hookStyle: HOOK_STYLES[0],
    visualFormat: VISUAL_FORMATS[0],
    assetType: ASSET_TYPES[0],
    persona: PERSONA_SEEDS[0],
    painPoint: PAIN_POINT_SEEDS[0],
  }
}

/* ------------------------------- Helpers ----------------------------------- */

/** The pickable values for an axis. */
export function axisValues(axis: IterationAxis): readonly string[] {
  return AXIS_META[axis].values
}

/** The CreativeTaxonomy key an axis writes to (e.g. 'hook' → 'hookStyle'). */
export function axisTaxonomyKey(axis: IterationAxis): keyof CreativeTaxonomy {
  return AXIS_META[axis].key
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'")

/**
 * Snap a free-text value to the closest canonical label for a set of vocab
 * options — case/punctuation-insensitive exact, then substring, else the trimmed
 * input (so extensible axes keep new personas/pains the strategist typed in).
 */
export function coerceToVocab(value: string | undefined, options: readonly string[]): string | undefined {
  const v = (value ?? '').trim()
  if (!v) return undefined
  const nv = norm(v)
  const exact = options.find((o) => norm(o) === nv)
  if (exact) return exact
  const partial = options.find((o) => norm(o).includes(nv) || nv.includes(norm(o)))
  return partial ?? v
}

/** True when a value is one of an axis's known canonical labels. */
export function isKnownValue(axis: IterationAxis, value: string): boolean {
  const nv = norm(value)
  return AXIS_META[axis].values.some((o) => norm(o) === nv)
}

/** Snap every field of a taxonomy object to canonical vocab where possible. */
export function coerceTaxonomy(t: CreativeTaxonomy | undefined): CreativeTaxonomy {
  if (!t) return {}
  return {
    hookStyle: coerceToVocab(t.hookStyle, HOOK_STYLES),
    visualFormat: coerceToVocab(t.visualFormat, VISUAL_FORMATS),
    assetType: coerceToVocab(t.assetType, ASSET_TYPES),
    persona: coerceToVocab(t.persona, PERSONA_SEEDS),
    painPoint: coerceToVocab(t.painPoint, PAIN_POINT_SEEDS),
  }
}

/** Chip strings for display, e.g. ["Hook: Urgency", "Format: UGC Mashup"]. */
export function taxonomyToTags(t: CreativeTaxonomy | undefined): string[] {
  if (!t) return []
  const tags: string[] = []
  if (t.hookStyle) tags.push(`Hook: ${t.hookStyle}`)
  if (t.visualFormat) tags.push(`Format: ${t.visualFormat}`)
  if (t.assetType) tags.push(`Asset: ${t.assetType}`)
  if (t.persona) tags.push(`Persona: ${t.persona}`)
  if (t.painPoint) tags.push(`Pain: ${t.painPoint}`)
  return tags
}

/** One-line human summary of a taxonomy, for notes/telemetry. */
export function describeTaxonomy(t: CreativeTaxonomy | undefined): string {
  const tags = taxonomyToTags(t)
  return tags.length ? tags.join(' · ') : 'untagged'
}

/** True when at least one axis is tagged. */
export function hasTaxonomy(t: CreativeTaxonomy | undefined): boolean {
  return taxonomyToTags(t).length > 0
}

/* ------------------------------ Classification ----------------------------- */

/** Deterministic keyword read used when Claude is unavailable — never throws. */
export function heuristicTaxonomy(text: string): CreativeTaxonomy {
  const t = text.toLowerCase()
  const hookStyle: HookStyle = /\?/.test(text)
    ? 'Question'
    : /\bif you\b|\bwhen you\b/.test(t)
      ? 'If/Then'
      : /story|when i|i used to|years ago/.test(t)
        ? 'Storytelling'
        : /stop|don'?t|never|myth|wrong|nobody tells/.test(t)
          ? 'Contrarian'
          : /now|today|last chance|closing|deadline/.test(t)
            ? 'Urgency'
            : 'Direct Address'
  const visualFormat: VisualFormat = /testimonial|review|member|client result/.test(t)
    ? 'Review'
    : /before|after|transform|went from/.test(t)
      ? 'Transformation'
      : /talking|founder|to camera|selfie|ugc/.test(t)
        ? 'Expert Explainer'
        : /problem|struggle|frustrat|pain/.test(t)
          ? 'Problem Agitation'
          : 'B-Roll'
  const assetType: AssetType = /ugc|selfie|phone|talking head/.test(t)
    ? 'UGC Mashup'
    : /animat|motion graphic/.test(t)
      ? 'Animation'
      : 'Image With Text'
  const painPoint =
    /profit|margin|leak/.test(t)
      ? 'Profit Leak'
      : /time|weekend|hours|family/.test(t)
        ? 'No Time / Weekends Gone'
        : /system|chaos|process|sop/.test(t)
          ? 'Chaos / No Systems'
          : /scale|grow|stuck/.test(t)
            ? 'Can’t Scale Past Myself'
            : undefined
  return { hookStyle, visualFormat, assetType, painPoint }
}

/* --------------------------- Orchestrator wiring --------------------------- */

/**
 * The instruction block appended to the orchestrator system prompt when a run is
 * in isolation mode. Holds every locked axis fixed, varies only the isolated
 * axis across the chosen values, and tags each concept's taxonomy accordingly.
 * Kept here so the vocab and the prompt can never drift apart.
 */
export function isolationBlock(input: {
  axis: IterationAxis
  values: string[]
  lockedTaxonomy: CreativeTaxonomy
  notes?: string
}): string {
  const meta = AXIS_META[input.axis]
  const locked = taxonomyToTags(input.lockedTaxonomy)
  const values = input.values.length ? input.values : meta.values.slice(0, 3)
  return `ISOLATION MODE — this is a controlled test, not free generation. We are testing exactly ONE variable.
- VARY ONLY: ${meta.label} (${meta.key}). Produce one concept per value to test: ${values.join(', ')}.
- HOLD FIXED (do not change these across concepts): ${locked.length ? locked.join(' · ') : 'use the single best-known value for each and keep it identical across every concept'}.
- Every returned concept MUST set its taxonomy field: ${meta.key} = the value it tests, and every other axis = the locked value above.
- Keep concepts otherwise as comparable as possible so the ONLY meaningful difference is ${meta.label}. That is what lets performance data attribute the win to this one variable.${
    input.notes?.trim() ? `\n- Strategist notes (honor these): ${input.notes.trim()}` : ''
  }`
}

/**
 * The instruction block appended when a run carries a clone reference — generate
 * concepts that match the reference's Creative DNA/structure, varying only what
 * the strategist's edits or the isolation axis specify.
 */
/**
 * The design direction block emitted when SPARK actually SAW the reference ad.
 *
 * This is what turns a visual read into creative the platform can render: the
 * palette, the layout archetype, where each element sits, and the scroll-stop
 * mechanism are handed to OPUS as evidence, and OPUS is told to carry them into
 * the production brief — which is what the image models render from.
 *
 * Deliberately NOT a lock. OPUS is the strategist: it may depart from the
 * reference when the campaign's angle, awareness stage, or placement calls for
 * a different design, provided it says why in the concept's basis. Proven design
 * is the default, not a cage.
 */
export function visualDirectionBlock(visual: VisualDNA): string {
  const lines = [
    'VISUAL REFERENCE — SPARK analyzed the actual winning ad. This is the DESIGN that earned the scroll-stop. Treat it as proven direction for the creative you produce.',
    `- Format: ${visual.format} · native ratio ${visual.aspectRatio}`,
    `- Layout archetype: ${visual.layout}`,
  ]

  if (visual.palette.length) {
    lines.push(
      `- Palette (reuse these roles; exact hexes unless the brand demands otherwise): ${visual.palette
        .map((c) => `${c.hex} → ${c.role}`)
        .join(' · ')}`,
    )
  }

  if (visual.elements.length) {
    lines.push('- Element placement (rebuild this hierarchy):')
    for (const el of visual.elements) {
      lines.push(
        `    · ${el.element} — sits ${el.position} (${el.zone} zone); ${el.treatment}${
          el.text ? `. Reference wording: "${el.text}" — match the ROLE and LENGTH, write fresh TPB copy.` : ''
        }`,
      )
    }
  }

  lines.push(
    `- Typography: ${visual.typography}`,
    `- Imagery: ${visual.imagery}`,
    `- Eye flow: ${visual.focalFlow}`,
    `- Text density: ${visual.textDensity}`,
    `- Contrast device (what makes it pop in-feed): ${visual.contrastDevice}`,
    `- Why it stops the scroll: ${visual.scrollStopReason}`,
  )

  if (visual.designPrinciples.length) {
    lines.push(`- Design principles to preserve: ${visual.designPrinciples.join(' | ')}`)
  }
  lines.push(`- Rebuilding it for TPB: ${visual.replicationNotes}`)

  lines.push(
    'HOW TO USE THIS:',
    '1. Carry the layout, palette roles, element placement and contrast device into the productionBrief for every visual concept — name the zone each piece of copy occupies and what fills the rest of the frame. The brief is what the image model renders, so design detail left out of the brief does not reach the ad.',
    '2. Write the adPackage copy to FIT the placements above — headline length must survive the headline zone, the hook must land where the reference puts it.',
    '3. Never reproduce the reference\'s words, brand, or logo. Reproduce its STRUCTURE.',
    '4. You are the strategist: if the campaign angle, awareness stage or placement means a different design will perform better, use the better design and state the reason in that concept\'s basis. Proven design is the default, not a constraint.',
  )

  return lines.join('\n')
}

export function cloneBlock(reference: {
  hook?: string
  storyStructure?: string
  ctaStructure?: string
  visualStyle?: string
  editingStyle?: string
  offerPresentation?: string
  summary?: string
  taxonomy?: CreativeTaxonomy
  visual?: VisualDNA
  designOnly?: boolean
}): string {
  // A design the platform pulled from the Vault is direction, not an order to
  // clone someone else's campaign: emit the design read alone, and say where it
  // came from so OPUS can weigh it against the angle.
  if (reference.designOnly) {
    const header = [
      `PROVEN DESIGN FROM THE VAULT${
        reference.summary ? ` — ${reference.summary}` : ''
      }. This is the strongest banked ad design for this brief. Build the visual concepts on it unless the angle genuinely calls for a different design, in which case say why in that concept's basis.`,
    ]
    return reference.visual
      ? [...header, '', visualDirectionBlock(reference.visual)].join('\n')
      : header.join('\n')
  }

  const lines = [
    'CLONE REFERENCE — match this proven structure. Reproduce the STRUCTURE and ENERGY, never the exact words; write fresh TPB copy that follows the same beats.',
  ]
  if (reference.summary) lines.push(`- What it is: ${reference.summary}`)
  if (reference.hook) lines.push(`- Hook approach: ${reference.hook}`)
  if (reference.storyStructure) lines.push(`- Story structure: ${reference.storyStructure}`)
  if (reference.ctaStructure) lines.push(`- CTA structure: ${reference.ctaStructure}`)
  if (reference.offerPresentation) lines.push(`- Offer presentation: ${reference.offerPresentation}`)
  if (reference.visualStyle) lines.push(`- Visual style: ${reference.visualStyle}`)
  if (reference.editingStyle) lines.push(`- Editing style: ${reference.editingStyle}`)
  const tax = taxonomyToTags(reference.taxonomy)
  if (tax.length) lines.push(`- Reference taxonomy (keep unless isolation mode overrides an axis): ${tax.join(' · ')}`)
  lines.push(
    '- For any video / UGC / founder / testimonial concept, make the production brief SHOOT-READY: timestamped beats mirroring the reference pacing (e.g. HOOK 0-3s, PROBLEM 3-10s, PROOF, CTA), each frame with the exact on-screen action and spoken line, so a creator could shoot it as-is.',
  )
  // The design read, when SPARK saw the ad, is appended as its own section so
  // the layout/palette direction reaches the production brief the image models
  // render from — not just the copy structure above.
  if (reference.visual) {
    lines.push('', visualDirectionBlock(reference.visual))
  }
  return lines.join('\n')
}
