/**
 * Campaign Reactor self-test — proves the intelligence network is wired end to
 * end against a running deployment.
 *
 * `scripts/verify-reactor.sh` checks the knowledge loop (stats → ingest →
 * search → stream emits something). This checks the thing that script cannot:
 * that the SIX-AGENT NETWORK actually activates, retrieves real evidence,
 * attributes that evidence to the right layer, and produces exactly the
 * deliverables the brief asked for.
 *
 * It reads the same SSE stream the UI reads, so a pass here means the live
 * agent workflow renders truthfully.
 *
 * Usage:
 *   npx tsx scripts/reactor-selftest.ts
 *   BASE_URL=https://your-app.vercel.app npx tsx scripts/reactor-selftest.ts
 *
 * The platform sits behind a login gate, so the suite signs in first and
 * carries the session cookie on every call. Without that it 401s on its first
 * request and reports "is the app running?" — a test that cannot reach the
 * thing it tests guards nothing. Override the pair with PLATFORM_LOGIN_NAME /
 * PLATFORM_LOGIN_PASSWORD when the deployment has set its own.
 *
 * Exits non-zero on the first failed assertion set, so it works in CI.
 */

import { INTELLIGENCE, INTELLIGENCE_IDS, type IntelligenceId } from '@/lib/agents'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

/** The signed session cookie, held for the life of the run. */
let sessionCookie = ''

/**
 * Sign in and keep the cookie. Falls through silently when the deployment has
 * no gate (an older build, or one with auth disabled) — the suite then runs
 * exactly as it did before.
 */
async function signIn(): Promise<void> {
  const body = {
    name: process.env.PLATFORM_LOGIN_NAME ?? 'Bamik',
    password: process.env.PLATFORM_LOGIN_PASSWORD ?? '1234',
  }
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = res.headers.get('set-cookie')
    if (res.ok && raw) sessionCookie = raw.split(';')[0]
  } catch {
    /* no gate, or unreachable — the first real request reports it properly */
  }
}

/** Request headers, with the session attached once it exists. */
function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return sessionCookie ? { ...extra, cookie: sessionCookie } : extra
}

/** Layers the platform guarantees on every build (see MANDATORY_LAYERS). */
const MANDATORY: IntelligenceId[] = ['atlas', 'nova', 'spark', 'echo', 'oracle']

interface SseEvent {
  type: string
  [k: string]: unknown
}

interface AgentObservation {
  started: boolean
  completed: boolean
  /** Retrievals the backend explicitly attributed to this layer. */
  findings: string[]
  confidence?: string
  summary?: string
}

/** The concept fields this test asserts on — the variation contract included. */
interface ObservedConcept {
  type: string
  text: string
  testId?: string
  variantId?: string
  variationMethod?: string
  variationLabel?: string
}

interface RunResult {
  events: SseEvent[]
  agents: Record<IntelligenceId, AgentObservation>
  concepts: ObservedConcept[]
  steps: string[]
  errors: string[]
  demo: boolean
  elapsedMs: number
  /** Retrieval events that named no layer — these cannot be attributed. */
  unattributedRetrievals: number
}

/* ------------------------------- Assertions -------------------------------- */

let passed = 0
let failed = 0

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1
    console.log(`  ${green('PASS')}  ${name}`)
  } else {
    failed += 1
    console.log(`  ${red('FAIL')}  ${name}`)
    if (detail) console.log(`        ${dim(detail)}`)
  }
}

/* --------------------------------- Runner ---------------------------------- */

async function fireReactor(payload: Record<string, unknown>): Promise<RunResult> {
  const started = Date.now()
  const res = await fetch(`${BASE_URL}/api/campaign-reactor`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok || !res.body) {
    throw new Error(
      res.status === 401
        ? 'Reactor responded 401 Unauthorized — the login pair did not open the gate. Set PLATFORM_LOGIN_NAME / PLATFORM_LOGIN_PASSWORD to this deployment\'s own.'
        : `Reactor responded ${res.status} ${res.statusText}`,
    )
  }

  const agents = INTELLIGENCE_IDS.reduce(
    (acc, id) => {
      acc[id] = { started: false, completed: false, findings: [] }
      return acc
    },
    {} as Record<IntelligenceId, AgentObservation>,
  )

  const result: RunResult = {
    events: [],
    agents,
    concepts: [],
    steps: [],
    errors: [],
    demo: false,
    elapsedMs: 0,
    unattributedRetrievals: 0,
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.replace(/^data: /, '').trim()
      if (!line) continue
      let ev: SseEvent
      try {
        ev = JSON.parse(line) as SseEvent
      } catch {
        continue
      }
      result.events.push(ev)

      const layerId = (ev.id as string | undefined)?.toLowerCase()
      const isLayer = (v: string | undefined): v is IntelligenceId =>
        !!v && (INTELLIGENCE_IDS as string[]).includes(v)

      switch (ev.type) {
        case 'step': {
          const text = String(ev.text ?? '')
          result.steps.push(text)
          if (/demo mode|demo intelligence/i.test(text)) result.demo = true
          break
        }
        case 'delegate': {
          if (!isLayer(layerId)) break
          if (ev.status === 'start') agents[layerId].started = true
          if (ev.status === 'done') {
            agents[layerId].completed = true
            agents[layerId].confidence = ev.confidence as string | undefined
            agents[layerId].summary = ev.summary as string | undefined
          }
          break
        }
        case 'retrieval': {
          if (isLayer(layerId)) {
            agents[layerId].findings.push(`${ev.system} · ${ev.title}`)
          } else if (ev.system !== 'meta-ads') {
            // Meta Ads MCP retrievals legitimately belong to no layer.
            result.unattributedRetrievals += 1
          }
          break
        }
        case 'concept':
          result.concepts.push(ev.concept as ObservedConcept)
          break
        case 'error':
          result.errors.push(String(ev.message ?? 'unknown'))
          break
      }
    }
  }

  result.elapsedMs = Date.now() - started
  return result
}

