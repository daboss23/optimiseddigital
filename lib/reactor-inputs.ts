/**
 * Shared input contract for the Campaign Reactor multi-step modal.
 *
 * The modal (client) collects a `ReactorInputs` object across four slides; the
 * orchestrator route (server) reads the same shape to construct its system
 * prompt blocks in a fixed order. Keep this file framework-agnostic (pure data
 * + types) so both sides can import it.
 */

import type { VariationMethod } from './variations'

export interface BrandSettings {
  voiceGuidelines: string
  toneRules: string
}

/**
 * The Strategic Intelligence read OPUS presents before the reactor fires — the
 * platform thinking out loud. Sourced from `/api/campaign-reactor/intelligence`
 * (real retrieval + optional OPUS synthesis), it is intelligence, never exposed
 * agent machinery.
 */
export interface StrategicIntelligence {
  awareness: string
  primaryPain: string
  primaryDesire: string
  primaryPattern: string
  recommendedCreativeStructure: string
  recommendedCopyStructure: string
  recommendedOfferPositioning: string
  knowledgeAssetsConsulted: string[]
  researchSourcesConsulted: string[]
  confidence: 'High' | 'Medium' | 'Exploratory'
  confidenceScore: number
}

/**
 * A structured production brief — SPARK's frame-by-frame plan for a visual
 * concept. Image and video generation is driven by these briefs rather than raw
 * prompts so every asset is built from a deliberate creative structure.
 */
export interface ProductionFrame {
  label: string
  description: string
}

/**
 * A literal piece of copy that must appear ON the creative, declared separately
 * from the prose frames so the render prompt can quote it exactly instead of
 * digging it back out of a paragraph. See `lib/render-prompt.ts`.
 */
export interface OnImageTextSlot {
  /** e.g. "Headline", "CTA button", "Compliance line". */
  role: string
  /** The exact words to set on the image. */
  text: string
  /** Where it sits, e.g. "top third, left aligned". */
  placement?: string
}

export interface ProductionBrief {
  creativeType: string
  pattern: string
  audience: string
  awareness: string
  frames: ProductionFrame[]
  /**
   * The ad's on-image copy. Optional and additive — when absent the render
   * compiler recovers the copy from the quoted strings in `frames`.
   */
  onImageText?: OnImageTextSlot[]
}

/**
 * NEURO predicted-response score — a TRIBE-inspired neural pre-test on a
 * concept. It estimates how the human brain is likely to react to the creative
 * BEFORE any spend, grounded in established neuromarketing principles (visual
 * salience, cognitive load, emotional valence, memory encoding, first-3-seconds
 * hook strength). It is a PREDICTION/ESTIMATE, never measured brain data — the
 * UI must label it as such. Kept here (framework-agnostic) so both the server
 * scorer and the client card can share the shape.
 */
export interface NeuroScore {
  /** Scroll-stopping power of the opening — does it break the pattern? (1-10) */
  attention: number
  /** Emotional pull / arousal — does it make the viewer feel something? (1-10) */
  emotion: number
  /** Memory encoding — will it be remembered an hour later? (1-10) */
  memorability: number
  /** First-3-seconds hook strength — do the openers earn the next beat? (1-10) */
  hook: number
  /** Convenience average of the four axes (1-10), computed server-side. */
  overall: number
  /** One-line rationale for the estimate. */
  reason: string
  /** The neuromarketing principle the estimate leaned on, when identifiable. */
  principle?: string
}

/**
 * The predicted-response pass mark (1-10). A concept whose attention or hook
 * falls below this is "below the bar" — flagged for revision server-side and
 * shown in warning colour on the card. Shared so the gate and the UI agree.
 */
export const NEURO_PASS_MARK = 6

/** The four scored axes, in display order, with builder-facing labels. */
export const NEURO_AXES: { key: keyof Pick<NeuroScore, 'attention' | 'emotion' | 'memorability' | 'hook'>; label: string }[] = [
  { key: 'attention', label: 'Attention' },
  { key: 'emotion', label: 'Emotion' },
  { key: 'memorability', label: 'Memorability' },
  { key: 'hook', label: 'Hook' },
]

/*
 * NOTE: `briefToPrompt` used to live here. It flattened every frame into one
 * paragraph — including the ad's quoted copy — which is what produced garbled
 * on-image text. It now lives in `lib/render-prompt.ts`, which separates the
 * scene from the literal copy and budgets that copy so it renders correctly.
 * Import it from there.
 */

