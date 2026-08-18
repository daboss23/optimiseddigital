// SPARK — Creative Intelligence. Studies winning creatives (ads, UGC, founder
// videos, testimonials) and extracts repeatable Creative DNA — patterns, not
// files. The DNA is stored back into the knowledge layer as `creative` chunks so
// OPUS can retrieve "what has already worked" on future runs.
//
// SPARK reads two ways:
//   - WRITTEN — a script, transcript, or notes (`extractCreativeDNA`).
//   - VISUAL  — the ad itself, seen by a vision model (`extractVisualDNA`):
//     the palette, the layout, where the headline sits, what it says, the
//     bullets, where the hook lands, and WHY the design stops the scroll.
//
// The visual read is what lets OPUS design the next ad rather than only write
// it — `visualDirectionBlock` (lib/taxonomy.ts) carries it into the production
// brief the image models render from.

import Anthropic from '@anthropic-ai/sdk'
import { ingestKnowledge, type IngestResult } from '@/lib/knowledge'
import { parseModelJson } from '@/lib/parse'
import { INTELLIGENCE_MODEL, VISION_MODEL } from '@/lib/models'
import { describeMeasuredPalette, reconcilePalette, type MeasuredSwatch } from '@/lib/palette'
import type { AdImage } from '@/lib/ad-image'
// Type-only, so this is erased at compile time and adds no runtime cycle with
// lib/taxonomy.ts (which imports VisualDNA from here the same way).
import type { CreativeTaxonomy } from '@/lib/taxonomy'
import { getTenant, tenantDescriptor, type TenantProfile } from '@/lib/tenant'

const MODEL = INTELLIGENCE_MODEL

/**
 * Ceiling on how many distinct ads one read dissects. A board screenshot can
 * hold dozens; past this the per-ad detail degrades and the response gets long
 * enough to risk truncation, so the read stays honest about what it covered.
 */
export const MAX_ADS_PER_READ = 12

// The repeatable pattern categories SPARK classifies winning creatives into.
export const CREATIVE_PATTERNS = [
  'Member Win',
  'Identity Shift',
  'Profit Leak',
  'Authority Builder',
  'Event Promotion',
  'Founder Story',
  'Problem Agitation',
  'Systems Transformation',
  'Time Freedom',
  'Leadership Evolution',
] as const

export interface CreativeDNA {
  hook: string
  opening: string
  storyStructure: string
  ctaStructure: string
  editingStyle: string
  offerPresentation: string
  visualStyle: string
  patternType: string
  creativeCategory: string
  summary: string
}

export interface SparkSource {
  url?: string
  platform?: string
  title?: string
}

/* ------------------------------- Visual DNA -------------------------------- */

/** The vertical bands a designer lays an ad out in, top to bottom. */
export const LAYOUT_ZONES = [
  'top',
  'upper-middle',
  'middle',
  'lower-middle',
  'bottom',
  'full-bleed',
] as const
export type LayoutZone = (typeof LAYOUT_ZONES)[number]

/** One colour pulled off the creative, with the job it does in the design. */
export interface ColorSwatch {
  /** `#rrggbb`. */
  hex: string
  /** e.g. "Background", "Headline text", "CTA button", "Accent / highlight". */
  role: string
}

/** One placed element — what it is, what it says, and where it sits. */
export interface LayoutElement {
  /** e.g. "Headline", "Hook", "Bullets", "CTA button", "Logo", "Subject". */
  element: string
  /** The words actually on the ad. Empty for purely visual elements. */
  text: string
  /** Where it sits, in a designer's words ("top third, left-aligned"). */
  position: string
  /** Coarse vertical band, for the layout map. */
  zone: LayoutZone
  /** How it is styled — weight, case, colour, any scrim or container behind it. */
  treatment: string
}

/**
 * The design read of a winning ad: everything OPUS needs to reproduce the
 * STRUCTURE of what worked — palette, layout, placement, hierarchy — without
 * copying the ad itself.
 */
