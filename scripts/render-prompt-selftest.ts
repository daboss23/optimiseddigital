/**
 * Render-prompt self-test — guards the on-image spelling fix.
 *
 * The failure this locks down is real and shipped: production briefs were
 * flattened into one paragraph, handing the image model five quoted strings
 * buried in prose. Headlines came back as "NOT DISORGARUSED", subheads merged
 * into nonsense, and the fine-print strip rendered as pure noise — while the
 * CTA, being short and isolated, came out almost perfect. That contrast is the
 * whole lesson, and these assertions encode it.
 *
 * Run: npx tsx scripts/render-prompt-selftest.ts
 */

import {
  compileRenderPrompt,
  enforceSingleFrame,
  MAX_RENDERED_TEXT_BLOCKS,
  MAX_RENDERED_TEXT_CHARS,
  ON_IMAGE_TEXT_MARKER,
  type RenderBrand,
} from '@/lib/render-prompt'
import type { ProductionBrief } from '@/lib/reactor-inputs'
import { promptCarriesCopy } from '@/lib/image'
import {
  MIN_VISUAL_RELEVANCE,
  rankVisualReferences,
  type StoredVisualReference,
} from '@/lib/visual-library'
import type { VisualDNA } from '@/lib/spark'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// The exact brief behind the garbled render.
const brief: ProductionBrief = {
  creativeType: '1:1 Static',
  pattern: 'Time Freedom',
  audience: 'Cold, Solution-Aware trades business owners',
  awareness: 'Solution-Aware',
  frames: [
    {
      label: 'Frame 1 — Scene',
      description:
        'Real builder in hi-vis at a cluttered night-time site-office desk, laptop glow, paper invoices stacked. Dark #0a0a0a field top third and left margin for text.',
    },
    {
      label: 'Frame 2 — Headline (top third)',
      description:
        'Condensed bold white: "NOT DISORGANISED. JUST MISSING ONE SYSTEM." The word "ONE" set in amber (#f59e0b).',
    },
    {
      label: 'Frame 3 — Subhead',
      description: 'White line beneath: "The admin that eats 15 hrs/week isn’t a discipline problem."',
    },
    { label: 'Frame 4 — Proof chip', description: 'Amber-outlined chip lower left: "Reclaim 15 hrs/wk + $2,000/mo"' },
    {
      label: 'Frame 5 — CTA button',
      description: 'Solid amber (#f59e0b) button, bottom-centered, dark text: "Get the AI Agent Blueprint"',
    },
    {
      label: 'Frame 6 — Disclaimer',
      description:
        'Tiny grey text bottom edge (safe zone): "Results are individual and not typical. Building a business involves risk."',
    },
  ],
}

console.log('\nRender prompt — text discipline')
const r = compileRenderPrompt(brief, 'fallback')

check('the copy is listed literally, not left buried in prose', r.prompt.includes(ON_IMAGE_TEXT_MARKER))
check(
  `at most ${MAX_RENDERED_TEXT_BLOCKS} text blocks are asked for`,
  r.rendered.length <= MAX_RENDERED_TEXT_BLOCKS,
  `got ${r.rendered.length}`,
)
check(
  `rendered copy stays inside the ${MAX_RENDERED_TEXT_CHARS}-char budget`,
  r.rendered.reduce((n, t) => n + t.text.length, 0) <= MAX_RENDERED_TEXT_CHARS,
)
check('the headline wins the first slot', r.rendered[0]?.text.startsWith('NOT DISORGANISED'))
check(
  'the CTA wins the second slot (it is not crowded out by the subhead)',
  r.rendered[1]?.text === 'Get the AI Agent Blueprint',
)
check(
  'an emphasised word inside the headline is a treatment, not a second block',
  !r.rendered.some((t) => t.text === 'ONE') && r.rendered[0]?.placement?.includes('ONE') === true,
)
check(
  'the fine print is dropped from the render, with a reason',
  r.omitted.some((o) => o.text.startsWith('Results are individual') && Boolean(o.omittedReason)),
)
check('nothing is silently lost — every string is rendered or reported', r.rendered.length + r.omitted.length === 5)
check('the model is told to render no other text', /Render NO other text/.test(r.prompt))
check(
  'copy is never duplicated between the scene and the text block',
  !r.prompt.split(ON_IMAGE_TEXT_MARKER)[0].includes('NOT DISORGANISED'),
)
check('the oven can see this render carries copy', promptCarriesCopy(r.prompt))