export interface ReactorInputs {
  /** Human-facing campaign label (the first question in the guided flow). */
  campaignName?: string
  brief: string
  angle: string
  angleIsAgentDecided: boolean
  outputTypes: string[]
  outputTypesAgentDecided: boolean
  /** Selected aspect ratios per deliverable, e.g. { 'Video Creative': ['9:16'] }. */
  dimensions?: Record<string, string[]>
  /** Selected render model per deliverable, e.g. { 'Video Creative': 'veo-3.1' }. 'auto' = system pick. */
  models?: Record<string, string>
  /**
   * Per-deliverable variation settings, keyed exactly like `dimensions` and
   * `models`: how many distinct versions of THIS format to make (1–4), and the
   * single lever that separates them. A format absent from the maps runs at ×1.
   *
   * These replaced a single global `variations` count, which forced every
   * selected format to the same number and gave the run no way to say WHICH
   * lever moved — leaving the resulting ads unattributable in ORACLE.
   */
  variationCounts?: Record<string, number>
  variationMethods?: Record<string, VariationMethod>
  /**
   * @deprecated The pre-per-format global count. Still read by the route so a
   * payload from an older client (or a saved request) keeps working: it seeds
   * every selected format when `variationCounts` is absent. Never written by
   * the current modal.
   */
  variations?: number
  awarenessStage: string
  awarenessDirective: string
  sophisticationStage: string
  sophisticationDirective: string
  audienceType: string
  audienceDirective: string
  offerType: string
  offerTypeDirective: string
  offerName: string
  onBrandEnabled: boolean
  brandSettings: BrandSettings
}

/* ----------------------------------------------------------------------------
   Strategic-input vocabulary shared by the modal and the orchestrator.

   NO_PREFERENCE is the universal "let Reactor decide dynamically" sentinel — it
   sits at index 0 of every strategic option list. CUSTOM_* are the labels that
   reveal a free-text field so an advanced user can supply an angle / audience /
   offer that isn't in the menu. Both the UI and the route treat a custom value
   exactly like a native one.
---------------------------------------------------------------------------- */

export const NO_PREFERENCE = 'No Preference'
export const CUSTOM_ANGLE = 'Custom Angle…'
export const CUSTOM_AUDIENCE = 'Custom Audience…'
export const CUSTOM_OFFER = 'Custom Offer…'

/**
 * ORACLE strategic-memory evidence for a recommended angle — how many stored
 * campaigns share this strategic configuration, how many won, and their average
 * win score. Null/zeroed when the angle is new (no memory yet).
 */
export interface AngleEvidence {
  similar: number
  winners: number
  avgWinScore: number | null
}

/**
 * The Dynamic Strategy Engine's read of a brief. The angle is NOT constrained to
 * the base categories — NOVA/ORACLE/OPUS can surface a sharper angle (e.g.
 * "Profit Leak") that the dropdown then adopts. Strategy defines the dropdown,
 * not the other way around.
 */
export interface ReactorSuggestion {
  angle: string
  angleConfidence: number
  angleReason: string
  awareness: string
  sophistication: string
  audience: string
  offer: string
  deliverables: string[]
  deliverablesReason: string
  evidence: AngleEvidence | null
  /** Per intelligence-source recommendation + factual reason (asset counts). */
  intelligenceSources: IntelSourceRecommendation[]
}

export interface IntelSourceRecommendation {
  id: string
  recommended: boolean
  reason: string
}

/**
 * Directive injected when the user supplies a custom value. OPUS must treat it
 * as a hard strategic constraint that flows through research, creative, copy,
 * and pattern analysis — without breaking the recommendation system.
 */
export function customDirective(field: 'angle' | 'audience' | 'offer', value: string): string {
  const v = value.trim()
  if (field === 'angle') {
    return `The user supplied a CUSTOM campaign angle: "${v}". Treat this as a hard strategic constraint. Build every concept, hook, and production brief around this angle. Ground research, creative, copy, and pattern selection in it — do not substitute a different angle.`
  }
  if (field === 'audience') {
    return `The user supplied a CUSTOM target audience: "${v}". Treat this as a hard strategic constraint. Tailor research, creative, copy, and pattern selection to this exact audience. Do not substitute a generic segment.`
  }
  return `The user supplied a CUSTOM offer: "${v}". Treat this as the campaign's offer and CTA frame. Build research, creative, copy, and pattern analysis around delivering and converting on this specific offer. Use this exact offer in every CTA.`
}