export interface VisualDNA {
  /** e.g. "Static image ad, 1:1, text-led top third." */
  format: string
  /** Best-guess placement ratio: "1:1", "4:5", "9:16", "16:9". */
  aspectRatio: string
  /** The layout archetype, e.g. "Split: headline block over photo." */
  layout: string
  /** Every placed element, in reading order. */
  elements: LayoutElement[]
  /** The palette, most dominant first. */
  palette: ColorSwatch[]
  /** Type treatment — families, weights, case, size contrast. */
  typography: string
  /** The photography/illustration: subject, setting, light, treatment. */
  imagery: string
  /** The path the eye travels, first fixation to CTA. */
  focalFlow: string
  /** How much of the frame is text vs image. */
  textDensity: string
  /** The single device that makes it pop in-feed (contrast, colour, face…). */
  contrastDevice: string
  /** Why this design stops the scroll — the mechanism, not a compliment. */
  scrollStopReason: string
  /** The transferable design rules worth reusing. */
  designPrinciples: string[]
  /** How to rebuild this design for a different brand and offer. */
  replicationNotes: string
}

/* ------------------------------- Heuristics -------------------------------- */

function heuristicDNA(text: string): CreativeDNA {
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 140) ?? 'Winning creative'
  const t = text.toLowerCase()
  const patternType =
    /profit|margin|leak/.test(t)
      ? 'Profit Leak'
      : /time|freedom|hours|weekend|family/.test(t)
        ? 'Time Freedom'
        : /system|process|sop|chaos/.test(t)
          ? 'Systems Transformation'
          : /member|client|result|case study/.test(t)
            ? 'Member Win'
            : /founder|story|journey/.test(t)
              ? 'Founder Story'
              : 'Authority Builder'
  return {
    hook: firstLine,
    opening: 'Pattern interrupt → relatable builder scene.',
    storyStructure: 'Problem → turning point → transformation → proof.',
    ctaStructure: 'Soft qualifying CTA to the next step.',
    editingStyle: 'Fast-cut, captioned, mobile-first.',
    offerPresentation: 'Outcome-led, proof-backed.',
    visualStyle: 'On-site, high-contrast, authentic.',
    patternType,
    creativeCategory: patternType,
    summary: firstLine,
  }
}

/**
 * A structurally valid Visual DNA used when the vision read is unavailable, so
 * the UI and the downstream design block always have a coherent shape to
 * render. This is a SAMPLE, never a read of the user's ad — callers must carry
 * `live: false` through to the UI so it can never be mistaken for one. When the
 * browser measured the upload's real colours they are used here, because those
 * ARE from the ad even when nothing else is.
 */
function heuristicVisualDNA(measured: MeasuredSwatch[] = []): VisualDNA {
  const palette = measured.length
    ? measured.map((m) => ({ hex: m.hex, role: 'Measured from the upload' }))
    : null
  return {
    format: 'Static image ad, text-led.',
    aspectRatio: '1:1',
    layout: 'Headline block above a real-world photo, CTA anchored bottom.',
    elements: [
      {
        element: 'Headline',
        text: '',
        position: 'Top third, left-aligned',
        zone: 'top',
        treatment: 'Heavy sans, high contrast against a darkened scrim',
      },
      {
        element: 'Subject',
        text: '',
        position: 'Centre, filling the frame',
        zone: 'middle',
        treatment: 'Documentary photography, natural light',
      },
      {
        element: 'CTA',
        text: '',
        position: 'Bottom, centred',
        zone: 'bottom',
        treatment: 'Solid accent button with short imperative label',
      },
    ],
    palette: palette ?? [
      { hex: '#0a0a0a', role: 'Background' },
      { hex: '#ffffff', role: 'Headline text' },
      { hex: '#f59e0b', role: 'Accent / CTA' },
    ],
    typography: 'Condensed bold headline, regular-weight supporting copy.',
    imagery: 'Authentic on-site photography rather than stock.',
    focalFlow: 'Headline → subject → CTA.',
    textDensity: 'Roughly one third text, two thirds image.',
    contrastDevice: 'Bright accent against a dark, low-noise field.',
    scrollStopReason: 'High-contrast headline reads in-feed at thumbnail size.',
    designPrinciples: [
      'Reserve a clear text zone — never let type fight the photo.',
      'One accent colour, used only for the action.',
      'Headline must be legible at thumbnail scale.',
    ],
    replicationNotes:
      'Keep the zone structure and contrast discipline; swap subject, palette and copy for the brand.',
  }
}

/* ----------------------------- Prompt fragments ---------------------------- */

const DNA_KEYS =
  '{"hook":"...","opening":"...","storyStructure":"...","ctaStructure":"...","editingStyle":"...","offerPresentation":"...","visualStyle":"...","patternType":"...","creativeCategory":"...","summary":"..."}'

