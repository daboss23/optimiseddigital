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
  /**
   * The product this campaign sells, picked from the connected store's
   * catalog (`lib/catalog`). Only the id is trusted: the server re-reads the
   * product's facts — price, compare-at price, image, rating — from the
   * account's own catalog, so a figure on a creative can never come from the
   * request. `productName` is display and demo fallback only.
   */
  productId?: string
  productName?: string
  brief: string
  angle: string
  angleIsAgentDecided: boolean
  /**
   * Strategic directive for the chosen angle. Only present when the angle came
   * from ATLAS's read of the connected website — the seed angles are named
   * categories that carry no directive of their own.
   */
  angleDirective?: string
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
    'Voice: confident, specific and native to the brand’s own customers — the words they use in their reviews, not the words a marketing team uses. Speak the language the connected website and its product pages evidence. Lead with the product, a concrete detail and real proof over adjectives. No hype, no fluff, no stock superlatives.',
  toneRules:
    'Tone: warm, direct, respectful of the buyer’s intelligence. Short lines that read at thumb size. The product is the hero and every claim is earned with evidence — a real review, a real figure, a detail you can see. Engineered for performance.',
}

/* ------------------------------- Slide 1 ---------------------------------- */

/**
 * The seed campaign angles — the lenses an e-commerce creative sells through.
 *
 * Each carries its own directive, so choosing "Us vs Them" tells OPUS what that
 * angle demands rather than handing it a bare category name to interpret. ATLAS
 * appends whatever angles it derives from the connected store on top of these
 * (`/api/strategy-options`), so this is the floor, not the ceiling.
 *
 * They replaced a set written for a coaching business ("Profit", "Time
 * Freedom", "Owner Identity") — angles no product brand runs, which every
 * campaign then had to translate before it could start.
 */
export const angleSeeds: DirectiveOption[] = [
  {
    label: 'Problem → Solution',
    description: 'Name the frustration the product ends, then show it ending.',
    directive:
      'Name the one everyday frustration this product ends, in the words customers use for it, then show the product ending it. The problem is the hook; the product in use is the turn. Never invent a symptom the product does not address, and never assert the viewer has a condition.',
  },
  {
    label: 'Social Proof',
    description: 'Lead with other customers — reviews, ratings, the crowd.',
    directive:
      'Lead with other customers: a review in their own words, a star rating, a units-sold or review-count figure — ONLY where the product facts, the website or the Vault supply it. The crowd sells; the brand stays quiet. A quote states the customer’s experience, never a promised result.',
  },
  {
    label: 'Us vs Them',
    description: 'The product beside the alternative the buyer already uses.',
    directive:
      'Put the product beside the alternative the buyer already uses — the generic version, the old habit, the category default — on two or three concrete, visible dimensions. Name the category, never a competitor brand. Every difference claimed must be true of the product.',
  },
  {
    label: 'Offer-Led',
    description: 'The deal is the hook — stated exactly, product beside it.',
    directive:
      'The offer is the hook: lead with the exact deal as configured (amount off, threshold, bundle, gift), the product visible beside it, and one real reason to act now. Never round a discount up, stack offers, or imply a deal that is not running.',
  },
  {
    label: 'Quality & Craft',
    description: 'What it is made of and how — the detail a cheaper one skips.',
    directive:
      'Sell what the product is made of and how: the material, the ingredient, the process, the detail a cheaper version skips — shown in macro. Specific beats premium: name the thing, never the adjective. Every material or process claim must come from the product facts or the website.',
  },
  {
    label: 'Identity & Lifestyle',
    description: 'Who the buyer is with it — the taste, the ritual, the world.',
    directive:
      'Sell who the buyer is with the product: the taste, the ritual, the world it belongs to. The product sits naturally inside a life the audience wants, and stays the hero of the frame. Aspirational, never preachy.',
  },
  {
    label: 'Founder Story',
    description: 'The maker, in their own words — why it exists.',
    directive:
      'The person who made it, on camera or in their own words: why the product exists and the one thing they refused to compromise on. Phone-shot and specific beats polished. Founder voice earns a trust that brand voice cannot — but only facts the brief or website supply.',
  },
  {
    label: 'Gifting',
    description: 'The product as the gift — who it’s for, the moment it’s opened.',
    directive:
      'Position the product as the gift: who it is for, the moment it is opened, why it beats the usual present. Name an occasion or a deadline only if the brief does.',
  },
]

export const angleOptions = [NO_PREFERENCE, ...angleSeeds.map((a) => a.label)] as const

/**
 * What the orchestrator may choose from when the operator lets it pick the
 * deliverables. Creative formats only: the platform makes the creative, not
 * the caption, so copy-only outputs (hooks, headlines, VSL openers) are not
 * deliverables any more — they live ON the creative, inside its brief.
 */
