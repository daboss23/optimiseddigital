/**
 * The shell's branding — the connected business's name, logo and monogram.
 *
 * Read by the client chrome (sidebar, topbar, avatar) so connecting a website
 * rebrands the command center with no redeploy. Always 200s: a failure returns
 * the product default rather than an error the chrome would have to handle.
 */

import { NextResponse } from 'next/server'
import { DEFAULT_IDENTITY } from '@/lib/brand-identity'
import { getBrandIdentity } from '@/lib/brand-identity.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await getBrandIdentity() })
  } catch (error) {
    console.error('Brand identity route failed:', error)
    return NextResponse.json({ success: true, data: DEFAULT_IDENTITY })
  }
}
