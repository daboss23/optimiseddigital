/**
 * Meta ad unit layer — the contract that turns a generated concept into a
 * LAUNCH-READY Meta ad, not a copy fragment.
 *
 * A Meta ad is a structured unit: primary text (with the hook inside the
 * ~125-character "See more" fold on mobile), a ≤40-character headline, an
 * optional ≤30-character description, and a CTA button from Meta's enum. This
 * module owns that shape end to end: the type, Meta's real constraints, the
 * validator (including the platform's hard compliance phrases), the Ads-Manager-ready
 * clipboard format, the orchestrator prompt block, the submit_concepts JSON
 * schema fragment, and the demo-mode generator.
 *
 * Kept framework-agnostic (pure data + functions) so the server route and the
 * client concept cards share one source of truth for what "Meta-ready" means.
 */

import type { CreativeTaxonomy } from '@/lib/taxonomy'

/* --------------------------------- Limits ---------------------------------- */

/** Characters of primary text visible before Meta's "See more" fold on mobile. */
export const PRIMARY_TEXT_FOLD = 125
/** Meta truncates headlines beyond ~40 characters in most placements. */
export const HEADLINE_MAX = 40
/** Meta truncates link descriptions beyond ~30 characters. */
export const DESCRIPTION_MAX = 30

/**
 * The CTA button types the platform offers — the subset of Meta's
 * call_to_action enum that maps to a standard funnel (learn → subscribe → apply).
 */
export const META_CTA_OPTIONS = [
  'LEARN_MORE',
  'APPLY_NOW',
  'SIGN_UP',
  'BOOK_NOW',
  'GET_OFFER',
  'DOWNLOAD',
  'SUBSCRIBE',
  'CONTACT_US',
  'WATCH_MORE',
] as const

export type MetaCta = (typeof META_CTA_OPTIONS)[number]

/** Builder-facing button labels, as Meta renders them. */
export const META_CTA_LABELS: Record<MetaCta, string> = {
  LEARN_MORE: 'Learn More',
  APPLY_NOW: 'Apply Now',
  SIGN_UP: 'Sign Up',
  BOOK_NOW: 'Book Now',
  GET_OFFER: 'Get Offer',
  DOWNLOAD: 'Download',
  SUBSCRIBE: 'Subscribe',
  CONTACT_US: 'Contact Us',
  WATCH_MORE: 'Watch More',
}

/* --------------------------------- Shape ----------------------------------- */

/** A complete, launch-ready Meta ad unit attached to a generated concept. */
export interface MetaAdPackage {
  /** The ad body. The hook must land inside the first PRIMARY_TEXT_FOLD chars. */
  primaryText: string
  /** ≤ HEADLINE_MAX chars — shown under the creative next to the CTA button. */
  headline: string
  /** ≤ DESCRIPTION_MAX chars — optional proof/urgency reinforcement. */
  description?: string
  /** Meta CTA button type (META_CTA_OPTIONS). */
  cta: string
}

/* ------------------------------- Validation -------------------------------- */

export interface AdComplianceIssue {
  field: 'primaryText' | 'headline' | 'description' | 'cta'
  severity: 'error' | 'warning'
  message: string
}

// The platform's hard compliance constraints (mirrors the orchestrator's COMPLIANCE
// block) — enforced in code, not just in the prompt, so nothing banned ships.
const BANNED_PHRASES = ['guaranteed', 'you will make', 'passive income', 'get rich', 'earn from home']

/**
 * Validate an ad package against Meta's placement constraints and the hard
 * compliance rules. `error` issues block shipping (the orchestrator revises);
 * `warning` issues surface on the concept card but don't block.
 */