/* ----------------------------------------------------------------------------
   Brand settings — sourced from the Settings tab once that store exists. Until
   then this curated default stands in so the ON BRAND toggle still drives the
   prompt injection. Wire this to the real settings store when it ships.
---------------------------------------------------------------------------- */

export const defaultBrandSettings: BrandSettings = {
  voiceGuidelines:
    'Voice: confident, specific, builder-native — operator to operator. Speak the language of trades business owners. Lead with concrete numbers and named proof over adjectives. No hype, no fluff, no guru clichés.',
  toneRules:
    'Tone: direct, grounded, respectful of the reader’s intelligence. Short sentences. Identity-led, not hustle-led. Every claim is earned with evidence. Engineered for performance.',
}

/* ------------------------------- Slide 1 ---------------------------------- */

export const angleOptions = [
  NO_PREFERENCE,
  'Profit',
  'Time Freedom',
  'Systems',
  'Growth',
  'Owner Identity',
] as const

export const outputTypeOptions = [
  'Hooks',
  'Headlines',
  'Static Concepts',
  'Video Concepts',
  'Founder Concepts',
  'VSL Openers',
  'Testimonial Concepts',
] as const

/* ---------------------------- Creative formats ---------------------------- *
   The aspect ratios each deliverable can be rendered at, mapped to the ratios
   the image/video pipeline actually supports (1:1 / 9:16 / 16:9). The Formats
   step shows only the sizes relevant to the deliverables the user selected.
--------------------------------------------------------------------------- */

export type CreativeRatio = '1:1' | '4:5' | '9:16' | '16:9'

export interface CreativeSize {
  ratio: CreativeRatio
  label: string
  use: string
  dims: string
}

export const CREATIVE_SIZES: Record<string, CreativeSize[]> = {
  'Static Creative': [
    { ratio: '4:5', label: 'Tall feed', use: 'Meta feed — largest mobile footprint', dims: '1080×1350' },
    { ratio: '1:1', label: 'Square', use: 'Feed', dims: '1080×1080' },
    { ratio: '9:16', label: 'Vertical', use: 'Stories', dims: '1080×1920' },
    { ratio: '16:9', label: 'Landscape', use: 'Desktop / in-stream', dims: '1920×1080' },
  ],
  'Video Creative': [
    { ratio: '9:16', label: 'Vertical', use: 'Reels / Stories', dims: '1080×1920' },
    { ratio: '1:1', label: 'Square', use: 'Feed', dims: '1080×1080' },
    { ratio: '16:9', label: 'Landscape', use: 'In-stream / YouTube', dims: '1920×1080' },
  ],
  'UGC Creative': [
    { ratio: '9:16', label: 'Vertical', use: 'Reels / TikTok', dims: '1080×1920' },
    { ratio: '1:1', label: 'Square', use: 'Feed', dims: '1080×1080' },
  ],
  'Carousel Creatives': [
    { ratio: '4:5', label: 'Tall feed', use: 'Feed carousel — largest mobile footprint', dims: '1080×1350' },
    { ratio: '1:1', label: 'Square', use: 'Feed carousel', dims: '1080×1080' },
    { ratio: '9:16', label: 'Vertical', use: 'Stories carousel', dims: '1080×1920' },
  ],
  'Montage / Scene Flow': [
    { ratio: '9:16', label: 'Vertical', use: 'Reels / TikTok', dims: '1080×1920' },
    { ratio: '1:1', label: 'Square', use: 'Feed', dims: '1080×1080' },
    { ratio: '16:9', label: 'Landscape', use: 'In-stream / YouTube', dims: '1920×1080' },
  ],
}

// The size pre-selected for a deliverable so the Formats step is never blank.
// Stills default to 4:5 — the tall feed unit occupies the most vertical space
// a static ad can hold in the Meta mobile feed, so it is the format to beat.
// Carousels stay square: Meta crops every card to a single ratio and 1:1 is the
// safest across placements.
export const DEFAULT_SIZE: Record<string, CreativeRatio> = {
  'Static Creative': '4:5',
  'Video Creative': '9:16',
  'UGC Creative': '9:16',
  'Carousel Creatives': '1:1',
  'Montage / Scene Flow': '9:16',
}

/* ------------------------------- Slide 2 ---------------------------------- */

export interface DirectiveOption {
  label: string
  directive: string
  /** Optional one-line, builder-facing explanation rendered under the option. */
  description?: string
}

/**
 * Awareness — Eugene Schwartz. How much the prospect already knows about their
 * problem and your solution, and therefore how much the ad has to EXPLAIN
 * before it can sell. Distinct from sophistication (what you may claim).
 */
