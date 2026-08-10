// Instant clone — take the design SPARK just read off a winning ad and rebuild
// it as a finished Meta ad for THIS business and THIS offer, in one call.
//
// Two steps, one request:
//   1. WRITE — Claude fills the reference's element slots with fresh on-brand
//      copy (the headline that fits the headline zone, the words that go in the
//      highlight block, the CTA label) and composes the render prompt that
//      reproduces the layout, palette and contrast device.
//   2. RENDER — the image oven renders that prompt on whichever provider is
//      configured, falling through providers automatically.
//
// The reference's WORDS are never reproduced — its structure is. That is the
// difference between cloning a proven design and copying someone's ad.
//
// Never throws: with no Anthropic key the prompt is composed deterministically
// from the design read, and with no image provider the prompt and copy are
// still returned so the strategist can render them anywhere.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getBrandMemory } from '@/lib/brand-memory'
import { generateImageDetailed, type AspectRatio } from '@/lib/image'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import { parseModelJson } from '@/lib/parse'
import { visualDirectionBlock } from '@/lib/taxonomy'
import type { CreativeDNA, VisualDNA } from '@/lib/spark'

export const runtime = 'nodejs'
export const maxDuration = 120

/** The copy that goes ON the cloned ad, slot by slot. */
interface CloneCopy {
  /** The main headline, in the reference's headline zone. */
  headline: string
  /** The word or phrase that sits inside the highlight block, if the design has one. */
  highlight: string
  /** Supporting line / bullets, in the reference's support zone. */
  support: string[]
  /** The CTA label on the button or bar. */
  cta: string
}

interface CloneResult {
  copy: CloneCopy
  /** The full render prompt handed to the image model. */
  prompt: string
  /** Why this rebuild keeps the reference's scroll-stop working. */
  rationale: string
}

/**
 * The image oven speaks 1:1 / 9:16 / 16:9 / 4:3 / 3:4. Meta designs are often
 * read as 4:5, which no provider declares — snap it to the nearest portrait
 * rather than dropping the design's orientation.
 */
function toRenderRatio(raw: string | undefined): AspectRatio {
  const value = (raw ?? '').trim()
  if (value === '1:1' || value === '9:16' || value === '16:9' || value === '4:3' || value === '3:4') {
    return value
  }
  if (value === '4:5' || value === '2:3') return '3:4'
  if (value === '5:4' || value === '3:2') return '4:3'
  return '1:1'
}

/** The words already on the reference, so the writer matches ROLE and LENGTH. */
function referenceSlots(visual: VisualDNA): string {
  const slots = visual.elements
    .filter((e) => e.text.trim())
    .map(
      (e) =>
        `- ${e.element} (${e.zone}, ${e.position}) — reference reads "${e.text}" (${e.text.length} chars). Match the JOB and the LENGTH, not the words.`,
    )
  return slots.length ? slots.join('\n') : '- The reference carries no readable on-ad copy; write the minimum the layout needs.'
}

/**
 * A render prompt built straight from the design read, with no model in the
 * loop. Used when no Anthropic key is configured — the clone still renders,
 * it just carries generic copy the strategist replaces.
 */
/**
 * The literal-text guard: names the exact strings the render must set and bans
 * everything else. Image models only spell correctly when the copy is quoted,
 * short, and explicitly marked as characters to reproduce.
 */
const RENDER_TEXT_GUARD = (copy: CloneCopy): string =>
  [
    'ON-IMAGE TEXT — reproduce these strings exactly, character for character:',
    `1. Headline — "${copy.headline}"`,
    `2. CTA button — "${copy.cta}"`,
    'Sharp, correctly-kerned, correctly-spelled type, legible at thumbnail size. Render no other text anywhere in the image: no fine print, no captions, no logos, no watermarks, no invented or garbled lettering.',
  ].join('\n')

function deterministicPrompt(visual: VisualDNA, goal: string, copy: CloneCopy): string {
  const palette = visual.palette.map((c) => `${c.hex} (${c.role})`).join(', ')
  const placements = visual.elements
    .map((e) => `${e.element} in the ${e.zone} zone, ${e.position}, ${e.treatment}`)
    .join('; ')
  return [
    `A finished ${visual.aspectRatio} Meta ad creative for: ${goal}.`,
    `Layout: ${visual.layout}. ${visual.format}`,
    `Element placement: ${placements}.`,
    `Palette, used in exactly these roles: ${palette}.`,
    `Typography: ${visual.typography}.`,
    `Imagery: ${visual.imagery}.`,
    `Contrast device: ${visual.contrastDevice}. Eye flow: ${visual.focalFlow}. Text density: ${visual.textDensity}.`,
    `On-ad text, rendered exactly: headline "${copy.headline}"${
      copy.highlight ? `, with "${copy.highlight}" set inside a solid highlight block` : ''
    }${copy.support.length ? `, supporting line "${copy.support[0]}"` : ''}, CTA button labelled "${copy.cta}".`,
    'Sharp, legible type at thumbnail size. No watermark, no logo, no lorem ipsum, no gibberish text.',
  ].join(' ')
}