export function validateAdPackage(pkg: MetaAdPackage | undefined): AdComplianceIssue[] {
  if (!pkg) return []
  const issues: AdComplianceIssue[] = []

  const headline = pkg.headline?.trim() ?? ''
  if (!headline) {
    issues.push({ field: 'headline', severity: 'error', message: 'Headline is missing.' })
  } else if (headline.length > HEADLINE_MAX) {
    issues.push({
      field: 'headline',
      severity: 'error',
      message: `Headline is ${headline.length} chars — Meta truncates past ${HEADLINE_MAX}. Tighten it.`,
    })
  }

  const description = pkg.description?.trim() ?? ''
  if (description.length > DESCRIPTION_MAX) {
    issues.push({
      field: 'description',
      severity: 'warning',
      message: `Description is ${description.length} chars — Meta truncates past ${DESCRIPTION_MAX}.`,
    })
  }

  const primary = pkg.primaryText?.trim() ?? ''
  if (!primary) {
    issues.push({ field: 'primaryText', severity: 'error', message: 'Primary text is missing.' })
  } else {
    // The hook (first sentence or first line) must resolve before the fold —
    // otherwise the scroll-stopper is literally cut off by "…See more".
    const firstBreak = primary.search(/[.!?\n]/)
    const hookEnd = firstBreak === -1 ? primary.length : firstBreak + 1
    if (hookEnd > PRIMARY_TEXT_FOLD) {
      issues.push({
        field: 'primaryText',
        severity: 'error',
        message: `The opening line runs ${hookEnd} chars — it gets cut by the "See more" fold at ${PRIMARY_TEXT_FOLD}. Land the hook earlier.`,
      })
    }
  }

  const banned = BANNED_PHRASES.filter((p) =>
    `${primary} ${headline} ${description}`.toLowerCase().includes(p),
  )
  for (const phrase of banned) {
    issues.push({
      field: 'primaryText',
      severity: 'error',
      message: `Contains the banned compliance phrase "${phrase}" — rewrite without it.`,
    })
  }

  const cta = (pkg.cta ?? '').toUpperCase()
  if (!META_CTA_OPTIONS.includes(cta as MetaCta)) {
    issues.push({
      field: 'cta',
      severity: 'warning',
      message: `CTA "${pkg.cta}" is not a Meta button type — defaulting to Learn More.`,
    })
  }

  return issues
}

/** The rendered CTA label for a package, defaulting safely. */
export function ctaLabel(pkg: MetaAdPackage): string {
  const cta = (pkg.cta ?? '').toUpperCase() as MetaCta
  return META_CTA_LABELS[cta] ?? META_CTA_LABELS.LEARN_MORE
}

/* ------------------------- Test-ID name threading -------------------------- */

/**
 * The test/variant token format shared by the creative-push naming and the
 * performance-ingest parsing — declared ONCE here so the two can never drift.
 * A test is RXN-{5 chars}; a variant appends -A / -B / -AA…
 */
export const TEST_ID_RE = /\b(RXN-[A-Z0-9]{5})(?:-([A-Z]+))?\b/i

export interface TestToken {
  testId: string
  variantId?: string
}

/** Recover the RXN test token from a Meta ad/creative name, if present. */
export function parseTestToken(name: string | null | undefined): TestToken | null {
  if (!name) return null
  const m = TEST_ID_RE.exec(name)
  if (!m) return null
  const testId = m[1].toUpperCase()
  return { testId, variantId: m[2] ? `${testId}-${m[2].toUpperCase()}` : undefined }
}

/**
 * Build a Meta creative/ad name that leads with the test attribution so a synced
 * ad auto-maps back to its hypothesis, then a human-readable descriptor — e.g.
 * "RXN-4Z9Q1-B · Urgency · UGC Mashup". Capped at 90 chars (the publisher's
 * existing limit). Falls back to a plain descriptor when there's no test.
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

/* --------------------------- Ads Manager export ----------------------------- */

/**
 * Format a concept's ad package as paste-ready text for Meta Ads Manager —
 * field labels matching the Ads Manager creative form, in its field order.
 */
export function formatForAdsManager(conceptType: string, pkg: MetaAdPackage): string {
  const lines = [
    `— Meta ad unit (${conceptType}) —`,
    '',
    'PRIMARY TEXT:',
    pkg.primaryText.trim(),
    '',
    `HEADLINE: ${pkg.headline.trim()}`,
  ]
  if (pkg.description?.trim()) lines.push(`DESCRIPTION: ${pkg.description.trim()}`)
  lines.push(`CTA BUTTON: ${ctaLabel(pkg)}`)
  return lines.join('\n')
}

/* --------------------------- Orchestrator wiring ---------------------------- */

/**
 * Meta-native craft rules injected into the coordinator prompt on EVERY run —
 * the difference between "good copy" and copy engineered for Meta's feed.
 */
