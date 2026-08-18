/**
 * Whose platform this LOOKS like.
 *
 * `lib/tenant.ts` answers who the agents write FOR; this answers whose name and
 * mark the shell wears. They resolve from the same place — the connected
 * website — so connecting a site rebrands the command center to that business
 * without anyone editing a file or redeploying.
 *
 * Falls back to the product's own lockup when no site is connected, so a fresh
 * deployment still looks finished on first load rather than blank.
 *
 * This module is PURE — types, the default, and a string helper — so the client
 * chrome can import it. The resolver that reads the connected website lives in
 * `lib/brand-identity.server.ts`, because pulling it in here dragged node:fs
 * and node:crypto into the browser bundle through website-intelligence.
 */

export interface BrandIdentity {
  /** Display name for the shell — the connected company, or the product. */
  name: string
  /** Absolute URL of the business's logo, when one was found. */
  logoUrl: string | null
  /** 2-3 letter monogram for the avatar chip. */
  initials: string
  /** True once a real business has been connected — the shell is white-labelled. */
  branded: boolean
}

/** Shown until a website is connected. */
export const DEFAULT_IDENTITY: BrandIdentity = {
  name: 'Creative Reactor',
  logoUrl: null,
  initials: 'CR',
  branded: false,
}

/**
 * Monogram from a company name: first letters of the first two significant
 * words ("Summit Build Co" → "SB"), or the first two characters of a
 * single-word name ("Klaviyo" → "KL").
 */
export function initialsFor(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9\u00C0-\u024F\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !/^(the|and|for|ltd|llc|inc|co|group)$/i.test(w))
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const single = words[0] ?? name.trim()
  return single.slice(0, 2).toUpperCase() || DEFAULT_IDENTITY.initials
}
