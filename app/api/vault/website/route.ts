import { NextRequest, NextResponse } from 'next/server'
import { getConnectedWebsite, disconnectWebsite } from '@/lib/website-intelligence'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The connected-website summary that powers the Website Intelligence panel —
// reconstructed from the website chunks already stored in the Knowledge Vault.
export async function GET() {
  try {
    const website = await getConnectedWebsite(await currentAccount())
    return NextResponse.json({ success: true, website })
  } catch (err) {
    console.error('Website summary error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to load website' },
      { status: 500 },
    )
  }
}

// Disconnect the website — remove all of its derived intelligence from the Vault.
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const domain = searchParams.get('domain')
    if (!domain) {
      return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
    }
    await disconnectWebsite(domain, await currentAccount())
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Website disconnect error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Disconnect failed' },
      { status: 500 },
    )
  }
}