export const META_CRAFT_BLOCK = `META AD CRAFT — every concept ships as a complete, launch-ready Meta ad unit (the adPackage field), not a copy fragment:
- primaryText: the ad body. Only the first ${PRIMARY_TEXT_FOLD} characters show before Meta's "See more" fold on mobile — the full pattern-interrupt hook must land inside them. Never open on the offer. Write for a sound-off, mobile-first feed: short lines, a line break between beats, no walls of text.
- headline: ≤ ${HEADLINE_MAX} characters. A concrete benefit, proof point, or curiosity gap — never a label or the company name.
- description: ≤ ${DESCRIPTION_MAX} characters, optional. One reinforcing proof or urgency beat.
- cta: one of ${META_CTA_OPTIONS.join(', ')}. Match commitment to temperature: cold = LEARN_MORE/WATCH_MORE, warm = SIGN_UP/DOWNLOAD/SUBSCRIBE, hot = APPLY_NOW/BOOK_NOW.
- One idea per ad, one CTA. Creative aspect ratios: 1:1 or 4:5 for feed, 9:16 for Reels/Stories — keep key text out of the top and bottom 14% of 9:16 creative (Meta UI safe zones).
- Packages violating these limits or the compliance constraints are bounced back to you for revision before anything ships.`

/**
 * JSON-schema fragment for the adPackage property on submit_concepts — kept
 * here so the tool contract and the validator can never drift apart.
 */
export const adPackageSchema = {
  type: 'object' as const,
  description: `REQUIRED for every concept: the complete, launch-ready Meta ad unit. The hook must land inside the first ${PRIMARY_TEXT_FOLD} chars of primaryText (mobile "See more" fold).`,
  properties: {
    primaryText: {
      type: 'string' as const,
      description: `The ad body. First ${PRIMARY_TEXT_FOLD} chars show before the fold — the hook lives there. Short lines, line breaks between beats.`,
    },
    headline: { type: 'string' as const, description: `Max ${HEADLINE_MAX} chars.` },
    description: { type: 'string' as const, description: `Optional, max ${DESCRIPTION_MAX} chars.` },
    cta: {
      type: 'string' as const,
      enum: [...META_CTA_OPTIONS],
      description: 'Meta CTA button type, matched to audience temperature.',
    },
  },
  required: ['primaryText', 'headline', 'cta'],
}

/**
 * Build the revision feedback handed back to OPUS when submitted packages fail
 * validation — same loop shape as the NEURO pre-test critique.
 */
export function adPackageFeedback(
  concepts: { type: string; adPackage?: MetaAdPackage }[],
): { failingIndices: number[]; feedback: string } {
  const lines: string[] = []
  const failingIndices: number[] = []
  concepts.forEach((c, i) => {
    const errors = validateAdPackage(c.adPackage).filter((x) => x.severity === 'error')
    const missing = !c.adPackage
    if (missing) {
      failingIndices.push(i)
      lines.push(`- [${c.type}] has NO adPackage — every concept must ship as a complete Meta ad unit.`)
    } else if (errors.length > 0) {
      failingIndices.push(i)
      lines.push(`- [${c.type}] ${errors.map((e) => e.message).join(' ')}`)
    }
  })
  const feedback = `META AD COMPLIANCE: ${failingIndices.length} concept(s) are not launch-ready:\n${lines.join(
    '\n',
  )}\n\nFix these packages (keep the concept, repair the ad unit) and call submit_concepts again with ALL concepts, including the ones that already passed.`
  return { failingIndices, feedback }
}

/* --------------------------------- Demo mode -------------------------------- */

/**
 * Deterministic demo ad package so demo mode (no ANTHROPIC_API_KEY) shows the
 * full launch-ready experience, per concept type and angle.
 */
export function demoAdPackage(
  conceptType: string,
  angle: string,
  audience = 'operators',
): MetaAdPackage {
  const a = angle || 'Profit'
  const al = a.toLowerCase()
  const hot = /founder|testimonial|campaign/i.test(conceptType)
  // Deliberately unbranded scaffolding with the SHAPE of a compliant ad unit —
  // fold discipline, character budgets, one idea, a real CTA — and none of one
  // company's copy. It used to be a finished ad for a specific coaching
  // business, complete with its client count, which every deployment without a
  // key rendered as its own and could push straight to Meta.
  return {
    primaryText: `Most ${audience} don't have a ${al} problem. They have a ${al} leak.\n\nThe numbers look fine at the top and nobody can say where it goes after that.\n\nThis is the demo path — connect a website and fire the Reactor for real copy written to your brand.\n\nSee how it works below.`,
    headline: `Find the ${a} leak in your business`.slice(0, HEADLINE_MAX),
    description: 'Demo ad unit'.slice(0, DESCRIPTION_MAX),
    cta: hot ? 'APPLY_NOW' : 'LEARN_MORE',
  }
}
