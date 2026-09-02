/**
 * The operator's live data endpoint.
 *
 * A thin shell over `fetchOperatorSource` — all the Graph work lives in
 * `lib/operator/adapters/meta-server.ts` so the route, the client adapter and
 * the live self-test can never grow three different ideas of the contract.
 *
 * The access token never leaves the server: the browser calls this route and
 * gets back the shaped DataSource payload, nothing Meta-flavoured.
 *
 * Failure is loud on purpose. A 500 here puts the operator surface into its
 * disconnected state — it never renders half an account as if it were whole.
 */

import { NextResponse } from 'next/server'
import { fetchOperatorSource } from '@/lib/operator/adapters/meta-server'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
// Live account data — never cached.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const payload = await fetchOperatorSource(await currentAccount())
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Meta source failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
