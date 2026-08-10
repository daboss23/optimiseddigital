// Shared YouTube transcript fetcher. Pulls captions via YouTube's internal
// "innertube" player API (posing as the Android client, which still returns
// caption metadata reliably), with a watch-page scrape fallback when that call
// is throttled. Used by the Knowledge Vault YouTube ingest (ATLAS) and by
// NOVA's market-intelligence research. Never throws — returns a result union.

export interface TranscriptResult {
  ok: boolean
  content: string
  videoId?: string
  error?: string
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  // Bare 11-char id
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url
  return null
}

interface CaptionTrack {
  baseUrl: string
  languageCode?: string
  kind?: string
}

// Ask YouTube's internal "innertube" player API for the video's caption tracks.
// We pose as the Android client, which still returns caption metadata reliably
// without the page-scraping the youtube-transcript package depends on.
async function fetchCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  // Long-lived public innertube key used by the YouTube web client.
  const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 13) gzip',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              androidSdkVersion: 33,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    )
    if (!res.ok) return []
    const data = await res.json()
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  } catch {
    return []
  }
}

// Fallback: scrape the watch page and pull caption tracks out of the embedded
// ytInitialPlayerResponse JSON. Useful when the innertube call is throttled.
async function fetchCaptionTracksFromWatchPage(videoId: string): Promise<CaptionTrack[]> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const html = await res.text()
    const match = html.match(/"captionTracks":(\[.*?\])/)
    if (!match) return []
    return JSON.parse(match[1]) as CaptionTrack[]
  } catch {
    return []
  }
}

// Prefer a manually-authored English track, then any English, then any track at
// all — auto-generated captions are better than nothing.
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null
  const english = tracks.filter((t) => t.languageCode?.startsWith('en'))
  const manualEnglish = english.find((t) => t.kind !== 'asr')
  return manualEnglish ?? english[0] ?? tracks[0]
}

// Fetch a caption track as json3 and flatten it into plain transcript text.
async function fetchTranscriptText(track: CaptionTrack): Promise<string> {
  try {
    const sep = track.baseUrl.includes('?') ? '&' : '?'
    const res = await fetch(`${track.baseUrl}${sep}fmt=json3`, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return ''
    const data = await res.json()
    const events: { segs?: { utf8?: string }[] }[] = data?.events ?? []
    return events
      .flatMap((e) => (e.segs ?? []).map((s) => s.utf8 ?? ''))
      .join('')
      .replace(/\n/g, ' ')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  } catch {
    return ''
  }
}

/**
 * Fetch a video's transcript from its URL or bare id. Returns the full
 * transcript text — callers truncate to their own budget. Best-effort: any
 * failure resolves to `{ ok: false, error }` rather than throwing.
 */
export async function fetchYouTubeTranscript(url: string): Promise<TranscriptResult> {
  const videoId = extractVideoId(url.trim())
  if (!videoId) {
    return { ok: false, content: '', error: 'Could not find a video ID in that URL' }
  }

  let tracks = await fetchCaptionTracks(videoId)
  if (tracks.length === 0) {
    tracks = await fetchCaptionTracksFromWatchPage(videoId)
  }
  const track = pickTrack(tracks)
  if (!track) {
    return {
      ok: false,
      content: '',
      videoId,
      error: 'No transcript found. This video has no captions (or they are disabled).',
    }
  }

  const raw = await fetchTranscriptText(track)
  if (!raw || raw.length < 5) {
    return { ok: false, content: '', videoId, error: 'The transcript came back empty for this video.' }
  }

  return { ok: true, content: raw, videoId }
}

// Turn a raw caption dump into clean, readable Knowledge Vault content — the
// core ideas, frameworks, and claims, not a wall of run-on caption text. Used
// by the Vault YouTube ingest so a pasted URL lands as usable knowledge.
// Never throws — returns the raw transcript when the model/keys are absent so
// the platform always works end to end.
export async function structureTranscriptForVault(
  transcript: string,
  title?: string,
): Promise<string> {
  const raw = transcript.trim()
  if (!process.env.ANTHROPIC_API_KEY || raw.length < 200) return raw

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const { INTELLIGENCE_MODEL } = await import('@/lib/models')
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: 2000,
      system:
        'You structure a raw YouTube caption transcript into clean, retrievable knowledge for a marketing/coaching knowledge base (The Professional Builder — coaching for trades/construction business owners). ' +
        'Read the transcript as what was said, then read across it for structure: how it opens, how it holds attention, where it turns, how it closes. ' +
        'Output well-organized Markdown: a one-line summary, then the core ideas / frameworks / steps as tight bullet points, then any notable claims, numbers, or hooks worth reusing. ' +
        'Report only what the transcript actually states — never invent detail. Mark anything you infer as an inference. Do not add preamble; output only the structured notes.',
      messages: [
        {
          role: 'user',
          content: `${title ? `Video title: ${title}\n\n` : ''}Transcript:\n"""${raw.slice(0, 24000)}"""`,
        },
      ],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    const out = textBlock && 'text' in textBlock ? textBlock.text.trim() : ''
    return out.length > 40 ? out : raw
  } catch (err) {
    console.error('Transcript structuring failed, using raw transcript:', err)
    return raw
  }
}
