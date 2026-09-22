/**
 * Run the automatic campaign research against the LIVE library, once, and show
 * exactly what the agents would be handed.
 *
 * Everything else about this integration is proved in process against a
 * stubbed transport (`npm run selftest:gethookd`), because a suite that hit
 * the live library would bill the account on every CI run. This is the one
 * command that talks to the real source — for the moment after a key is
 * rotated, or a vendor renames a filter, when "it returned 200" is not the
 * question. The question is whether five static ads that have run ninety days
 * actually come back, and what they cost.
 *
 * Run:
 *   GETHOOKD_API_KEY=... npx tsx scripts/gethookd-research.ts "roofing lead gen for contractors"
 *
 * COST: bounded by the ladder itself — at most three searches of eight rows,
 * so under 0.25 credits, and it stops early the moment it has enough. The
 * credits actually spent are printed.
 */

import {
  researchProvenAds,
  researchTerms,
  researchFocus,
  sparkEvidence,
  echoEvidence,
  provenAdBlock,
} from '@/lib/gethookd/research'
import { gethookdConfigured } from '@/lib/gethookd'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`

async function main() {
  const brief = process.argv.slice(2).join(' ').trim()
  if (!gethookdConfigured()) {
    console.error(
      red('\nGETHOOKD_API_KEY is not set in this shell.') +
        '\nThis script is the LIVE check — it needs the same key the deployment uses.\n' +
        dim('  GETHOOKD_API_KEY=... npx tsx scripts/gethookd-research.ts "your campaign brief"\n'),
    )
    process.exit(1)
  }

  const input = {
    brief: brief || 'Booked strategy calls for local service businesses that want more qualified leads',
    offerName: '',
  }

  console.log(`\n${bold('Brief')}      ${input.brief}`)
  console.log(`${bold('Focus')}      ${researchFocus(input)}`)
  console.log(`${bold('Terms')}      ${researchTerms(input).join(', ') || dim('(none — straight to the browse rung)')}\n`)

  const started = Date.now()
  const research = await researchProvenAds(input)
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  console.log(bold('The ladder'))
  for (const step of research.steps) {
    const widened = step.widened.length ? dim(` (widened: ${step.widened.join(', ')})`) : ''
    console.log(
      `  [${step.pool}] ${step.label} → ${step.eligible} eligible of ${step.returned} billed${widened}`,
    )
  }

  console.log(
    `\n${bold('Result')}     ${
      research.ads.length
        ? green(`${research.ads.length} reference${research.ads.length === 1 ? '' : 's'}`)
        : red('no references')
    } in ${seconds}s · ${
      research.credits ? `${research.credits.used.toFixed(2)} credits spent, ${research.credits.remaining.toFixed(2)} left` : 'no credit figures returned'
    }`,
  )
  if (research.note) console.log(`${bold('Note')}       ${research.note}`)

  const poolOf = (id: string) => (research.craft.some((c) => c.id === id) ? 'best-built' : 'on-market')
  for (const ad of research.ads) {
    console.log(
      `\n  ${bold(ad.brand)} · ${poolOf(ad.id)} · ${ad.daysActive ?? 0} days live · ${
        ad.performanceTier ?? 'unrated'
      } · ${ad.countries.join('/') || 'no country data'}`,
    )
    console.log(`  ${ad.title || dim('(no headline)')}`)
    console.log(dim(`  ${ad.body.replace(/\s+/g, ' ').slice(0, 160)}…`))
    console.log(dim(`  still: ${ad.imageUrl ? 'yes' : 'NO — would be rejected'}   ${ad.shareUrl ?? ''}`))
  }

  // The point of the whole exercise: what SPARK, ECHO and OPUS actually read.
  console.log(`\n${bold('── SPARK is handed ──')}\n${sparkEvidence(research) || dim('(nothing)')}`)
  console.log(`\n${bold('── ECHO is handed ──')}\n${echoEvidence(research) || dim('(nothing)')}`)
  console.log(`\n${bold('── OPUS is handed ──')}\n${provenAdBlock(research) || dim('(nothing)')}\n`)

  // A live source that returns nothing eligible is a real answer, not a crash —
  // but it is not a passing demo either, so the exit code says which happened.
  process.exit(research.ads.length ? 0 : 2)
}

main().catch((err) => {
  console.error(red('\nResearch probe crashed:'), err)
  process.exit(1)
})
