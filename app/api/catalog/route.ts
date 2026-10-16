import { NextResponse } from 'next/server'
import { catalogSummary, syncCatalog } from '@/lib/catalog'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A sync reads the catalog API, then a dozen product pages for ratings —
// bounded by per-request timeouts, comfortably inside Fluid compute's 300s.
export const maxDuration = 120

/**
 * The product catalog.
 *
 * GET  — this account's catalog as summaries (title, price, sale price,
 *        image, rating), or `{ catalog: null }` before the first sync.
 * POST — read the store again. Body `{ storeUrl? }`; without one, the
 *        account's connected website is the store. Never throws: a store that
 *        cannot be read comes back as `{ ok: false, error }`.
 */

export async function GET() {
  return NextResponse.json({ ok: true, catalog: await catalogSummary(await currentAccount()) })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { storeUrl?: unknown }
  const storeUrl = typeof body.storeUrl === 'string' ? body.storeUrl : undefined
  const account = await currentAccount()
  const result = await syncCatalog(account, storeUrl)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error })
  return NextResponse.json({
    ok: true,
    stored: result.stored,
    catalog: await catalogSummary(account),
  })
}
