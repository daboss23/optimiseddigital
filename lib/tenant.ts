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

/**
 * Resolved identities, KEYED BY ACCOUNT.
 *
 * This was a single `cached` profile in module scope. A serverless instance
 * serves many requests, so whichever customer warmed it handed their company
 * name, industry, audience and positioning to whoever landed on that instance
 * next — into the orchestrator prompt, the render prompt and the shell. A cache
 * that cannot say WHOSE entry it holds is not a cache on a multi-tenant
 * deployment, it is a leak with a TTL.
 *
 * Bounded, because an unbounded map keyed by tenant is a slow memory leak on an
 * instance that serves a thousand accounts.
 */
const MAX_CACHED_TENANTS = 64
const cache = new Map<string, { at: number; profile: TenantProfile }>()

export async function getTenant(accountId: string | null): Promise<TenantProfile> {
  // No account: the env override or the neutral fallback, never another
  // customer's identity and never a cached one.
  if (!accountId) return fromEnv() ?? NEUTRAL_TENANT

  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.profile

  let profile = fromEnv() ?? NEUTRAL_TENANT
  try {
    const site = await getConnectedWebsite(accountId)
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

  if (cache.size >= MAX_CACHED_TENANTS) {
    // Oldest insertion first — Map preserves insertion order.
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(accountId, { at: Date.now(), profile })
  return profile
}

/** Drop the cache — call after a website scan so the new identity is live. */
export function invalidateTenant(accountId?: string | null): void {
  // One account's scan invalidates that account's identity. Clearing the whole
  // map would be correct but wasteful; clearing nothing would leave a customer
  // looking at their previous brand for a minute after connecting a new site.
  if (accountId) cache.delete(accountId)
  else cache.clear()
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
