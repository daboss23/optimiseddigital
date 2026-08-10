import type { AspectRatio } from './types'

/**
 * Muapi still-image provider — a unified gateway to many frontier image models
 * behind ONE key (MUAPIAPP_API_KEY), alongside fal, Kie and Higgsfield.
 *
 * Muapi's API is asynchronous in the same shape as Kie's: POST a generation to
 * the model's endpoint to create a task, then poll the prediction until it
 * resolves. Stills finish quickly, so the synchronous wrapper polls to
 * completion and returns the URL inline; the start/poll pair is also exported
 * so the route can hand a slow render to the client instead of holding a
 * function open past the host ceiling.
 *
 *   Create : POST https://api.muapi.ai/api/v1/<model-endpoint>
 *            body { prompt, aspect_ratio, … }  → { request_id }
 *   Poll   : GET  https://api.muapi.ai/api/v1/predictions/<request_id>/result
 *            → { status, outputs: [url, …] }
 *   Auth   : x-api-key: <MUAPIAPP_API_KEY>
 *
 * SANDBOX: Muapi issues Sandbox keys that return mock data instantly and burn
 * no credits. Because the key is read from the environment, pointing this at a
 * sandbox key is purely a Vercel/env change — no code change.
 *
 * Every endpoint slug is env-overridable (MUAPI_MODEL_*). Vendor model paths
 * drift, and the docs host is not reachable from every build environment, so
 * correcting a slug must never require a code change.
 *
 * Per project rules this NEVER throws on a missing key or a failed render — it
 * returns null / an error string so the copy stays usable.
 */

const API_BASE = process.env.MUAPI_API_BASE || 'https://api.muapi.ai/api/v1'

/**
 * Map our internal muapi model ids → Muapi endpoint slugs (env-overridable).
 *
 * `flux-dev-image` is CONFIRMED working (it rendered). The rest follow Muapi's
 * `<alias>-image` convention but are unverified, because muapi.ai is not
 * reachable from every build environment — which is exactly why each one has
 * its own env override. If a model 404s, set its variable to the slug shown in
 * the Muapi dashboard and the fix ships without a code change. A wrong slug is
 * never fatal: the oven falls through to the next configured model.
 */
const MUAPI_MODEL_ENDPOINTS: Record<string, string> = {
  'muapi-nano-banana-pro':
    process.env.MUAPI_MODEL_NANO_BANANA_PRO || 'nano-banana-pro-image',
  'muapi-nano-banana-2': process.env.MUAPI_MODEL_NANO_BANANA_2 || 'nano-banana-2-image',
  'muapi-gpt-image-2': process.env.MUAPI_MODEL_GPT_IMAGE_2 || 'gpt-image-2-image',
  'muapi-midjourney': process.env.MUAPI_MODEL_MIDJOURNEY || 'midjourney-image',
  'muapi-seedream': process.env.MUAPI_MODEL_SEEDREAM || 'seedream-image',
  'muapi-flux-kontext-max':
    process.env.MUAPI_MODEL_FLUX_KONTEXT_MAX || 'flux-kontext-max-image',
  'muapi-flux-dev': process.env.MUAPI_MODEL_FLUX_DEV || 'flux-dev-image',
}

function muapiKey(): string | undefined {
  return process.env.MUAPIAPP_API_KEY || process.env.MUAPI_API_KEY
}

export function muapiImageConfigured(): boolean {
  return Boolean(muapiKey())
}

function authHeaders(): Record<string, string> {
  return { 'x-api-key': muapiKey() ?? '', 'Content-Type': 'application/json' }
}

/** The Muapi endpoint slug for one of our internal model ids, if it is a Muapi model. */
export function muapiEndpointFor(modelId: string): string | undefined {
  return MUAPI_MODEL_ENDPOINTS[modelId]
}

export interface MuapiImageResult {
  url: string | null
  error?: string
}

const POLL_INTERVAL_MS = 1500
/**
 * Must stay under the host's function ceiling (Vercel Hobby kills a function at
 * 60s; the image route declares maxDuration = 60). 50s leaves room to return a
 * clean timeout error rather than being killed mid-poll.
 */
