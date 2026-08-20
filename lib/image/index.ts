import { generateImage as higgsfieldImage, higgsfieldConfigured } from '@/lib/higgsfield'
import { generateFalImage, falImageConfigured } from './fal'
import {
  generateKieImage,
  kieImageConfigured,
  startKieImage,
  pollKieImage,
  type KiePollResult,
} from './kie'
import {
  generateMuapiImage,
  muapiImageConfigured,
  startMuapiImage,
  pollMuapiImage,
} from './muapi'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, getImageModel } from './registry'
import type { AspectRatio, ImageModelAvailability } from './types'

export * from './types'
export { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, getImageModel } from './registry'

/**
 * Unified image "oven" — dispatches a still render to whichever provider backs
 * the requested model (Muapi, fal / FLUX, Kie, Higgsfield). Callers never
 * branch on provider. Never throws on missing keys — returns null.
 */

export function providerConfigured(provider: string): boolean {
  if (provider === 'higgsfield') return higgsfieldConfigured()
  if (provider === 'fal') return falImageConfigured()
  if (provider === 'kie') return kieImageConfigured()
  if (provider === 'muapi') return muapiImageConfigured()
  return false
}

/** True if ANY image provider is configured. */
export function imageConfigured(): boolean {
  return (
    higgsfieldConfigured() || falImageConfigured() || kieImageConfigured() || muapiImageConfigured()
  )
}

/** The image model menu annotated with whether each model's key is present. */
export function listImageModels(): ImageModelAvailability[] {
  return IMAGE_MODELS.map((m) => ({ ...m, configured: providerConfigured(m.provider) }))
}

/* --------------------------- Text-aware routing ---------------------------- */

/**
 * A prompt "carries copy" when it asks the model to set literal words on the
 * image. `lib/render-prompt.ts` marks those prompts explicitly; the SPARK clone
 * writer phrases it its own way, so both spellings are detected.
 *
 * This matters because the fallback chain is otherwise ordered by quality, and
 * quality is not spelling: a headline creative that falls through to a
 * weak-text model renders a beautiful photo with a mangled headline, which
 * looks like a working render and is unusable.
 */
const CARRIES_COPY = /ON-IMAGE TEXT|rendered exactly|render(?:ed)? these strings exactly|on-ad text/i

export function promptCarriesCopy(prompt: string): boolean {
  return CARRIES_COPY.test(prompt)
}

const FIDELITY_RANK: Record<string, number> = { strong: 0, moderate: 1, weak: 2 }

/** Configured ids reordered so the models that can spell come first. */
function textCapableFirst(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const fa = FIDELITY_RANK[getImageModel(a)?.textFidelity ?? 'weak'] ?? 2
    const fb = FIDELITY_RANK[getImageModel(b)?.textFidelity ?? 'weak'] ?? 2
    return fa - fb
  })
}

/** Pick a usable model: the requested one if configured, else first configured. */
function resolveModelId(requested?: string, carriesCopy = false): string | null {
  const tryIds = [requested, DEFAULT_IMAGE_MODEL].filter(Boolean) as string[]
  for (const id of tryIds) {
    const m = getImageModel(id)
    if (m && providerConfigured(m.provider)) return id
  }
  const configured = IMAGE_MODELS.filter((m) => providerConfigured(m.provider)).map((m) => m.id)
  const ordered = carriesCopy ? textCapableFirst(configured) : configured
  return ordered[0] ?? null
}

/**
 * Ordered list of configured model ids to try: the resolved/requested model
 * first, then every other configured model as a fallback. This makes the oven
 * resilient — if the chosen provider is out of credit or rejects, it
 * automatically tries another configured provider before giving up.
 *
 * When the prompt carries copy the FALLBACKS are re-ordered by text fidelity,
 * so a run whose frontier model 404s lands on the next model that can actually
 * set a headline instead of falling all the way to the fast workhorse. (The
 * explicitly requested model still goes first — an explicit pick is a decision,
 * not a default.)
 */
