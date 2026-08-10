import { NextRequest, NextResponse } from 'next/server'
import { ingestKnowledge, type KnowledgeSystem } from '@/lib/knowledge'
import { extractVideoId, fetchYouTubeTranscript, structureTranscriptForVault } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 60

const VALID_SYSTEMS: KnowledgeSystem[] = [
  'vault',
  'research',
  'transformation',
  'creative',
  'design',
  'copy',
  'pattern',
  'learning',
  'website',
]

// Ingest a piece of Knowledge Vault content: chunk it, embed each chunk via
// Voyage, and store the vectors in Supabase for retrieval by the Reactor.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, url } = body as { title?: string; content?: string; url?: string }
    let content = (body.content as string | undefined)?.trim() || ''
    const system = (body.system as KnowledgeSystem) ?? 'vault'

    // YouTube URL → pull the transcript (manual captions or auto-generated ASR)
    // and structure it into clean, retrievable Vault knowledge. Lets you drop a
    // link instead of pasting the whole transcript. Falls through to the paste
    // path with a clear message when the video has no captions at all.
    if (!content && url?.trim() && extractVideoId(url.trim())) {
      const transcript = await fetchYouTubeTranscript(url.trim())
      if (!transcript.ok) {
        return NextResponse.json(
          {
            success: false,
            error: `${transcript.error ?? 'Could not read this video.'} Paste the transcript or notes into "content" instead.`,
          },
          { status: 422 },
        )
      }
      content = await structureTranscriptForVault(transcript.content, title)
    }

    if (!title || !content) {
      return NextResponse.json(
        { success: false, error: 'title and content (or a YouTube url) are required' },
        { status: 400 },
      )
    }
    if (!VALID_SYSTEMS.includes(system)) {
      return NextResponse.json(
        { success: false, error: `system must be one of: ${VALID_SYSTEMS.join(', ')}` },
        { status: 400 },
      )
    }

    const result = await ingestKnowledge({
      system,
      title,
      content,
      category: body.category ?? null,
      builderId: body.builderId ?? null,
      metadata: { ...(body.metadata ?? {}), ...(url?.trim() ? { sourceUrl: url.trim() } : {}) },
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('Vault ingest error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Ingest failed' },
      { status: 500 },
    )
  }
}
