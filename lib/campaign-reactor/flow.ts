/**
 * Creative Flow — pure data layer for the node-graph production canvas.
 *
 * The Flow is the ElevenLabs-style counterpart to the Studio: a finished
 * Campaign Reactor run is laid out as a wired pipeline — Brief → visual/video
 * nodes (each a real, runnable generation step) → the live Ad Composition. No
 * React here; just the aspect-ratio menu, the lane categorisation, and the
 * seed that turns `Concept[]` into nodes + edges.
 */

import type { Concept } from '@/components/campaign-reactor/ReactorRunContext'

/* -------------------------------------------------------------------------- */
/*  Ad dimensions                                                             */
/* -------------------------------------------------------------------------- */

export interface AspectOption {
  value: '1:1' | '16:9' | '4:3' | '9:16' | '3:4'
  label: string
  /** The ratio shown under the label. */
  ratio: string
  /** Tailwind aspect class for framing the node preview. */
  box: string
}

/** The ad-dimension menu — mirrors the platform's image/video aspect support. */
export const ASPECT_OPTIONS: AspectOption[] = [
  { value: '1:1', label: 'Square', ratio: '1:1', box: 'aspect-[1/1]' },
  { value: '16:9', label: 'Landscape', ratio: '16:9', box: 'aspect-[16/9]' },
  { value: '4:3', label: 'Landscape', ratio: '4:3', box: 'aspect-[4/3]' },
  { value: '9:16', label: 'Portrait', ratio: '9:16', box: 'aspect-[9/16]' },
  { value: '3:4', label: 'Portrait', ratio: '3:4', box: 'aspect-[3/4]' },
]

export const DEFAULT_ASPECT = '1:1'

export function aspectBox(value: string): string {
  return ASPECT_OPTIONS.find((a) => a.value === value)?.box ?? 'aspect-[1/1]'
}

/* -------------------------------------------------------------------------- */
/*  Node seeding                                                              */
/* -------------------------------------------------------------------------- */

/** A concept that produces a visual (still or moving) gets its own node. */
export function isVisualConcept(c: Concept): boolean {
  return /concept|static|founder|campaign|testimonial|video|image|creative|ugc/i.test(c.type)
}

/** Concepts that should appear as runnable media nodes, with their run index. */
export interface MediaConcept {
  index: number
  concept: Concept
  /** A video render (moving) vs a still. */
  isVideo: boolean
}

export function mediaConcepts(concepts: Concept[]): MediaConcept[] {
  return concepts
    .map((concept, index) => ({ index, concept, isVideo: /video|testimonial/i.test(concept.type) }))
    .filter((m) => isVisualConcept(m.concept))
}