function candidateModelIds(requested?: string, carriesCopy = false): string[] {
  const first = resolveModelId(requested, carriesCopy)
  const configured = IMAGE_MODELS.filter((m) => providerConfigured(m.provider)).map((m) => m.id)
  const rest = carriesCopy ? textCapableFirst(configured) : configured
  return Array.from(new Set([first, ...rest].filter(Boolean) as string[]))
}

/**
 * The closest ratio a given model can actually render.
 *
 * The brief only ever offers ratios the CHOSEN model supports — but when that
 * model fails and the oven falls through to another provider, the requested
 * ratio can be one the substitute doesn't declare (GPT Image has no 4:3/3:4).
 * Sending it anyway is a guaranteed provider rejection, so we snap to a
 * supported ratio of the same orientation instead of losing the render.
 */
export function supportedRatio(modelId: string, aspectRatio: AspectRatio): AspectRatio {
  const model = getImageModel(modelId)
  if (!model || model.aspectRatios.includes(aspectRatio)) return aspectRatio
  const orientation = (r: string) => {
    const [w, h] = r.split(':').map(Number)
    return w > h ? 'landscape' : w < h ? 'portrait' : 'square'
  }
  const want = orientation(aspectRatio)
  const match = model.aspectRatios.find((r) => orientation(r) === want)
  return (match ?? model.aspectRatios[0] ?? '1:1') as AspectRatio
}

/** Render with a single specific model; returns the URL and any failure reason. */
async function renderWithModel(
  id: string,
  prompt: string,
  requestedRatio: AspectRatio,
): Promise<{ url: string | null; error?: string }> {
  const model = getImageModel(id)
  if (!model) return { url: null, error: `Unknown image model "${id}"` }
  const aspectRatio = supportedRatio(id, requestedRatio)
  if (model.provider === 'fal') return generateFalImage(prompt, aspectRatio)
  if (model.provider === 'kie') return generateKieImage(id, prompt, aspectRatio)
  if (model.provider === 'muapi') return generateMuapiImage(id, prompt, aspectRatio)
  if (model.provider === 'higgsfield') {
    const url = await higgsfieldImage(prompt, aspectRatio)
    return { url, error: url ? undefined : 'Higgsfield returned no image' }
  }
  return { url: null, error: `No renderer for provider "${model.provider}"` }
}

export interface GeneratedImage {
  imageUrl: string
  modelId: string
  provider: string
}

export interface ImageAttempt {
  image: GeneratedImage | null
  /** Human-readable failure reason when image is null (surfaced to the UI). */
  error?: string
  /**
   * Set when the render did NOT run on the model that was asked for — the
   * requested model's id, plus a builder-facing note saying what happened.
   * A silent downgrade is how a text-bearing ad ends up on a model that cannot
   * spell, so the substitution is always reported rather than swallowed.
   */
  requestedModelId?: string
  fellBack?: boolean
  note?: string
}

/**
 * Generate a still and report WHY it failed (provider status/body) so the UI
 * can show an actionable error instead of a generic "rejected" message.
 */
