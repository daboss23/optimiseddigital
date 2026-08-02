import { generateImage as higgsfieldImage, higgsfieldConfigured } from '@/lib/higgsfield'
import { generateFalImage, falImageConfigured } from './fal'
import {
  generateKieImage,
  kieImageConfigured,
  startKieImage,
  pollKieImage,
  type KiePollResult,
} from './kie'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, getImageModel } from './registry'
import type { AspectRatio, ImageModelAvailability } from './types'

export * from './types'
export { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, getImageModel } from './registry'

/**
 * Unified image "oven" — dispatches a still render to whichever provider backs
 * the requested model (fal / FLUX, Higgsfield). Callers never branch on
 * provider. Never throws on missing keys — returns null.
 */

export function providerConfigured(provider: string): boolean {
  if (provider === 'higgsfield') return higgsfieldConfigured()
  if (provider === 'fal') return falImageConfigured()
  if (provider === 'kie') return kieImageConfigured()
  return false
}

/** True if ANY image provider is configured. */
export function imageConfigured(): boolean {
  return higgsfieldConfigured() || falImageConfigured() || kieImageConfigured()
}

/** The image model menu annotated with whether each model's key is present. */
export function listImageModels(): ImageModelAvailability[] {
  return IMAGE_MODELS.map((m) => ({ ...m, configured: providerConfigured(m.provider) }))
}

/** Pick a usable model: the requested one if configured, else first configured. */
function resolveModelId(requested?: string): string | null {
  const tryIds = [requested, DEFAULT_IMAGE_MODEL].filter(Boolean) as string[]
  for (const id of tryIds) {
    const m = getImageModel(id)
    if (m && providerConfigured(m.provider)) return id
  }
  return IMAGE_MODELS.find((m) => providerConfigured(m.provider))?.id ?? null
}

/**
 * Ordered list of configured model ids to try: the resolved/requested model
 * first, then every other configured model as a fallback. This makes the oven
 * resilient — if the chosen provider is out of credit or rejects, it
 * automatically tries another configured provider before giving up.
 */
function candidateModelIds(requested?: string): string[] {
  const first = resolveModelId(requested)
  const rest = IMAGE_MODELS.filter((m) => providerConfigured(m.provider)).map((m) => m.id)
  return Array.from(new Set([first, ...rest].filter(Boolean) as string[]))
}

/** Render with a single specific model; returns the URL and any failure reason. */
async function renderWithModel(
  id: string,
  prompt: string,
  aspectRatio: AspectRatio,
): Promise<{ url: string | null; error?: string }> {
  const model = getImageModel(id)
  if (!model) return { url: null, error: `Unknown image model "${id}"` }
  if (model.provider === 'fal') return generateFalImage(prompt, aspectRatio)
  if (model.provider === 'kie') return generateKieImage(id, prompt, aspectRatio)
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
  const candidates = candidateModelIds(modelId)
  if (candidates.length === 0) return { image: null, error: 'No image provider is configured' }

  const errors: string[] = []
  for (const id of candidates) {
    const model = getImageModel(id)
    if (!model) continue
    const { url, error } = await renderWithModel(id, prompt, aspectRatio)
    if (url) {
      return { image: { imageUrl: url, modelId: id, provider: model.provider } }
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
/* Kie persists a finished render against its taskId, so a slow model can be    */
/* started in one short request and polled in later ones — the render never     */
/* has to survive a single function under the host ceiling. Only Kie models     */
/* support this; fal/Higgsfield return inline and use the synchronous path.     */

export interface StartedImageJob {
  taskId: string | null
  modelId: string
  provider: string
  error?: string
}

/** True when the resolved model renders via Kie (the async-capable provider). */
export function isAsyncImageModel(requested?: string): boolean {
  const id = resolveModelId(requested)
  const model = id ? getImageModel(id) : null
  return model?.provider === 'kie'
}

/**
 * Start an async Kie render and return its taskId. Resolves the requested model
 * to a configured Kie model; returns an error (never throws) when none applies.
 */
export async function startImageJob(
  requested: string | undefined,
  prompt: string,
  aspectRatio: AspectRatio = '1:1',
): Promise<StartedImageJob> {
  const id = resolveModelId(requested)
  const model = id ? getImageModel(id) : null
  if (!id || !model || model.provider !== 'kie') {
    return { taskId: null, modelId: id ?? '', provider: model?.provider ?? '', error: 'Not a Kie model' }
  }
  const { taskId, error } = await startKieImage(id, prompt, aspectRatio)
  return { taskId, modelId: id, provider: 'kie', error }
}

/** Poll a previously started Kie render once. */
export async function pollImageJob(taskId: string): Promise<KiePollResult> {
  return pollKieImage(taskId)
}
