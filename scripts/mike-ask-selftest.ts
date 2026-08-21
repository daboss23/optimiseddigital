/**
 * Ask Mike (open) — in-process contract checks.
 *
 * Proves the half of the agent that must never depend on a model call: the
 * instruments return what they claim to, the allowlist is a wall rather than a
 * comment, and the fact ledger accepts what the account actually produced
 * while rejecting what it did not.
 *
 * The evaluation date is PINNED, for the same reason `operator-selftest.ts`
 * pins its own: an unpinned "last complete day" moves with the calendar and
 * gives a suite that passes on Monday and fails on Thursday.
 *
 *   npm run selftest:mike-ask
 *
 * Exits non-zero on any failure, so it works in CI.
 */

import { createSeededSource } from '@/lib/operator/adapters/seeded'
import {
  assertReadOnly,
  runAskTool,
  ASK_TOOLS,
  ASK_TOOL_NAMES,
  ToolNotPermitted,
  type ToolContext,
  type ToolRun,
} from '@/lib/operator/ask/tools'
import { buildLedger, checkAnswer } from '@/lib/operator/ask/facts'
import { configuredOrigin, loadOperatorContext } from '@/lib/operator/ask/source'
import { isValidDate } from '@/lib/operator/dates'

const EVALUATION_DATE = '2026-08-12'

let passed = 0
let failed = 0

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1
    console.log(`${green('PASS')}  ${label}${detail ? dim(` — ${detail}`) : ''}`)
  } else {
    failed += 1
    console.log(`${red('FAIL')}  ${label}${detail ? dim(` — ${detail}`) : ''}`)
  }
}

type Json = Record<string, unknown>
const asJson = (run: ToolRun): Json => run.result as Json

