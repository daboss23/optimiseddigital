/**
 * Blank-slate self-test — proves the platform ships with no business in it.
 *
 * This is a white-labelled product: a company connects their website and the
 * Reactor becomes theirs. That only holds if the source tree carries nobody
 * else's business, and it did. The original tenant — a residential builder and
 * the coaching brand around it — was reachable from six separate places:
 *
 *   · four `system: 'website'` documents in the fallback corpus, holding that
 *     company's positioning, proof points, audience fears and brand voice,
 *     filed under the exact system a connected site's real profile lands in;
 *   · the whole curated corpus (its patterns, its clients' margins, its winning
 *     hooks) — gated on every dashboard, and NOT on retrieval, which is the one
 *     path that feeds the agents;
 *   · `skills/hooks-library.md`, a swipe file of that company's finished ad
 *     copy, injected into both copy routes;
 *   · `brand/BRAND_MEMORY.md`, its brand document, injected wherever no site
 *     was connected;
 *   · the NEURO pre-test principles, which reasoned about "the builder's eye";
 *   · the orchestrator's own voice instruction — "builder-native" — and the
 *     default destination URL on every ad pushed to Meta.
 *
 * None of it looked broken. It looked like the platform understood a business
 * that happened not to be yours.
 *
 * Run: npx tsx scripts/blank-slate-selftest.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { foundationAssets, learnings } from '@/lib/reactor-data'
import { searchKnowledge } from '@/lib/knowledge'
import { demoDataEnabled } from '@/lib/demo-mode'
import { NEURO_SEED_PRINCIPLES } from '@/seeds/neuro/principles'
import { getBrandMemory } from '@/lib/brand-memory'
import { compileRenderPrompt } from '@/lib/render-prompt'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failures++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Language that belongs to the original tenant's business and nobody else's.
 *
 * Deliberately NOT the bare word "builder": the codebase legitimately says
 * "builder-facing" about the person operating the platform, and banning it
 * outright would teach the next person to work around this test rather than fix
 * the leak it found.
 */
const TENANT_MARKERS = [
  /\bTPB\b/,
  /Summit Build/i,
  /The Professional Builder/i,
  /theprobuilder/i,
  /Hunter Valley/i,
  /provisional sums?/i,
  /\bknockdown[- ]rebuild/i,
  /\bsubbies?\b/i,
  /\bon the tools\b/i,
  /\bmember (?:win|vault|result|transformation)/i,
]

function leaks(text: string): string[] {
  return TENANT_MARKERS.filter((re) => re.test(text)).map((re) => re.source)
}

function assertClean(label: string, text: string) {
  const found = leaks(text)
  check(label, found.length === 0, found.join(', '))
}

async function main() {
  console.log('\nThe fallback corpus carries craft, not a company')

  check(
    'nothing files under the `website` system — that is where a connected site lands',
    foundationAssets.every((a) => a.system !== 'website'),
    foundationAssets
      .filter((a) => a.system === 'website')
      .map((a) => a.title)
      .join(', '),
  )
  assertClean(
    'nothing in the shipped corpus names the original tenant',
    foundationAssets.map((a) => `${a.title} ${a.content}`).join('\n'),
  )

  console.log('\nRetrieval answers the same way the dashboards do')

  check('the demo flag is off in this environment', !demoDataEnabled())

  for (const q of [
    'positioning voice audience proof',
    'winning hooks and offers',
    'client transformation margin',
    'what patterns win',
  ]) {
    const hits = await searchKnowledge(q, { k: 8 })
    assertClean(
      `"${q}" retrieves nothing belonging to another business`,
      hits.map((h) => `${h.title} ${h.content}`).join('\n'),
    )
  }

  const websiteHits = await searchKnowledge('who we are what makes us different', {
    system: 'website',
    k: 8,
  })
  check(
    'the `website` system is empty until a site is connected',
    websiteHits.length === 0,
    websiteHits.map((h) => h.title).join(', '),
  )

  console.log('\nEverything injected into a model is tenant-neutral')

  for (const f of ['hooks-library.md', 'meta-frameworks.md']) {
    assertClean(
      `skills/${f} carries craft, not one company's copy`,
      readFileSync(join(process.cwd(), 'skills', f), 'utf-8'),
    )
  }

  const brandMemory = getBrandMemory()
  assertClean('brand/BRAND_MEMORY.md ships without a business in it', brandMemory)
  // The template's content headings must have nothing under them. A heading
  // followed by prose is somebody's brand, and this file reaches every business
  // on the deployment.
  const templateBody = brandMemory.split('## IF YOU DO FILL IT IN')[1] ?? ''
  const filled: string[] = []
  const headingRe = /^## ([A-Z][^\n]*)\n+([^\n#][^\n]*)/gm
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(templateBody)) !== null) filled.push(m[1])
  check('and every content heading in it is still empty', filled.length === 0, filled.join(', '))

  assertClean(
    'the NEURO pre-test reasons about a reader, not one industry',
    NEURO_SEED_PRINCIPLES.map((p) => `${p.title} ${p.content}`).join('\n'),
  )
  check(
    'and no principle is addressed to a named company',
    !NEURO_SEED_PRINCIPLES.some((p) => /APPLY TO [A-Z]{2,}/.test(p.content)),
  )

  assertClean(
    "the Creative Learnings floor states principle, not another account's figures",
    learnings.map((l) => `${l.insight} ${l.evidence} ${l.recommendation}`).join('\n'),
  )
  check(
    'and it claims no measurement it does not have',
    learnings.every((l) => /not yet measured on this account/i.test(l.evidence)),
  )

  const orchestrator = readFileSync(
    join(process.cwd(), 'app/api/campaign-reactor/route.ts'),
    'utf-8',
  )
  check(
    "the orchestrator is not told to write in one industry's voice",
    !/builder-native/.test(orchestrator),
  )

  const publish = readFileSync(join(process.cwd(), 'lib/meta-publish.ts'), 'utf-8')
  check(
    'no ad is published to a hard-coded destination URL',
    !/https:\/\/theprobuilder/.test(publish),
  )

  console.log('\nA render for a fresh deployment names nobody')

  const fresh = compileRenderPrompt(
    {
      creativeType: '1:1 Static',
      pattern: 'Authority',
      audience: 'Cold traffic',
      awareness: 'Problem-Aware',
      frames: [{ label: 'Headline zone', description: 'Dark scrim.' }],
    },
    'Render as a premium Meta ad creative — photographic, high contrast.',
  ).prompt
  assertClean('an unbranded render prompt carries no business at all', fresh)
  check('and it still refuses the decorative stock default', /no beaches, no surfing/.test(fresh))

  console.log(
    failures === 0
      ? '\n\x1b[32mThe platform ships blank — every business in it comes from the connected website.\x1b[0m\n'
      : `\n\x1b[31m${failures} check(s) FAILED — tenant content is reachable.\x1b[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