export const awarenessOptions: DirectiveOption[] = [
  {
    label: NO_PREFERENCE,
    description: 'The system reads the brief and angle and picks the awareness stage for you.',
    directive:
      'The user has no awareness-stage preference — determine the most appropriate awareness stage from the campaign brief and angle. If no clear signal, default to Problem-Aware for cold traffic.',
  },
  {
    label: 'Unaware',
    description:
      'They don’t know they have this problem yet. Open on a felt moment, not a solution.',
    directive:
      'The audience does not yet name their problem. Open on a felt symptom or a relatable scene — a moment in their day that mirrors the pain. Do NOT name a solution, a method, or a product category early. Goal: make them recognise themselves before they know why they’re watching.',
  },
  {
    label: 'Problem-Aware',
    description:
      'They feel the pain but don’t know a fix exists. Name the pain, then reveal a path.',
    directive:
      'The audience feels the pain but doesn’t know structured solutions exist. Open by naming the pain with precision and agitating the real cost of staying there — time, margin, relationships, identity. Then reveal that a path exists. Do not lead with the offer.',
  },
  {
    label: 'Solution-Aware',
    description:
      'They know solutions exist and are comparing. Lead with your mechanism, skip the problem build.',
    directive:
      'The audience knows solutions exist and is comparing approaches — coaching, hiring, DIY systems. Lead with mechanism: the specific reason THIS approach beats the alternatives they are already weighing. Skip the problem build.',
  },
  {
    label: 'Product-Aware',
    description:
      'They know TPB and haven’t committed. Lead with proof, risk reversal and a reason to act now.',
    directive:
      'The audience knows TPB and has considered it but hasn’t committed. Lead with proof — named member results, specific figures. Add risk reversal and a clear reason to act now. Minimise problem education.',
  },
  {
    label: 'Most-Aware',
    description:
      'They’re ready to buy. Lead with the offer and the deadline. Nothing else.',
    directive:
      'The audience is ready. Lead directly with the offer and a reason to act now. Short, punchy, direct. Skip the problem and mechanism build entirely.',
  },
]

/**
 * Market Sophistication — Eugene Schwartz, Breakthrough Advertising. How many
 * times this market has already been pitched a solution, and therefore what
 * KIND of claim still lands. Distinct from awareness (which governs how much
 * you explain); sophistication governs what you are allowed to claim.
 */
export const sophisticationOptions: DirectiveOption[] = [
  {
    label: NO_PREFERENCE,
    description:
      'The system reads the brief and market context and picks the sophistication stage for you.',
    directive:
      'The user has no market-sophistication preference — infer the stage from the brief, the competitive context, and vault research. For coaching offers to trades business owners (a heavily pitched market), default to Stage 4–5: mechanism-led differentiation with identity-level identification.',
  },
  {
    label: 'Stage 1 — First Claim',
    description:
      'The market has never heard this promise before. A simple, direct claim wins on its own.',
    directive:
      'MARKET SOPHISTICATION — STAGE 1 (first to market): The audience has never been pitched this benefit. Lead with the direct claim, stated simply and boldly. No mechanism, no elaboration — name the desire and promise its fulfilment. Do not overcomplicate.',
  },
  {
    label: 'Stage 2 — Bigger Claim',
    description:
      'Competitors make the same promise. Winning needs a bigger, more specific version of the claim.',
    directive:
      'MARKET SOPHISTICATION — STAGE 2 (claim competition): Competitors already make the same promise. Outbid them with a larger, sharper, more specific claim — concrete numbers, tighter timeframes, named outcomes. Still claim-led, but enlarged and made specific enough that generic competitors cannot copy it.',
  },
  {
    label: 'Stage 3 — New Mechanism',
    description:
      'The market has heard every claim and is skeptical. Lead with a NEW mechanism — the unique way this works.',
    directive:
      'MARKET SOPHISTICATION — STAGE 3 (claims exhausted): The audience has heard every claim and no longer believes bare promises. Lead with a NEW MECHANISM — the specific, preferably named, way this works that competitors do not have. The mechanism is the headline; the claim rides behind it.',
  },
  {
    label: 'Stage 4 — Better Mechanism',
    description:
      'Mechanisms are everywhere too. Elaborate and dramatize why THIS mechanism is easier, faster, more certain.',
    directive:
      'MARKET SOPHISTICATION — STAGE 4 (mechanism competition): Competing mechanisms crowd the market. Elaborate and dramatize the mechanism — prove it is easier, faster, more certain than the alternatives the prospect has already seen. Comparison, proof, and specificity of process are the levers. A named proprietary process beats a generic one.',
  },
  {
    label: 'Stage 5 — Identity & Tribe',
    description:
      'A fully exhausted market. Claims and mechanisms bounce off — lead with identification and who they become.',
    directive:
      'MARKET SOPHISTICATION — STAGE 5 (fully exhausted market): Claims and mechanisms both bounce off. Lead with IDENTIFICATION — mirror the prospect’s day, language, and identity so precisely they feel seen, then sell who they become and the tribe they join, not what the product does. Experience, identity, and belonging are the message; the offer arrives late and quietly.',
  },
]

