/**
 * ATLAS strategy derivation — turning a website read into strategic OPTIONS.
 *
 * The Campaign Angle and Campaign Offer dropdowns used to be a fixed list built
 * around one company's business model. Point the platform at a different kind
 * of business and the menu was quietly wrong: a marketing agency has no "Owner
 * Identity" angle, and a SaaS company does not run a "Live Event / In-Person"
 * campaign.
 *
 * This module runs once per website scan and asks the model two things:
 *   1. What is THIS business actually selling and saying? (from the extracted
 *      profiles — evidence-bound, never invented)
 *   2. What angles and offer types does a business of this CATEGORY typically
 *      run? (category knowledge, marked as such)
 *
 * The result is ADDITIVE. The seed options stay exactly where they are — the
 * derived ones are appended, deduped against the seeds, and each carries the
 * evidence that produced it so a builder can see why it appeared.
 *
 * Never throws: a failed derivation returns nothing and the dropdowns keep
 * their seed lists, which is the pre-existing behaviour.
 */

import Anthropic from '@anthropic-ai/sdk'
import { parseModelJson } from '@/lib/parse'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import type { WebsiteProfiles } from '@/lib/website-intelligence'

/** How many derived entries we will accept per axis. Keeps the menu usable. */
export const MAX_DERIVED_PER_AXIS = 6

export interface DerivedOption {
  label: string
  /** Written in the same imperative voice as the seed directives. */
  directive: string
  /** Why this appeared — the site evidence or the category reasoning. */
  evidence: string
  /** 'site' = literally evidenced on the website; 'category' = typical for this business type. */
  basis: 'site' | 'category'
}

export interface DerivedStrategyOptions {
  angles: DerivedOption[]
  offers: DerivedOption[]
  /** Audience segments this business actually sells to — short menu labels. */
  personas: string[]
  /** The pains those segments feel, in the business's own market language. */
  painPoints: string[]
  /** Short read of what kind of business this is — shown in the panel. */
  businessCategory: string
  derivedAt: string
}

export const EMPTY_DERIVED: DerivedStrategyOptions = {
  angles: [],
  offers: [],
  personas: [],
  painPoints: [],
  businessCategory: '',
  derivedAt: '',
}

/* ------------------------------- Normalising ------------------------------ */

/** Loose match so "Webinar/Masterclass" doesn't get appended next to "Webinar / Masterclass". */
function fingerprint(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Short menu labels (personas / pain points). Drops sentences and duplicates. */
function asLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw) {
    const label = typeof v === 'string' ? v.trim() : ''
    if (!label || label.length > 40) continue
    const fp = fingerprint(label)
    if (!fp || seen.has(fp)) continue
    seen.add(fp)
    out.push(label)
    if (out.length >= MAX_DERIVED_PER_AXIS) break
  }
  return out
}

function asOption(raw: unknown, basis: 'site' | 'category'): DerivedOption | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  const directive = typeof r.directive === 'string' ? r.directive.trim() : ''
  if (!label || !directive) return null
  // A label long enough to be a sentence is a model mistake, not an option.
  if (label.length > 48) return null
  return {
    label,
    directive,
    evidence: typeof r.evidence === 'string' ? r.evidence.trim() : '',
    basis: r.basis === 'site' || r.basis === 'category' ? r.basis : basis,
  }
}

/**
 * Append derived options to the seed labels, dropping anything that duplicates
 * a seed or an earlier derived entry. Seeds always win — the menu the user
 * already knows never reorders under them.
 */
export function mergeDerived(
  seedLabels: readonly string[],
  derived: readonly DerivedOption[],
): DerivedOption[] {
  const seen = new Set(seedLabels.map(fingerprint))
  const out: DerivedOption[] = []
  for (const opt of derived) {
    const fp = fingerprint(opt.label)
    if (!fp || seen.has(fp)) continue
    seen.add(fp)
    out.push(opt)
    if (out.length >= MAX_DERIVED_PER_AXIS) break
  }
  return out
}

/* -------------------------------- Derivation ------------------------------ */

function profileDigest(profiles: WebsiteProfiles, domain: string): string {
  const b = profiles.brand
  const a = profiles.audience
  const o = profiles.offer
  const m = profiles.messaging
  const list = (xs: string[] | undefined, n: number) =>
    (xs ?? []).map((s) => s?.trim()).filter(Boolean).slice(0, n).join('; ')

  return [
    `Domain: ${domain}`,
    `Company: ${b.companyName}`,
    `Industry: ${b.industry}`,
    `Business model: ${b.businessModel}`,
    `Positioning: ${b.positioning}`,
    `Value propositions: ${list(b.valuePropositions, 5)}`,
    `Primary audiences: ${list(a.primaryAudiences, 4)}`,
    `Audience problems: ${list(a.problems, 6)}`,
    `Audience desires: ${list(a.desires, 6)}`,
    `Primary offer: ${o.primaryOffer}`,
    `Products: ${list(o.products, 5)}`,
    `Services: ${list(o.services, 5)}`,
    `Programs: ${list(o.programs, 5)}`,
    `Lead magnets: ${list(o.leadMagnets, 4)}`,
    `Events: ${list(o.events, 4)}`,
    `Calls to action: ${list(o.callsToAction, 6)}`,
    `Messaging themes: ${list(m.themes, 6)}`,
    `Transformation language: ${list(m.transformationLanguage, 5)}`,
  ]
    .filter((line) => !line.endsWith(': '))
    .join('\n')
}

