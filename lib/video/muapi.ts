import type { JobStatus, VideoInput } from './types'

/**
 * Muapi video provider — the same unified gateway that backs the still models,
 * reused for clips. One key (MUAPIAPP_API_KEY) unlocks Veo, Kling, Seedance,
 * Wan and friends, so this sits alongside fal and Higgsfield in the oven.
 *
 *   Submit : POST https://api.muapi.ai/api/v1/<model-endpoint>
 *            body { prompt, aspect_ratio, image_url?, duration? } → { request_id }
 *   Poll   : GET  https://api.muapi.ai/api/v1/predictions/<request_id>/result
 *            → { status, outputs: [url, …] }
 *   Auth   : x-api-key: <MUAPIAPP_API_KEY>
 *
 * SANDBOX: a Muapi Sandbox key returns mock data instantly and spends no
 * credits, so testing this end to end is an env change, not a code change.
 *
 * Endpoint slugs are env-overridable (MUAPI_VIDEO_*) because vendor model paths
 * drift. Per project rules this NEVER throws — it returns null / 'unknown' so
 * the agent and copy stay usable.
 */

const API_BASE = process.env.MUAPI_API_BASE || 'https://api.muapi.ai/api/v1'

function muapiKey(): string | undefined {
  return process.env.MUAPIAPP_API_KEY || process.env.MUAPI_API_KEY
}

export function muapiVideoConfigured(): boolean {
  return Boolean(muapiKey())
}

function authHeaders(): Record<string, string> {
  return { 'x-api-key': muapiKey() ?? '', 'Content-Type': 'application/json' }
}

/** Map Muapi's prediction states onto our normalised lifecycle. */
function mapStatus(raw?: string): JobStatus {
  const s = (raw ?? '').toLowerCase()
  if (['queued', 'pending', 'starting', 'in_queue'].includes(s)) return 'queued'
  if (['processing', 'in_progress', 'running', 'generating'].includes(s)) return 'in_progress'
  if (['completed', 'succeeded', 'success', 'complete', 'finished'].includes(s)) return 'completed'
  if (['failed', 'error', 'fail', 'canceled', 'cancelled'].includes(s)) return 'failed'
  return 'unknown'
}

/**
 * Pull the first video URL out of a prediction payload. Muapi returns
 * `outputs: [url, …]`; accept the common sibling shapes too so a response-shape
 * difference degrades to a working render rather than a silent miss.
 */
function firstResultUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const pick = (v: unknown): string | null => {
    if (typeof v === 'string' && v.startsWith('http')) return v
    if (v && typeof v === 'object') {
      const u = (v as { url?: unknown }).url
      if (typeof u === 'string' && u.startsWith('http')) return u
    }
    return null
  }
  for (const key of ['outputs', 'output', 'videos', 'video', 'video_url', 'url', 'result']) {
    const val = d[key]
    if (Array.isArray(val)) {
      for (const item of val) {
        const u = pick(item)
        if (u) return u
      }
    } else {
      const u = pick(val)
      if (u) return u
    }
  }
  return null
}

/** Build the per-model payload from our normalised VideoInput. */
function buildInput(input: VideoInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    prompt: input.prompt ?? '',
    aspect_ratio: input.aspectRatio ?? '9:16',
  }
  if (input.durationSec) payload.duration = String(input.durationSec)
  if (input.mode === 'image-to-video' && input.imageUrl) payload.image_url = input.imageUrl
  if (input.mode === 'reference-to-video' && input.imageUrls?.length) {
    payload.image_urls = input.imageUrls.slice(0, 9)
  }
  return payload
}

export interface MuapiSubmitResult {
  requestId: string
  status: JobStatus
}

/** Submit a render to a Muapi model endpoint. Returns a request id to poll. */
export async function muapiSubmit(
  endpoint: string,
  input: VideoInput,
): Promise<MuapiSubmitResult | null> {
  if (!muapiVideoConfigured()) return null
  try {
    const res = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(buildInput(input)),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('muapi submit failed:', res.status, (await res.text()).slice(0, 400))
      return null
    }
    const data = (await res.json()) as { request_id?: string; id?: string; status?: string }
    const requestId = data.request_id ?? data.id
    if (!requestId) return null
    return { requestId, status: mapStatus(data.status) === 'unknown' ? 'queued' : mapStatus(data.status) }
  } catch (err) {
    console.error('muapi submit error:', err)
    return null
  }
}

export interface MuapiStatusResult {
  status: JobStatus
  videoUrl: string | null
}

/** Poll a Muapi render by request id. */
export async function muapiStatus(requestId: string): Promise<MuapiStatusResult> {
  if (!muapiVideoConfigured() || !requestId) return { status: 'unknown', videoUrl: null }
  try {
    const res = await fetch(
      `${API_BASE}/predictions/${encodeURIComponent(requestId)}/result`,
      { headers: authHeaders(), cache: 'no-store' },
    )
    if (!res.ok) return { status: 'unknown', videoUrl: null }
    const data = (await res.json()) as Record<string, unknown>
    const status = mapStatus(String(data.status ?? data.state ?? ''))
    const url = firstResultUrl(data)
    // Some gateways drop the status field once the payload carries the result.
    if (status === 'completed' || (status === 'unknown' && url)) {
      return { status: 'completed', videoUrl: url }
    }
    return { status, videoUrl: null }
  } catch (err) {
    console.error('muapi status error:', err)
    return { status: 'unknown', videoUrl: null }
  }
}