export async function generateImageDetailed(
  modelId: string | undefined,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<ImageAttempt> {
  const carriesCopy = promptCarriesCopy(prompt)
  const candidates = candidateModelIds(modelId, carriesCopy)
  if (candidates.length === 0) return { image: null, error: 'No image provider is configured' }

  const intended = candidates[0]
  const errors: string[] = []
  for (const id of candidates) {
    const model = getImageModel(id)
    if (!model) continue
    const { url, error } = await renderWithModel(id, prompt, aspectRatio)
    if (url) {
      const fellBack = id !== intended
      const weakText = carriesCopy && model.textFidelity === 'weak'
      return {
        image: { imageUrl: url, modelId: id, provider: model.provider },
        requestedModelId: intended,
        fellBack,
        note: fellBack
          ? `${getImageModel(intended)?.label ?? intended} was unavailable — rendered on ${model.label}.${
              weakText
                ? ' That model is weak at in-image text, so check the headline spelling (fix the failing model’s slug, or render the copy as a Studio overlay).'
                : ''
            } Reason: ${errors[0] ?? 'unknown'}`
          : weakText
            ? `${model.label} is weak at in-image text — check the headline spelling, or overlay the copy in the Studio.`
            : undefined,
      }
    }
    errors.push(`${model.label}: ${error ?? 'no image'}`)
  }

  return { image: null, error: errors.join(' · ') || 'All image providers failed' }
}

/** Generate a still with the chosen model (or the best available). */
export async function generateImageWith(
  modelId: string | undefined,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<GeneratedImage | null> {
  return (await generateImageDetailed(modelId, prompt, aspectRatio)).image
}

/* ------------------------- Async (start + poll) path ----------------------- */
/* Kie and Muapi both persist a finished render against a task/request id, so a */
/* slow model can be started in one short request and polled in later ones —    */
/* the render never has to survive a single function under the host ceiling.    */
/* fal/Higgsfield return inline and use the synchronous path above.             */

/** Providers whose renders are started once and polled separately. */
const ASYNC_PROVIDERS = ['kie', 'muapi'] as const

export interface StartedImageJob {
  taskId: string | null
  modelId: string
  provider: string
  error?: string
  /** The model this render was meant to run on, when it fell back. */
  requestedModelId?: string
  fellBack?: boolean
  note?: string
}

/** True when the resolved model renders via an async-capable provider. */
export function isAsyncImageModel(requested?: string): boolean {
  const id = resolveModelId(requested)
  const model = id ? getImageModel(id) : null
  return Boolean(model && (ASYNC_PROVIDERS as readonly string[]).includes(model.provider))
}

/**
 * Start an async render and return its task/request id.
 *
 * This walks the SAME fallback chain as the synchronous oven rather than trying
 * one model and giving up. A gateway slug that has drifted (Muapi's frontier
 * endpoints are env-overridable precisely because they do) used to fail the
 * start, drop the whole render onto the synchronous path, and re-fail every
 * model above the workhorse before landing there — which is how a text-heavy ad
 * ended up rendered by a model that cannot spell. Never throws.
 */
export async function startImageJob(
  requested: string | undefined,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<StartedImageJob> {
  const carriesCopy = promptCarriesCopy(prompt)
  const candidates = candidateModelIds(requested, carriesCopy).filter((id) => {
    const m = getImageModel(id)
    return m && (ASYNC_PROVIDERS as readonly string[]).includes(m.provider)
  })
  if (candidates.length === 0) {
    return { taskId: null, modelId: '', provider: '', error: 'Not an async-capable image model' }
  }

  const intended = candidates[0]
  const errors: string[] = []
  for (const id of candidates) {
    const model = getImageModel(id)!
    const ratio = supportedRatio(id, aspectRatio)
    const { taskId, error } =
      model.provider === 'muapi'
        ? await startMuapiImage(id, prompt, ratio).then((r) => ({ taskId: r.requestId, error: r.error }))
        : await startKieImage(id, prompt, ratio)
    if (taskId) {
      const fellBack = id !== intended
      const weakText = carriesCopy && model.textFidelity === 'weak'
      return {
        taskId,
        modelId: id,
        provider: model.provider,
        requestedModelId: intended,
        fellBack,
        note: fellBack
          ? `${getImageModel(intended)?.label ?? intended} was unavailable — rendering on ${model.label}.${
              weakText ? ' That model is weak at in-image text, so check the headline spelling.' : ''
            } Reason: ${errors[0] ?? 'unknown'}`
          : weakText
            ? `${model.label} is weak at in-image text — check the headline spelling, or overlay the copy in the Studio.`
            : undefined,
      }
    }
    errors.push(`${model.label}: ${error ?? 'no task id'}`)
  }

  return {
    taskId: null,
    modelId: intended,
    provider: getImageModel(intended)?.provider ?? '',
    error: errors.join(' · '),
  }
}

/**
 * Poll a previously started render once. `provider` says which gateway holds
 * the job — it is round-tripped through the client from the start response, so
 * a Muapi id is never polled against Kie's endpoint (and vice versa).
 */
export async function pollImageJob(taskId: string, provider?: string): Promise<KiePollResult> {
  if (provider === 'muapi') return pollMuapiImage(taskId)
  return pollKieImage(taskId)
}
