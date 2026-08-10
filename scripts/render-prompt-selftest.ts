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

console.log(failures === 0 ? '\nAll render-prompt checks passed.\n' : `\n${failures} check(s) FAILED.\n`)
process.exit(failures === 0 ? 0 : 1)
