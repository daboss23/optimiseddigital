import { NextRequest, NextResponse } from 'next/server'
import { updateFramework, deleteFramework } from '@/lib/supabase'
import { currentAccount } from '@/lib/account'
import type { FrameworkUpdate } from '@/types'

export const runtime = 'nodejs'

// Edit or remove one of the session account's frameworks. An id that belongs
// to another account — or to the platform — matches nothing.

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const account = await currentAccount()
  if (!account) {
    return NextResponse.json({ success: false, error: 'No account on this session' }, { status: 401 })
  }
  try {
    const body = (await request.json()) as FrameworkUpdate
    const updated = await updateFramework(params.id, body, account)
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update framework error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update framework' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const account = await currentAccount()
  if (!account) {
    return NextResponse.json({ success: false, error: 'No account on this session' }, { status: 401 })
  }
  try {
    await deleteFramework(params.id, account)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete framework error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to delete framework' },
      { status: 500 }
    )
  }
}
