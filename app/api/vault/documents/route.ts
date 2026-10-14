import { NextRequest, NextResponse } from 'next/server'
import { currentAccount, requireAccount } from '@/lib/account'
import {
  MAX_PDF_BYTES,
  deleteDocument,
  documentsReadiness,
  listDocuments,
  uploadDocument,
} from '@/lib/documents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/* ----------------------------------------------------------------------------
   Long documents — PDFs the Reactor reads by structure (PageIndex).

   GET     the account's documents + whether the feature is configured
   POST    multipart `file` — upload one PDF
   DELETE  ?id=<document id> — remove it here and at the provider

   The account is resolved from the session on every call. A document id in a
   request only ever narrows a lookup that is already scoped to that account.
---------------------------------------------------------------------------- */

export async function GET() {
  const readiness = documentsReadiness()
  const account = await currentAccount()
  if (!account) {
    return NextResponse.json({ success: true, readiness, maxBytes: MAX_PDF_BYTES, documents: [] })
  }
  const listed = await listDocuments(account)
  if (!listed.ok) {
    return NextResponse.json({ success: false, error: listed.error, readiness }, { status: 500 })
  }
  return NextResponse.json({
    success: true,
    readiness,
    maxBytes: MAX_PDF_BYTES,
    documents: listed.documents,
  })
}

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

  let file: File | null = null
  try {
    const form = await request.formData()
    const entry = form.get('file')
    file = entry instanceof File ? entry : null
  } catch {
    return NextResponse.json(
      { success: false, error: `Could not read the upload. Files must be PDFs under ${MAX_PDF_BYTES / 1024 / 1024} MB.` },
      { status: 400 },
    )
  }
  if (!file) {
    return NextResponse.json({ success: false, error: 'No file provided.' }, { status: 400 })
  }

  const uploaded = await uploadDocument(account, file.name, await file.arrayBuffer())
  if (!uploaded.ok) {
    return NextResponse.json({ success: false, error: uploaded.error }, { status: 422 })
  }
  return NextResponse.json({ success: true, document: uploaded.document })
}

export async function DELETE(request: NextRequest) {
  let account: string
  try {
    account = await requireAccount()
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'No account on this session.' },
      { status: 401 },
    )
  }

  const id = request.nextUrl.searchParams.get('id')?.trim() ?? ''
  if (!id) return NextResponse.json({ success: false, error: 'id is required.' }, { status: 400 })

  const removed = await deleteDocument(account, id)
  if (!removed.ok) {
    return NextResponse.json({ success: false, error: removed.error }, { status: 422 })
  }
  return NextResponse.json({ success: true })
}
