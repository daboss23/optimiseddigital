import {
  startVideo as higgsfieldStartVideo,
  getVideoStatus as higgsfieldStatus,
  higgsfieldConfigured,
} from '@/lib/higgsfield'
import { falConfigured, falSubmit, falStatus } from './fal'
import { muapiVideoConfigured, muapiSubmit, muapiStatus } from './muapi'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS, getVideoModel } from './registry'
import type { JobStatus, ModelAvailability, VideoInput, VideoJob } from './types'

/** Higgsfield exposes an extra 'nsfw' state; fold it into our lifecycle. */
function normalizeHiggsfieldStatus(status: string): JobStatus {
  if (status === 'nsfw') return 'failed'
  if (['queued', 'in_progress', 'completed', 'failed'].includes(status)) return status as JobStatus
  return 'unknown'
}

export * from './types'
export { VIDEO_MODELS, DEFAULT_VIDEO_MODEL, getVideoModel } from './registry'

/**
 * Unified video "oven" — dispatches a render to whichever provider backs the
 * requested model, and normalises start/poll into one VideoJob shape. Callers
 * (the agent, API routes, UI) never branch on provider.
 *
 * Never throws on missing keys or failures — returns null / 'unknown' so copy
 * stays usable, per project rules.
 */

/** True if ANY video provider is configured. */
export function videoConfigured(): boolean {
  return higgsfieldConfigured() || falConfigured() || muapiVideoConfigured()
}

function providerConfigured(provider: string): boolean {
  if (provider === 'higgsfield') return higgsfieldConfigured()
  if (provider === 'fal') return falConfigured()
  if (provider === 'muapi') return muapiVideoConfigured()
  return false
}

/** The model menu annotated with whether each model's keys are present. */
export function listVideoModels(): ModelAvailability[] {
  return VIDEO_MODELS.map((m) => ({ ...m, configured: providerConfigured(m.provider) }))
}

/** Pick a usable model: the requested one if configured, else the first configured. */
function resolveModelId(requested?: string): string | null {
  const tryIds = [requested, DEFAULT_VIDEO_MODEL].filter(Boolean) as string[]
  for (const id of tryIds) {
    const m = getVideoModel(id)
    if (m && providerConfigured(m.provider)) return id
  }
  const firstConfigured = VIDEO_MODELS.find((m) => providerConfigured(m.provider))
  return firstConfigured?.id ?? null
}

/** Start a render. Returns a VideoJob with a request id to poll, or null. */
export async function startVideoJob(
  modelId: string | undefined,
  input: VideoInput,
): Promise<VideoJob | null> {
  const id = resolveModelId(modelId)
  if (!id) return null
  const model = getVideoModel(id)
  if (!model) return null

  // Fall back to image-to-video if the model can't do the requested mode.
  const mode = model.modes.includes(input.mode) ? input.mode : model.modes[0]
  const endpoint = model.endpoints[mode]
  if (!endpoint) return null

  if (model.provider === 'higgsfield') {
    if (!input.imageUrl) return null
    const started = await higgsfieldStartVideo(input.prompt ?? '', input.imageUrl)
    if (!started) return null
    return {
      provider: 'higgsfield',
      modelId: id,
      requestId: started.requestId,
      status: normalizeHiggsfieldStatus(started.status),
      videoUrl: null,
    }
  }

  if (model.provider === 'muapi') {
    const started = await muapiSubmit(endpoint, { ...input, mode })
    if (!started) return null
    return {
      provider: 'muapi',
      modelId: id,
      requestId: started.requestId,
      status: started.status,
      videoUrl: null,
    }
  }

  // fal-backed models
  const started = await falSubmit(endpoint, { ...input, mode })
  if (!started) return null
  return {
    provider: 'fal',
    modelId: id,
    requestId: started.requestId,
    status: started.status,
    videoUrl: null,
    responseUrl: started.responseUrl,
  }
}

/** Poll a previously started render by model + request id. Pass the responseUrl
 * returned at start time so fal status resolution is exact (no path guessing). */
export async function getVideoJob(
  modelId: string,
  requestId: string,
  responseUrl?: string | null,
): Promise<VideoJob> {
  const model = getVideoModel(modelId)
  const base: VideoJob = {
    provider: model?.provider ?? 'fal',
    modelId,
    requestId,
    status: 'unknown',
    videoUrl: null,
  }
  if (!model) return base

  if (model.provider === 'higgsfield') {
    const state = await higgsfieldStatus(requestId)
    return { ...base, status: normalizeHiggsfieldStatus(state.status), videoUrl: state.videoUrl }
  }

  if (model.provider === 'muapi') {
    const state = await muapiStatus(requestId)
    return { ...base, status: state.status, videoUrl: state.videoUrl }
  }

  // fal: prefer the authoritative responseUrl; fall back to the endpoint base.
  const endpoint = Object.values(model.endpoints)[0]
  if (!endpoint) return base
  const state = await falStatus(endpoint, requestId, responseUrl)
  return { ...base, status: state.status, videoUrl: state.videoUrl }
}
