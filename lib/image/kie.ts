import type { AspectRatio } from './types'

/**
 * Kie.ai still-image provider — the third image gateway alongside fal and
 * Higgsfield. One KIE_API_KEY unlocks Kie's whole model market (Nano Banana,
 * Seedream, Flux, Qwen, GPT Image, …), so we expose the top flagship image
 * models through it and let the oven pick.
 *
 * Kie's "market" API is asynchronous: POST a task to create it, then poll the
 * job until it succeeds. Stills finish in seconds, well inside one serverless
 * function, so we poll to completion and return the URL inline (like fal's
 * synchronous path) rather than handing a job back to the client.
 *
 *   Create : POST https://api.kie.ai/api/v1/jobs/createTask
 *            body { model, input: { prompt, image_size, output_format } }
 *   Poll   : GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=…
 *            data.state ∈ waiting|queuing|generating|success|fail
 *            data.resultJson → { resultUrls: [url, …] }  (JSON string)
 *   Auth   : Authorization: Bearer <KIE_API_KEY>
 *
 * Per project rules this NEVER throws on a missing key or a failed render — it
 * returns null so the copy stays usable. Every model slug is env-overridable
 * (KIE_MODEL_*) because vendor model paths drift; correcting a slug is a Vercel
 * variable change, not a code change.
 */

const API_BASE = process.env.KIE_API_BASE || 'https://api.kie.ai/api/v1'
const CREATE_URL = `${API_BASE}/jobs/createTask`
const RECORD_URL = `${API_BASE}/jobs/recordInfo`

/** Map our internal Kie model ids → Kie market slugs (env-overridable). */
const KIE_MODEL_SLUGS: Record<string, string> = {
  'kie-nano-banana-pro': process.env.KIE_MODEL_NANO_BANANA_PRO || 'google/nano-banana-pro',
  'kie-nano-banana': process.env.KIE_MODEL_NANO_BANANA || 'google/nano-banana',
  'kie-seedream-v4': process.env.KIE_MODEL_SEEDREAM || 'bytedance/seedream-v4-text-to-image',
  'kie-flux-kontext-max': process.env.KIE_MODEL_FLUX_KONTEXT || 'black-forest-labs/flux-kontext-max',
  'kie-gpt-image': process.env.KIE_MODEL_GPT_IMAGE || 'gpt-image-2-text-to-image',
}

function kieKey(): string | undefined {
  return process.env.KIE_API_KEY || process.env.KIE_KEY
}

export function kieImageConfigured(): boolean {
  return Boolean(kieKey())
}

/** The Kie market slug for one of our internal model ids, if it is a Kie model. */
export function kieSlugFor(modelId: string): string | undefined {
  return KIE_MODEL_SLUGS[modelId]
}

export interface KieImageResult {
  url: string | null
  error?: string
}

const POLL_INTERVAL_MS = 1500
/**
 * How long to poll Kie before giving up. This MUST stay under the host's
 * function ceiling (Vercel Hobby kills a function at 60s, `maxDuration = 60` on
 * the image route). The previous 90s default sat ABOVE that ceiling, so the
 * function was killed mid-poll before the timeout could ever fire: a hard crash
 * instead of a clean error — and because Kie charges a credit at createTask,
 * the credit was spent while the URL was never retrieved.
 *
 * 50s leaves the function ~10s to return the timeout error cleanly. Pro
 * deployments (300s ceiling) can raise it with KIE_POLL_TIMEOUT_MS to give
 * Kie's slower flagship models more room.
 */
const POLL_TIMEOUT_MS = Number(process.env.KIE_POLL_TIMEOUT_MS) || 50_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Pull the first image URL out of a recordInfo payload's resultJson string. */
function firstResultUrl(resultJson: unknown): string | null {
  if (typeof resultJson !== 'string' || !resultJson) return null
  try {
    const parsed = JSON.parse(resultJson) as { resultUrls?: unknown }
    const urls = parsed?.resultUrls
    if (Array.isArray(urls) && typeof urls[0] === 'string') return urls[0]
  } catch {
    return null
  }
  return null
}

