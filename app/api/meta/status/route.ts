import { NextResponse } from 'next/server'
import { metaApiStatus } from '@/lib/meta-graph'
import { currentAccount } from '@/lib/account'

export const dynamic = 'force-dynamic'

// Verifies the Meta Marketing API connection without exposing the dashboard to
// live data. Returns whether the token is configured, whether it can reach the
// Graph API, how many ad accounts it sees, and the spend threshold the
// dashboard must clear before it swaps from demo to live numbers.
export async function GET() {
  const status = await metaApiStatus(await currentAccount())
  return NextResponse.json(status)
}
