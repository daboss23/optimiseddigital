/**
 * Pre-ship preflight.
 *
 * The two things that decide whether a first-time operator has a good day or a
 * confusing one, checked against the REAL services with the REAL keys:
 *
 *   1. Website extraction — does connecting a site produce all five
 *      intelligence profiles, or does it quietly come back with two?
 *   2. The image oven — does each headline-capable model actually render, and
 *      does it render on the model that was ASKED for?
 *
 * Neither can be faked in a unit test: both are questions about live vendors
 * and live credit. So this runs them for real and prints what happened.
 *
 *   npm run preflight -- --url https://herwebsite.com
 *   npm run preflight -- --images-only
 *   npm run preflight -- --url https://herwebsite.com --skip-images
 *
 * Exits non-zero if anything a first-time operator would notice is broken.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local without a dependency. Existing environment wins, so CI can
// inject secrets directly.
try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !line.trim().startsWith('#') && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch {
  /* no .env.local — rely on the environment */
}

import { analyzeWebsite } from '@/lib/website-intelligence'
import { generateImageDetailed, listImageModels } from '@/lib/image'
import { IMAGE_MODELS } from '@/lib/image/registry'

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

let failures = 0
const fail = (why: string) => {
  failures += 1
  console.log(`${red('FAIL')}  ${why}`)
}
const pass = (what: string, detail = '') =>
  console.log(`${green('PASS')}  ${what}${detail ? dim(` — ${detail}`) : ''}`)
const warn = (what: string) => console.log(`${yellow('WARN')}  ${what}`)

/* ------------------------------ 1 · extraction ----------------------------- */

/**
 * Five profiles, each with real content in it.
 *
 * The failure this exists to catch is the quiet one: a scan that returns two
 * populated profiles and three empty ones still "succeeds", still writes, and
 * still shows a connected website — the operator just never finds out that
 * most of their brand intelligence is missing.
 */
async function checkExtraction(url: string): Promise<void> {
  console.log(bold(`\n  1 · Website extraction — ${url}\n`))

  if (!process.env.ANTHROPIC_API_KEY) {
    fail('ANTHROPIC_API_KEY is not set, so no profiles can be derived at all.')
    return
  }

  const started = Date.now()
  let lastProgress = ''
  const summary = await analyzeWebsite(url, (e) => {
    if (e.type === 'progress') {
      lastProgress = e.message
      console.log(dim(`      ${e.message}`))
    }
    if (e.type === 'error') console.log(red(`      ${e.message}`))
  }).catch((err: unknown) => {
    fail(`the scan threw: ${err instanceof Error ? err.message : String(err)}`)
    return null
  })

  if (!summary) return
  console.log('')

  if (summary.extractionBlocked) {
    fail(
      `extraction was blocked by the ACCOUNT, not the site: ${summary.extractionError ?? 'no reason given'}`,
    )
    console.log(
      dim(
        '      This is the usual cause of "it only extracted two things": the credit\n' +
          '      balance runs out partway through and the remaining profiles never run.',
      ),
    )
  }

  const facts = (p: Record<string, unknown>) =>
    Object.entries(p)
      .filter(([k]) => k !== 'sourceUrls' && k !== 'companyName')
      .reduce(
        (s, [, v]) =>
          s + (Array.isArray(v) ? v.length : v && v !== 'Not confidently identified' ? 1 : 0),
        0,
      )

  const profiles = summary.profiles as unknown as Record<string, Record<string, unknown>>
  const names = ['brand', 'audience', 'offer', 'messaging', 'proof'] as const
  let populated = 0

  for (const name of names) {
    const n = facts(profiles[name] ?? {})
    if (n > 0) {
      populated += 1
      pass(`${name} profile`, `${n} facts`)
    } else {
      fail(`${name} profile came back EMPTY`)
    }
  }

  if (summary.preservedProfiles?.length) {
    warn(
      `${summary.preservedProfiles.join(', ')} were carried over from the previous scan — ` +
        'this run did not derive them.',
    )
  }
  if (summary.extractionFailed?.length) {
    fail(`${summary.extractionFailed.join(', ')} failed: ${summary.extractionError ?? 'unknown'}`)
  }

  if (populated === names.length) {
    pass('all five profiles derived', `${Math.round((Date.now() - started) / 1000)}s`)
  } else {
    fail(`${populated} of ${names.length} profiles populated — the exact symptom to catch`)
  }

  if (summary.pages.length < 3) {
    warn(
      `only ${summary.pages.length} pages scanned — a thin corpus produces thin profiles even ` +
        `when nothing is broken. Last step: ${lastProgress}`,
    )
  }
  if (summary.failedPages.length > 0) {
    warn(`${summary.failedPages.length} page(s) could not be read: ` +
      summary.failedPages.map((p) => `${p.url} (${p.reason})`).join(', '))
  }
}

