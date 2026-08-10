import type { ImageModelAvailability } from './types'

/**
 * Recommend an image model before the Reactor fires. Pure (types only) so it
 * runs on client and server.
 *
 * Heuristic (best configured wins, in order):
 *  - Muapi leads while it is on trial as the main still generator — one
 *    MUAPIAPP_API_KEY unlocks the frontier models, so text-heavy creative →
 *    GPT Image 2 / Nano Banana Pro (in-image text), photographic → Nano Banana
 *    Pro / Seedream.
 *  - Then the Kie flagships, Higgsfield Soul (premium founder/testimonial look)
 *    and FLUX via fal.
 * Prefers configured models; falls back to the ideal for display when none have
 * keys yet.
 */

export interface ImageRecommendation {
  modelId: string
  reason: string
  configured: boolean
}

const TEXT_HEAVY = ['static', 'campaign', 'headline', 'banner']
const PHOTO = ['founder', 'testimonial', 'event']

export function recommendImageModel(
  outputs: string[],
  models: ImageModelAvailability[],
): ImageRecommendation | null {
  if (models.length === 0) return null

  const lower = outputs.map((o) => o.toLowerCase())
  const wantsText = lower.some((o) => TEXT_HEAVY.some((k) => o.includes(k)))
  const wantsPhoto = lower.some((o) => PHOTO.some((k) => o.includes(k)))

  const preference: { id: string; reason: string }[] = wantsText
    ? [
        { id: 'muapi-gpt-image-2', reason: "OpenAI's latest — the sharpest in-image text for headline/offer creatives" },
        { id: 'muapi-nano-banana-pro', reason: 'best-in-class prompt adherence and in-image text via Muapi' },
        { id: 'muapi-nano-banana-2', reason: 'latest-generation Gemini image model with legible on-ad copy' },
        { id: 'muapi-flux-kontext-max', reason: 'precise typography control via Muapi' },
        { id: 'kie-nano-banana-pro', reason: 'best-in-class prompt adherence and in-image text via Kie' },
        { id: 'kie-gpt-image', reason: 'clean in-image text for headline/offer creatives via Kie' },
        { id: 'fal-flux', reason: 'photoreal stills with strong prompt adherence via one fal key' },
        { id: 'higgsfield-soul', reason: 'premium photographic look' },
      ]
    : wantsPhoto
      ? [
          { id: 'muapi-nano-banana-pro', reason: 'top-tier photoreal detail via Muapi' },
          { id: 'muapi-seedream', reason: 'cinematic photoreal founder/testimonial stills via Muapi' },
          { id: 'muapi-nano-banana-2', reason: 'latest-generation photoreal scene coherence via Muapi' },
          { id: 'kie-seedream-v4', reason: 'cinematic photoreal founder/testimonial stills via Kie' },
          { id: 'kie-nano-banana-pro', reason: 'top-tier photoreal detail via Kie' },
          { id: 'higgsfield-soul', reason: 'premium photographic look for founder/testimonial ads' },
          { id: 'fal-flux', reason: 'photoreal founder/testimonial stills in-house via one fal key' },
        ]
      : [
          { id: 'muapi-nano-banana-pro', reason: 'strongest all-round ad still via one Muapi key' },
          { id: 'muapi-nano-banana-2', reason: 'latest-generation Gemini image model via Muapi' },
          { id: 'muapi-gpt-image-2', reason: "OpenAI's latest image model via Muapi" },
          { id: 'muapi-seedream', reason: 'cinematic realism via Muapi' },
          { id: 'kie-nano-banana-pro', reason: 'strongest all-round ad still via Kie' },
          { id: 'kie-seedream-v4', reason: 'cinematic realism via Kie' },
          { id: 'fal-flux', reason: 'photoreal variants in-house via one fal key' },
          { id: 'higgsfield-soul', reason: 'premium photographic look' },
        ]

  for (const p of preference) {
    const m = models.find((mm) => mm.id === p.id)
    if (m?.configured) return { modelId: m.id, reason: p.reason, configured: true }
  }

  const ideal = models.find((mm) => mm.id === preference[0].id) ?? models[0]
  return { modelId: ideal.id, reason: preference[0].reason, configured: ideal.configured }
}
