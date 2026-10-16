import { NextResponse } from 'next/server'
import { vaultStats } from '@/lib/knowledge'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live counts of what THIS account has stored in the knowledge layer (falls
// back to the curated demo map when Supabase isn't configured).
export async function GET() {
  try {
    const stats = await vaultStats(await currentAccount())
    return NextResponse.json({ success: true, ...stats })
  } catch (err) {
    console.error('Vault stats error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Stats failed' },
      { status: 500 },
    )
  }
}
