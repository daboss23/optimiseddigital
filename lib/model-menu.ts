/**
 * Per-deliverable render-model menu for the campaign brief.
 *
 * When the user picks a creative deliverable, the Formats step shows the model
 * that will render it — recommended by the system, overridable by the user —
 * and the dimension options adapt to whichever model is chosen (every model
 * declares its own aspect-ratio support in the image/video registries).
 *
 * Pure data + types (no React, no server-only imports) so the modal, the
 * Workbench, and the reactor route can all share it.
 */

import { IMAGE_MODELS } from '@/lib/image/registry'
import { VIDEO_MODELS } from '@/lib/video/registry'
import { recommendImageModel } from '@/lib/image/recommend'
import { recommendVideoModel } from '@/lib/video/recommend'
import type { ImageModelAvailability } from '@/lib/image/types'
import type { ModelAvailability } from '@/lib/video/types'
import type { CreativeSize } from '@/lib/reactor-inputs'

export type ModelKind = 'image' | 'video' | 'montage'

/** One entry in a deliverable's model menu. */
export interface ModelMenuOption {
  id: string
  label: string
  kind: ModelKind
  provider: string
  aspectRatios: string[]
  configured: boolean
  /** One-line, builder-facing note on what this model is best at. */
  note: string
}

export interface ModelMenu {
  deliverable: string
  options: ModelMenuOption[]
  recommendedId: string
  /** Why the system recommends that model for this deliverable. */
  reason: string
}

/**
 * OpenMontage — the scene engine. It is NOT a render model and is never a
 * selectable item in a model list: it plans the scene sequence and then hands
 * every scene to two REAL models underneath — a still model (renders each
 * scene) and a motion model (animates each scene into a clip). This constant
 * only backs the informational badge shown above the two real pickers.
 */
export const OPENMONTAGE_ID = 'openmontage'

export const OPENMONTAGE_BADGE = {
  id: OPENMONTAGE_ID,
  label: 'OpenMontage — Scene Engine',
  note: 'Plans the scene sequence and sequencing logic. It renders nothing itself — the two models below do the actual rendering, scene by scene.',
}

/** Compound model-key suffixes for the montage deliverable's two real picks. */
export const MONTAGE_STILL_SUFFIX = '::still'
export const MONTAGE_MOTION_SUFFIX = '::motion'
export const montageStillKey = (deliverable: string) => `${deliverable}${MONTAGE_STILL_SUFFIX}`
export const montageMotionKey = (deliverable: string) => `${deliverable}${MONTAGE_MOTION_SUFFIX}`

/** Everything the user sees for the montage sizing options. */
export const MONTAGE_RATIO_LABELS: Record<string, CreativeSize> = {
  '9:16': { ratio: '9:16', label: 'Vertical', use: 'Reels / TikTok', dims: '1080×1920' },
  '1:1': { ratio: '1:1', label: 'Square', use: 'Feed', dims: '1080×1080' },
  '4:5': { ratio: '4:5', label: 'Tall feed', use: 'Meta feed — largest mobile footprint', dims: '1080×1350' },
  '16:9': { ratio: '16:9', label: 'Landscape', use: 'In-stream / YouTube', dims: '1920×1080' },
  '4:3': { ratio: '1:1', label: 'Classic', use: 'Feed', dims: '1440×1080' },
  '3:4': { ratio: '9:16', label: 'Portrait', use: 'Feed / Stories', dims: '1080×1440' },
}

/** Display metadata for every ratio any registry model can emit. */
export function sizeFor(ratio: string): CreativeSize {
  return (
    MONTAGE_RATIO_LABELS[ratio] ?? {
      ratio: ratio as CreativeSize['ratio'],
      label: ratio,
      use: 'Custom',
      dims: ratio,
    }
  )
}

const isVideoDeliverable = (d: string) => /video|ugc|montage|scene/i.test(d)
export const isMontageDeliverable = (d: string) => /montage|scene/i.test(d)

function imageOption(m: (typeof IMAGE_MODELS)[number], configured: boolean): ModelMenuOption {
  return {
    id: m.id,
    label: m.label,
    kind: 'image',
    provider: m.provider,
    aspectRatios: m.aspectRatios,
    configured,
    note: m.notes,
  }
}

function videoOption(m: (typeof VIDEO_MODELS)[number], configured: boolean): ModelMenuOption {
  return {
    id: m.id,
    label: m.label,
    kind: 'video',
    provider: m.provider,
    aspectRatios: m.aspectRatios,
    configured,
    note: m.notes,
  }
}

/**
 * Build the model menu for one deliverable. Availability lists come from
 * `/api/image/models` and `/api/video/models`; when they are still loading the
 * registries stand in with `configured: false` so the menu is never empty.
 */
