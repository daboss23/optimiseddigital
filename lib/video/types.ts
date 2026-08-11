/**
 * Unified video-generation types for the TPB "oven" — the multi-model layer
 * that turns prompts (and stills) into high-quality clips.
 *
 * Every provider (fal.ai gateway, Higgsfield) is normalised to the same job
 * shape so the Campaign Reactor agent, the API routes, and the UI never care
 * which model rendered a clip — only what it can do.
 */

export type AspectRatio = '1:1' | '9:16' | '16:9' | '4:3' | '3:4'

export type VideoProvider = 'fal' | 'higgsfield' | 'muapi'

/**
 * How a clip is produced: from a written prompt, from a single still, or from a
 * set of reference images that lock a consistent identity/face across the clip
 * (the "face library" / in-house UGC mechanism).
 */
export type GenMode = 'text-to-video' | 'image-to-video' | 'reference-to-video'

/** Normalised render lifecycle across every provider. */
export type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'unknown'

export type ModelTier = 'flagship' | 'fast' | 'budget'

/**
 * A single entry on the model menu. The `endpoints` map holds the
 * provider-specific path per mode (e.g. a fal model id), so the registry stays
 * the only place that needs touching when a vendor ships a new version.
 */
export interface VideoModel {
  id: string
  label: string
  provider: VideoProvider
  /** Provider-specific endpoint/model path, keyed by generation mode. */
  endpoints: Partial<Record<GenMode, string>>
  modes: GenMode[]
  maxDurationSec: number
  aspectRatios: AspectRatio[]
  /** Native audio/dialogue generation (e.g. Veo 3). */
  audio: boolean
  tier: ModelTier
  notes: string
}

/** Input for a render, normalised across providers. */
export interface VideoInput {
  prompt?: string
  /** Required for image-to-video. */
  imageUrl?: string
  /** Reference identity images (up to 9) for reference-to-video — keeps a face
   * consistent across the clip. The face-library mechanism. */
  imageUrls?: string[]
  /** Reference videos (up to 3) for reference-to-video — motion/style refs. */
  videoUrls?: string[]
  mode: GenMode
  aspectRatio?: AspectRatio
  durationSec?: number
}

/** A started or polled render job. */
export interface VideoJob {
  provider: VideoProvider
  modelId: string
  requestId: string
  status: JobStatus
  videoUrl: string | null
  /** fal's authoritative result URL (status at `${responseUrl}/status`); null
   * for providers that don't use it (e.g. Higgsfield). Pass it back when polling
   * so status resolution never relies on guessing the model's base path. */
  responseUrl?: string | null
  /**
   * When the requested model could not take the job (missing key, drifted
   * endpoint slug), the oven renders on the nearest capable model and says so.
   * A silent downgrade is how a Veo 3 UGC order came back as a still.
   */
  requestedModelId?: string
  fellBack?: boolean
  note?: string
}

/** Model entry plus whether its provider keys are present in this environment. */
export interface ModelAvailability extends VideoModel {
  configured: boolean
}