/* ---------------------------------- Suite ---------------------------------- */

async function main() {
  console.log(bold(`\nCampaign Reactor self-test → ${BASE_URL}\n`))
  await signIn()

  /* -- 1. Every mandatory layer activates and reports evidence -------------- */
  console.log(bold('1. Intelligence network activation'))
  const run = await fireReactor({
    angle: 'Profit',
    outputs: ['Hook', 'Static Creative', 'Video Creative'],
    reactorInputs: {
      campaignName: 'Reactor self-test',
      brief:
        'Builders doing $2M–$3M who are still on the tools and losing margin they cannot see.',
      angle: 'Profit',
      outputTypes: ['Hook', 'Static Creative', 'Video Creative'],
      // Deliberately ASYMMETRIC: the whole point of the per-format system is
      // that Static and Video can differ. A regression back to one global count
      // would make these equal and fail the check below.
      variationCounts: { 'Static Creative': 3, 'Video Creative': 2 },
      variationMethods: { 'Static Creative': 'hooks', 'Video Creative': 'visual-execution' },
      audienceType: 'Builders $1M–$3M',
      awarenessStage: 'Problem-Aware',
      offerType: 'Strategy Call',
    },
  })

  console.log(
    dim(
      `   mode: ${run.demo ? 'demo intelligence' : 'live network'} · ${run.events.length} events · ${(run.elapsedMs / 1000).toFixed(1)}s`,
    ),
  )

  for (const id of MANDATORY) {
    const a = run.agents[id]
    const name = INTELLIGENCE[id].codename
    check(
      `${name} activated (the platform guarantees this layer on every run)`,
      a.completed,
      `started=${a.started} completed=${a.completed}`,
    )
    check(
      `${name} retrieved real evidence`,
      a.findings.length > 0,
      `${name} reported with zero retrievals — its knowledge systems (${INTELLIGENCE[
        id
      ].systems.join(', ')}) returned nothing`,
    )
  }

  const reported = INTELLIGENCE_IDS.filter((id) => run.agents[id].completed)
  check(
    'at least four of the five layers contributed',
    reported.length >= 4,
    `reported: ${reported.map((id) => INTELLIGENCE[id].codename).join(', ') || 'none'}`,
  )

  /* -- 2. Evidence is attributable to the layer that found it --------------- */
  console.log(`\n${bold('2. Evidence attribution')}`)
  check(
    'every retrieval names the layer that made it',
    run.unattributedRetrievals === 0,
    `${run.unattributedRetrievals} retrieval event(s) carried no agent id — under parallel consults these land on the wrong agent card`,
  )
  const totalFindings = INTELLIGENCE_IDS.reduce((n, id) => n + run.agents[id].findings.length, 0)
  check('the run retrieved evidence at all', totalFindings > 0, `${totalFindings} findings`)

  const confident = INTELLIGENCE_IDS.filter(
    (id) => run.agents[id].completed && run.agents[id].confidence,
  )
  check(
    'reporting layers carry a confidence band',
    confident.length === reported.length,
    `${confident.length}/${reported.length} banded`,
  )
  // A layer that found nothing must not claim more than Exploratory.
  const overclaiming = INTELLIGENCE_IDS.filter(
    (id) =>
      run.agents[id].completed &&
      run.agents[id].findings.length === 0 &&
      run.agents[id].confidence &&
      run.agents[id].confidence !== 'Exploratory' &&
      // ORACLE's historical-winners lookup reports High off stored outcomes
      // rather than retrievals, which is a real signal, not a fabricated one.
      !/historical winner/i.test(run.agents[id].summary ?? ''),
  )
  check(
    'no layer claims confidence it has no evidence for',
    overclaiming.length === 0,
    overclaiming
      .map((id) => `${INTELLIGENCE[id].codename}=${run.agents[id].confidence} with 0 findings`)
      .join(', '),
  )

  /* -- 3. The run produces exactly what the brief asked for ----------------- */
  console.log(`\n${bold('3. Deliverables')}`)
  check('the run completed without a fault', run.errors.length === 0, run.errors.join('; '))
  check(
    'a terminal done event closed the stream',
    run.events.some((e) => e.type === 'done'),
  )
  check('concepts were produced', run.concepts.length > 0, `${run.concepts.length} concepts`)

  // One Hook (copy is single) plus the per-format variation counts asked for
  // above — 3 statics under the Hooks lever, 2 videos under Visuals.
  const byType = run.concepts.reduce<Record<string, number>>((acc, c) => {
    acc[c.type] = (acc[c.type] ?? 0) + 1
    return acc
  }, {})
  console.log(dim(`   concept types: ${JSON.stringify(byType)}`))
  check(
    'every concept carries non-empty text',
    run.concepts.every((c) => c.text?.trim().length > 0),
  )

  const countOf = (re: RegExp) =>
    Object.entries(byType)
      .filter(([type]) => re.test(type))
      .reduce((n, [, v]) => n + v, 0)
  const statics = countOf(/static/i)
  const videos = countOf(/video|founder/i)
  check(
    'the static deliverable produced exactly its 3 requested versions',
    statics === 3,
    `expected 3 static concepts, got ${statics}: ${JSON.stringify(byType)}`,
  )
  check(
    'the video deliverable produced exactly its 2 requested versions',
    videos === 2,
    `expected 2 video concepts, got ${videos}: ${JSON.stringify(byType)}`,
  )
  check(
    'the two formats honoured DIFFERENT counts (per-format, not one global knob)',
    statics !== videos,
    `both formats produced ${statics} — the per-format counts collapsed into one`,
  )

  // Attribution: a variation set is only useful if every version says which
  // lever moved and which value it carried, under one shared test id.
  const varied = run.concepts.filter((c) => /static|video|founder/i.test(c.type))
  check(
    'every variation carries its lever + concrete difference label',
    varied.every((c) => Boolean(c.variationMethod && c.variationLabel)),
    `unlabelled: ${varied
      .filter((c) => !c.variationMethod || !c.variationLabel)
      .map((c) => c.type)
      .join(', ')}`,
  )
  const testIds = new Set(varied.map((c) => c.testId).filter(Boolean))
  check(
    'the whole run shares ONE test id so its versions are comparable',
    testIds.size === 1,
    `expected 1 test id, got ${testIds.size}: ${Array.from(testIds).join(', ')}`,
  )
  const variantIds = varied.map((c) => c.variantId).filter(Boolean)
  check(
    'every version has a distinct variant id',
    new Set(variantIds).size === variantIds.length && variantIds.length === varied.length,
    `variant ids: ${variantIds.join(', ')}`,
  )
  check(
    'variant ids parse as RXN test tokens (so Meta ad names round-trip)',
    variantIds.every((v) => /^RXN-[A-Z0-9]{5}-[A-Z]+$/.test(v ?? '')),
    `unparseable: ${variantIds.filter((v) => !/^RXN-[A-Z0-9]{5}-[A-Z]+$/.test(v ?? '')).join(', ')}`,
  )

  /* -- 4. The pre-flight briefing runs before OPUS's first turn ------------- */
  console.log(`\n${bold('4. Pre-flight briefing')}`)
  if (run.demo) {
    console.log(
      dim('   skipped — the curated demo path walks the layers directly (no orchestrator).'),
    )
  } else {
    check(
      'the mandatory layers were briefed in parallel up front',
      run.steps.some((s) => /briefing .* in parallel/i.test(s)),
      `steps: ${run.steps.slice(0, 6).join(' | ')}`,
    )
  }

  /* -------------------------------- Summary -------------------------------- */
  console.log(`\n${'-'.repeat(46)}`)
  console.log(green(`PASS: ${passed}`))
  console.log(failed > 0 ? red(`FAIL: ${failed}`) : green('FAIL: 0'))
  if (run.demo) {
    console.log(
      dim(
        '\nRan against the curated demo intelligence. Set ANTHROPIC_API_KEY (and VOYAGE_API_KEY + Supabase) to exercise the live network.',
      ),
    )
  }
  console.log()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(red(`\nSelf-test could not run: ${err instanceof Error ? err.message : err}`))
  console.error(dim(`Is the app running at ${BASE_URL}?`))
  process.exit(1)
})