export function modelMenuFor(
  deliverable: string,
  imageAvail: ImageModelAvailability[],
  videoAvail: ModelAvailability[],
): ModelMenu | null {
  // "Recommend Format" carries no model choice — the reactor decides the
  // format, the model, and the sizes downstream.
  if (/recommend format/i.test(deliverable)) return null
  // Montage has TWO real model picks (still + motion), not one — handled by
  // montageMenus() and rendered as two dedicated pickers, never this single menu.
  if (isMontageDeliverable(deliverable)) return null

  const imgConfigured = (id: string) => imageAvail.find((m) => m.id === id)?.configured ?? false
  const vidConfigured = (id: string) => videoAvail.find((m) => m.id === id)?.configured ?? false

  const imageOptions = IMAGE_MODELS.map((m) => imageOption(m, imgConfigured(m.id)))
  const videoOptions = VIDEO_MODELS.map((m) => videoOption(m, vidConfigured(m.id)))

  if (isVideoDeliverable(deliverable)) {
    const rec = recommendVideoModel(
      [deliverable],
      videoAvail.length ? videoAvail : VIDEO_MODELS.map((m) => ({ ...m, configured: false })),
    )
    return {
      deliverable,
      options: videoOptions,
      recommendedId: rec?.modelId ?? videoOptions[0].id,
      reason: rec?.reason ?? 'Flagship realism for builder-native video.',
    }
  }

  // Statics, carousels, and variation packs are stills-led.
  const rec = recommendImageModel(
    [deliverable],
    imageAvail.length ? imageAvail : IMAGE_MODELS.map((m) => ({ ...m, configured: false })),
  )
  return {
    deliverable,
    options: imageOptions,
    recommendedId: rec?.modelId ?? imageOptions[0].id,
    reason: rec?.reason ?? 'Photoreal stills with strong prompt adherence.',
  }
}

/**
 * The montage deliverable's two real model menus: a Still Model (renders each
 * scene) and a Motion Model (animates each scene). OpenMontage sequences them
 * but is never itself a pick — this is what actually answers "what model does
 * montage use."
 */
export function montageMenus(
  deliverable: string,
  imageAvail: ImageModelAvailability[],
  videoAvail: ModelAvailability[],
): { still: ModelMenu; motion: ModelMenu } {
  const imgConfigured = (id: string) => imageAvail.find((m) => m.id === id)?.configured ?? false
  const vidConfigured = (id: string) => videoAvail.find((m) => m.id === id)?.configured ?? false
  const imageOptions = IMAGE_MODELS.map((m) => imageOption(m, imgConfigured(m.id)))
  const videoOptions = VIDEO_MODELS.map((m) => videoOption(m, vidConfigured(m.id)))

  const stillRec = recommendImageModel(
    ['Static Creative'],
    imageAvail.length ? imageAvail : IMAGE_MODELS.map((m) => ({ ...m, configured: false })),
  )
  const motionRec = recommendVideoModel(
    ['Video Creative'],
    videoAvail.length ? videoAvail : VIDEO_MODELS.map((m) => ({ ...m, configured: false })),
  )

  return {
    still: {
      deliverable: montageStillKey(deliverable),
      options: imageOptions,
      recommendedId: stillRec?.modelId ?? imageOptions[0].id,
      reason: stillRec?.reason ?? 'Photoreal stills with strong prompt adherence, rendered per scene.',
    },
    motion: {
      deliverable: montageMotionKey(deliverable),
      options: videoOptions,
      recommendedId: motionRec?.modelId ?? videoOptions[0].id,
      reason: motionRec?.reason ?? 'Cinematic realism for animating each scene into a clip.',
    },
  }
}

/**
 * The dimension options for a deliverable given the chosen model — the system
 * knows every model's sizing support from the registries, so the Formats step
 * only ever offers ratios the selected model can actually render.
 */
export function sizesForModel(menu: ModelMenu | null, modelId: string | undefined): CreativeSize[] {
  if (!menu) return []
  const model =
    menu.options.find((o) => o.id === modelId) ??
    menu.options.find((o) => o.id === menu.recommendedId) ??
    menu.options[0]
  return model.aspectRatios.map(sizeFor).filter(
    // De-dupe ratios that map to the same rendered size family.
    (s, i, arr) => arr.findIndex((x) => x.ratio === s.ratio) === i,
  )
}

/** Resolve what the user actually picked ('auto' and unknown ids → recommendation). */
export function resolveModelPick(menu: ModelMenu | null, pick: string | undefined): string | null {
  if (!menu) return null
  if (pick && pick !== 'auto' && menu.options.some((o) => o.id === pick)) return pick
  return menu.recommendedId
}
