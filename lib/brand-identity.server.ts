/**
 * Server-side resolution of the shell's branding. Split from
 * `lib/brand-identity.ts` so the client chrome can import the types and the
 * default without dragging website-intelligence's node: imports into the
 * browser bundle.
 */

import { getConnectedWebsite } from '@/lib/website-intelligence'
import { getTenant } from '@/lib/tenant'
import { DEFAULT_IDENTITY, initialsFor, type BrandIdentity } from '@/lib/brand-identity'
import { getSetting, settingsConfigured, SETTING_BRAND_LOGO } from '@/lib/settings'

/**
 * Resolve the shell's identity. Never throws — any failure falls back to the
 * product lockup, because a branding lookup must not be able to break the
 * chrome that renders every page.
 */
export async function getBrandIdentity(): Promise<BrandIdentity> {
  try {
    const [site, tenant, uploaded] = await Promise.all([
      getConnectedWebsite(),
      getTenant(),
      getSetting<{ dataUrl: string }>(SETTING_BRAND_LOGO),
    ])
    const canUploadLogo = settingsConfigured()
    const name = tenant.companyName?.trim() || site?.domain || ''

    // An uploaded logo is an explicit choice, so it outranks the one ATLAS
    // guessed from the site — and it stands on its own even before a website is
    // connected, which is the whole point of offering the upload.
    if (!name) {
      return uploaded?.dataUrl
        ? {
            ...DEFAULT_IDENTITY,
            logoUrl: uploaded.dataUrl,
            domain: site?.domain ?? null,
            branded: true,
            logoUploaded: true,
            canUploadLogo,
          }
        : { ...DEFAULT_IDENTITY, canUploadLogo }
    }

    return {
      name,
      logoUrl: uploaded?.dataUrl ?? site?.brandAssets?.logoUrl ?? null,
      domain: site?.domain ?? null,
      initials: initialsFor(name),
      branded: true,
      logoUploaded: Boolean(uploaded?.dataUrl),
      canUploadLogo,
    }
  } catch (err) {
    console.error('Brand identity lookup failed, using product default:', err)
    return DEFAULT_IDENTITY
  }
}
