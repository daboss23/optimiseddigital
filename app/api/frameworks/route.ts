import { NextRequest, NextResponse } from 'next/server'
import { listFrameworks, createFramework } from '@/lib/supabase'
import { currentAccount } from '@/lib/account'
import type { FrameworkInsert } from '@/types'

export const runtime = 'nodejs'

/**
 * The account's own frameworks.
 *
 * Both halves used to trust the request: GET took a `builderScope` query
 * parameter whose default, `all`, listed every brand's frameworks, and POST
 * wrote whatever `builder_id` the body named. The account now comes from the
 * session, and a session that names none gets nothing.
 */
export async function GET(request: NextRequest) {
  const account = await currentAccount()
  if (!account) return NextResponse.json({ success: true, data: [] })
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || undefined

    const frameworks = await listFrameworks(account, { category })
    return NextResponse.json({ success: true, data: frameworks })
  } catch (error) {
    console.error('List frameworks error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list frameworks' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const account = await currentAccount()
  if (!account) {
    return NextResponse.json({ success: false, error: 'No account on this session' }, { status: 401 })
  }
  try {
    const body = (await request.json()) as FrameworkInsert

    if (!body.title?.trim()) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 })
    }
    if (!body.category) {
      return NextResponse.json({ success: false, error: 'Category is required' }, { status: 400 })
    }
    if (!body.content?.trim()) {
      return NextResponse.json({ success: false, error: 'Content is required' }, { status: 400 })
    }

    const tags =
      body.tags && body.tags.length > 0
        ? body.tags.map((t) => t.trim()).filter(Boolean)
        : null

    const framework = await createFramework(
      {
        title: body.title.trim(),
        category: body.category,
        content: body.content.trim(),
        tags,
      },
      account,
    )

    return NextResponse.json({ success: true, data: framework })
  } catch (error) {
    console.error('Create framework error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create framework' },
      { status: 500 }
    )
  }
}
