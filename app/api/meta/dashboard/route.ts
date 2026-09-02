import { NextResponse } from 'next/server'
import { resolveMetaDashboard } from '@/lib/meta-graph'
import { resolveRange } from '@/lib/date-range'
import { currentAccount } from '@/lib/account'

export const dynamic = 'force-dynamic'

/**
 * The dashboard payload for one date range.
 *
 * The client control fetches this on every range change and swaps the whole
 * page atomically — one request, one window, so no two components can ever be
 * showing different periods. A failure returns ok:false with the reason so the
 * UI can show a real error state instead of silently stale numbers.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const range = resolveRange({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    preset: url.searchParams.get('preset'),
    tz: url.searchParams.get('tz'),
  })

  try {
    const data = await resolveMetaDashboard(await currentAccount(), range)
    return NextResponse.json({ ok: true, data })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Meta data could not be loaded', range },
      { status: 502 },
    )
  }
}
