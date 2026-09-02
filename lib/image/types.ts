/**
 * Unified image-generation types — the multi-model still-creative layer.
 * Mirrors lib/video so the agent, routes, and UI treat every image model
 * (fal / FLUX, Higgsfield) the same way.
 */

/**
 * Ratios the still pipeline can request. `4:5` is Meta's tall feed format — the
 * largest footprint a static ad gets in the mobile feed — and is deliberately
 * image-only: the video registry keeps its own list.
 */
export type AspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4' | '4:5'

export type ImageProvider = 'higgsfield' | 'fal' | 'kie' | 'muapi'

export type ModelTier = 'flagship' | 'fast' | 'budget'

/**
 * How well a model sets LITERAL text inside the image.
 *
 * This is a separate axis from `tier`: Midjourney is a flagship-quality
 * renderer that cannot spell, and FLUX mangles any headline longer than a
 * couple of words. Nearly every static ad carries a headline and a
 * CTA button, so a render that carries copy must be routed on this axis — not
 * on tier — or it comes back looking correct at a glance and unreadable up
 * close. See `textCapableFirst()` in ./index.
 */
export type TextFidelity = 'strong' | 'moderate' | 'weak'

export interface ImageModel {
  id: string
  label: string
  provider: ImageProvider
  aspectRatios: AspectRatio[]
  tier: ModelTier
  /** Reliability at rendering exact on-image copy. */
  textFidelity: TextFidelity
  notes: string
}

/** Model entry plus whether its provider key is present in this environment. */
export interface ImageModelAvailability extends ImageModel {
  configured: boolean
}
