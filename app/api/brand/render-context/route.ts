/**
 * The connected business, in the form an IMAGE model needs.
 *
 * Stills and videos are rendered from the browser (the reactor streams a
 * production brief and the client compiles it — see `lib/render-prompt.ts`),
 * and until this route existed the browser had no way to learn who the ad was
 * for. Every render was therefore composed from a pattern name, an audience
 * label and a headline, with the business itself never named. An image model
 * given an under-specified prompt does not fail; it supplies a subject of its
 * own, and a decorative stock photograph is what that looks like.
 *
 * Deliberately a separate, tiny payload rather than a slice of
 * `/api/brand-identity`: that route answers "whose logo does the chrome wear",
 * this one answers "what belongs inside the frame". They resolve from the same
 * connected website but they are not the same question, and folding them
 * together would put a data URI logo into every render request.
 *
 * Always 200s with a usable object — a render must never be blocked by a
 * branding lookup.
 */

import { NextResponse } from 'next/server'
import { renderBrandFrom } from '@/lib/brand-context'
import { getTenant } from '@/lib/tenant'
import { getConnectedWebsite } from '@/lib/website-intelligence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // The tenant resolves from the same scan and is cached, so this costs one
    // read in practice. It is still worth asking for both: the tenant carries
    // an env override for deployments that name their business without a scan.
    const [site, tenant] = await Promise.all([
      getConnectedWebsite().catch(() => null),
      getTenant().catch(() => null),
    ])
    return NextResponse.json({ success: true, data: renderBrandFrom(site, tenant) })
  } catch (error) {
    console.error('Render brand context failed:', error)
    return NextResponse.json({ success: true, data: {} })
  }
}
