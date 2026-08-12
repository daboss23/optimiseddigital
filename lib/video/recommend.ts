import type { ModelAvailability } from './types'

/**
 * Pick the best video model for a set of requested output types, before the
 * Reactor fires. Pure (types only) so it runs on both client and server.
 *
 * Heuristic, in priority order:
 *  - Anything where a person speaks (Testimonial / UGC / talking-head) → a model
 *    with native audio (Veo 3.1) so the dialogue is generated, not silent.
 *  - Cinematic action / B-roll (Video / Founder Concept) → a flagship realism
 *    model (Seedance 2.0, then Kling 3.0).
 *  - Otherwise → the cheapest flagship-or-budget option for volume.
 * Prefers configured models; falls back to the ideal pick for display when none
 * of the preferred models have keys yet.
 */

export interface VideoRecommendation {
  modelId: string
  reason: string
  configured: boolean
}

export interface VideoRecommendationContext {
  /**
   * The brief carries reference stills / clips of a real person (the in-house
   * face library). That is a different job from "generate a talking head": the
   * model has to hold ONE face across every clip, which only the
   * reference-to-video tiers do — and Seedance 2.0's omni-reference takes up to
   * nine stills where Veo takes three. When refs are attached, that capability
   * outranks Veo's dialogue edge.
   */
  hasReferences?: boolean
}

const SPEAKING = ['testimonial', 'ugc', 'talking', 'spokesperson', 'interview']
const CINEMATIC = ['video', 'founder', 'event', 'campaign']

export function recommendVideoModel(
  outputs: string[],
  models: ModelAvailability[],
  ctx: VideoRecommendationContext = {},
): VideoRecommendation | null {
  if (models.length === 0) return null

  const lower = outputs.map((o) => o.toLowerCase())
  const wantsSpeech = lower.some((o) => SPEAKING.some((k) => o.includes(k)))
  const wantsCinematic = lower.some((o) => CINEMATIC.some((k) => o.includes(k)))

  // Ordered preference list of (modelId, why) by intent.
  // Muapi ids lead each list because Muapi is the platform's default gateway
  // and sits first in registry order — so when both routes to a model are
  // available, the recommendation names the same entry the deduped picker
  // keeps. A Muapi-only environment used to be recommended a fal model it had
  // no key for, flagged unusable, with an equivalent sitting right there.
  const preference: { id: string; reason: string }[] = wantsSpeech
    ? [
        { id: 'muapi-veo3.1', reason: 'people speaking with native audio (UGC / testimonials)' },
        { id: 'veo-3.1', reason: 'people speaking with native audio (UGC / testimonials)' },
        { id: 'muapi-seedance-2.0', reason: 'cinematic realism with native synchronized audio' },
        { id: 'seedance-2.0', reason: 'cinematic realism with native synchronized audio' },
        { id: 'muapi-veo4', reason: 'photorealistic dialogue on the newest Veo tier' },
        { id: 'veo-3', reason: 'native-audio dialogue' },
        { id: 'kling-3.0', reason: 'strong lip-sync-friendly motion for talking-head UGC' },
      ]
    : wantsCinematic
      ? [
          { id: 'muapi-seedance-2.0', reason: 'cinematic realism + native audio for on-site builder B-roll' },
          { id: 'seedance-2.0', reason: 'cinematic realism + native audio for on-site builder B-roll' },
          { id: 'muapi-kling-3.0', reason: 'top-tier motion consistency for action scenes' },
          { id: 'kling-3.0', reason: 'top-tier motion consistency for action scenes' },
          { id: 'muapi-veo3.1', reason: 'realistic motion with native audio' },
          { id: 'veo-3.1', reason: 'realistic motion with native audio' },
          { id: 'kling-2.5', reason: 'high prompt adherence for action scenes' },
        ]
      : [
          { id: 'muapi-seedance-2.0-fast', reason: 'flagship Seedance quality at lower cost for high-volume variants' },
          { id: 'seedance-2.0-fast', reason: 'flagship Seedance quality at lower cost for high-volume variants' },
          { id: 'muapi-wan-2.7', reason: 'best quality-to-cost for high-volume variants' },
          { id: 'wan-2.7', reason: 'native 1080p at scale for high-volume variants' },
          { id: 'wan-2.5', reason: 'best quality-to-cost for high-volume variants' },
          { id: 'seedance-2.0', reason: 'flagship realism' },
        ]

  // A face library in the brief re-orders the list: the reference-to-video
  // tiers move to the front, Seedance first (nine reference stills against
  // Veo's three, plus native audio and 15s clips). Nothing is dropped — a
  // model that cannot hold a face simply stops being the recommendation.
  const ordered = ctx.hasReferences
    ? [
        {
          id: 'muapi-seedance-2.0',
          reason: 'holds one face across every clip (omni-reference, up to 9 stills) with native audio',
        },
        {
          id: 'seedance-2.0',
          reason: 'holds one face across every clip (omni-reference, up to 9 stills) with native audio',
        },
        {
          id: 'muapi-seedance-2.0-fast',
          reason: 'same face consistency and native audio at volume speed and cost',
        },
        {
          id: 'seedance-2.0-fast',
          reason: 'same face consistency and native audio at volume speed and cost',
        },
        ...preference,
      ]
    : preference

  // First configured model in the preference order wins.
  for (const p of ordered) {
    const m = models.find((mm) => mm.id === p.id)
    if (m?.configured) return { modelId: m.id, reason: p.reason, configured: true }
  }

  // None of the preferred models are configured — recommend the ideal anyway
  // (so the UI can prompt for the key), but flag it as not yet usable.
  const ideal = models.find((mm) => mm.id === ordered[0].id) ?? models[0]
  return { modelId: ideal.id, reason: ordered[0].reason, configured: ideal.configured }
}