/** A usable copy set when the writer is unavailable or returns nothing. */
function fallbackCopy(goal: string, visual: VisualDNA): CloneCopy {
  const cta = visual.elements.find((e) => /cta|button/i.test(e.element))?.text?.trim()
  return {
    headline: goal.slice(0, 60) || 'Built for builders',
    highlight: '',
    support: [],
    cta: cta && cta.length <= 20 ? cta : 'Learn more',
  }
}

async function writeClone(
  visual: VisualDNA,
  dna: CreativeDNA | undefined,
  goal: string,
): Promise<CloneResult> {
  const fallback = fallbackCopy(goal, visual)

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      copy: fallback,
      prompt: deterministicPrompt(visual, goal, fallback),
      rationale:
        'Composed from the design read alone — set ANTHROPIC_API_KEY to have the copy written into each slot.',
    }
  }

  const brand = getBrandMemory()

  const system = `You are SPARK's clone designer for The Professional Builder. You are handed the DESIGN of an ad that has already won, and you rebuild it for a different business and offer.

RULES:
- Reproduce the STRUCTURE — zones, placement, palette roles, contrast device, eye flow. Never reproduce the reference's words, brand, product or logo.
- Copy must FIT its slot. A headline written for a two-line headline zone breaks the design at four lines.
- If the reference sets one word inside a coloured highlight block, keep that device and choose the word that most deserves it.
- Write to the brand memory below. If it is empty, write to the goal alone.
- The render prompt must describe a FINISHED ad — layout, palette hexes in their roles, typography, imagery, and every piece of on-ad text quoted exactly so the image model sets it.

Reply with ONLY a JSON object, no prose, no markdown fences:
{"headline":"...","highlight":"the word/phrase inside the highlight block, or empty string","support":["..."],"cta":"...","imagePrompt":"...","rationale":"one sentence on why this keeps the reference's scroll-stop working"}`

  const user = [
    `WHAT THIS AD IS FOR:\n${goal}`,
    brand ? `BRAND MEMORY:\n${brand.slice(0, 6000)}` : '',
    dna
      ? `THE REFERENCE'S COPY STRUCTURE:\nHook: ${dna.hook}\nStory: ${dna.storyStructure}\nCTA: ${dna.ctaStructure}\nOffer: ${dna.offerPresentation}`
      : '',
    visualDirectionBlock(visual),
    `THE REFERENCE'S FILLED SLOTS — write the equivalent for this business:\n${referenceSlots(visual)}`,
    'Return the JSON object now.',
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: 1600,
      system,
      messages: [{ role: 'user', content: user }],
    })
    const out = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const parsed = parseModelJson<{
      headline?: string
      highlight?: string
      support?: string[]
      cta?: string
      imagePrompt?: string
      rationale?: string
    }>(out)

    const copy: CloneCopy = {
      headline: parsed?.headline?.trim() || fallback.headline,
      highlight: parsed?.highlight?.trim() || '',
      support: Array.isArray(parsed?.support)
        ? parsed.support.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
        : [],
      cta: parsed?.cta?.trim() || fallback.cta,
    }

    return {
      copy,
      // Whatever the writer returns still gets the literal-text guard appended —
      // a model-authored prompt that merely mentions the copy renders it as
      // gibberish. `deterministicPrompt` already carries the guard.
      prompt: parsed?.imagePrompt?.trim()
        ? `${parsed.imagePrompt.trim()}\n\n${RENDER_TEXT_GUARD(copy)}`
        : deterministicPrompt(visual, goal, copy),
      rationale: parsed?.rationale?.trim() || '',
    }
  } catch (err) {
    console.error('SPARK clone write failed, composing from the design read:', err)
    return {
      copy: fallback,
      prompt: deterministicPrompt(visual, goal, fallback),
      rationale: '',
    }
  }
}

/**
 * POST /api/spark/clone — rebuild a read design as a finished ad.
 *
 * Body: { visual, dna?, goal, aspectRatio?, model? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      visual?: VisualDNA
      dna?: CreativeDNA
      goal?: string
      aspectRatio?: string
      model?: string
    }

    const visual = body.visual
    if (!visual || !Array.isArray(visual.elements) || !visual.layout) {
      return NextResponse.json(
        { success: false, error: 'No design read supplied — analyze an ad first.' },
        { status: 400 },
      )
    }

    const goal =
      body.goal?.trim() ||
      'The Professional Builder — coaching that helps trades and construction business owners fix their margin and get their time back.'

    const ratio = toRenderRatio(body.aspectRatio || visual.aspectRatio)
    const { copy, prompt, rationale } = await writeClone(visual, body.dna, goal)
    const { image, error } = await generateImageDetailed(body.model, prompt, ratio)

    return NextResponse.json({
      success: true,
      imageUrl: image?.imageUrl ?? null,
      model: image?.modelId ?? null,
      provider: image?.provider ?? null,
      aspectRatio: ratio,
      copy,
      prompt,
      rationale,
      // The render can fail while the clone brief is still perfectly useful, so
      // this is a note rather than a failure.
      renderError: image ? undefined : error ?? 'No image provider is configured',
    })
  } catch (err) {
    console.error('SPARK clone error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Clone failed' },
      { status: 500 },
    )
  }
}