export const audienceOptions: DirectiveOption[] = [
  {
    label: NO_PREFERENCE,
    directive:
      'The user has no audience preference — determine audience temperature and ad type from the brief and angle. If no clear signal, default to cold prospecting.',
  },
  {
    label: 'Cold — new audience',
    directive:
      'Cold traffic with no prior exposure to TPB. The ad must earn attention from scratch, frame the problem, and build enough credibility to warrant the next step. Do not assume any familiarity with TPB or its methods.',
  },
  {
    label: 'Warm — saw content, didn’t convert',
    directive:
      'Warm audience. Has seen TPB content or ads but hasn’t taken action. Has some familiarity. Lead with proof, deepen the mechanism, and address the most likely objection holding them back from acting.',
  },
  {
    label: 'Retargeting — visited sales page',
    directive:
      'Hot audience. Visited the sales or application page — they considered it. Lead with urgency, social proof, and objection handling. Short, direct, reason-to-act-now. Minimal problem education required.',
  },
  {
    label: 'Retargeting — started application',
    directive:
      'Hottest audience. Started the application and didn’t finish — they want in. The concept must remove the final friction and address the most likely reason someone stops mid-application. Direct CTA back to complete.',
  },
  {
    label: 'Re-engagement — past lead',
    directive:
      'Audience who engaged previously but went cold. Pattern interrupt is key. Show what has changed or what they have missed. New proof, new angle, new urgency.',
  },
  {
    label: 'Re-engagement — past member',
    directive:
      'Former members or alumni who know TPB well. Lead with transformation, what’s new in the program, and what peers have achieved since they left. Nostalgia + social proof + FOMO.',
  },
]

export const offerOptions: DirectiveOption[] = [
  {
    label: NO_PREFERENCE,
    directive:
      'The user has no offer preference — select the most appropriate offer type and CTA frame based on the campaign brief, angle, and awareness stage.',
  },
  {
    label: 'Strategy Call / Application',
    directive:
      'High-commitment next step. The concept must qualify hard — state exactly who this is for and who it is not. Carry heavy social proof with named results. Pre-frame the call as valuable and selective, not a sales pitch. High proof burden.',
  },
  {
    label: 'Webinar / Masterclass',
    directive:
      'Medium friction. Sell the ONE insight or transformation they will walk away with. Curiosity and outcome-driven. The CTA promise is the discovery, not the product.',
  },
  {
    label: 'Free Lead Magnet',
    directive:
      'Low friction, easy yes. Lead with the specific tangible promise of the asset. Light proof burden, heavy emphasis on the concrete deliverable they receive immediately.',
  },
  {
    label: 'Live Event / In-Person',
    directive:
      'Lead with scarcity, the room, and who else will be there. Urgency is primary. Date, location, and limited seats are the creative levers.',
  },
  {
    label: 'Low-Ticket Offer',
    directive:
      'Transactional. Lead with value-to-price asymmetry and the immediate outcome they receive. Price anchoring matters here.',
  },
]

/** A fresh, agent-decides-everything input set — the modal's starting state. */
export function createDefaultInputs(): ReactorInputs {
  return {
    brief: '',
    angle: angleOptions[0],
    angleIsAgentDecided: true,
    outputTypes: [],
    outputTypesAgentDecided: true,
    awarenessStage: awarenessOptions[0].label,
    awarenessDirective: awarenessOptions[0].directive,
    sophisticationStage: sophisticationOptions[0].label,
    sophisticationDirective: sophisticationOptions[0].directive,
    audienceType: audienceOptions[0].label,
    audienceDirective: audienceOptions[0].directive,
    offerType: offerOptions[0].label,
    offerTypeDirective: offerOptions[0].directive,
    offerName: '',
    onBrandEnabled: true,
    brandSettings: defaultBrandSettings,
  }
}
