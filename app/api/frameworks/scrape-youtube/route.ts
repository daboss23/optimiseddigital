import { NextRequest, NextResponse } from 'next/server'
import { fetchYouTubeTranscript, structureTranscriptForVault } from '@/lib/youtube'

export const runtime = 'nodejs'
export const maxDuration = 60

// Transcribe a YouTube video for the Knowledge Vault. The transcript-fetching
// logic lives in lib/youtube.ts so NOVA's market research can reuse it. The raw
// captions are then structured into clean, readable knowledge (core ideas,
// frameworks, claims) rather than a run-on caption wall — the reading of the
// content, not the caption dump. Structuring degrades to the raw transcript
// when the model/keys are absent, so the Vault always works end to end.
export async function POST(request: NextRequest) {
  try {
    const { url, title } = (await request.json()) as { url?: string; title?: string }
    if (!url?.trim()) {
      return NextResponse.json({ success: false, error: 'YouTube URL is required' }, { status: 400 })
    }

    const result = await fetchYouTubeTranscript(url.trim())
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    const content = await structureTranscriptForVault(result.content, title)

    return NextResponse.json({ success: true, content })
  } catch (error) {
    console.error('YouTube transcript error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch transcript. The video may be private, age-restricted, or region-locked.',
      },
      { status: 500 },
    )
  }
}
