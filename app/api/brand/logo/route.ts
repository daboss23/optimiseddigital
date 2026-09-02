/**
 * The uploaded brand logo.
 *
 * ATLAS reads a logo off the connected website, but that pick is a guess: some
 * sites only ship a favicon, some a wordmark baked into a photo. An uploaded
 * file is the user's explicit answer, so it always wins.
 *
 * Stored as a data URI in platform_settings rather than in object storage —
 * a logo is tens of kilobytes, it is read on every page load, and this avoids
 * requiring a storage bucket to exist before the chrome can render.
 */

import { NextRequest, NextResponse } from 'next/server'
import { clearSetting, getSetting, setSetting, SETTING_BRAND_LOGO } from '@/lib/settings'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Transparent formats first — those are the ones that sit cleanly on the dark chrome. */
const ALLOWED = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg']

/** Base64 inflates by ~33%, so this is roughly a 750KB file. Logos are far smaller. */
const MAX_DATA_URL_BYTES = 1_000_000

export interface StoredLogo {
  dataUrl: string
  updatedAt: string
}

export async function GET() {
  const logo = await getSetting<StoredLogo>(SETTING_BRAND_LOGO, await currentAccount())
  return NextResponse.json({ success: true, data: logo })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl.trim() : ''

    const match = /^data:([a-z0-9.+/-]+);base64,/i.exec(dataUrl)
    if (!match) {
      return NextResponse.json(
        { success: false, error: 'Expected a base64 data URL.' },
        { status: 400 },
      )
    }
    if (!ALLOWED.includes(match[1].toLowerCase())) {
      return NextResponse.json(
        { success: false, error: 'Use a PNG, SVG, WebP or JPEG. A transparent PNG or SVG looks best.' },
        { status: 400 },
      )
    }
    if (dataUrl.length > MAX_DATA_URL_BYTES) {
      return NextResponse.json(
        { success: false, error: 'That file is too large — keep the logo under about 700KB.' },
        { status: 413 },
      )
    }

    const stored = await setSetting(SETTING_BRAND_LOGO, {
      dataUrl,
      updatedAt: new Date().toISOString(),
    } satisfies StoredLogo, await currentAccount())
    if (!stored) {
      return NextResponse.json(
        { success: false, error: 'Supabase is not configured, so the logo cannot be saved.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logo upload failed:', error)
    return NextResponse.json({ success: false, error: 'Upload failed' }, { status: 500 })
  }
}

export async function DELETE() {
  await clearSetting(SETTING_BRAND_LOGO, await currentAccount())
  return NextResponse.json({ success: true })
}
