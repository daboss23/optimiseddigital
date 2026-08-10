import { createHiggsfieldClient } from '@higgsfield/client/v2'

/**
 * Higgsfield creative generation — image (inline) and video (fire-and-poll).
 *
 * Runs the official `@higgsfield/client` SDK (v2) on the server. Authenticates
 * with HF_CREDENTIALS ("KEY_ID:KEY_SECRET", from cloud.higgsfield.ai/api-keys).
 *
 * Per the project rules, this NEVER throws on missing keys or failed renders —
 * it returns null / 'unknown' so the agent and the copy stay usable. Generate
 * the API key once in the browser; the server uses it forever (no login flow).
 */

const BASE_URL = process.env.HIGGSFIELD_BASE_URL || 'https://platform.higgsfield.ai'
const IMAGE_ENDPOINT = process.env.HIGGSFIELD_IMAGE_ENDPOINT || '/v1/text2image/soul'
const VIDEO_ENDPOINT = process.env.HIGGSFIELD_VIDEO_ENDPOINT || '/v1/image2video/dop'
const VIDEO_MODEL = process.env.HIGGSFIELD_VIDEO_MODEL || 'dop-turbo'

// Mirrors lib/image/types — 4:5 is Meta's tall feed still (video renders never
// request it, so nothing downstream of startVideo sees it).
export type AspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4' | '4:5'
export type VideoStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'unknown'

const ASPECT_DIMENSIONS: Record<AspectRatio, string> = {
  '1:1': process.env.HIGGSFIELD_IMAGE_SIZE || '1080x1080',
  '9:16': '1080x1920',
  '16:9': '1920x1080',
  '4:3': '1440x1080',
  '3:4': '1080x1440',
  '4:5': '1080x1350',
}

/** Resolve credentials from any of the supported env shapes. */
function credentials(): string | undefined {
  if (process.env.HF_CREDENTIALS) return process.env.HF_CREDENTIALS
  if (process.env.HF_KEY) return process.env.HF_KEY
  if (process.env.HF_API_KEY && process.env.HF_API_SECRET) {
    return `${process.env.HF_API_KEY}:${process.env.HF_API_SECRET}`
  }
  return undefined
}

export function higgsfieldConfigured(): boolean {
  return Boolean(credentials())
}

function client() {
  return createHiggsfieldClient({ credentials: credentials() })
}

/**
 * Generate a still creative. Blocks until the render completes (seconds), so it
 * returns the image URL inline. Returns null when unconfigured or on failure.
 */
export async function generateImage(
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<string | null> {
  if (!higgsfieldConfigured() || !prompt) return null
  try {
    const res = await client().subscribe(IMAGE_ENDPOINT, {
      input: {
        prompt,
        width_and_height: ASPECT_DIMENSIONS[aspectRatio] ?? ASPECT_DIMENSIONS['1:1'],
        quality: '1080p',
        batch_size: 1,
        enhance_prompt: true,
      },
      withPolling: true,
    })
    if (res.status === 'completed' && res.images?.[0]?.url) return res.images[0].url
    return null
  } catch (err) {
    console.error('Higgsfield image error:', err)
    return null
  }
}

export interface StartedVideo {
  requestId: string
  status: VideoStatus
}

/**
 * Kick off an image-to-video render and return immediately with a request id to
 * poll. Video renders take minutes — longer than a serverless function may run —
 * so the caller polls `getVideoStatus` instead of blocking here.
 */
export async function startVideo(prompt: string, imageUrl: string): Promise<StartedVideo | null> {
  if (!higgsfieldConfigured() || !imageUrl) return null
  try {
    const res = await client().subscribe(VIDEO_ENDPOINT, {
      input: {
        model: VIDEO_MODEL,
        prompt: prompt || 'Subtle cinematic motion, gentle parallax, premium ad feel.',
        input_images: [{ type: 'image_url', image_url: imageUrl }],
        enhance_prompt: true,
      },
      withPolling: false,
    })
    return { requestId: res.request_id, status: (res.status as VideoStatus) ?? 'queued' }
  } catch (err) {
    console.error('Higgsfield video start error:', err)
    return null
  }
}

export interface VideoState {
  status: VideoStatus
  videoUrl: string | null
}

/** Poll a video render by request id. Reuses the SDK's auth + status endpoint. */
export async function getVideoStatus(requestId: string): Promise<VideoState> {
  if (!higgsfieldConfigured() || !requestId) return { status: 'unknown', videoUrl: null }
  try {
    const res = await fetch(`${BASE_URL}/requests/${encodeURIComponent(requestId)}/status`, {
      headers: { Authorization: `Key ${credentials()}` },
      cache: 'no-store',
    })
    if (!res.ok) return { status: 'unknown', videoUrl: null }
    const data = (await res.json()) as { status?: string; video?: { url?: string } }
    return {
      status: (data.status as VideoStatus) ?? 'unknown',
      videoUrl: data.video?.url ?? null,
    }
  } catch (err) {
    console.error('Higgsfield video status error:', err)
    return { status: 'unknown', videoUrl: null }
  }
}
