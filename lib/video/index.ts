import {
  startVideo as higgsfieldStartVideo,
  getVideoStatus as higgsfieldStatus,
  higgsfieldConfigured,
} from '@/lib/higgsfield'
import { falConfigured, falSubmit, falStatus } from './fal'
import { muapiVideoConfigured, muapiSubmit, muapiStatus } from './muapi'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS, getVideoModel, modelFamily } from './registry'
import type { JobStatus, ModelAvailability, VideoInput, VideoJob, VideoModel } from './types'

/** Higgsfield exposes an extra 'nsfw' state; fold it into our lifecycle. */
function normalizeHiggsfieldStatus(status: string): JobStatus {
  if (status === 'nsfw') return 'failed'
  if (['queued', 'in_progress', 'completed', 'failed'].includes(status)) return status as JobStatus
  return 'unknown'
}

export * from './types'
export { VIDEO_MODELS, DEFAULT_VIDEO_MODEL, getVideoModel, modelFamily } from './registry'

/**
 * Unified video "oven" — dispatches a render to whichever provider backs the
 * requested model, and normalises start/poll into one VideoJob shape. Callers
 * (the agent, API routes, UI) never branch on provider.
 *
 * Never throws on missing keys or failures — returns null / 'unknown' so copy
 * stays usable, per project rules.
 *
 * WHY THE FALLBACK CHAIN EXISTS: this layer used to try exactly ONE model. If
 * its endpoint slug had drifted (vendor renames are constant — the same class
 * of bug that shipped misspelled headlines through the image oven), the submit
 * 404'd, startVideoJob returned null, and the Reactor was told "video
 * generation unavailable" — so it substituted a STILL. A UGC ad ordered on
 * Veo 3 came back as a GPT Image 2 picture. Now a Veo request that can't reach
 * Muapi's Veo tries fal's Veo, then any other audio-capable model, and the
 * substitution is REPORTED (`fellBack` + `note`), never silent.
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

/**
 * Ordered list of models to actually ATTEMPT for this request, best first:
 *
 *   1. the requested model (or the default when none was named)
 *   2. the same model FAMILY on another provider — a Veo request stays Veo
 *   3. any other model that can do the job, audio-capable ones first when the
 *      requested model had audio (spoken UGC is worthless silent)
 *
 * Only configured providers that support the requested mode are included.
 */
function candidateModels(requested: string | undefined, mode: VideoInput['mode']): VideoModel[] {
  const usable = (m: VideoModel) =>
    providerConfigured(m.provider) && (m.modes.includes(mode) || m.modes.length > 0)

  const intended = getVideoModel(requested ?? '') ?? getVideoModel(DEFAULT_VIDEO_MODEL)
  const family = intended ? modelFamily(intended.id) : null
  const needsAudio = intended?.audio ?? false

  const rank = (m: VideoModel) => {
    if (intended && m.id === intended.id) return 0
    if (family && modelFamily(m.id) === family) return 1
    if (needsAudio && m.audio) return 2
    if (m.modes.includes(mode)) return 3
    return 4
  }

  return VIDEO_MODELS.filter(usable).sort((a, b) => rank(a) - rank(b))
}

/** Start a render on one specific model. Null when that model can't take it. */
async function submitTo(model: VideoModel, input: VideoInput): Promise<VideoJob | null> {
  // Fall back to image-to-video if the model can't do the requested mode.
  const mode = model.modes.includes(input.mode) ? input.mode : model.modes[0]
  const endpoint = model.endpoints[mode]
  if (!endpoint) return null
  // image-to-video without a still is not a render this model can do.
  if (mode !== 'text-to-video' && !input.imageUrl && !input.imageUrls?.length) return null

  if (model.provider === 'higgsfield') {
    if (!input.imageUrl) return null
    const started = await higgsfieldStartVideo(input.prompt ?? '', input.imageUrl)
    if (!started) return null
    return {
      provider: 'higgsfield',
      modelId: model.id,
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
      modelId: model.id,
      requestId: started.requestId,
      status: started.status,
      videoUrl: null,
    }
  }

  const started = await falSubmit(endpoint, { ...input, mode })
  if (!started) return null
  return {
    provider: 'fal',
    modelId: model.id,
    requestId: started.requestId,
    status: started.status,
    videoUrl: null,
    responseUrl: started.responseUrl,
  }
}

/**
 * Start a render. Walks the candidate chain until one provider accepts the job,
 * so a drifted endpoint slug costs a retry instead of the whole clip. Returns
 * null only when NO configured provider took it.
 */
export async function startVideoJob(
  modelId: string | undefined,
  input: VideoInput,
): Promise<VideoJob | null> {
  const intendedId = getVideoModel(modelId ?? '')?.id ?? modelId ?? DEFAULT_VIDEO_MODEL
  const candidates = candidateModels(modelId, input.mode)
  if (!candidates.length) return null

  const tried: string[] = []
  for (const model of candidates) {
    const job = await submitTo(model, input)
    if (job) {
      const fellBack = job.modelId !== intendedId
      const intendedLabel = getVideoModel(intendedId)?.label ?? intendedId
      return {
        ...job,
        requestedModelId: intendedId,
        fellBack,
        note: fellBack
          ? `Requested ${intendedLabel} was unavailable (${tried.join(', ')}) — rendered on ${model.label} instead.`
          : undefined,
      }
    }
    tried.push(`${model.label} did not accept the job`)
  }
  console.error('video oven: no provider accepted the job —', tried.join('; '))
  return null
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