const VISUAL_KEYS = `{"format":"...","aspectRatio":"1:1|4:5|9:16|16:9","layout":"...","elements":[{"element":"Headline|Hook|Bullets|CTA|Logo|Subject|Badge|Proof","text":"the exact words on the ad, or empty string","position":"e.g. top third, left-aligned","zone":"top|upper-middle|middle|lower-middle|bottom|full-bleed","treatment":"weight, case, colour, any scrim behind it"}],"palette":[{"hex":"#rrggbb","role":"Background|Headline text|CTA button|Accent"}],"typography":"...","imagery":"...","focalFlow":"...","textDensity":"...","contrastDevice":"...","scrollStopReason":"...","designPrinciples":["...","..."],"replicationNotes":"..."}`

/**
 * SPARK's identity, addressed to whichever business this deployment serves.
 * Built per call rather than as a constant: naming a fixed company here made
 * SPARK read every uploaded ad as if it were for that company's market.
 */
function sparkSystemBase(tenant: TenantProfile): string {
  return `You are SPARK, the Creative Intelligence layer for ${tenantDescriptor(
    tenant,
  )}. You study creatives that have ALREADY WON and extract their repeatable DNA — the structure, never the words.`
}

function visionSystemPrompt(
  count: number,
  hasMeasuredPalette: boolean,
  tenant: TenantProfile,
): string {
  // With measured colours in the prompt the palette is a LABELLING job, not a
  // sampling job — the model stops guessing hexes and starts naming what each
  // real colour does. Without them it has to estimate, and is told to say so.
  const paletteRules = hasMeasuredPalette
    ? `PALETTE — the colours below each image were sampled from its actual pixels. They are ground truth.
- Every hex in "palette" MUST be copied exactly from that image's measured list. Never invent a hex, never round one to a "nicer" value.
- Give each one the JOB it does in the design: Background, Headline text, Highlight block behind the headline, CTA button, Badge, Bullet tick, Product, and so on.
- Account for EVERY vivid measured colour. A saturated colour covering only a few percent of the frame is almost always the scroll-stop device — a red band behind one word, a yellow CTA pill, a green tick row. Dropping it is the single worst mistake you can make here.
- On a multi-ad sheet the measured list spans the whole screenshot, so assign each colour to the ad that actually uses it and leave it off the others.`
    : `PALETTE — no measured colours are available for these images, so estimate the hexes as accurately as you can and prefer naming the vivid accent colours over the neutrals.`

  return `${sparkSystemBase(tenant)}

You are looking at ${count > 1 ? `${count} images` : 'an image'} of winning ad creatives. Read them the way a senior art director reverse-engineers a competitor's control ads.

FIRST, SEPARATE THE ADS. An image may hold ONE ad, or it may be a screenshot of a board, swipe file, ad-library grid or contact sheet holding SEVERAL distinct ads laid out in a grid. Identify every distinct ad creative across everything you are shown, and analyze EACH ONE SEPARATELY.
- One entry per distinct ad. NEVER merge two different ads into a single entry, and never split one ad into several.
- A single ad keeps its own panels together: a before/after pair, a multi-panel comparison, or a carousel frame set belongs to ONE ad.
- Give each entry a short "label" that identifies it by position and a distinguishing feature ("Top-left — orange headline, hard-hat photo") so a human can match the entry to the ad on screen.
- Work left-to-right, top-to-bottom.
- Analyze at most ${MAX_ADS_PER_READ} ads. If there are more, take the ${MAX_ADS_PER_READ} most prominent and say so in the last entry's replicationNotes.

THEN, FOR EACH AD, report what is ACTUALLY THERE — never invent an element you cannot see:
- Transcribe on-ad copy VERBATIM into each element's "text" (headline, hook, bullets, CTA label, badges). Keep the original line breaks and casing. If an element is absent, omit it rather than inventing it.
- Locate every element by zone and describe its treatment precisely enough to rebuild the layout without the original.
- When type sits inside a coloured block, band, highlight or pill, SAY SO and name that block's colour in the treatment. Highlighting one word of a headline in a hot colour is a deliberate device, and rebuilding the ad without it loses the design.
- Explain the scroll-stop MECHANISM (contrast, face, colour break, type scale) — not praise.
- If an ad is too small or too low-resolution to read its copy reliably, still report the layout and palette, and say so plainly in that ad's replicationNotes rather than guessing at the words.

${paletteRules}

Classify each ad's patternType as ONE of: ${CREATIVE_PATTERNS.join(', ')}.

Reply with ONLY a JSON object, no prose, no markdown fences:
{"ads":[{"label":"...","dna":${DNA_KEYS},"visual":${VISUAL_KEYS}}]}`
}

