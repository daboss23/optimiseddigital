/**
 * Server-side resolution of the shell's branding. Split from
 * `lib/brand-identity.ts` so the client chrome can import the types and the
 * default without dragging website-intelligence's node: imports into the
 * browser bundle.
 */

import { getConnectedWebsite } from '@/lib/website-intelligence'
import { getTenant } from '@/lib/tenant'
import { DEFAULT_IDENTITY, initialsFor, type BrandIdentity } from '@/lib/brand-identity'

/**
 * Resolve the shell's identity. Never throws — any failure falls back to the
 * product lockup, because a branding lookup must not be able to break the
 * chrome that renders every page.
 */
export async function getBrandIdentity(): Promise<BrandIdentity> {
  try {
    const [site, tenant] = await Promise.all([getConnectedWebsite(), getTenant()])
    const name = tenant.companyName?.trim() || site?.domain || ''
    if (!name) return DEFAULT_IDENTITY

    return {
      name,
      logoUrl: site?.brandAssets?.logoUrl ?? null,
      initials: initialsFor(name),
      branded: true,
    }
  } catch (err) {
    console.error('Brand identity lookup failed, using product default:', err)
    return DEFAULT_IDENTITY
  }
}