console.log('\nRender prompt — a brief with no on-image copy')
const clean = compileRenderPrompt(
  {
    creativeType: 'Video Concept',
    pattern: 'Profit Leak',
    audience: 'Builders',
    awareness: 'Problem-Aware',
    frames: [{ label: 'Frame 1', description: 'Builder overwhelmed on a chaotic job site.' }],
  },
  'fallback',
)
check('asks for no lettering at all', /Render NO text, lettering/.test(clean.prompt))
check('is not routed as a text render', !promptCarriesCopy(clean.prompt))

/* -------------------------------------------------------------------------- */
/*  A still is ONE frame — the filmstrip regression                            */
/*                                                                            */
/*  The exact brief that shipped as five stacked letterbox panels: a narrative */
/*  sequence handed to a still model, which rendered it as a shot list.        */
/* -------------------------------------------------------------------------- */

console.log('\nRender prompt — a still is one frame, not a storyboard')
const sequence = {
  creativeType: 'Static Concept',
  pattern: 'The Builder-Not-a-CEO Identity Trap',
  audience: 'Builders',
  awareness: 'Problem-Aware',
  frames: [
    { label: 'Frame 1', description: 'Builder overwhelmed on a chaotic job site.' },
    { label: 'Frame 2', description: 'The hidden identity trap exposed with one stark figure.' },
    { label: 'Frame 3', description: 'The system / turning point introduced.' },
    { label: 'Frame 4', description: 'The after — margin, time, and control restored.' },
    { label: 'Frame 5', description: 'Soft, qualifying call to action to the next step.' },
  ],
}

const still = compileRenderPrompt(sequence, 'fallback')
check('only the hero beat reaches a still', !/turning point|The after/.test(still.prompt))
check('frames are not numbered at the model', !/Frame \d/.test(still.prompt))
check('a single unified composition is demanded', /ONE single photographic frame/.test(still.prompt))
check('panels and strips are ruled out by name', /storyboard|filmstrip|multi-panel/.test(still.prompt))

const motion = compileRenderPrompt(sequence, 'fallback', { motion: true })
check('video keeps the full sequence', /turning point/.test(motion.prompt) && /The after/.test(motion.prompt))
check('video is not told to render a single frame', !/ONE single photographic frame/.test(motion.prompt))

/* -------------------------------------------------------------------------- */
/*  A still always carries words — the other half of the filmstrip failure     */
/* -------------------------------------------------------------------------- */

console.log('\nA still is an ad, not a stock photo')

// `sequence` has no quoted copy anywhere: exactly the brief that rendered five
// wordless panels. Without the headline floor it renders a caption-less photo.
const wordless = compileRenderPrompt(sequence, 'fallback')
check('a brief with no copy renders no invented lettering', wordless.rendered.length === 0)

const floored = compileRenderPrompt(sequence, 'fallback', { headline: 'You built a job, not a business.' })
check('the concept headline is burned in when the brief forgot one', floored.rendered.length === 1)
check('and it is listed as literal copy', floored.prompt.includes('You built a job, not a business.'))
check(
  'the headline floor never overrides copy the brief did declare',
  compileRenderPrompt(brief, 'fallback', { headline: 'Ignore me' }).rendered.every(
    (t) => t.text !== 'Ignore me',
  ),
)
check(
  'video is exempt — motion carries its message over time',
  compileRenderPrompt(sequence, 'fallback', { motion: true, headline: 'You built a job, not a business.' })
    .rendered.length === 0,
)
check(
  'a briefless still still gets its headline',
  compileRenderPrompt(undefined, 'raw concept', { headline: 'You built a job, not a business.' }).rendered
    .length === 1,
)
check(
  'a junk headline is not burned in',
  compileRenderPrompt(sequence, 'fallback', { headline: 'TBD' }).rendered.length === 0,
)