export const outputTypeOptions = [
  'Static Creative',
  'Carousel Creatives',
  'Video Creative',
  'UGC Creative',
  'Montage / Scene Flow',
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
      'The audience feels the frustration but doesn’t know a product fixes it. Open by naming the frustration with precision — the moment it shows up in their day — and the real cost of putting up with it. Then reveal the product as the fix. Do not lead with the offer.',
  },
  {
    label: 'Solution-Aware',
    description:
      'They know solutions exist and are comparing. Lead with your mechanism, skip the problem build.',
    directive:
      'The audience knows products like this exist and is comparing — the generic version, a competitor, the habit they already have. Lead with mechanism: the specific, visible reason THIS product beats the alternatives they are already weighing. Skip the problem build.',
  },
  {
    label: 'Product-Aware',
    description:
      'They know the brand and haven’t committed. Lead with proof, risk reversal and a reason to act now.',
    directive:
      'The audience knows the brand and has looked at the product but hasn’t bought. Lead with proof — reviews in customers’ own words, a rating, the product in use. Add risk reversal and a clear reason to act now. Minimise problem education.',
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
      'The user has no market-sophistication preference — infer the stage from the brief, the competitive context, and vault research. In a heavily pitched market where the audience has seen many similar claims, default to Stage 4–5: mechanism-led differentiation with identity-level identification.',
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

/**
 * Audience temperature — where the buyer sits in an e-commerce funnel, in the
 * same segments a Meta account actually builds: broad prospecting, engaged
 * audiences, product viewers, cart abandoners, purchasers and lapsed
 * customers. Each one needs a different creative, so the directive says what
 * the creative has to DO for that segment, not who they are.
 */
export const audienceOptions: DirectiveOption[] = [
  {
    label: NO_PREFERENCE,
    directive:
      'The user has no audience preference — determine audience temperature from the brief and angle. If no clear signal, default to cold, broad prospecting.',
  },
  {
    label: 'Cold — broad prospecting',
    description: 'Never seen the brand. Broad or Advantage+ audience.',
    directive:
      'Cold traffic in a broad or Advantage+ audience with no prior exposure to the brand. The creative must stop the scroll on the product and the problem alone, earn credibility fast, and make the product legible at a glance. Assume nothing — not the brand name, not the category.',
  },
  {
    label: 'Warm — engaged, not yet shopped',
    description: 'Watched, followed or engaged — never viewed a product.',
    directive:
      'Engaged with the brand’s content, video or profile but never viewed a product. Familiar, not convinced. Lead with proof and the product in use, and answer the "is it worth it" doubt before asking for the click.',
  },
  {
    label: 'Product viewers — browsed, didn’t add',
    description: 'Looked at a product page and left.',
    directive:
      'Viewed product pages and left without adding to cart. They know what it is; something stopped them — price, fit, trust or timing. Show the product they looked at, answer the most likely objection, and lead with reviews.',
  },
  {
    label: 'Cart abandoners — added, didn’t buy',
    description: 'Added to cart or started checkout, then left.',
    directive:
      'Added to cart and left. Intent is high; friction won. Remove it: the offer, the guarantee, free shipping or returns if the brand genuinely has them, and a short reason to finish now. Product front and centre, minimal education.',
  },
  {
    label: 'Past purchasers — cross-sell & replenish',
    description: 'Bought before. Sell the next thing.',
    directive:
      'Bought before and know the product. Sell the next thing: the replenishment moment, the complementary product, the upgrade or the bundle. Speak like a brand they already trust; skip the problem education entirely.',
  },
  {
    label: 'Lapsed customers — win-back',
    description: 'Bought once and went quiet.',
    directive:
      'Bought once and went quiet. Show what’s new or what they’re missing — a new product, a new formula, a returning favourite — with a real reason to come back now. Warm, never desperate.',
  },
]

/**
 * Campaign Offer — the DEAL, not its name.
 *
 * It sets three things at once, which is why it is a strategic input rather
 * than a label: what the creative has to SHOW (one product, a bundle, a gift),
 * how much margin it gives away, and the urgency it can honestly claim. A
 * full-price ad and a BOGO ad are not the same ad with a different sticker.
 *
 * Ordered from the offer that gives away the least margin to the one that
 * gives away the most, so the list reads as the ladder it is: a brand should
 * reach for the top of it first.
 *
 * Every directive carries the same rule in its own terms — the deal is stated
 * EXACTLY as configured. A creative cannot be edited after the render, and a
 * rounded-up discount burned into one is a compliance problem shipped at scale.
 *
 * ATLAS appends whatever offers it derives from the connected store on top of
 * these (`/api/strategy-options`), so this is a seed ladder, not a ceiling.
 */
export const offerOptions: DirectiveOption[] = [
  {
    label: NO_PREFERENCE,
    directive:
      'The user has no offer preference — select the most appropriate offer framing based on the campaign brief, angle and audience temperature. When nothing in the brief names a deal, sell at full price.',
  },
  {
    label: 'Full Price — Value-Led',
    description: 'No deal attached — the product earns its price.',
    directive:
      'No discount: the product must justify its price on its own. Lead with the benefit and the proof, and let quality, reviews and specificity carry the value. Never imply a deal that is not running. The strongest test of a creative, and the one that protects margin.',
  },
  {
    label: 'New Launch / Drop',
    description: 'A new product, colour or formula — newness is the hook.',
    directive:
      'Newness is the hook: what it is, what is different about it, why now. Show the product clearly — a launch ad that hides the product is a teaser nobody remembers. Claim early access or limited quantities only if the brief says so.',
  },
  {
    label: 'Limited Stock / Restock',
    description: 'Back in stock or a limited run — scarcity that is real.',
    directive:
      'Scarcity is the lever, so it must be true: "back in stock", "last chance" or "limited run" only when the brief says so. Lead with the product and the reason it sold out — reviews, demand — then the urgency. Invented scarcity is a compliance and trust failure, never a tactic.',
  },
  {
    label: 'Quiz / Product Finder',
    description: 'A short quiz that matches the buyer to the right product.',
    directive:
      'The next step is a short quiz, not a purchase — the lowest-friction ask an e-commerce brand has. Sell the outcome of the quiz (the right product for THEM), show the range it chooses from, and make the first question feel effortless.',
  },
  {
    label: 'Free Shipping',
    description: 'Remove the most common reason a cart is abandoned.',
    directive:
      'Free shipping removes the most common checkout objection. State the terms exactly as configured (always, or over a threshold) and pair them with the product — free shipping on nothing sells nothing. Light proof burden; the friction removal is the message.',
  },
  {
    label: 'Money-Back Guarantee / Risk-Free Trial',
    description: 'Try it — the risk moves to the brand.',
    directive:
      'The guarantee is the hook: state it as the brief states it — the period and the condition — and not one degree stronger. It sells the TRY, never a result: no promised outcome, no implied refund the policy does not give. Pair it with proof so it reads as confidence, not desperation. This offer carries real compliance exposure.',
  },
  {
    label: 'Subscribe & Save',
    description: 'The routine, delivered — and cheaper every time.',
    directive:
      'Sell the routine first, the saving second: the product arriving before it runs out, the discount on every order, the freedom to skip or cancel — ONLY the terms the brand actually offers. Name the cadence if the brief does. Answer the real objection, which is being locked in.',
  },
  {
    label: 'Free Gift With Purchase',
    description: 'A gift with the order — desirable in its own right.',
    directive:
      'Show the gift beside the product and name exactly what it is. The gift sells the order, so make it desirable in its own right, and state any threshold exactly as configured. Never let the gift read as the product.',
  },
  {
    label: 'Spend Threshold / Amount Off',
    description: 'Spend over a basket size, unlock a reward — the AOV lever.',
    directive:
      'A fixed amount off, or a reward unlocked above a basket size. Reaching the threshold is the creative’s job: make it feel easy by showing the products that get there. State the terms exactly as configured — a threshold ad that hides the threshold is a bait-and-switch.',
  },
  {
    label: 'Bundle / Buy More, Save More',
    description: 'Two or more products together, for less than apart.',
    directive:
      'Show every item in the bundle, physically together, and the saving against buying them separately — only the real figures from the product facts, never manufactured or borrowed from a reference ad. Sell the set or the routine, not the arithmetic; the bundle should look like one obvious decision.',
  },
  {
    label: 'BOGO / Buy X Get Y',
    description: 'Buy one, get one free or discounted.',
    directive:
      'State the mechanic plainly — buy one, get one free or at a stated discount — with BOTH products in frame. The second item must be visible: an unseen freebie is not an offer. Terms exactly as configured, with no implied limits that do not exist.',
  },
  {
    label: 'Percent Off',
    description: 'A straight percentage off — first order, sitewide or one product.',
    directive:
      'State the exact percentage as configured and what it applies to — first order, sitewide or one product — never rounded up, never "up to" unless the brief says so, never manufactured or borrowed from a reference ad. Put the product beside the number so the discount sells THIS product, not discounting in general. A reason to act now only if the offer genuinely ends.',
  },
  {
    label: 'Sale Event / Seasonal',
    description: 'A dated event — a holiday sale, a season, an anniversary.',
    directive:
      'The event and its end date are the frame: name the event and the deal exactly as configured, with the product as the hero of the frame. The urgency is real here because the date is real — use it once, clearly, and never extend it in the creative.',
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
