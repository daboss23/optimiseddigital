import { NextRequest, NextResponse } from 'next/server'
import { requireAccount } from '@/lib/account'
import { askDocument } from '@/lib/documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Ask one of the account's long documents a question — the same call the
 * Reactor's `read_document` tool makes, exposed so an operator can check what
 * the agents will be told before a campaign depends on it.
 */
export async function POST(request: NextRequest) {
  let account: string
  try {
    account = await requireAccount()
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'No account on this session.' },
      { status: 401 },
    )
  }

  let body: { id?: unknown; question?: unknown }
  try {
    body = (await request.json()) as { id?: unknown; question?: unknown }
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const question = typeof body.question === 'string' ? body.question : ''
  if (!id || !question.trim()) {
    return NextResponse.json({ success: false, error: 'id and question are required.' }, { status: 400 })
  }

  const answered = await askDocument(account, id, question)
  if (!answered.ok) {
    return NextResponse.json({ success: false, error: answered.error }, { status: 422 })
  }
  return NextResponse.json({ success: true, answer: answered.answer, document: answered.document })
}
