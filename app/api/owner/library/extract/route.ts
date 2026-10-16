import { NextRequest, NextResponse } from 'next/server'
import { isOwnerRequest } from '@/lib/owner-session'
import { MAX_DOC_CHARS } from '@/lib/library/text'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * PDF → text for the Platform Library, owner-only.
 *
 * The browser reads Markdown, text, CSV and HTML itself (Notion zips are
 * unpacked there too); a PDF needs pdf.js, which runs here. Unlike the
 * Vault's parser this keeps the WHOLE document — an SOP manual is the point,
 * not an 8,000-character preview of it.
 */

/** Vercel's request body ceiling is 4.5 MB; stay under it with headroom. */
const MAX_PDF_BYTES = 4 * 1024 * 1024

export async function POST(request: NextRequest) {
  if (!(await isOwnerRequest())) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }
    if (!/\.pdf$/i.test(file.name)) {
      return NextResponse.json({ success: false, error: 'Only PDFs are extracted here' }, { status: 400 })
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json(
        { success: false, error: 'PDF is over 4 MB — export it as Markdown, or split it.' },
        { status: 413 },
      )
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (String.fromCharCode(...Array.from(bytes.slice(0, 5))) !== '%PDF-') {
      return NextResponse.json({ success: false, error: 'That file is not a PDF' }, { status: 400 })
    }
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(bytes)
    const { text } = await extractText(pdf, { mergePages: true })
    const content = (Array.isArray(text) ? text.join('\n') : text)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_DOC_CHARS)
    if (content.length < 40) {
      return NextResponse.json(
        { success: false, error: 'No text could be read from this PDF — it may be scanned images.' },
        { status: 422 },
      )
    }
    return NextResponse.json({ success: true, text: content })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'The PDF could not be read' },
      { status: 500 },
    )
  }
}
