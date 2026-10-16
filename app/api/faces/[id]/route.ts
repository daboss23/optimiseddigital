import { NextRequest, NextResponse } from 'next/server'
import { deleteFace, facesConfigured } from '@/lib/faces'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'

// Remove a roster entry (and its Storage object).
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!facesConfigured()) {
    return NextResponse.json({ success: false, error: 'Supabase is not configured' }, { status: 400 })
  }
  try {
    await deleteFace(params.id, await currentAccount())
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Face delete error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    )
  }
}
