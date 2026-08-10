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
  // ORDER IS LOAD-BEARING: the oven resolves the first configured model and
  // falls through this list, and the Formats-step picker defaults to the
  // leader. So whatever sits at the top is what actually renders.
  //
  // These are ranked by TEXT FIDELITY first, not raw image quality, because
  // every TPB static carries a headline and a CTA. A model that renders a
  // gorgeous scene and a misspelled headline has produced an unusable ad.
  // Midjourney and FLUX.1 Dev sit at the bottom for exactly that reason.
  {
    id: 'muapi-nano-banana-pro',
    label: 'Nano Banana Pro (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: 'Google Nano Banana Pro (Gemini 3 Pro Image) — the strongest all-round ad still: top-tier prompt adherence, in-image text rendering and photoreal detail. 0.12 credits/image.',
  },
  {
    id: 'muapi-gpt-image-2',
    label: 'GPT Image 2 (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '16:9', '9:16'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: "OpenAI's latest image model — the sharpest in-image text and instruction-following, and it takes prompts up to 20,000 characters. First choice for headline/offer creatives.",
  },
  {
    id: 'muapi-imagen4-ultra',
    label: 'Imagen 4 Ultra (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: "Google Imagen 4 Ultra — DeepMind's flagship: photorealism, rich texture and accurate text rendering. Strong third opinion when a headline must be perfect.",
  },
  {
    id: 'muapi-nano-banana-2',
    label: 'Nano Banana 2 (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: 'Google Nano Banana 2 (Gemini 3.1 Flash Image) — speed with high-fidelity 4K output and legible on-ad copy.',
  },
  {
    id: 'muapi-seedream',
    label: 'Seedream 5.0 Pro (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: "ByteDance Seedream 5.0 Pro — their flagship: cinematic photoreal rendering with deep visual reasoning and precise typography. Premium proof/founder creative.",
  },
  {
    id: 'muapi-flux-3',
    label: 'FLUX 3 (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'moderate',
    notes: "Black Forest Labs' next-generation frontier model, jointly trained across image, video and audio. Strong all-round generation; text is good but not best-in-class.",
  },
  {
    id: 'muapi-flux-kontext-max',
    label: 'FLUX Kontext (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'moderate',
    notes: 'FLUX Kontext — generation with optional reference-image guidance for pose or style. Best when a banked design must be reproduced faithfully.',
  },
  {
    id: 'muapi-midjourney',
    label: 'Midjourney V8 (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'weak',
    notes: 'Midjourney V8 — the most stylised, art-directed look and the highest scroll-stop ceiling when the angle wants a brand image rather than a literal scene. Cannot set legible on-image copy: use it for text-free creative only.',
  },
  {
    id: 'muapi-flux-dev',
    label: 'FLUX.1 Dev (Muapi)',
    provider: 'muapi',
    aspectRatios: ['1:1', '4:5', '16:9', '4:3', '9:16', '3:4'],
    tier: 'fast',
    textFidelity: 'weak',
    notes: 'FLUX.1 Dev — the fast, high-volume workhorse at 0.015 credits. Weak at in-image text (headlines come back misspelled), so it is used for text-free variations and is the last resort for a creative that carries copy.',
  },
  // Kie.ai flagship image market — the most powerful models, one KIE_API_KEY.
  {
    id: 'kie-nano-banana-pro',
    label: 'Nano Banana Pro (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: 'Google Nano Banana Pro via Kie — top-tier prompt adherence, text rendering, and photoreal detail. Best all-round ad still.',
  },
  {
    id: 'kie-seedream-v4',
    label: 'Seedream 4.0 (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'moderate',
    notes: 'ByteDance Seedream 4.0 via Kie — cinematic realism and strong composition for premium proof/founder stills.',
  },
  {
    id: 'kie-flux-kontext-max',
    label: 'FLUX Kontext Max (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: 'FLUX.1 Kontext Max via Kie — precise, editable photoreal generation with excellent typography control.',
  },
  {
    id: 'kie-gpt-image',
    label: 'GPT Image 2 (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '9:16'],
    tier: 'flagship',
    textFidelity: 'strong',
    notes: 'OpenAI GPT Image 2 via Kie — next-gen photorealism, sharp in-image text and instruction-following for headline/offer creatives.',
  },
  {
    id: 'kie-nano-banana',
    label: 'Nano Banana (Kie)',
    provider: 'kie',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'fast',
    textFidelity: 'moderate',
    notes: 'Google Nano Banana via Kie — fast, high-volume variant for quick creative variations.',
  },
  {
    id: 'fal-flux',
    label: 'FLUX.1 (fal)',
    provider: 'fal',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'weak',
    notes: 'Photoreal humans and scenes via fal — one FAL_KEY, no per-model subscription. Great for realistic UGC and B-roll stills; weak at in-image text, so it renders scenes rather than headline creatives.',
  },
  {
    id: 'higgsfield-soul',
    label: 'Higgsfield Soul',
    provider: 'higgsfield',
    aspectRatios: ['1:1', '16:9', '4:3', '9:16', '3:4'],
    tier: 'flagship',
    textFidelity: 'weak',
    notes: 'Photographic, premium ad look — pairs with Higgsfield image-to-video. Weak at in-image text: best for the photographic layer with copy overlaid afterwards.',
  },
]

// The frontier model leads while Muapi is on trial as the main still generator.
// When MUAPIAPP_API_KEY is absent the oven automatically falls through to the
// next configured provider (Kie → fal → Higgsfield), so this is a preference,
// never a hard dependency.
export const DEFAULT_IMAGE_MODEL = 'muapi-nano-banana-pro'

export function getImageModel(id: string): ImageModel | undefined {
  return IMAGE_MODELS.find((m) => m.id === id)
}
