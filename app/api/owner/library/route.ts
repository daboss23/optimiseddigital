import { NextRequest, NextResponse } from 'next/server'
import { isOwnerRequest } from '@/lib/owner-session'
import {
  deleteLibraryDocument,
  ingestLibraryDocuments,
  isLibraryKind,
  libraryReadiness,
  listLibraryDocuments,
  retagLibraryDocument,
  type LibraryIngestResult,
  type LibraryUpload,
} from '@/lib/library'
import { MAX_DOC_CHARS } from '@/lib/library/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A batch is a series of embedding calls and inserts; give it room.
export const maxDuration = 300

/**
 * The Platform Library, owner-only.
 *
 * GET    — readiness + every document (title, niches, kind, size).
 * POST   — { documents: [{ title, sourceName, text, niches, kind }] } → ingest.
 *          The browser has already unpacked zips and read text files; PDFs go
 *          through /api/owner/library/extract first.
 * PATCH  — { id, niches } → retag a document (and its sections).
 * DELETE — ?id= → remove a document and its sections.
 *
 * Every handler checks the owner cookie FIRST and answers 404 without it: to
 * anyone else this route does not exist.
 */

const notFound = () => NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

/** Documents per request — the browser batches under Vercel's body limit too. */
const MAX_DOCS = 40

export async function GET() {
  if (!(await isOwnerRequest())) return notFound()
  const readiness = await libraryReadiness()
  try {
    const documents = readiness.installed ? await listLibraryDocuments() : []
    return NextResponse.json({ success: true, readiness, documents })
  } catch (err) {
    return NextResponse.json({
      success: false,
      readiness,
      documents: [],
      error: err instanceof Error ? err.message : 'The library could not be listed',
    })
  }
}

export async function POST(request: NextRequest) {
  if (!(await isOwnerRequest())) return notFound()
  const readiness = await libraryReadiness()
  if (!readiness.installed) {
    return NextResponse.json({ success: false, error: readiness.reason }, { status: 503 })
  }
  const body = (await request.json().catch(() => null)) as { documents?: unknown } | null
  const raw = Array.isArray(body?.documents) ? body.documents.slice(0, MAX_DOCS) : []
  if (!raw.length) {
    return NextResponse.json({ success: false, error: 'No documents in this batch.' }, { status: 400 })
  }
  // One result per document sent, IN ORDER — the browser matches them back by
  // position, which survives two documents sharing a title.
  const results: LibraryIngestResult[] = []
  for (const d of raw as Record<string, unknown>[]) {
    const text = typeof d?.text === 'string' ? d.text.slice(0, MAX_DOC_CHARS) : ''
    const title = typeof d?.title === 'string' ? d.title : ''
    if (!text.trim()) {
      results.push({ title: title || 'Untitled', status: 'empty', chunks: 0 })
      continue
    }
    const doc: LibraryUpload = {
      title,
      sourceName: typeof d.sourceName === 'string' ? d.sourceName : null,
      text,
      niches: Array.isArray(d.niches) ? (d.niches as unknown[]).map(String) : [],
      kind: isLibraryKind(d.kind) ? d.kind : 'sop',
    }
    results.push(...(await ingestLibraryDocuments([doc])))
  }
  return NextResponse.json({ success: true, results })
}

export async function PATCH(request: NextRequest) {
  if (!(await isOwnerRequest())) return notFound()
  const body = (await request.json().catch(() => null)) as { id?: unknown; niches?: unknown } | null
  if (typeof body?.id !== 'string' || !body.id) {
    return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
  }
  try {
    const niches = await retagLibraryDocument(
      body.id,
      Array.isArray(body.niches) ? (body.niches as unknown[]).map(String) : [],
    )
    return NextResponse.json({ success: true, niches })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Retag failed' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isOwnerRequest())) return notFound()
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
  try {
    await deleteLibraryDocument(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    )
  }
}