function systemPrompt(seedAngles: readonly string[], seedOffers: readonly string[]): string {
  return `You are ATLAS, the Website Intelligence layer of a creative campaign platform. You have just read a company's website and extracted its brand, audience, offer and messaging profiles. Your job now is to propose the CAMPAIGN ANGLES and OFFER TYPES this specific business should be able to choose from when briefing a campaign.

Two sources, and you must label which one each option came from:
- basis "site": the website itself evidences this angle or offer. Quote or closely paraphrase the evidence.
- basis "category": this business is a <category>, and businesses of that category typically run this angle or offer type. Say what the category reasoning is.

HARD RULES
- Never invent an offer the business does not plausibly sell. A "category" option must be genuinely typical for the business type, not aspirational.
- Do NOT return any option that duplicates one of these existing angles: ${seedAngles.join(', ')}
- Do NOT return any option that duplicates one of these existing offers: ${seedOffers.join(', ')}
- Labels are SHORT menu entries (2-5 words), title case, no trailing punctuation. Examples of the right shape: "Retainer / Ongoing Service", "Free Audit", "Client Results".
- Directives are one dense paragraph written as an instruction to a creative team, matching this voice: "High-commitment next step. The concept must qualify hard — state exactly who this is for and who it is not. Carry heavy social proof with named results."
- Return at most ${MAX_DERIVED_PER_AXIS} angles and at most ${MAX_DERIVED_PER_AXIS} offers. Fewer is better than padding.
- If the extracted profiles are too thin to support a confident read, return empty arrays. An empty list is a valid, honest answer.

Also return the audience PERSONAS this business sells to and the PAIN POINTS those personas feel, as short menu labels (2-4 words each, title case, max ${MAX_DERIVED_PER_AXIS} of each). These are the axes a creative test is isolated on, so they must be distinct from one another and phrased in the business's own market language.

Reply with ONLY a JSON object, no prose, no markdown fences:
{"businessCategory":"short phrase, e.g. 'B2B marketing agency'","angles":[{"label":"","directive":"","evidence":"","basis":"site|category"}],"offers":[{"label":"","directive":"","evidence":"","basis":"site|category"}],"personas":["",""],"painPoints":["",""]}`
}

/**
 * Derive campaign angles + offer types for the scanned business. Returns
 * EMPTY_DERIVED when no key is configured, the profiles are too thin, or the
 * call fails — the caller keeps its seed lists either way.
 */
export async function deriveStrategyOptions(
  profiles: WebsiteProfiles,
  domain: string,
  seedAngles: readonly string[],
  seedOffers: readonly string[],
): Promise<DerivedStrategyOptions> {
  if (!process.env.ANTHROPIC_API_KEY) return EMPTY_DERIVED

  const digest = profileDigest(profiles, domain)
  // Under ~200 chars the scan recovered almost nothing; deriving from that
  // would be guessing at the business, which is exactly what this replaces.
  if (digest.length < 200) return EMPTY_DERIVED

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: 3000,
      system: systemPrompt(seedAngles, seedOffers),
      messages: [
        {
          role: 'user',
          content: `Extracted website intelligence:\n"""\n${digest}\n"""\n\nPropose the campaign angles and offer types for this business.`,
        },
      ],
    })
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const raw = parseModelJson<Record<string, unknown>>(text)

    const angles = Array.isArray(raw.angles)
      ? raw.angles.map((a) => asOption(a, 'category')).filter((a): a is DerivedOption => a !== null)
      : []
    const offers = Array.isArray(raw.offers)
      ? raw.offers.map((o) => asOption(o, 'category')).filter((o): o is DerivedOption => o !== null)
      : []

    return {
      angles: mergeDerived(seedAngles, angles),
      offers: mergeDerived(seedOffers, offers),
      personas: asLabels(raw.personas),
      painPoints: asLabels(raw.painPoints),
      businessCategory: typeof raw.businessCategory === 'string' ? raw.businessCategory.trim() : '',
      derivedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('Strategy derivation failed, keeping seed options:', err)
    return EMPTY_DERIVED
  }
}
