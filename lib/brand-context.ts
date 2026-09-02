import type { Builder } from '@/types'
import type { WebsiteSummary } from '@/lib/website-intelligence'
import type { RenderBrand } from '@/lib/render-prompt'
import type { TenantProfile } from '@/lib/tenant'

const UNKNOWN = 'Not confidently identified'

/** Drop empty / not-identified values, trim, cap the list, join for a prompt. */
function list(items: string[] | undefined, max: number): string {
  const clean = (items ?? [])
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s) && s !== UNKNOWN)
  return Array.from(new Set(clean)).slice(0, max).join('; ')
}

function field(value: string | undefined): string {
  const v = value?.trim()
  return v && v !== UNKNOWN ? v : ''
}

/**
 * Turn the connected website's extracted intelligence (Brand Intelligence tab)
 * into an ON-BRAND prompt block the orchestrator applies to every concept —
 * copy AND visuals. This is the live wire between what ATLAS read from the
 * site and what the reactor writes: real voice, offer, audience language,
 * proof, and the brand's own colours, not a generic default.
 *
 * Returns '' when nothing usable was extracted, so the caller can fall back to
 * the static brand settings.
 */
export function websiteBrandBrief(w: WebsiteSummary): string {
  const b = w.profiles.brand
  const a = w.profiles.audience
  const o = w.profiles.offer
  const p = w.profiles.proof
  const company = field(b.companyName) || w.domain

  const lines: string[] = []
  const positioning = field(b.positioning)
  const voice = field(b.brandVoice)
  const tone = field(b.tone)
  const industry = field(b.industry)
  const primaryOffer = field(o.primaryOffer)
  const audiences = list(a.primaryAudiences, 3)
  const audienceLanguage = list([...a.audienceLanguage, ...a.problems, ...a.desires], 8)
  const valueProps = list(b.valuePropositions, 4)
  const differentiators = list([...b.differentiators, ...b.primaryPromises], 4)
  const proof = list([...p.results, ...p.statistics, ...p.testimonials], 4)
  const colors = (w.brandAssets?.colors ?? []).map((c) => c.hex).slice(0, 6)

  if (industry) lines.push(`Industry: ${industry}`)
  if (positioning) lines.push(`Positioning: ${positioning}`)
  if (voice) lines.push(`Brand voice: ${voice}`)
  if (tone) lines.push(`Tone: ${tone}`)
  if (primaryOffer) lines.push(`Primary offer: ${primaryOffer}`)
  if (audiences) lines.push(`Primary audience: ${audiences}`)
  if (audienceLanguage) lines.push(`Speak in the audience's own words: ${audienceLanguage}`)
  if (valueProps) lines.push(`Value propositions: ${valueProps}`)
  if (differentiators) lines.push(`Differentiators / promises: ${differentiators}`)
  if (proof) lines.push(`Real proof to draw on (never invent): ${proof}`)
  if (colors.length) {
    lines.push(
      `Brand colours — use these as the creative palette (hex): ${colors.join(', ')}. Compose every still and video around this palette.`,
    )
  }
  if (w.brandAssets?.logoUrl) {
    lines.push(
      'A logo exists and is composited after render — never draw a wordmark or logo lettering into the image; leave clean space for it.',
    )
  }

  // Nothing beyond the company name was recovered — let the caller fall back.
  if (lines.length === 0) return ''

  return [
    `ON BRAND — LIVE BRAND INTELLIGENCE (extracted by ATLAS from the connected website ${w.domain}). Apply this brand's REAL identity to every concept, in both copy and visuals. This is authoritative and overrides generic voice guidance.`,
    `Company: ${company}`,
    ...lines,
    `Non-negotiable: every concept must be unmistakably ${company} — specific enough that the brand name could not be swapped out for another company.`,
  ].join('\n')
}

/**
 * Builds a brand-memory style brief from a stored builder profile. Used in
 * place of the static brand/BRAND_MEMORY.md when a specific builder is
 * selected, so the same engine produces on-brand copy for any tenant.
 */
export function buildBrandContext(b: Builder): string {
  const proof = (b.proof_points ?? [])
    .filter((p) => p && p.trim())
    .map((p) => `- ${p}`)
    .join('\n')

  const sections = [
    `# Brand Memory - ${b.name}`,
    b.region ? `**Region:** ${b.region}` : '',
    b.website ? `**Website:** ${b.website}` : '',
    b.serves ? `## Who they build for\n${b.serves}` : '',
    b.offer ? `## Core offer\n${b.offer}` : '',
    proof ? `## Proof points\n${proof}` : '',
    b.brand_voice ? `## Voice & tone\n${b.brand_voice}` : '',
    b.visual_style ? `## Visual style guide\n${b.visual_style}` : '',
    `## Non-negotiable\nEvery line of copy must be specific to ${b.name} - it should be impossible to swap the brand name out and reuse it for any other builder.`,
  ]

  return sections.filter(Boolean).join('\n\n')
}

/**
 * The same live brand intelligence, cut down to what an IMAGE model needs.
 *
 * `websiteBrandBrief` above is written for the orchestrator: voice, promises,
 * proof, audience language — paragraphs a writer uses. An image model needs the
 * opposite: who the business is, what world its pictures come from, which
 * colours are its own, and whether to leave the logo alone. Sending it the copy
 * brief would bury those four facts in text it cannot act on.
 *
 * This existed nowhere, which is why every still was composed from a pattern
 * name and an audience label — enough to write a headline, nowhere near enough
 * to choose a subject. The tenant profile fills whatever the site scan could
 * not establish, so a partially-read site still renders on-brand.
 */
export function renderBrandFrom(
  site: WebsiteSummary | null,
  tenant?: TenantProfile | null,
): RenderBrand {
  const b = site?.profiles.brand
  const a = site?.profiles.audience

  const name = field(b?.companyName) || tenant?.companyName?.trim() || site?.domain || ''
  const industry = field(b?.industry) || tenant?.industry?.trim() || ''
  // The audience the PICTURES are for. Their own words describe the world they
  // work in far better than a segment label does, so the primary audience leads
  // and the language they use follows it.
  const audience =
    list(a?.primaryAudiences, 2) || tenant?.audienceDescriptor?.trim() || ''
  const positioning = field(b?.positioning) || tenant?.positioning?.trim() || ''

  return {
    name: name || undefined,
    industry: industry || undefined,
    audience: audience || undefined,
    positioning: positioning || undefined,
    palette: (site?.brandAssets?.colors ?? []).map((c) => c.hex).filter(Boolean).slice(0, 6),
    hasLogo: Boolean(site?.brandAssets?.logoUrl),
  }
}

/** True when a resolved brand carries enough to steer a render at all. */
export function renderBrandIsUsable(brand: RenderBrand): boolean {
  return Boolean(brand.name || brand.industry || brand.audience || brand.palette?.length)
}
