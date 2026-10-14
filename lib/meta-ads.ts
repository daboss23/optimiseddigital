/**
 * Meta creative layer — the contract for what this platform hands to Meta.
 *
 * THE PLATFORM MAKES THE CREATIVE, NOT THE CAPTION.
 *
 * It used to ship every concept as a full Meta ad unit — primary text,
 * headline, description, CTA button — with an editor and a mock Facebook feed
 * to polish it in. That layer was removed on purpose. For an e-commerce
 * account the caption is the cheap part: a media buyer runs a handful of
 * proven primary texts across dozens of creatives, and Meta's own Advantage+
 * text variations rewrite captions for free. What is scarce is the CREATIVE —
 * enough genuinely different, product-true visuals to feed delivery — so that
 * is the whole job now, and everything an ad must SAY has to be said by the
 * creative itself.
 *
 * This module owns what remains of the contract, in one place:
 *   - the RXN test token that threads a hypothesis through Meta and back
 *     (`metaAdName`, `metaAssetName`, `parseTestToken`);
 *   - the on-creative compliance gate — words burned into pixels cannot be
 *     edited in Ads Manager, so they are checked BEFORE the render;
 *   - the creative craft block injected into every orchestrator run;
 *   - the placement map the Launch Bay reads a finished creative against.
 *
 * Kept framework-agnostic (pure data + functions) so the server route, the
 * upload, the ingest and the client cards share one definition.
 */

import type { CreativeTaxonomy } from '@/lib/taxonomy'

/* ------------------------- Test-ID name threading -------------------------- */

/**
 * The test/variant token format shared by the upload naming and the
 * performance-ingest parsing — declared ONCE here so the two can never drift.
 * A test is RXN-{5 chars}; a variant appends -A / -B / -AA…
 */
export const TEST_ID_RE = /\b(RXN-[A-Z0-9]{5})(?:-([A-Z]+))?\b/i

export interface TestToken {
  testId: string
  variantId?: string
}

/** Recover the RXN test token from a Meta ad, creative or asset name, if present. */
export function parseTestToken(name: string | null | undefined): TestToken | null {
  if (!name) return null
  const m = TEST_ID_RE.exec(name)
  if (!m) return null
  const testId = m[1].toUpperCase()
  return { testId, variantId: m[2] ? `${testId}-${m[2].toUpperCase()}` : undefined }
}

/**
 * A Meta name that leads with the test attribution, then a human-readable
 * descriptor — e.g. "RXN-4Z9Q1-B · Urgency · UGC Mashup". Capped at 90 chars.
 * Falls back to a plain descriptor when there is no test.
 */
export function metaAdName(opts: {
  variantId?: string
  testId?: string
  taxonomy?: CreativeTaxonomy
  fallback?: string
}): string {
  const id = opts.variantId || opts.testId
  const descr = [opts.taxonomy?.hookStyle, opts.taxonomy?.visualFormat || opts.taxonomy?.assetType]
    .filter(Boolean)
    .join(' · ')
  const parts = [id, descr || opts.fallback?.trim()].filter(Boolean)
  const name = parts.join(' · ') || opts.fallback?.trim() || 'Reactor creative'
  return name.slice(0, 90)
}

/**
 * The same name, made safe to be a FILENAME — which is what Meta keeps as an
 * uploaded image's name in the media library.
 *
 * Separators are spaces and hyphens, never underscores: `TEST_ID_RE` ends on a
 * word boundary, and "RXN-4Z9Q1-B_Hook" has none after the B, so an underscore
 * would silently cut the variant off the token and the ingest would attribute
 * the ad to the test but not to the version that won it.
 */
