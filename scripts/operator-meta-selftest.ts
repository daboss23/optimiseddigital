/**
 * Mike Delight — live Meta source contract check.
 *
 * The operator self-test (`npm run selftest:operator`) proves the pipeline
 * against SEEDED data with a pinned date. This script proves the other half:
 * that the live Meta source returns data honouring the same contract, against
 * the real account named by META_ACCESS_TOKEN / META_AD_ACCOUNT_ID.
 *
 * It imports the server builder directly — no HTTP, no Next server — so what
 * is asserted here is byte-for-byte what `/api/operator/source` serves.
 *
 * Usage:
 *   npm run selftest:operator-meta
 *
 * Exits non-zero on any failure, so it works in CI.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local without a dependency — KEY=VALUE per line, # comments.
// Existing environment wins, so CI can inject secrets directly.
try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch {
  // No .env.local — rely on the environment.
}

import { fetchOperatorSource } from '@/lib/operator/adapters/meta-server'
import { resolveMetaCredentials } from '@/lib/operator/adapters/meta-credentials'
import { addDays, isValidDate, todayIn } from '@/lib/operator/dates'

let passed = 0
let failed = 0

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1
    console.log(`${green('✓')} ${label}${detail ? dim(` — ${detail}`) : ''}`)
  } else {
    failed += 1
    console.log(`${red('✗')} ${label}${detail ? dim(` — ${detail}`) : ''}`)
  }
}

async function main() {
  console.log('\nMike Delight — live Meta source contract check\n')

  if (!process.env.META_ACCESS_TOKEN) {
    console.log(red('META_ACCESS_TOKEN is not set. Add it to .env.local and re-run.'))
    process.exit(1)
  }

  // 0 · Credential resolution — the stored connection wins when one exists,
  // the environment is the fallback. Either way a usable token must resolve.
  const credentials = await resolveMetaCredentials(null)
  check(
    'credentials resolve (stored connection wins, env is the fallback)',
    Boolean(credentials?.token) &&
      (credentials?.origin === 'env' || credentials?.origin === 'settings'),
    credentials ? `origin: ${credentials.origin}` : 'no credentials',
  )

  const payload = await fetchOperatorSource(null)
  const { creatives, baselines, metadata } = payload

  console.log(
    dim(
      `Account timezone ${metadata.accountTimezone} · ${creatives.length} creatives · ` +
        `${baselines.length} baselines · complete through ${metadata.completeThrough}`,
    ),
  )
  console.log()

  // 1 · The account returned something gradeable
  check('creatives returned with delivery', creatives.length > 0, `${creatives.length} ads`)

  // 2 · Daily rows are sorted, dated, and never past the last complete day
  check(
    'daily rows sorted oldest → newest, none past completeThrough',
    creatives.every((c) => {
      const dates = c.daily.map((d) => d.date)
      const sorted = [...dates].sort()
      return (
        dates.every(isValidDate) &&
        JSON.stringify(dates) === JSON.stringify(sorted) &&
        dates.every((d) => d <= metadata.completeThrough)
      )
    }),
  )

  // 3 · One result type per creative, on every row — never blended
  check(
    'every daily row carries the creative’s single primaryResultType',
    creatives.every((c) => c.daily.every((d) => d.primaryResultType === c.primaryResultType)),
  )

  // 4 · Frequency exists only as range-level delivery, in labelled 7-day windows
  check(
    'ranges are 7-day current/previous windows with real reach and frequency',
    creatives.every((c) =>
      c.ranges.every(
        (r) =>
          r.days === 7 &&
          (r.window === 'current' || r.window === 'previous') &&
          r.reach > 0 &&
          r.frequency > 0 &&
          r.impressions > 0,
      ),
    ),
  )

  // 5 · The windows are the ones the rules evaluate
  const lastComplete = metadata.completeThrough
  check(
    'current window is the 7 days ending on completeThrough',
    creatives.every((c) => {
      const cur = c.ranges.find((r) => r.window === 'current')
      return !cur || (cur.to === lastComplete && cur.from === addDays(lastComplete, -6))
    }),
  )

  // 6 · Metadata is honest about origin and the clock
  check(
    'metadata: origin meta, completeThrough is yesterday in the account timezone',
    metadata.origin === 'meta' &&
      metadata.completeThrough === addDays(todayIn(metadata.accountTimezone), -1) &&
      metadata.maturityDelayHours > 0,
  )

  // 7 · Baselines never blend result types
  check(
    'every baseline is scoped to exactly one primaryResultType',
    baselines.every((b) => typeof b.key.primaryResultType === 'string'),
  )

  // 8 · Baselines carry the sufficiency evidence the resolver reads
  check(
    'baselines report creativeCount and resultCount',
    baselines.every((b) => b.creativeCount >= 0 && b.resultCount >= 0),
  )

  console.log(`\n${'-'.repeat(52)}`)
  console.log(green(`PASS: ${passed}`))
  console.log(failed > 0 ? red(`FAIL: ${failed}`) : green('FAIL: 0'))
  console.log()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(red(`\nLive source check could not run: ${error instanceof Error ? error.message : error}`))
  process.exit(1)
})