console.log('\nEvery render has a subject')

/* The second failure this file exists for, and the one that shipped an ad with
   a woman surfing on it. The copy is declared in `onImageText` and the frames
   are named after the copy zones they hold — which is idiomatic art direction
   and exactly what `visualDirectionBlock` asks the orchestrator to write. Every
   frame therefore classifies as copy, every frame is stripped out of the scene,
   and the model receives a layout with no photograph in it. It does not fail on
   that prompt; it invents a subject, and a decorative stock scene is what the
   invention looks like. */
const zonesOnly: ProductionBrief = {
  creativeType: '4:5 Static',
  pattern: 'Authority',
  audience: 'Cold, Problem-Aware ecommerce founders',
  awareness: 'Problem-Aware',
  onImageText: [
    { role: 'Headline', text: 'YOUR BEST MONTH WAS AN ACCIDENT', placement: 'upper third' },
    { role: 'CTA button', text: 'Get the audit', placement: 'bottom centre' },
  ],
  frames: [
    { label: 'Headline zone (top third)', description: 'Dark scrim, condensed bold white type.' },
    { label: 'Proof badge', description: 'Amber-outlined chip, lower left, small caps.' },
    { label: 'CTA button zone', description: 'Solid amber pill, bottom centre.' },
  ],
}

const zoned = compileRenderPrompt(zonesOnly, 'Static proof ad built on one hard number.')
check(
  'a brief of nothing but copy zones still reaches the model with a subject',
  zoned.prompt.includes('SCENE:') || zoned.prompt.includes('SUBJECT —'),
)
check(
  'the concept description is recovered as the subject',
  zoned.prompt.includes('Static proof ad built on one hard number.'),
)

// Nothing to recover from at all: no scene frames, and a fallback that is pure
// render boilerplate. The prompt must say so and close the door on the default.
const nothing = compileRenderPrompt(
  { ...zonesOnly, frames: [{ label: 'Headline zone', description: 'Dark scrim.' }] },
  'Render as a premium Meta ad creative — photographic, high contrast, leave room for a text overlay.',
)
check('an unrecoverable brief admits it has no scene', nothing.prompt.includes('SUBJECT —'))
check(
  'type treatment is sent as LAYOUT, never passed off as a scene',
  nothing.prompt.includes('LAYOUT: Dark scrim') && !nothing.prompt.includes('SCENE: Dark scrim'),
)
check(
  'and bans the decorative stock default by name',
  /no beaches, no surfing/.test(nothing.prompt),
)
check(
  'the model is never pointed at a scene that is not there',
  !nothing.prompt.includes('true to the scene described above'),
)
check(
  'a brief that DOES describe a scene still says so',
  compileRenderPrompt(brief, 'fallback').prompt.includes('true to the scene described above'),
)

console.log('\nThe ad knows whose it is')

const acme: RenderBrand = {
  name: 'Optimised Digital',
  industry: 'performance marketing for ecommerce brands',
  audience: 'founders running $1M–$10M online stores',
  palette: ['#0a0a0a', '#f59e0b'],
  hasLogo: true,
}
const branded = compileRenderPrompt(zonesOnly, 'fallback', { brand: acme })
check('the business is named before anything else', branded.prompt.startsWith('THE AD IS FOR OPTIMISED DIGITAL'))
check('its industry reaches the model', branded.prompt.includes('performance marketing for ecommerce brands'))
check('so does its palette', branded.prompt.includes('#f59e0b'))
check(
  'a brand with a logo is told never to draw one',
  /never draw a wordmark, logo or brand lettering/.test(branded.prompt),
)
check(
  'the no-scene guard is scoped to that business',
  branded.prompt.includes('the world of performance marketing for ecommerce brands'),
)
check(
  'with nothing connected, no empty brand header is emitted',
  !compileRenderPrompt(zonesOnly, 'fallback').prompt.includes('THE AD IS FOR'),
)
check(
  'and the guard then never points at a business that is not there',
  !compileRenderPrompt(zonesOnly, 'x', { brand: {} }).prompt.includes('compose one from the business above'),
)

