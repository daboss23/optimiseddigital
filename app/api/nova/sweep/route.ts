import { NextRequest, NextResponse } from 'next/server'
import { runNovaSweep } from '@/lib/market-intelligence'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// NOVA's memory refresh. Sweeps her core subreddits for the window's signal and
// embeds anything new — deduped — so campaign fires retrieve fresh intelligence
// with zero added latency. Callable by GET or POST.
//
// Deliberately NOT on a schedule. A weekly Vercel Cron used to fire this every
// Monday, spending model tokens on a sweep nobody asked for — including in weeks
// the platform was never opened. Sweep on demand instead; re-add a `crons` entry
// to vercel.json when the spend is worth the freshness.
//
// Auth: when CRON_SECRET is configured, Vercel attaches it as a Bearer token and
// we require a match. With no secret set, the endpoint is open (local/manual).
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return request.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runNovaSweep()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('NOVA sweep error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Sweep failed' },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST(request: NextRequest) {
  return handle(request)
}