/* ------------------------------- Normalising -------------------------------- */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function normaliseHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = HEX.exec(raw.trim())
  if (!m) return null
  const body = m[1]!.toLowerCase()
  return `#${body.length === 3 ? body.replace(/./g, (c) => c + c) : body}`
}

function normaliseZone(raw: unknown): LayoutZone {
  const v = String(raw ?? '').trim().toLowerCase()
  return (LAYOUT_ZONES as readonly string[]).includes(v) ? (v as LayoutZone) : 'middle'
}

function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : fallback
}

function strList(raw: unknown, limit = 6): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => str(v)).filter(Boolean).slice(0, limit)
}

/**
 * Coerce a model's visual object into a valid VisualDNA, filling any gaps.
 *
 * `measured` is the palette sampled from the real pixels. Reported colours are
 * snapped onto it, and on a single-ad read any measured colour the model missed
 * is added back — so the design read can no longer be missing a colour that is
 * plainly on the ad.
 */
function normaliseVisual(
  raw: Partial<VisualDNA> | undefined,
  measured: MeasuredSwatch[] = [],
  singleAd = false,
): VisualDNA {
  const fb = heuristicVisualDNA(measured)
  if (!raw || typeof raw !== 'object') return fb

  const elements: LayoutElement[] = Array.isArray(raw.elements)
    ? raw.elements
        .map((e) => ({
          element: str((e as LayoutElement)?.element),
          text: str((e as LayoutElement)?.text),
          position: str((e as LayoutElement)?.position, 'unspecified'),
          zone: normaliseZone((e as LayoutElement)?.zone),
          treatment: str((e as LayoutElement)?.treatment, 'unspecified'),
        }))
        .filter((e) => e.element)
        .slice(0, 12)
    : []

  const reported: ColorSwatch[] = Array.isArray(raw.palette)
    ? raw.palette
        .map((c) => ({ hex: normaliseHex((c as ColorSwatch)?.hex), role: str((c as ColorSwatch)?.role, 'Colour') }))
        .filter((c): c is ColorSwatch => Boolean(c.hex))
        .slice(0, 8)
    : []

  // Fill only on a single-ad read: on a board screenshot the measured palette
  // spans every creative on the sheet, so a neighbour's colour must not be
  // grafted onto this ad.
  const palette = reconcilePalette(reported, measured, { fill: singleAd }) as ColorSwatch[]

  return {
    format: str(raw.format, fb.format),
    aspectRatio: str(raw.aspectRatio, fb.aspectRatio),
    layout: str(raw.layout, fb.layout),
    elements: elements.length ? elements : fb.elements,
    palette: palette.length ? palette : fb.palette,
    typography: str(raw.typography, fb.typography),
    imagery: str(raw.imagery, fb.imagery),
    focalFlow: str(raw.focalFlow, fb.focalFlow),
    textDensity: str(raw.textDensity, fb.textDensity),
    contrastDevice: str(raw.contrastDevice, fb.contrastDevice),
    scrollStopReason: str(raw.scrollStopReason, fb.scrollStopReason),
    designPrinciples: strList(raw.designPrinciples).length
      ? strList(raw.designPrinciples)
      : fb.designPrinciples,
    replicationNotes: str(raw.replicationNotes, fb.replicationNotes),
  }
}

function mergeDNA(parsed: Partial<CreativeDNA> | undefined, fallback: CreativeDNA): CreativeDNA {
  const p = parsed ?? {}
  return {
    hook: str(p.hook, fallback.hook),
    opening: str(p.opening, fallback.opening),
    storyStructure: str(p.storyStructure, fallback.storyStructure),
    ctaStructure: str(p.ctaStructure, fallback.ctaStructure),
    editingStyle: str(p.editingStyle, fallback.editingStyle),
    offerPresentation: str(p.offerPresentation, fallback.offerPresentation),
    visualStyle: str(p.visualStyle, fallback.visualStyle),
    patternType: str(p.patternType, fallback.patternType),
    creativeCategory: str(p.creativeCategory, str(p.patternType, fallback.creativeCategory)),
    summary: str(p.summary, fallback.summary),
  }
}

/* -------------------------------- Extraction -------------------------------- */

