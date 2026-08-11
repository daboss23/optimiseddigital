import type { VideoModel } from './types'

/**
 * The model menu — TPB's in-house equivalent of Higgsfield's model picker.
 *
 * fal.ai is used as a single gateway for the frontier models (Seedance, Kling,
 * Veo, Wan): one key (FAL_KEY) unlocks all of them with one async pattern.
 * Higgsfield stays wired through its own platform API.
 *
 * Provider model paths drift as vendors ship new versions, so every endpoint
 * can be overridden with an env var without code changes. The defaults reflect
 * the current generation; update them (or set the env var) as models evolve.
 */

const env = (key: string, fallback: string) => process.env[key] || fallback

export const VIDEO_MODELS: VideoModel[] = [
  // Muapi unified gateway — one MUAPIAPP_API_KEY unlocks Veo / Kling / Seedance
  // / Wan. On trial as the primary video generator, so these lead the menu; the
  // fal and Higgsfield models below stay wired as automatic fallbacks.
  {
    id: 'muapi-veo3',
    label: 'Veo 3',
    provider: 'muapi',
    endpoints: {
      'text-to-video': env('MUAPI_VIDEO_VEO3_T2V', 'veo3-text-to-video'),
      'image-to-video': env('MUAPI_VIDEO_VEO3_I2V', 'veo3-image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 8,
    aspectRatios: ['9:16', '16:9'],
    audio: true,
    tier: 'flagship',
    notes: 'Google Veo 3 — native synchronized audio + dialogue. Best for people speaking / UGC voices.',
  },
  {
    id: 'muapi-kling-pro',
    label: 'Kling Pro',
    provider: 'muapi',
    endpoints: {
      'text-to-video': env('MUAPI_VIDEO_KLING_T2V', 'kling-v2.5-turbo-pro-t2v'),
      'image-to-video': env('MUAPI_VIDEO_KLING_I2V', 'kling-v2.5-turbo-pro-i2v'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 10,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'flagship',
    notes: 'Kling Pro — top-tier motion consistency and prompt adherence for UGC and action.',
  },
  {
    id: 'muapi-seedance-pro',
    label: 'Seedance Pro',
    provider: 'muapi',
    endpoints: {
      'text-to-video': env('MUAPI_VIDEO_SEEDANCE_T2V', 'seedance-pro-t2v'),
      'image-to-video': env('MUAPI_VIDEO_SEEDANCE_I2V', 'seedance-pro-i2v'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 12,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: true,
    tier: 'flagship',
    notes: 'ByteDance Seedance Pro — cinematic realism and real-world physics for on-site builder B-roll.',
  },
  {
    id: 'muapi-wan',
    label: 'Wan 2.2',
    provider: 'muapi',
    endpoints: {
      'text-to-video': env('MUAPI_VIDEO_WAN_T2V', 'wan2.2-text-to-video'),
      'image-to-video': env('MUAPI_VIDEO_WAN_I2V', 'wan2.2-image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 10,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'budget',
    notes: 'Wan 2.2 — strong quality-to-cost ratio for high-volume variant generation.',
  },
  {
    id: 'seedance-2.0',
    label: 'Seedance 2.0 (ByteDance)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_SEEDANCE_T2V', 'bytedance/seedance-2.0/text-to-video'),
      'image-to-video': env('FAL_SEEDANCE_I2V', 'bytedance/seedance-2.0/image-to-video'),
      'reference-to-video': env('FAL_SEEDANCE_R2V', 'bytedance/seedance-2.0/reference-to-video'),
    },
    modes: ['text-to-video', 'image-to-video', 'reference-to-video'],
    maxDurationSec: 15,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: true,
    tier: 'flagship',
    notes: 'ByteDance flagship — native synchronized audio, real-world physics, and cinematic multi-shot in one pass. Reference-to-video keeps a consistent face across clips (in-house UGC / face library). Best for realistic human scenes and on-site builder B-roll.',
  },
  {
    id: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast (ByteDance)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_SEEDANCE_FAST_T2V', 'bytedance/seedance-2.0/fast/text-to-video'),
      'image-to-video': env('FAL_SEEDANCE_FAST_I2V', 'bytedance/seedance-2.0/fast/image-to-video'),
      'reference-to-video': env('FAL_SEEDANCE_FAST_R2V', 'bytedance/seedance-2.0/fast/reference-to-video'),
    },
    modes: ['text-to-video', 'image-to-video', 'reference-to-video'],
    maxDurationSec: 15,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: true,
    tier: 'fast',
    notes: 'Lower-latency, lower-cost Seedance 2.0 — same native audio and reference-to-video face consistency, ideal for high-volume in-house UGC.',
  },
  {
    id: 'veo-3.1',
    label: 'Veo 3.1 (Google)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_VEO31_T2V', 'fal-ai/veo3.1'),
      'image-to-video': env('FAL_VEO31_I2V', 'fal-ai/veo3.1/image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 8,
    aspectRatios: ['9:16', '16:9'],
    audio: true,
    tier: 'flagship',
    notes: "Google's latest — native synchronized audio + dialogue. Best for people speaking / UGC voices.",
  },
  {
    id: 'kling-3.0',
    label: 'Kling 3.0 (Kuaishou)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_KLING3_T2V', 'fal-ai/kling-video/v3/pro/text-to-video'),
      'image-to-video': env('FAL_KLING3_I2V', 'fal-ai/kling-video/v3/pro/image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 10,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'flagship',
    notes: 'Latest Kling — top-tier motion consistency and prompt adherence for UGC and action.',
  },
  {
    id: 'wan-2.7',
    label: 'Wan 2.7 (Alibaba)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_WAN27_T2V', 'fal-ai/wan/v2.7/text-to-video'),
      'image-to-video': env('FAL_WAN27_I2V', 'fal-ai/wan/v2.7/image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 15,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'flagship',
    notes: 'Native 1080p, 15s clips, first/last-frame control — strong quality at scale for high-volume variants.',
  },
  {
    id: 'kling-2.5',
    label: 'Kling 2.5 (Kuaishou)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_KLING_T2V', 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'),
      'image-to-video': env('FAL_KLING_I2V', 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 10,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'flagship',
    notes: 'Excellent prompt adherence and lip-sync-friendly motion for UGC.',
  },
  {
    id: 'veo-3',
    label: 'Veo 3 (Google)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_VEO3_T2V', 'fal-ai/veo3'),
      'image-to-video': env('FAL_VEO3_I2V', 'fal-ai/veo3/image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 8,
    aspectRatios: ['9:16', '16:9'],
    audio: true,
    tier: 'flagship',
    notes: 'Native synchronized audio + dialogue — best for people speaking / UGC voices.',
  },
  {
    id: 'wan-2.5',
    label: 'Wan 2.5 (Alibaba)',
    provider: 'fal',
    endpoints: {
      'text-to-video': env('FAL_WAN_T2V', 'fal-ai/wan-25-preview/text-to-video'),
      'image-to-video': env('FAL_WAN_I2V', 'fal-ai/wan-25-preview/image-to-video'),
    },
    modes: ['text-to-video', 'image-to-video'],
    maxDurationSec: 10,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'budget',
    notes: 'Strong quality-to-cost ratio for high-volume variant generation.',
  },
  {
    id: 'higgsfield-dop',
    label: 'Higgsfield DoP',
    provider: 'higgsfield',
    endpoints: {
      'image-to-video': 'dop',
    },
    modes: ['image-to-video'],
    maxDurationSec: 5,
    aspectRatios: ['1:1', '9:16', '16:9'],
    audio: false,
    tier: 'fast',
    notes: 'Cinematic camera-move animation of a still — already wired via the Higgsfield SDK.',
  },
]

/**
 * Default model when the caller does not specify one. Muapi is on trial as the
 * main video generator; when MUAPIAPP_API_KEY is absent the oven falls through
 * to the next configured provider (fal → Higgsfield), so this is a preference,
 * never a hard dependency.
 */
export const DEFAULT_VIDEO_MODEL = 'muapi-veo3'

export function getVideoModel(id: string): VideoModel | undefined {
  return VIDEO_MODELS.find((m) => m.id === id)
}

/**
 * The model FAMILY behind an id — 'muapi-veo3', 'veo-3.1' and 'veo-3' are all
 * `veo`. The oven uses this to keep a fallback in the same family: a Veo
 * request that can't reach one gateway's Veo goes to another gateway's Veo
 * before it considers a different model entirely.
 */
export function modelFamily(id: string): string {
  const s = id.toLowerCase()
  if (s.includes('veo')) return 'veo'
  if (s.includes('kling')) return 'kling'
  if (s.includes('seedance')) return 'seedance'
  if (s.includes('wan')) return 'wan'
  if (s.includes('higgsfield') || s.includes('dop')) return 'dop'
  return s
}
