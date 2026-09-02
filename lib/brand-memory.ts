import fs from 'fs'
import path from 'path'
import { buildBrandContext, websiteBrandBrief } from '@/lib/brand-context'
import { getBuilder } from '@/lib/supabase'
import { getTenant } from '@/lib/tenant'
import { getConnectedWebsite } from '@/lib/website-intelligence'

/**
 * Reads the Summit Build Co brand intelligence document that is injected into
 * the copy-generation agents at runtime.
 *
 * NOTE: This intentionally reads `brand/BRAND_MEMORY.md` — NOT `CLAUDE.md`.
 * Per the project rules, CLAUDE.md holds Claude Code's build rules and must
 * never be injected into API calls. BRAND_MEMORY.md is the brand's voice,
 * audience, proof points and visual guidelines.
 */
export function getBrandMemory(): string {
  const brandPath = path.join(process.cwd(), 'brand', 'BRAND_MEMORY.md')

  try {
    return fs.readFileSync(brandPath, 'utf-8')
  } catch (error) {
    console.error('Could not read brand/BRAND_MEMORY.md:', error)
    return ''
  }
}

/** The brand a copy call should write for, and what to call it. */
export interface ResolvedBrandMemory {
  /** The brand brief injected into the system prompt. */
  memory: string
  /** The company name the copy is written for. */
  brandName: string
  /** Where it came from — surfaced in logs when copy comes back off-brand. */
  source: 'builder' | 'website' | 'file'
}

/**
 * Whose brand a copy call writes for, resolved in order of how explicit the
 * choice was.
 *
 * `brand/BRAND_MEMORY.md` is one specific company's brand intelligence — a
 * residential builder in the Hunter Valley — checked into the repository as the
 * original tenant's memory. Every copy route reached for it unconditionally, so
 * a customer who connected their own website still had that builder's voice,
 * proof points and visual style injected into the system prompt underneath
 * their own brief. Copy written to the wrong brand memory does not look broken;
 * it looks like the platform simply misunderstood the business.
 *
 * Order:
 *   1. An explicitly selected builder — the user named this profile.
 *   2. The connected website — ATLAS read this business's real identity.
 *   3. The static file — a deployment with nothing connected at all.
 *
 * Never throws: every step degrades to the next.
 */
export async function resolveBrandMemory(
  builderId?: string | null,
): Promise<ResolvedBrandMemory> {
  if (builderId) {
    try {
      const builder = await getBuilder(builderId)
      return { memory: buildBrandContext(builder), brandName: builder.name, source: 'builder' }
    } catch (err) {
      console.error('Builder load failed, falling back to connected website:', err)
    }
  }

  try {
    const site = await getConnectedWebsite()
    if (site) {
      const brief = websiteBrandBrief(site)
      // An empty brief means the scan indexed pages but derived no profiles
      // (usually a missing ANTHROPIC_API_KEY at scan time). The site is still
      // the right IDENTITY even when the profiles are thin, so keep the name.
      const tenant = await getTenant().catch(() => null)
      const brandName = tenant?.companyName?.trim() || site.domain
      if (brief) return { memory: brief, brandName, source: 'website' }
    }
  } catch (err) {
    console.error('Connected website lookup failed, using the static brand file:', err)
  }

  return { memory: getBrandMemory(), brandName: 'Summit Build Co', source: 'file' }
}