// Extract Creative DNA from a creative's transcript/description/notes. Never
// throws — falls back to a heuristic read so the platform always works.
export async function extractCreativeDNA(text: string): Promise<CreativeDNA> {
  const trimmed = text.trim()
  if (!process.env.ANTHROPIC_API_KEY || trimmed.length < 40) {
    return heuristicDNA(trimmed)
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: `${sparkSystemBase(await getTenant())} Study the winning creative below and extract its repeatable Creative DNA — the structure, not the words. Classify patternType as ONE of: ${CREATIVE_PATTERNS.join(', ')}. Reply with ONLY a JSON object, no prose.`,
      messages: [
        {
          role: 'user',
          content: `Winning creative (transcript / description / notes):\n"""${trimmed.slice(0, 6000)}"""\n\nReturn JSON with exactly these keys, each a tight phrase:\n${DNA_KEYS}`,
        },
      ],
    })
    const out = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    return mergeDNA(parseModelJson<Partial<CreativeDNA>>(out), heuristicDNA(trimmed))
  } catch (err) {
    console.error('SPARK DNA extraction failed, using heuristic:', err)
    return heuristicDNA(trimmed)
  }
}

/** One distinct ad creative found in the uploaded images, read on its own. */
export interface AnalyzedAd {
  /** Identifies the ad by position + a distinguishing feature. */
  label: string
  dna: CreativeDNA
  visual: VisualDNA
}

export interface VisualAnalysis {
  /** One entry per distinct ad detected. Never empty. */
  ads: AnalyzedAd[]
  /**
   * True only when a vision model actually LOOKED at the creative. False means
   * `ads` is a structurally valid sample, not a read of the user's ad — callers
   * must surface that rather than presenting it as a teardown, and must not
   * store it as knowledge.
   */
  live: boolean
  /** Why the read isn't live, in words a strategist can act on. */
  reason?: string
  /** The colours measured from the pixels, when the browser sampled them. */
  measured: MeasuredSwatch[]
}

/**
 * SEE winning ads. Sends the creative(s) to the vision model and returns the
 * written Creative DNA and the design read together, extracted from the same
 * evidence so copy structure and layout can never disagree.
 *
 * Handles a board/contact-sheet screenshot holding SEVERAL ads: each distinct
 * creative is separated and dissected on its own rather than blurred into one
 * averaged pattern. `context` is optional supporting text that sharpens the
 * read. Never throws.
 */
export async function extractVisualDNA(
  images: AdImage[],
  context = '',
): Promise<VisualAnalysis> {
  // Every colour measured across the uploads, biggest first. A single upload is
  // the common case and the one where fill-back is safe.
  const measured = images
    .flatMap((img) => img.palette ?? [])
    .sort((a, b) => b.share - a.share)

  const sample = (reason: string): VisualAnalysis => ({
    ads: [
      {
        label: 'Sample ad',
        dna: heuristicDNA(context || 'Winning ad creative'),
        visual: heuristicVisualDNA(measured),
      },
    ],
    live: false,
    reason,
    measured,
  })

  if (!images.length) return sample('No image reached SPARK, so there was nothing to look at.')
  if (!process.env.ANTHROPIC_API_KEY) {
    return sample(
      'ANTHROPIC_API_KEY is not configured, so no vision model looked at this ad. What follows is a sample structure, not a read of your creative.',
    )
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const content: Anthropic.ContentBlockParam[] = []
    images.forEach((img, i) => {
      // Label each image so the model can cite which one an ad came from when
      // several sheets are uploaded at once.
      if (images.length > 1) content.push({ type: 'text', text: `Image ${i + 1}:` })
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data },
      })
      // The measured palette rides directly after its own image so there is no
      // ambiguity about which sheet the colours belong to.
      if (img.palette?.length) {
        content.push({
          type: 'text',
          text: `Colours measured from the pixels of ${
            images.length > 1 ? `Image ${i + 1}` : 'this image'
          } (ground truth — copy these hexes exactly):\n${describeMeasuredPalette(img.palette)}`,
        })
      }
    })
    content.push({
      type: 'text',
      text: context.trim()
        ? `Supporting context from the strategist (use it, but the IMAGE is the source of truth for anything visual):\n"""${context.trim().slice(0, 4000)}"""\n\nSeparate every distinct ad and return the JSON object now.`
        : 'Separate every distinct ad and return the JSON object now.',
    })

    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      // Scales with how many ads a sheet can hold — a 12-ad teardown is long.
      max_tokens: 8000,
      system: visionSystemPrompt(images.length, measured.length > 0, await getTenant()),
      messages: [{ role: 'user', content }],
    })

    const out = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const parsed = parseModelJson<{
      ads?: { label?: string; dna?: Partial<CreativeDNA>; visual?: Partial<VisualDNA> }[]
    }>(out)

    const found = Array.isArray(parsed?.ads) ? parsed.ads.slice(0, MAX_ADS_PER_READ) : []
    const singleAd = found.length === 1 && images.length === 1
    const ads: AnalyzedAd[] = found.map((a, i) => ({
      label: str(a?.label, `Ad ${i + 1}`),
      dna: mergeDNA(a?.dna, heuristicDNA(context || `Winning ad creative ${i + 1}`)),
      visual: normaliseVisual(a?.visual, measured, singleAd),
    }))

    // A well-formed response with zero ads means nothing ad-like was found. Say
    // that plainly instead of handing back an invented teardown.
    return ads.length
      ? { ads, live: true, measured }
      : sample('The vision read found no ad creative in that image. Try a fuller screenshot of the ad.')
  } catch (err) {
    console.error('SPARK visual analysis failed:', err)
    return sample(
      `The vision read failed — ${
        err instanceof Error ? err.message : 'unknown error'
      }. Nothing below was read from your ad.`,
    )
  }
}

