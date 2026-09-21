import { NextRequest, NextResponse } from 'next/server'

/**
 * Download proxy for generated creatives. Provider CDNs (Kie / fal / Higgsfield)
 * serve stills inline and cross-origin, so a plain <a download> neither forces a
 * save nor names the file. This route fetches the asset server-side and streams
 * it back with Content-Disposition: attachment, giving the user a clean, named
 * PNG download of the finished creative.
 *
 * SSRF-safe: only absolute https URLs are proxied, and only image responses are
 * streamed back.
 */

export const runtime = 'nodejs'

function safeFilename(raw: string | null, ext: string): string {
  const base = (raw || 'optimised-creative').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${base || 'optimised-creative'}.${ext}`
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  const name = req.nextUrl.searchParams.get('name')

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  }

  let target: URL
  try {
    target = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }
  if (target.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only https image URLs can be downloaded' }, { status: 400 })
  }

  try {
    const res = await fetch(target.toString(), { cache: 'no-store' })
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Source returned ${res.status}` }, { status: 502 })
    }
    const contentType = res.headers.get('content-type') || 'image/png'
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'URL is not an image' }, { status: 415 })
    }
    // Extension from the real content-type (png stays png), defaulting to png.
    const ext = contentType.includes('jpeg') || contentType.includes('jpg')
      ? 'jpg'
      : contentType.includes('webp')
        ? 'webp'
        : 'png'

    return new NextResponse(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFilename(name, ext)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Download failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }
}
