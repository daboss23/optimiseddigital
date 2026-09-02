/**
 * Tenant identity — who this deployment is FOR.
 *
 * The agent network used to name the original tenant (and its trades /
 * construction audience) directly inside its system prompts. That made every
 * deployment the original tenant's deployment: point the platform at a marketing agency and
 * NOVA still profiled builders, NEURO still framed the pre-test around
 * builder coaching, and the strategic directives still assumed the reader had
 * seen that first tenant's ads.
 *
 * Identity now resolves in three tiers, most authoritative first:
 *   1. The connected website (ATLAS's own read — the real source of truth)
 *   2. Environment overrides, for a deployment with no site connected yet
 *   3. A neutral fallback that names no company at all
 *
 * The fallback is deliberately generic rather than any named company: a prompt that says
 * "this business" produces vague copy, but a prompt that says the wrong
 * company produces confidently wrong copy, which is far more expensive.
 */

import { getConnectedWebsite, type WebsiteSummary } from '@/lib/website-intelligence'

const UNKNOWN = 'Not confidently identified'

export interface TenantProfile {
  /** Full company name, e.g. "Northwind Studio". Empty when genuinely unknown. */
  companyName: string
  /** What the business does, e.g. "marketing agency". */
  industry: string
  /** Who it sells to, e.g. "founder-led B2B firms". */
  audienceDescriptor: string
  /** One-line positioning, when the site stated one. */
  positioning: string
  /** Where this identity came from — surfaced in telemetry, never guessed at. */
  source: 'website' | 'env' | 'default'
}

/** No company named. Prompts fall back to role-neutral phrasing. */
export const NEUTRAL_TENANT: TenantProfile = {
  companyName: '',
  industry: '',
  audienceDescriptor: '',
  positioning: '',
  source: 'default',
}

function clean(value: string | undefined | null): string {
  const v = (value ?? '').trim()
  return v && v !== UNKNOWN ? v : ''
}

function fromEnv(): TenantProfile | null {
  const companyName = clean(process.env.TENANT_COMPANY_NAME)
  const industry = clean(process.env.TENANT_INDUSTRY)
  const audienceDescriptor = clean(process.env.TENANT_AUDIENCE)
  if (!companyName && !industry && !audienceDescriptor) return null
  return {
    companyName,
    industry,
    audienceDescriptor,
    positioning: clean(process.env.TENANT_POSITIONING),
    source: 'env',
  }
}

/** Derive the tenant from an already-loaded website summary (no extra I/O). */
export function tenantFromWebsite(w: WebsiteSummary): TenantProfile {
  const brand = w.profiles.brand
  const audience = w.profiles.audience
  const companyName = clean(brand.companyName) || w.domain
  const primaryAudience = (audience.primaryAudiences ?? [])
    .map((a) => clean(a))
    .filter(Boolean)
    .slice(0, 2)
    .join(' and ')

  return {
    companyName,
    industry: clean(brand.industry),
    audienceDescriptor: primaryAudience,
    positioning: clean(brand.positioning),
    source: 'website',
  }
}

/* --------------------------- Resolution + cache --------------------------- */
// The tenant is read on every agent prompt build. Cache briefly so a single
// Reactor run (many parallel prompts) makes one database round trip, while a
// freshly connected website still takes effect without a redeploy.

const TTL_MS = 60_000
let cached: { at: number; profile: TenantProfile } | null = null

export async function getTenant(): Promise<TenantProfile> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.profile

  let profile = fromEnv() ?? NEUTRAL_TENANT
  try {
    const site = await getConnectedWebsite()
    if (site) {
      const fromSite = tenantFromWebsite(site)
      // The site wins, but only for fields it actually established — an env
      // override still covers whatever the scan could not identify.
      profile = {
        companyName: fromSite.companyName || profile.companyName,
        industry: fromSite.industry || profile.industry,
        audienceDescriptor: fromSite.audienceDescriptor || profile.audienceDescriptor,
        positioning: fromSite.positioning || profile.positioning,
        source: 'website',
      }
    }
  } catch (err) {
    // Identity must never take the reactor down — a missing tenant degrades to
    // neutral phrasing, which is safe.
    console.error('Tenant resolution failed, using fallback:', err)
  }

  cached = { at: Date.now(), profile }
  return profile
}

/** Drop the cache — call after a website scan so the new identity is live. */
export function invalidateTenant(): void {
  cached = null
}

/* ------------------------------ Prompt helpers ---------------------------- */

/**
 * The subject of an agent's system prompt: "Acme Growth (a marketing agency
 * serving founder-led B2B firms)", or "the connected brand" when unknown.
 * Never invents a name.
 */
export function tenantDescriptor(t: TenantProfile): string {
  const name = t.companyName || 'the connected brand'
  const parts: string[] = []
  if (t.industry) parts.push(t.industry)
  if (t.audienceDescriptor) parts.push(`serving ${t.audienceDescriptor}`)
  return parts.length ? `${name} (${parts.join(', ')})` : name
}

/** How to refer to the brand mid-sentence, e.g. "Acme Growth" / "the brand". */
export function tenantShortName(t: TenantProfile): string {
  return t.companyName || 'the brand'
}

/**
 * A compact identity block for prompts that need the full picture. Returns ''
 * when nothing is known, so callers can omit the section entirely rather than
 * inject a block of empty labels.
 */
export function tenantBlock(t: TenantProfile): string {
  const lines: string[] = []
  if (t.companyName) lines.push(`Company: ${t.companyName}`)
  if (t.industry) lines.push(`Industry: ${t.industry}`)
  if (t.audienceDescriptor) lines.push(`Sells to: ${t.audienceDescriptor}`)
  if (t.positioning) lines.push(`Positioning: ${t.positioning}`)
  if (!lines.length) return ''
  return `THIS DEPLOYMENT'S BUSINESS\n${lines.join('\n')}`
}