/* ------------------------------ 2 · image oven ----------------------------- */

/**
 * The top five, rendered for real.
 *
 * A render that silently lands on a different model is the failure that
 * matters here — it is how ads shipped with misspelled headlines. So the
 * prompt carries literal on-image copy, and any fallback is a FAIL rather than
 * a shrug, because a fallback means the requested model's slug is wrong.
 */
async function checkImageModels(): Promise<void> {
  console.log(bold('\n  2 · Image oven — the top five, rendered for real\n'))

  const availability = new Map(listImageModels().map((m) => [m.id, m.configured]))
  const top = IMAGE_MODELS.filter((m) => m.tier === 'flagship' && m.textFidelity === 'strong').slice(
    0,
    5,
  )

  if (top.length === 0) {
    fail('no flagship text-strong models are in the registry')
    return
  }

  // Literal copy in the prompt, because that is what an ad actually asks for
  // and what separates a working slug from a silent downgrade.
  const prompt =
    'A clean studio product photograph on a deep navy background.\n\nON-IMAGE TEXT (reproduce exactly): "BUILT TO LAST"'

  for (const model of top) {
    if (!availability.get(model.id)) {
      warn(`${model.label} (${model.id}) — provider not configured, skipped`)
      continue
    }
    const started = Date.now()
    const attempt = await generateImageDetailed(model.id, prompt, '4:5').catch((err: unknown) => ({
      image: null,
      error: err instanceof Error ? err.message : String(err),
    }))
    const secs = `${Math.round((Date.now() - started) / 1000)}s`

    if (!attempt.image) {
      fail(`${model.label} did not render — ${attempt.error ?? 'no image'}`)
      continue
    }
    if ('fellBack' in attempt && attempt.fellBack) {
      fail(
        `${model.label} fell back to ${attempt.image.modelId} — its slug is wrong. ` +
          `Run \`npm run muapi:slugs\` and set the override. ${attempt.note ?? ''}`,
      )
      continue
    }
    pass(`${model.label}`, `${secs} · ${attempt.image.imageUrl.slice(0, 72)}…`)
  }
}

/* ---------------------------------- main ---------------------------------- */

async function main() {
  const argv = process.argv.slice(2)
  const urlFlag = argv.indexOf('--url')
  const url = urlFlag >= 0 ? argv[urlFlag + 1] : undefined
  const imagesOnly = argv.includes('--images-only')
  const skipImages = argv.includes('--skip-images')

  console.log(bold('\n  Preflight — the two things a first-time operator will notice\n'))

  if (!imagesOnly) {
    if (!url) {
      fail('no --url given, so website extraction was not checked at all')
      console.log(dim('      npm run preflight -- --url https://herwebsite.com'))
    } else {
      await checkExtraction(url)
    }
  }
  if (!skipImages) await checkImageModels()

  console.log('\n----------------------------------------------------')
  console.log(failures === 0 ? green('READY') : red(`NOT READY — ${failures} problem(s)`))
  console.log('')
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error(red('\nPreflight crashed:'), err)
  process.exit(1)
})