/** Result of starting a Kie task: the taskId to poll, or a reason it failed. */
export interface KieStartResult {
  taskId: string | null
  error?: string
}

/**
 * Create a Kie render task and return its taskId WITHOUT polling. This is the
 * async path: because Kie persists the finished image against the taskId, the
 * client can poll `pollKieImage` across many short requests and never needs a
 * single function to outlive the render — so a slow model can no longer be
 * killed at the host ceiling with the image (and the charged credit) lost.
 */
export async function startKieImage(
  modelId: string,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<KieStartResult> {
  const key = kieKey()
  if (!key) return { taskId: null, error: 'KIE_API_KEY is not set' }
  if (!prompt) return { taskId: null, error: 'Empty prompt' }
  const slug = KIE_MODEL_SLUGS[modelId]
  if (!slug) return { taskId: null, error: `Unknown Kie model "${modelId}"` }

  try {
    const createRes = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: slug,
        input: { prompt, image_size: aspectRatio, output_format: 'png', num_images: 1 },
      }),
      cache: 'no-store',
    })
    const createBody = (await createRes.json().catch(() => null)) as
      | { code?: number; msg?: string; data?: { taskId?: string } }
      | null
    if (!createRes.ok) {
      return { taskId: null, error: `Kie createTask ${createRes.status}: ${createBody?.msg ?? 'error'}` }
    }
    const taskId = createBody?.data?.taskId
    if (!taskId) {
      return { taskId: null, error: `Kie createTask returned no taskId (${createBody?.msg ?? 'unknown'})` }
    }
    return { taskId }
  } catch (err) {
    return { taskId: null, error: `Kie request error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** One render state for a Kie task. `pending` means keep polling. */
export interface KiePollResult {
  status: 'pending' | 'completed' | 'failed'
  url?: string
  error?: string
}

/** Poll a Kie task ONCE. Cheap and fast — safe to call repeatedly from a client. */
export async function pollKieImage(taskId: string): Promise<KiePollResult> {
  const key = kieKey()
  if (!key) return { status: 'failed', error: 'KIE_API_KEY is not set' }
  if (!taskId) return { status: 'failed', error: 'taskId is required' }
  try {
    const pollRes = await fetch(`${RECORD_URL}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    const pollBody = (await pollRes.json().catch(() => null)) as
      | { data?: { state?: string; resultJson?: string; failMsg?: string } }
      | null
    const data = pollBody?.data
    const state = data?.state
    if (state === 'success') {
      const url = firstResultUrl(data?.resultJson)
      return url
        ? { status: 'completed', url }
        : { status: 'failed', error: 'Kie succeeded but returned no image URL' }
    }
    if (state === 'fail') return { status: 'failed', error: `Kie job failed: ${data?.failMsg ?? 'unknown'}` }
    return { status: 'pending' }
  } catch {
    // Transient — the caller keeps polling.
    return { status: 'pending' }
  }
}

export async function generateKieImage(
  modelId: string,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<KieImageResult> {
  // 1 — create the task (charges a credit at Kie).
  const start = await startKieImage(modelId, prompt, aspectRatio)
  if (!start.taskId) return { url: null, error: start.error }

  // 2 — poll until success/fail or the (sub-ceiling) timeout.
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const res = await pollKieImage(start.taskId)
    if (res.status === 'completed') return { url: res.url ?? null }
    if (res.status === 'failed') return { url: null, error: res.error }
    // pending → keep polling.
  }
  return {
    url: null,
    error:
      'Kie render exceeded the time limit. Kie charges a credit when the job starts, so the image likely finished on Kie’s side — check your Kie dashboard. For reliable inline rendering under a 60s host limit, use a faster model (fal-flux).',
  }
}
