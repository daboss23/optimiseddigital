import type { ImageModel } from './types'

/**
 * The image model menu — TPB's still-creative equivalent of the video registry.
 * Each model is a different provider; one key per provider unlocks it.
 *
 * Stills run through Muapi (one MUAPIAPP_API_KEY), fal.ai (one FAL_KEY unlocks
 * frontier image models), Higgsfield, or Kie.ai (one KIE_API_KEY unlocks its
 * whole model market). Every provider is one key.
 *
 * Muapi is listed FIRST and is the current default — it is on trial as the main
 * still generator. The other providers stay wired and become automatic
 * fallbacks, so removing MUAPIAPP_API_KEY restores the previous behaviour
 * without a code change.
 */

export const IMAGE_MODELS: ImageModel[] = [
  // Muapi unified gateway — one MUAPIAPP_API_KEY, many frontier models. On
  // trial as the primary still generator.
  //
  // These are Muapi's five STRONGEST image models for ad creative, ordered
  // best-first. Order is load-bearing: the oven resolves the first configured
  // model and falls through this list on failure, so the leader is both the
  // default and the first fallback. (It previously led with FLUX.1 Dev — the
  // fastest, not the best — which made the weakest model the platform default.)
  {
    id: 'muapi-seedream',
    label: 'Seedream 4.0 (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'ByteDance Seedream 4.0 — the strongest all-round ad still: cinematic photoreal realism and composition for premium proof/founder creative.',
  },
  {
    id: 'muapi-gpt4o',
    label: 'GPT-4o Image (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '16:9', '9:16'],
    tier: 'flagship',
    notes: 'OpenAI GPT-4o image — the best in-image text and instruction-following. First choice for headline/offer creatives that must render copy legibly.',
  },
  {
    id: 'muapi-midjourney',
    label: 'Midjourney (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'Midjourney — the most stylised, art-directed look. Highest scroll-stop ceiling when the angle wants a brand image rather than a literal scene.',
  },
  {
    id: 'muapi-flux-kontext-max',
    label: 'FLUX Kontext Max (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'FLUX.1 Kontext Max — precise, editable photoreal generation with excellent typography control. Best when a banked design must be reproduced faithfully.',
  },
  {
    id: 'muapi-flux-dev',
    label: 'FLUX.1 Dev (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'fast',
    notes: 'FLUX.1 Dev — the fast, high-volume workhorse. Lower ceiling than the four above; use it for bulk creative variations.',
  },
  // Kie.ai flagship image market — the most powerful models, one KIE_API_KEY.
  {
    id: 'kie-nano-banana-pro',
    label: 'Nano Banana Pro (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'Google Nano Banana Pro via Kie — top-tier prompt adherence, text rendering, and photoreal detail. Best all-round ad still.',
  },
  {
    id: 'kie-seedream-v4',
    label: 'Seedream 4.0 (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'ByteDance Seedream 4.0 via Kie — cinematic realism and strong composition for premium proof/founder stills.',
  },
  {
    id: 'kie-flux-kontext-max',
    label: 'FLUX Kontext Max (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'FLUX.1 Kontext Max via Kie — precise, editable photoreal generation with excellent typography control.',
  },
  {
    id: 'kie-gpt-image',
    label: 'GPT Image 2 (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '9:16'],
    tier: 'flagship',
    notes: 'OpenAI GPT Image 2 via Kie — next-gen photorealism, sharp in-image text and instruction-following for headline/offer creatives.',
  },
  {
    id: 'kie-nano-banana',
    label: 'Nano Banana (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'fast',
    notes: 'Google Nano Banana via Kie — fast, high-volume variant for quick creative variations.',
  },
  {
    id: 'fal-flux',
    label: 'FLUX.1 (fal)',
    provider: 'fal',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'Photoreal humans and scenes via fal — one FAL_KEY, no per-model subscription. Great for realistic UGC and B-roll stills.',
  },
  {
    id: 'higgsfield-soul',
    label: 'Higgsfield Soul',
    provider: 'higgsfield',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    notes: 'Photographic, premium ad look — pairs with Higgsfield image-to-video.',
  },
]

// Muapi's strongest model is the current default while Muapi is on trial as the
// main still generator. When MUAPIAPP_API_KEY is absent the oven automatically
// falls through to the next configured provider (Kie → fal → Higgsfield), so
// this is a preference, never a hard dependency.
export const DEFAULT_IMAGE_MODEL = 'muapi-seedream'

export function getImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id)
}