const POLL_TIMEOUT_MS = Number(process.env.MUAPI_POLL_TIMEOUT_MS) || 50_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Pull the first image URL out of a prediction payload. Muapi returns
 * `outputs: [url, …]`, but sibling gateways use `output`/`image_url`/objects
 * with a `url` field — accept them all so a response-shape difference degrades
 * to a working render instead of a silent "no URL".
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
  for (const key of ['outputs', 'output', 'images', 'image', 'image_url', 'url', 'result']) {
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

/** Normalised prediction state. `pending` means keep polling. */
export interface MuapiPollResult {
  status: 'pending' | 'completed' | 'failed'
  url?: string
  error?: string
}

/** Result of starting a Muapi generation: the request_id to poll, or a reason. */
export interface MuapiStartResult {
  requestId: string | null
  error?: string
}

/**
 * Create a Muapi generation and return its request_id WITHOUT polling.
 * Muapi persists the finished render against the request_id, so the client can
 * poll across many short requests and no single function has to outlive it.
 */
export async function startMuapiImage(
  modelId: string,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<MuapiStartResult> {
  const key = muapiKey()
  if (!key) return { requestId: null, error: 'MUAPIAPP_API_KEY is not set' }
  if (!prompt) return { requestId: null, error: 'Empty prompt' }
  const endpoint = MUAPI_MODEL_ENDPOINTS[modelId]
  if (!endpoint) return { requestId: null, error: `Unknown Muapi model "${modelId}"` }

  try {
    const res = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt, aspect_ratio: aspectRatio, num_images: 1 }),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => null)) as
      | { request_id?: string; id?: string; error?: string; message?: string }
      | null
    const requestId = res.ok ? (body?.request_id ?? body?.id) : undefined
    if (requestId) return { requestId }
    return {
      requestId: null,
      error: res.ok
        ? `Muapi returned no request_id (${body?.message ?? body?.error ?? 'unknown'})`
        : `Muapi ${endpoint} → HTTP ${res.status}: ${body?.message ?? body?.error ?? res.statusText}`,
    }
  } catch (err) {
    return {
      requestId: null,
      error: `Muapi request error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Poll a Muapi prediction ONCE. Cheap — safe to call repeatedly from a client. */
export async function pollMuapiImage(requestId: string): Promise<MuapiPollResult> {
  const key = muapiKey()
  if (!key) return { status: 'failed', error: 'MUAPIAPP_API_KEY is not set' }
  if (!requestId) return { status: 'failed', error: 'request_id is required' }
  try {
    const res = await fetch(
      `${API_BASE}/predictions/${encodeURIComponent(requestId)}/result`,
      { headers: authHeaders(), cache: 'no-store' },
    )
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return { status: 'pending' }

    const status = String(body.status ?? body.state ?? '').toLowerCase()
    if (['completed', 'succeeded', 'success', 'complete', 'finished'].includes(status)) {
      const url = firstResultUrl(body)
      return url
        ? { status: 'completed', url }
        : { status: 'failed', error: 'Muapi succeeded but returned no image URL' }
    }
    if (['failed', 'error', 'fail', 'canceled', 'cancelled'].includes(status)) {
      const msg = body.error ?? body.message ?? 'unknown'
      return { status: 'failed', error: `Muapi job failed: ${String(msg)}` }
    }
    // Some gateways omit status once done and just return the payload.
    const url = firstResultUrl(body)
    if (url) return { status: 'completed', url }
    return { status: 'pending' }
  } catch {
    // Transient — the caller keeps polling.
    return { status: 'pending' }
  }
}

/** Start + poll to completion, returning the URL inline. */
export async function generateMuapiImage(
  modelId: string,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<MuapiImageResult> {
  const start = await startMuapiImage(modelId, prompt, aspectRatio)
  if (!start.requestId) return { url: null, error: start.error }

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const res = await pollMuapiImage(start.requestId)
    if (res.status === 'completed') return { url: res.url ?? null }
    if (res.status === 'failed') return { url: null, error: res.error }
  }
  return {
    url: null,
    error:
      'Muapi render exceeded the time limit. The job likely finished on Muapi’s side — check your Muapi dashboard, or raise MUAPI_POLL_TIMEOUT_MS on a host with a higher function ceiling.',
  }
}
