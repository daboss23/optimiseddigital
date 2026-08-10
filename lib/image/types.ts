/**
 * Unified image-generation types — the multi-model still-creative layer.
 * Mirrors lib/video so the agent, routes, and UI treat every image model
 * (fal / FLUX, Higgsfield) the same way.
 */

export type AspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4'

export type ImageProvider = 'higgsfield' | 'fal' | 'kie' | 'muapi'

export type ModelTier = 'flagship' | 'fast' | 'budget'

export interface ImageModel {
  id: string
  label: string
  provider: ImageProvider
  aspectRatios: AspectRatio[]
  tier: ModelTier
  notes: string
}

/** Model entry plus whether its provider key is present in this environment. */
export interface ImageModelAvailability extends ImageModel {
  configured: boolean
}