console.log('\nA proven design is only pulled when it fits')

/* `bestVisualReferenceFor` used to return the top of an ordered list whatever
   its score, so ONE unrelated ad banked in the Vault became "PROVEN DESIGN —
   build the visual concepts on it" on every run that followed, carrying its
   subject into campaigns with nothing to do with it. */
const dna = (over: Partial<VisualDNA> = {}): VisualDNA => ({
  format: 'Static image ad',
  aspectRatio: '4:5',
  layout: 'Headline block over a photo',
  elements: [
    { element: 'Headline', text: '', position: 'top', zone: 'top', treatment: 'bold' },
    { element: 'Subject', text: '', position: 'centre', zone: 'middle', treatment: 'photo' },
    { element: 'CTA', text: '', position: 'bottom', zone: 'bottom', treatment: 'pill' },
  ],
  palette: [{ hex: '#0a0a0a', role: 'Background' }],
  typography: 'Condensed bold',
  imagery: 'Surfer riding a wave at golden hour',
  focalFlow: 'Headline → subject → CTA',
  textDensity: 'One third text',
  contrastDevice: 'Bright accent on dark',
  scrollStopReason: 'High-contrast headline',
  designPrinciples: [],
  replicationNotes: 'Keep the zones',
  ...over,
})

const unrelated: StoredVisualReference = {
  id: 'a',
  title: 'Surf brand summer campaign',
  pattern: 'Lifestyle',
  summary: 'Wetsuit brand seasonal launch',
  visual: dna(),
  createdAt: null,
}
const fitting: StoredVisualReference = {
  id: 'b',
  title: 'Ecommerce margin audit static',
  pattern: 'Profit Leak',
  summary: 'Margin audit offer for online stores',
  visual: dna({ imagery: 'Founder at a warehouse packing bench' }),
  createdAt: null,
}

const ecomBrief = {
  angle: 'Profit',
  brief: 'Margin audit offer for ecommerce stores losing profit to shipping',
  audience: 'ecommerce founders',
  outputs: ['Static Creative'],
  aspectRatio: '4:5',
}

const surfOnly = rankVisualReferences([unrelated], ecomBrief)[0]
check(
  'an unrelated design scores below the floor even with a matching ratio',
  surfOnly.relevance < MIN_VISUAL_RELEVANCE,
  `relevance ${surfOnly.relevance}`,
)
check(
  'design richness alone never clears the floor',
  surfOnly.score > surfOnly.relevance && surfOnly.relevance < MIN_VISUAL_RELEVANCE,
)
const fittingMatch = rankVisualReferences([unrelated, fitting], ecomBrief)[0]
check('a design that shares the brief\'s language does clear it', fittingMatch.reference.id === 'b')
check(
  'and it clears the floor on evidence, not on ranking',
  fittingMatch.relevance >= MIN_VISUAL_RELEVANCE,
  `relevance ${fittingMatch.relevance}`,
)

console.log('\nThe agent-authored prompt path')
const raw = enforceSingleFrame('Builder on site at golden hour, headline top third.')
check('the single-frame rule reaches prompts the compiler did not write', /NOT a storyboard/.test(raw))
check('enforcement is idempotent', enforceSingleFrame(raw) === raw)

console.log(failures === 0 ? '\nAll render-prompt checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
