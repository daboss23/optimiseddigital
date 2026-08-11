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
} from '@/lib/render-prompt'
import type { ProductionBrief } from '@/lib/reactor-inputs'
import { promptCarriesCopy } from '@/lib/image'

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

console.log('\nThe agent-authored prompt path')
const raw = enforceSingleFrame('Builder on site at golden hour, headline top third.')
check('the single-frame rule reaches prompts the compiler did not write', /NOT a storyboard/.test(raw))
check('enforcement is idempotent', enforceSingleFrame(raw) === raw)

console.log(failures === 0 ? '\nAll render-prompt checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