async function main() {
  const source = createSeededSource({ evaluationDate: EVALUATION_DATE })
  const [creatives, baselines, metadata] = await Promise.all([
    source.getCreatives(),
    source.getBaselines(),
    source.getMetadata(),
  ])
  const ctx: ToolContext = {
    evaluationDate: EVALUATION_DATE,
    creatives,
    baselines,
    metadata,
    board: [],
  }

  console.log(`\n  Mike — open ask, seeded account, pinned to ${EVALUATION_DATE}\n`)

  /* 1 · The allowlist is enforced, not described. */
  check('1 · every declared tool is on the allowlist', ASK_TOOLS.every((t) => (ASK_TOOL_NAMES as readonly string[]).includes(t.name)))
  check('2 · every allowlisted name is declared to the model', ASK_TOOL_NAMES.every((n) => ASK_TOOLS.some((t) => t.name === n)))

  let threw: unknown = null
  try {
    await runAskTool('pause_ad', {}, ctx)
  } catch (error) {
    threw = error
  }
  check('3 · an unlisted tool name throws rather than no-ops', threw instanceof ToolNotPermitted)
  check(
    '4 · nothing that mutates the account is reachable',
    !ASK_TOOL_NAMES.some((n) => /publish|pause|budget|scale|create|update|delete|ingest/i.test(n)),
    ASK_TOOL_NAMES.join(', '),
  )
  check('5 · assertReadOnly returns the name it approved', assertReadOnly('list_creatives') === 'list_creatives')

  /* 2 · The instruments return what they claim to. */
  const list = await runAskTool('list_creatives', {}, ctx)
  const listed = (asJson(list).creatives ?? []) as Json[]
  check('6 · list_creatives returns the account', listed.length === creatives.length, `${listed.length} creatives`)
  check(
    '7 · every creative carries a computed rollup, not a remembered one',
    listed.every((c) => 'spend' in c && 'results' in c && 'costPerResult' in c && 'completeDays' in c),
  )

  const search = await runAskTool('list_creatives', { search: creatives[0].name.split(' ')[0] }, ctx)
  check('8 · search narrows the list', ((asJson(search).creatives ?? []) as Json[]).length <= listed.length)
  const nothing = await runAskTool('list_creatives', { search: 'zzzz-no-such-creative' }, ctx)
  check('9 · a search matching nothing returns nothing, not everything', ((asJson(nothing).creatives ?? []) as Json[]).length === 0)

  const perf = await runAskTool('creative_performance', { creativeIds: [creatives[0].id], days: 14 }, ctx)
  const read = ((asJson(perf).creatives ?? []) as Json[])[0]
  check('10 · creative_performance returns the creative asked for', Boolean(read))
  check('11 · it carries both trend windows', Boolean(read && (read.trends as Json)?.ctr3v3 && (read.trends as Json)?.ctr7v7))
  check(
    '12 · frequency is range-level and says so',
    Boolean(read && /range-level/i.test(String((read.frequency as Json)?.note ?? ''))),
  )
  check(
    '13 · the attribution state travels with the read',
    Boolean(read && 'readIsProvisional' in (read.attribution as Json)),
  )
  const missing = await runAskTool('creative_performance', { creativeIds: ['no-such-id'] }, ctx)
  check('14 · an unknown id is reported as missing, never invented', ((asJson(missing).missing ?? []) as string[]).includes('no-such-id'))

  const cohort = await runAskTool('compare_to_baseline', { creativeId: creatives[0].id }, ctx)
  const cohortJson = asJson(cohort)
  check('15 · compare_to_baseline names which cohort answered', 'baseline' in cohortJson && 'rejectedCohorts' in cohortJson)
  check(
    '16 · a resolved baseline carries its fallback level',
    cohortJson.baseline === null || Boolean((cohortJson.baseline as Json).fallbackLevel),
  )

  const summary = await runAskTool('account_summary', { days: 30 }, ctx)
  const summaryJson = asJson(summary)
  check('17 · account_summary never blends result types', Array.isArray(summaryJson.byResultType))
  check(
    '18 · seeded data is labelled seeded, never passed off as measured',
    ((summaryJson.data as Json)?.origin ?? '') === 'seeded',
  )

  const board = await runAskTool('todays_board', {}, ctx)
  check('19 · todays_board reads the board it was handed', (asJson(board).count ?? -1) === 0)

  /* 3 · The fact ledger. */
  const runs: ToolRun[] = [list, perf, cohort, summary]
  const ledger = buildLedger(runs)
  check('20 · the ledger is built from what was actually read', ledger.length > 20, `${ledger.length} authorised values`)

  const realSpend = Number((read as Json)?.spend ?? 0)
  const spendCheck = checkAnswer(`Spend on that one is $${realSpend}.`, runs)
  check('21 · a figure that came back from a tool passes', spendCheck.ok, `$${realSpend}`)

  const rounded = checkAnswer(`Spend is about $${Math.round(realSpend)}.`, runs)
  check('22 · honest rounding of a real figure passes', rounded.ok)

  const invented = checkAnswer('Cost per lead is $999,987.', runs)
  check('23 · an invented figure fails', !invented.ok && invented.failures.some((f) => f.code === 'unresolved_numeral'))

  const noTools = checkAnswer('CPL is $71.40 across the account.', [])
  check('24 · a figure with nothing read behind it fails', !noTools.ok)

  const prose = checkAnswer('Nothing there worth acting on yet. Ask me again in a few days.', [])
  check('25 · an answer with no figures needs no tools', prose.ok)

  const ordinal = checkAnswer('The first one is the one I would look at.', [])
  check('26 · ordinals and small counts do not fail as unresolved numerals', ordinal.ok)

  const acted = checkAnswer('I paused it this morning.', runs)
  check('27 · claiming to have acted fails', !acted.ok && acted.failures.some((f) => f.code === 'capability_claim'))

  const offered = checkAnswer('You could pause it, though I would not yet.', runs)
  check('28 · discussing an action he cannot take is fine', offered.ok)

  const guaranteed = checkAnswer('That is guaranteed to win.', runs)
  check('29 · an absolute about the future fails', !guaranteed.ok && guaranteed.failures.some((f) => f.code === 'overclaimed_certainty'))

  const hedged = checkAnswer('Nothing here is guaranteed and I would not pretend otherwise.', runs)
  check('30 · a negated absolute is not a failure', hedged.ok)

  const voice = checkAnswer(
    'Honestly? It is doing fine and nobody needs a meeting about it. Leave it alone and look again on Friday.',
    runs,
  )
  check('31 · voice is never the thing that fails — only facts', voice.ok)

  /* 4 · The seam. */
  check('32 · the server resolves the same switch the browser does', configuredOrigin() === 'seeded' || configuredOrigin() === 'meta')
  check('33 · an unset switch means seeded, never a half-read live account', configuredOrigin() === 'seeded')

  /* 5 · The bootstrap.

     This is the one that shipped broken. Building a source with a placeholder
     date in order to read the account timezone off its metadata generates an
     account around an invalid date, and it surfaces as "Invalid time value"
     from inside date arithmetic — nowhere near the cause. The context loader
     resolves the date FIRST, per origin, and these three say so. */
  const context = await loadOperatorContext()
  check('34 · the bootstrap resolves a real evaluation date', isValidDate(context.evaluationDate), context.evaluationDate)
  check('35 · it loads the account in the same pass', context.creatives.length > 0, `${context.creatives.length} creatives`)
  check(
    '36 · the date it resolved is the account\'s own, not the reader\'s',
    context.metadata.completeThrough < context.evaluationDate,
    `complete through ${context.metadata.completeThrough}`,
  )

  console.log('\n----------------------------------------------------')
  console.log(passed > 0 ? green(`PASS: ${passed}`) : `PASS: ${passed}`)
  console.log(failed > 0 ? red(`FAIL: ${failed}`) : green('FAIL: 0'))
  console.log('')
  if (failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(red('\nSelf-test crashed:'), error)
  process.exit(1)
})
