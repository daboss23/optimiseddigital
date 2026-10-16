import { NextRequest, NextResponse } from 'next/server'
import { csvToKnowledgeText } from '@/lib/csv'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'md' || ext === 'txt') {
      const text = await file.text()
      const content = text.trim()
      if (!content) {
        return NextResponse.json({ success: false, error: 'File is empty' }, { status: 400 })
      }
      return NextResponse.json({ success: true, content })
    }

    // Review-app and survey exports: one review / response per row, turned into
    // readable lines with the customer's identity (names, emails, order ids)
    // left behind. See lib/csv.ts.
    if (ext === 'csv') {
      const content = csvToKnowledgeText(await file.text())
      if (!content) {
        return NextResponse.json({ success: false, error: 'The CSV has no rows to read' }, { status: 400 })
      }
      return NextResponse.json({ success: true, content })
    }

    if (ext === 'pdf') {
      const arrayBuffer = await file.arrayBuffer()

      // unpdf ships a serverless-friendly build of pdf.js that runs in Node
      // without the browser globals (DOMMatrix/Path2D) that pdf-parse's pdf.js
      // build assumes. Dynamic import defers the load to runtime.
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer))
      const { text } = await extractText(pdf, { mergePages: true })

      const content = (Array.isArray(text) ? text.join('\n') : text)
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      if (!content || content.length < 10) {
        return NextResponse.json(
          { success: false, error: 'Could not extract text from this PDF' },
          { status: 400 }
        )
      }

      const trimmed =
        content.length > 8000
          ? content.slice(0, 8000) + '\n\n[content truncated at 8000 chars]'
          : content

      return NextResponse.json({ success: true, content: trimmed })
    }

    return NextResponse.json(
      { success: false, error: 'Unsupported file type. Use .md, .txt, .csv or .pdf' },
      { status: 400 }
    )
  } catch (error) {
    console.error('File parse error:', error)
    const detail = error instanceof Error ? error.message : ''
    const message = detail
      ? `Couldn't read this file — ${detail}. Try a .md or .txt export instead.`
      : "Couldn't read this file. Try a .md or .txt export instead."
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