export function metaAssetName(name: string, extension: string): string {
  const base =
    name
      .replace(/·/g, '-')
      .replace(/[^A-Za-z0-9 .\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Reactor creative'
  const ext = extension.replace(/^\./, '').toLowerCase() || 'png'
  return `${base}.${ext}`
}

/* ------------------------ On-creative compliance gate ----------------------- */

export interface CreativeComplianceIssue {
  /** Where the words were found — on the image, or spoken/captioned in motion. */
  field: 'onImageText' | 'script'
  severity: 'error' | 'warning'
  message: string
}

interface ClaimRule {
  re: RegExp
  severity: 'error' | 'warning'
  why: string
}

/**
 * Claims that get e-commerce ads rejected, or get the account restricted.
 *
 * Written as patterns rather than banned WORDS because the old list banned
 * the substring "guaranteed" — which is also how every legitimate
 * "30-day money-back guarantee" is phrased, and that is one of the strongest
 * offers an e-commerce brand has. A rule here names the CLAIM, not a word.
 *
 * Errors are things Meta's advertising standards reject outright: promised
 * outcomes, medical cures, weight-loss figures, income claims, and ads that
 * assert the viewer's personal attributes ("Do you have acne?"). Warnings are
 * claims that are legal only when literally true and substantiated — the
 * platform cannot verify them, so it says so instead of passing them silently.
 */
const CLAIM_RULES: ClaimRule[] = [
  {
    re: /\bguaranteed (results?|to (work|cure|fix|heal|grow|lose|remove|clear|eliminate|reverse))\b/i,
    severity: 'error',
    why: 'promises an outcome the product cannot guarantee',
  },
  {
    // The CLAIM, not the word: "it cures", "cure your…", "cured my…". The
    // adjective is left alone — "dry-cured for 90 days" sells salami, and a
    // food brand must be able to say so.
    re: /\bcures\b|\bcure (your|the|my|her|his|their|it|acne|eczema|psoriasis|rosacea|anxiety|depression|insomnia|hair loss|baldness|pain|disease)\b|\bcured (my|your|her|his|their|our|the|it|me|of)\b|\bmiracle cure\b/i,
    severity: 'error',
    why: 'is a medical cure claim',
  },
  {
    re: /\bcure for\b/i,
    severity: 'warning',
    why: 'reads as a cure claim — fine as play on a snack, a rejection on anything sold for the body',
  },
  {
    re: /\blose \d+\s?(lbs?|pounds?|kg|kilos?|stone)\b/i,
    severity: 'error',
    why: 'states a weight-loss figure',
  },
  {
    re: /\b(miracle|magic pill|overnight results?|instant results?|permanent results?)\b/i,
    severity: 'error',
    why: 'promises an unrealistic outcome',
  },
  {
    re: /\b(you will make|passive income|get rich|earn from home)\b/i,
    severity: 'error',
    why: 'is an income claim',
  },
  {
    // Meta rejects copy that asserts or implies the viewer HAS a condition or
    // trait. "This serum calms redness" sells the product; "Do you have acne?"
    // tells the reader what is wrong with them, and that is the rejected form.
    // "fat" is deliberately absent: "Are you tired of fat-free snacks…" is a
    // product claim, and a pattern that bounces it teaches the team to ignore
    // the gate.
    re: /\b(are you|do you (have|suffer)|is your|you('re| are))\b[^.?!]{0,40}\b(overweight|obese|acne|depress\w*|anxi\w*|diabet\w*|balding|bald|wrinkl\w*|infertil\w*|insomnia|lonely|in debt)\b/i,
    severity: 'error',
    why: 'asserts the viewer’s personal attributes, which Meta rejects',
  },
  {
    re: /\bfda[- ]?approved\b/i,
    severity: 'warning',
    why: 'is a regulatory claim — only true for approved drugs and devices, never for supplements or cosmetics',
  },
  {
    re: /\bclinically (proven|tested)\b/i,
    severity: 'warning',
    why: 'needs a study behind it — keep it only if the brand can produce one',
  },
  {
    re: /\b(#1|number one|no\.? ?1|best[- ]selling|bestselling)\b/i,
    severity: 'warning',
    why: 'is a ranking claim — keep it only if the brand can substantiate it',
  },
]

function scan(text: string, field: CreativeComplianceIssue['field']): CreativeComplianceIssue[] {
  const issues: CreativeComplianceIssue[] = []
  for (const rule of CLAIM_RULES) {
    const m = rule.re.exec(text)
    if (!m) continue
    issues.push({
      field,
      severity: rule.severity,
      message: `"${m[0].trim()}" ${rule.why}.`,
    })
  }
  return issues
}

/** The parts of a concept that actually reach a viewer. */
export interface ShippableCreative {
  type: string
  productionBrief?: {
    frames?: { label: string; description: string }[]
    onImageText?: { role?: string; text?: string }[]
  }
}

/** Motion formats whose frames carry spoken lines and captions that ship. */
const MOTION_RE = /video|ugc|testimonial|montage|scene/i

/**
 * Check the words a creative will actually show or say.
 *
 * Only what SHIPS is judged: the on-image text of every creative, plus the
 * frames of a motion concept (its spoken lines and burned-in captions). The
 * concept's own description is direction for the team, never seen by a buyer,
 * and judging it would bounce a concept for describing the problem it solves.
 */
export function validateCreativeCopy(c: ShippableCreative | undefined): CreativeComplianceIssue[] {
  if (!c) return []
  const issues: CreativeComplianceIssue[] = []
  const onImage = (c.productionBrief?.onImageText ?? [])
    .map((t) => t?.text?.trim())
    .filter(Boolean)
    .join(' · ')
  if (onImage) issues.push(...scan(onImage, 'onImageText'))
  if (MOTION_RE.test(c.type)) {
    const script = (c.productionBrief?.frames ?? [])
      .map((f) => f?.description ?? '')
      .join(' ')
    if (script.trim()) issues.push(...scan(script, 'script'))
  }
  return issues
}

/**
 * Revision feedback for the orchestrator when submitted creatives carry a
 * blocking claim — same loop shape as the NEURO and production-brief gates,
 * sharing their single bounded revision pass.
 */
export function creativeCopyFeedback(
  concepts: ShippableCreative[],
): { failingIndices: number[]; feedback: string } {
  const lines: string[] = []
  const failingIndices: number[] = []
  concepts.forEach((c, i) => {
    const errors = validateCreativeCopy(c).filter((x) => x.severity === 'error')
    if (errors.length === 0) return
    failingIndices.push(i)
    lines.push(`- [${c.type}] ${errors.map((e) => e.message).join(' ')}`)
  })
  const feedback = `CREATIVE COMPLIANCE: ${failingIndices.length} creative(s) carry a claim Meta rejects, and words burned into a creative cannot be edited after the render:\n${lines.join(
    '\n',
  )}\n\nRewrite those words (keep the concept, sell the product's real benefit instead of the forbidden claim) and call submit_concepts again with ALL concepts, including the ones that already passed.`
  return { failingIndices, feedback }
}

/* ----------------------------- Placement map -------------------------------- */

export interface Placement {
  ratio: '4:5' | '1:1' | '9:16' | '16:9'
  label: string
  where: string
}

/**
 * Where a finished creative can run, read off its pixels rather than its
 * label. The Launch Bay shows this beside every creative so an upload never
 * lands a 16:9 still in a campaign that only buys Reels.
 */
export const PLACEMENTS: Placement[] = [
  { ratio: '4:5', label: 'Tall feed', where: 'Facebook + Instagram feed — the largest mobile footprint' },
  { ratio: '1:1', label: 'Square', where: 'Feed, Marketplace and right column — safest across placements' },
  { ratio: '9:16', label: 'Vertical', where: 'Stories and Reels — keep product and text out of the top 14% and bottom 20%' },
  { ratio: '16:9', label: 'Landscape', where: 'In-stream video and desktop feed only' },
]

/** The placement whose ratio is closest to a width × height, or null for a degenerate size. */
export function placementFor(width: number, height: number): Placement | null {
  if (!(width > 0) || !(height > 0)) return null
  const r = width / height
  const value = (p: Placement) => {
    const [w, h] = p.ratio.split(':').map(Number)
    return w / h
  }
  return PLACEMENTS.reduce((best, p) =>
    Math.abs(value(p) - r) < Math.abs(value(best) - r) ? p : best,
  )
}

/* --------------------------- Orchestrator wiring ---------------------------- */

/**
 * The e-commerce creative craft injected into the coordinator prompt on EVERY
 * run. It replaces the old caption block: with no primary text behind it, the
 * creative carries the whole sale.
 */
export const META_CREATIVE_CRAFT_BLOCK = `META CREATIVE CRAFT — this platform ships the CREATIVE, not the caption. The caption is written later in Ads Manager, so everything the ad must say has to be said BY the creative:
- THE PRODUCT IS THE HERO. Every still shows the real product — or the product in use — large enough to read at thumb size; every video shows it inside the first two seconds. Describe it exactly as the catalog and website show it (shape, colour, packaging, label). Never invent a variant, a colourway, a bundle or packaging that is not sold.
- ONE IDEA PER CREATIVE: one desire, one proof, one offer. The on-image headline carries the hook; the on-image CTA label names the action ("Shop Now", "Get 20% Off", "Claim Your Free Gift").
- PROOF IS NATIVE TO E-COMMERCE: star ratings, review counts, a customer's own words, units sold, press mentions — used ONLY when the product facts, the website or the Vault supply the figure. Never invent a rating, a review, a count, a price or a discount.
- OFFERS ARE STATED EXACTLY AS CONFIGURED: the % or amount off, the threshold, the bundle, the gift — never rounded up, never stacked, never presented as permanent when it is a sale.
- DIVERSITY IS THE LEVER: Meta's delivery groups near-identical creatives and treats them as a single bet. Separate concepts must differ in persona, desire, archetype or visual world — never a recolour or a reworded headline of a sibling. (The operator's configured variation lever still governs the versions WITHIN a format.)
- NATIVE BEATS POLISHED ON COLD TRAFFIC: UGC-style, lo-fi phone footage, review screenshots, notes-app and founder-to-camera formats out-pull studio ads with new audiences; polished product photography earns its place on retargeting.
- PLACEMENTS: 4:5 for feed, 9:16 for Stories and Reels with the product and every word kept out of the top 14% and bottom 20% (the platform UI sits there), 1:1 when one asset must run everywhere.
- NO FAKE INTERFACE: never draw play buttons, notification badges, checkboxes, cursors or system dialogs — Meta rejects ads that imitate UI.`