/* -------------------------------- Persistence ------------------------------- */

/** Render a Visual DNA as the retrievable lines stored in the knowledge layer. */
export function visualDnaLines(visual: VisualDNA): string[] {
  const lines = [
    `Format: ${visual.format} (${visual.aspectRatio})`,
    `Layout: ${visual.layout}`,
    `Palette: ${visual.palette.map((c) => `${c.hex} ${c.role}`).join(', ')}`,
    `Typography: ${visual.typography}`,
    `Imagery: ${visual.imagery}`,
    `Eye flow: ${visual.focalFlow}`,
    `Text density: ${visual.textDensity}`,
    `Contrast device: ${visual.contrastDevice}`,
    `Scroll-stop mechanism: ${visual.scrollStopReason}`,
  ]
  for (const el of visual.elements) {
    lines.push(
      `Element — ${el.element}: ${el.position} (${el.zone}); ${el.treatment}${
        el.text ? `; reads "${el.text}"` : ''
      }`,
    )
  }
  if (visual.designPrinciples.length) {
    lines.push(`Design principles: ${visual.designPrinciples.join(' | ')}`)
  }
  lines.push(`Replication: ${visual.replicationNotes}`)
  return lines
}

// Persist extracted Creative DNA into the knowledge layer as a `creative` chunk.
// When a visual read is supplied, the design intelligence is stored alongside it
// so retrieval surfaces layout and palette, not just copy structure.
//
// The design is written TWICE on purpose: as prose in the chunk body, which is
// what gets embedded and retrieved semantically, and as the exact VisualDNA
// object in `metadata.visualDna`, which is what lib/visual-library.ts reads back
// to hand a real design — palette, zones, placements — to a future run. Prose
// alone would force the orchestrator to re-derive a layout from a paragraph.
export async function storeCreativeDNA(
  dna: CreativeDNA,
  source: SparkSource,
  builderId: string | null = null,
  visual?: VisualDNA | null,
  taxonomy?: CreativeTaxonomy,
): Promise<IngestResult> {
  const title = source.title?.trim() || dna.summary.slice(0, 80) || `Creative DNA — ${dna.patternType}`
  const content = [
    `Pattern: ${dna.patternType}`,
    `Category: ${dna.creativeCategory}`,
    `Hook: ${dna.hook}`,
    `Opening: ${dna.opening}`,
    `Story structure: ${dna.storyStructure}`,
    `CTA structure: ${dna.ctaStructure}`,
    `Editing style: ${dna.editingStyle}`,
    `Offer presentation: ${dna.offerPresentation}`,
    `Visual style: ${dna.visualStyle}`,
    ...(visual ? ['', 'VISUAL DESIGN DNA', ...visualDnaLines(visual)] : []),
    source.url ? `Source: ${source.url}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return ingestKnowledge({
    // A read that SAW the ad is design knowledge and files under `design`; a
    // text-only read of a script is creative knowledge and stays in `creative`.
    // SPARK consults both, so nothing is lost either way.
    system: visual ? 'design' : 'creative',
    category: dna.patternType,
    title,
    content,
    builderId,
    metadata: {
      source: 'spark',
      platform: source.platform ?? 'Meta Ads',
      url: source.url ?? null,
      visual: visual ? 'true' : 'false',
      // The structured design, kept verbatim so a later run can rebuild this
      // layout exactly rather than paraphrasing it out of the prose above.
      visualDna: visual ?? null,
      pattern: dna.patternType,
      taxonomy: taxonomy ?? null,
      summary: dna.summary,
    },
  })
}
