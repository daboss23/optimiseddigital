/**
 * Proven-ad source self-test — guards the GetHookd connection.
 *
 * Runs entirely in process against a stubbed transport: no server, no network,
 * and no credits. That matters more here than anywhere else in the codebase,
 * because this source BILLS PER RETURNED ROW — a test suite that hit the live
 * library would charge the account every time CI ran.
 *
 * What it locks down:
 *   - the two ICP focuses stay separated (a service ad and an e-commerce ad are
 *     structurally different creative; an averaged feed teaches neither)
 *   - the real payload shape normalises correctly, asserted against an actual
 *     captured response rather than an invented one
 *   - cost discipline: page size capped, one brand can never fill the feed
 *   - honesty: an unkeyed, rejected or empty source explains itself and never
 *     throws, so the Ad Library keeps rendering its paste-to-clone path
 *
 * Run: npx tsx scripts/gethookd-selftest.ts
 */

import {
  ECOMMERCE_NICHE_IDS,
  SERVICE_NICHE_IDS,
  adToCloneText,
  focusOf,
  gethookdConfigured,
  nicheCsvFor,
  nicheTitle,
  searchProvenAds,
} from '@/lib/gethookd'
import {
  CRAFT_ARCHETYPES,
  MARKETING_NICHE_IDS,
} from '@/lib/gethookd'
import { offerOptions, NO_PREFERENCE } from '@/lib/reactor-inputs'
import {
  MIN_DAYS_ACTIVE,
  echoEvidence,
  isEligible,
  provenAdBlock,
  researchFocus,
  researchProvenAds,
  researchTerms,
  shortlist,
  sparkEvidence,
  researchSummary,
} from '@/lib/gethookd/research'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------ the transport ----------------------------- */

const realFetch = globalThis.fetch
let lastUrl = ''

let urls: string[] = []

/** Serve one canned envelope and record the URL the source actually built. */
function stubFetch(body: unknown, status = 200) {
  urls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    lastUrl = typeof input === 'string' ? input : input.toString()
    urls.push(lastUrl)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

/**
 * Refuse the named parameters the way the live API does, then serve `body` on
 * the retry. This is the exact failure that shipped: the endpoint's names are
 * not its MCP wrapper's names, so a perfectly authenticated request came back
 * "Unrecognized parameter(s): geo, limit, compact".
 */
function stubRefusing(names: string[], body: unknown) {
  urls = []
  let first = true
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    lastUrl = typeof input === 'string' ? input : input.toString()
    urls.push(lastUrl)
    if (first) {
      first = false
      return new Response(
        JSON.stringify({ message: `Unrecognized parameter(s): ${names.join(', ')}` }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

/**
 * Refuse the named parameters on EVERY call, serving `body` only once the
 * request carries none of them.
 *
 * Distinct from `stubRefusing`, which relents on the retry. That one proves a
 * rename succeeds; this one proves what happens when the endpoint knows none
 * of the spellings — the only case where the results really are global and the
 * banner has to say so.
 */
function stubRefusingAlways(names: string[], body: unknown) {
  urls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    lastUrl = typeof input === 'string' ? input : input.toString()
    urls.push(lastUrl)
    const sent = new URL(lastUrl).searchParams
    const offending = names.filter((n) => sent.get(n) !== null)
    if (offending.length) {
      return new Response(
        JSON.stringify({ message: `Unrecognized parameter(s): ${offending.join(', ')}` }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

/** No tier asked for means no tier sent — the stale filter must not be a silent default. */
async function tierIsOffByDefault(): Promise<boolean> {
  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services' })
  return !lastUrl.includes('performance_scores')
}

/** The tier filter still works when explicitly asked for — it is off by default, not gone. */
async function tierIsSendable(): Promise<boolean> {
  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services', tier: 'winning' })
  return lastUrl.includes('performance_scores=winning')
}

/**
 * Refuse a parameter under a list of spellings, accepting only the one named.
 *
 * The rename ladder walks several spellings deep now, because ONE was not
 * enough against the live endpoint: `ad_format` and `run_time` are both
 * refused here under the very names their own MCP wrapper accepts. The run
 * time bar is half of what this platform means by "proven", and losing it is
 * invisible — the duration sort still puts long-running ads on top, so the
 * feed looks right while the bar is simply not applied.
 */
function stubAcceptingOnly(accepted: string, refuse: string[], body: unknown) {
  urls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    lastUrl = typeof input === 'string' ? input : input.toString()
    urls.push(lastUrl)
    const sent = new URL(lastUrl).searchParams
    const offending = refuse.filter((n) => n !== accepted && sent.get(n) !== null)
    if (offending.length) {
      return new Response(
        JSON.stringify({ message: `Unrecognized parameter(s): ${offending.join(', ')}` }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

function restoreFetch() {
  globalThis.fetch = realFetch
}

function param(name: string): string | null {
  return new URL(lastUrl).searchParams.get(name)
}

/**
 * Two rows captured verbatim from the live library — a long-running service ad
 * with duplicate transcripts, and a carousel whose asset_type is the family
 * name. Invented fixtures would have hidden both of the bugs they cover.
 */
const CAPTURED_ROWS = [
  {
    id: 91558092,
    platform: 'facebook,instagram,messenger',
    countries: ['US'],
    display_format: 'video',
    asset_type: 'video',
    title: 'Guaranteed To Land Projects - Or You Don’t Pay!',
    body: 'Exclusively For Painting Companies - See what Zach had to say...',
    landing_page: 'https://projectsondemand.tridas.co/casestudy',
    cta_type: 'LEARN_MORE',
    cta_text: 'Learn more',
    days_active: 1322,
    status: 'active',
    performance_score: 100,
    performance_score_title: 'Winning',
    share_url: 'https://app.gethookd.ai/share/ad/91558092?signature=abc',
    primary_image_url: 'https://app.gethookd.ai/api/v1/media/91558092/300327709/download?signature=def',
    transcripts: [
      { ad_media_id: 300327709, content: 'short version' },
      { ad_media_id: 300327722, content: 'the considerably longer spoken transcript of the ad' },
    ],
    brand: { id: 4382066, name: 'Tridas', logo_url: 'https://app.gethookd.ai/logo?signature=ghi' },
    media: [
      {
        id: 300327709,
        type: 'video',
        thumbnail_url: 'https://app.gethookd.ai/thumb?signature=jkl',
        download_url: 'https://app.gethookd.ai/full?signature=mno',
        video_length_seconds: 59,
      },
    ],
  },
  {
    id: 133241944,
    platform: 'facebook,instagram,audience_network',
    countries: ['US'],
    display_format: 'dco',
    asset_type: 'carousel',
    title: 'Ultimate Solution to Start a Lab',
    body: 'One Stop Solution for Your Lab!',
    landing_page: 'https://www.stonylab.com/lab-equip',
    cta_text: 'Order now',
    days_active: 1636,
    performance_score: 90,
    performance_score_title: 'Optimized',
    // No ad-level still: the normaliser must fall back to the first medium.
    primary_image_url: null,
    transcripts: [],
    brand: { id: 7488502, name: 'StonyLab', logo_url: null },
    media: [
      {
        id: 434468943,
        type: 'video',
        thumbnail_url: 'https://app.gethookd.ai/thumb2?signature=pqr',
        download_url: 'https://app.gethookd.ai/full2?signature=stu',
        video_length_seconds: 6,
      },
    ],
  },
  // No id — an unidentifiable row must be dropped, never rendered as a card
  // whose Clone button points at nothing.
  { title: 'orphan', body: 'no id', brand: { name: 'Ghost' } },
]

async function main() {
  console.log('\nProven-ad source self-test\n')
  const KEY = 'GETHOOKD_API_KEY'
  const originalKey = process.env[KEY]

  /* ------------------------- 1. The ICP stays split ----------------------- */
  console.log('1. ICP focus separation')

  const services = nicheCsvFor('services').split(',').map(Number)
  const ecom = nicheCsvFor('ecommerce').split(',').map(Number)
  const all = nicheCsvFor('all').split(',').map(Number)

  check('services carries Service Business (25)', services.includes(25))
  check('services carries Business/Professional (7)', services.includes(7))
  check('services excludes Fashion (11)', !services.includes(11), 'a DTC vertical leaked into services')
  check('e-commerce carries Fashion (11)', ecom.includes(11))
  check('e-commerce carries Supplements (30)', ecom.includes(30))
  check(
    'e-commerce excludes Service Business (25)',
    !ecom.includes(25),
    'the two focuses blended into one feed',
  )
  check(
    'the two focuses never overlap',
    services.every((id) => !ecom.includes(id)),
    'a niche id is in both focuses, so "Both" would double-count it',
  )
  check(
    '"all" is the union of every focus',
    services.every((id) => all.includes(id)) &&
      ecom.every((id) => all.includes(id)) &&
      MARKETING_NICHE_IDS.every((id) => all.includes(id)),
    'a focus the operator can select must be reachable from "Everything" too',
  )
  check('"all" carries no duplicate ids', new Set(all).size === all.length)
  check(
    'every focused id is a real niche',
    all.every((id) => nicheTitle(id).length > 0),
    'a niche id has no title, so a row would render unlabelled',
  )
  check('focusOf attributes a service niche', focusOf(25) === 'services')
  check('focusOf attributes a DTC niche', focusOf(11) === 'ecommerce')
  check('focusOf refuses an out-of-ICP niche', focusOf(15) === null, 'Government is not the ICP')
  check(
    'the ICP id lists are non-trivial',
    SERVICE_NICHE_IDS.length >= 5 && ECOMMERCE_NICHE_IDS.length >= 8,
  )

  /* ------------------ 2. Unkeyed degrades, never throws ------------------- */
  console.log('\n2. No key connected')
  delete process.env[KEY]

  check('gethookdConfigured() is false with no key', !gethookdConfigured())
  const unkeyed = await searchProvenAds({ focus: 'services' })
  check('unkeyed search resolves rather than throwing', Array.isArray(unkeyed.ads))
  check('unkeyed search reports configured:false', unkeyed.configured === false)
  check('unkeyed search returns no rows', unkeyed.ads.length === 0)
  check(
    'unkeyed note names the env var to set',
    (unkeyed.note ?? '').includes(KEY),
    'the operator cannot act on a note that does not say what is missing',
  )
  check('unkeyed search spends nothing', unkeyed.credits === undefined)

  /* ---------------------- 3. The real payload shape ---------------------- */
  console.log('\n3. Normalising a captured response')
  process.env[KEY] = 'test-key'
  check('gethookdConfigured() is true with a key', gethookdConfigured())

  stubFetch({
    data: CAPTURED_ROWS,
    meta: { total: 365, has_more: true },
    used_credits: 0.03,
    remaining_credits: 59.85,
  })
  const res = await searchProvenAds({ focus: 'services', tier: 'proven', limit: 12 })

  check('the unidentifiable row is dropped', res.ads.length === 2, `got ${res.ads.length} rows`)
  const [tridas, stony] = res.ads
  check('ids are namespaced to the source', tridas!.id === 'gethookd-91558092')
  check('brand name is carried', tridas!.brand === 'Tridas')
  check('video format is read', tridas!.format === 'video')
  check(
    'a dco carousel normalises to carousel',
    stony!.format === 'carousel',
    `got ${stony!.format}`,
  )
  check('the ad-level still wins when present', tridas!.imageUrl!.includes('300327709'))
  check(
    'the still falls back to the first medium',
    stony!.imageUrl === 'https://app.gethookd.ai/thumb2?signature=pqr',
    'a row with no ad-level still would render as a blank card and block the design read',
  )
  check('full-resolution media is kept separately', tridas!.mediaUrl!.includes('full'))
  check(
    'the LONGEST transcript wins',
    tridas!.transcript === 'the considerably longer spoken transcript of the ad',
    'duplicate media carry the same words twice; the short one is a truncation',
  )
  check('a row with no transcript reports none', stony!.transcript === undefined)
  check('run time is carried', tridas!.daysActive === 1322)
  check('the source tier is carried verbatim', tridas!.performanceTier === 'Winning')
  check('video length is carried', tridas!.videoLength === 59)
  check('the platform CSV is split into a list', tridas!.platforms.length === 3)
  check('countries are carried', tridas!.countries[0] === 'US')
  check('the share link is kept', tridas!.shareUrl!.startsWith('https://app.gethookd.ai/share/'))
  check('total is passed through', res.total === 365)
  check('hasMore is passed through', res.hasMore === true)
  check('credits are reported to the operator', res.credits?.used === 0.03)
  check('remaining balance is reported', res.credits?.remaining === 59.85)
  check('a populated feed carries no note', res.note === undefined)
  check('rows are labelled by the focus that found them', tridas!.focus === 'services')

  /* --------------------------- 4. Cost discipline ------------------------- */
  console.log('\n4. Cost discipline')

  check('the ICP niche filter is sent', (param('niche') ?? '').includes('25'))
  check('only active ads are requested', param('status') === 'active')
  // The vendor's stored tier is NOT what makes an ad proven here: it is largely
  // derived from raw run time, so it scores a 2018 record nobody closed as
  // "Winning, 100", and it goes stale between indexing and display — which
  // withholds most of a page and leaves the grid looking half-empty.
  check('the stale tier filter is not applied by default', await tierIsOffByDefault(), 'asking for winning/optimized had the source withhold five of every six rows')
  check('the tier is still available on request', await tierIsSendable())
  check(
    'one brand cannot fill the feed',
    Number(param('ads_per_brand_limit')) > 0 && Number(param('ads_per_brand_limit')) <= 4,
    'an advertiser running 180 creatives would otherwise become the whole page',
  )
  check('longest-running first when unqueried', param('sort_column') === 'days_active')

  /* ------------------- 4b. What makes an ad "proven" ---------------------- */
  console.log('\n4b. Proof of life')

  // THE BUG THIS LOCKS DOWN: with no launch bound, ordering by run time returns
  // the OLDEST RECORDS IN THE DATABASE — 2018 dropshipping ads reporting ~3,200
  // days "live" because nobody ever marked them stopped. The feed filled with
  // ripped-jeans and fried-chicken ads and looked, accurately, like the worst
  // ads on the internet.
  const startedAfter = param('started_after')
  check('a launch-date floor is sent', Boolean(startedAfter), 'without it the sort returns 2018 zombies')
  check(
    'the floor is a real date, inside the window and in the past',
    (() => {
      if (!startedAfter || !/^\d{4}-\d{2}-\d{2}$/.test(startedAfter)) return false
      const ms = Date.parse(`${startedAfter}T00:00:00Z`)
      if (!Number.isFinite(ms)) return false
      const ageDays = (Date.now() - ms) / 86_400_000
      return ageDays > 0 && ageDays < 365 * 4
    })(),
    `sent ${startedAfter}`,
  )
  // The run-time bar was a request param until the endpoint was probed and
  // refused every spelling of it. Launched-recently alone is not proof;
  // still-running-since is — so the bar moved to the rows rather than being
  // dropped, and THAT is what has to hold.
  stubFetch({
    data: [
      { id: 91, title: 'Ran a quarter', description: 'b', days_active: 120, status: 'active', display_format: 'image' },
      { id: 92, title: 'Ran a week', description: 'b', days_active: 7, status: 'active', display_format: 'image' },
    ],
    meta: {},
  })
  const barred = await searchProvenAds({ focus: 'services' })
  check(
    'a minimum run time is enforced',
    barred.ads.length === 1 && (barred.ads[0]!.daysActive ?? 0) >= 90,
    'launched-recently alone is not proof; still-running-since is',
  )

  // A relaxed search matched "contract" inside "contractor" and returned car
  // loan claims and phone plans — billed like any other row.
  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services', query: 'contractor' })
  check(
    'a typed term is matched exactly',
    param('strict_query') === 'true',
    'relaxed matching returned confidently wrong ads and billed for them',
  )

  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services' })
  check(
    'no term means no strict flag',
    param('strict_query') === null,
    'it only governs a query, and sending it bare is noise',
  )

  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'all', limit: 500 })
  check('page size is capped', Number(param('limit')) <= 24, `requested 500, sent ${param('limit')}`)

  await searchProvenAds({ focus: 'all', page: 9999 })
  check('page number is capped', Number(param('page')) <= 20)

  await searchProvenAds({ focus: 'services', query: '  ' })
  check('a whitespace query is not sent as a filter', param('query') === null)

  /* -------------------------- 5. Failure is honest ------------------------ */
  console.log('\n5. Failure reporting')

  stubFetch({ data: [], meta: { total: 0, has_more: false } })
  const empty = await searchProvenAds({ focus: 'ecommerce', query: 'nothing matches this' })
  check('an empty feed explains itself', Boolean(empty.note))
  check('an empty feed quotes the query back', (empty.note ?? '').includes('nothing matches this'))
  check('an empty feed is still configured', empty.configured === true)

  stubFetch({ message: 'Unauthenticated.' }, 401)
  const rejected = await searchProvenAds({ focus: 'services' })
  check('a rejected key does not throw', Array.isArray(rejected.ads))
  check(
    'a rejected key is named as a key problem',
    (rejected.note ?? '').toLowerCase().includes('key'),
    '"unavailable" sends the operator looking in the wrong place',
  )

  stubFetch({ message: 'Out of credits' }, 402)
  const broke = await searchProvenAds({ focus: 'services' })
  check('an exhausted balance says so', (broke.note ?? '').toLowerCase().includes('credit'))

  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED')
  }) as typeof fetch
  const down = await searchProvenAds({ focus: 'services' })
  check('a dead source does not throw', down.ads.length === 0)
  check(
    'a dead source points at paste-to-clone',
    (down.note ?? '').toLowerCase().includes('paste'),
    'the surface must always offer a next move',
  )

  /* ------------------ 6. Refused parameters (the shipped bug) ------------- */
  console.log('\n6. Refused parameter names')

  check(
    'the REST page-size name is sent, not the MCP one',
    param('per_page') !== null && param('limit') === null,
    'the endpoint rejects `limit`; its name here is `per_page`',
  )
  check(
    'no MCP-only payload flag is sent',
    param('compact') === null,
    '`compact` is MCP payload shaping and the REST endpoint refuses it',
  )

  // `location` is the confirmed default now, so THAT is the name a drifting
  // vendor would refuse — and `geo`, which its MCP wrapper takes, is the first
  // spelling the ladder reaches for.
  stubRefusing(['location'], {
    data: CAPTURED_ROWS.slice(0, 1),
    meta: { total: 12, has_more: false },
    used_credits: 0.01,
    remaining_credits: 59.8,
  })
  const widened = await searchProvenAds({ focus: 'services' })

  check('a refused filter triggers exactly one retry', urls.length === 2, `${urls.length} requests`)
  check(
    'the retry stops sending the name that was refused',
    new URL(urls[1]!).searchParams.get('location') === null,
  )
  // A refused name is usually a RENAME, not a missing capability. Dropping the
  // country filter outright is what served ads from every market on earth to an
  // account scoped to US + AU, so the alternate spelling is tried FIRST.
  check(
    'the country filter is retried under its other name, not abandoned',
    new URL(urls[1]!).searchParams.get('geo') === 'US,AU',
    'dropping it silently widens a billed search to the whole world',
  )
  check(
    'the retry keeps every filter that was accepted',
    new URL(urls[1]!).searchParams.get('niche') !== null &&
      new URL(urls[1]!).searchParams.get('status') === 'active',
    'stripping more than was refused would silently widen a billed search',
  )
  check('the retry returns real rows', widened.ads.length === 1)
  check(
    'a rename that WORKED is not reported as widened',
    !(widened.note ?? '').toLowerCase().includes('all markets'),
    'the filter was applied, just under the endpoint\'s own spelling — warning anyway trains the operator to ignore the banner',
  )
  check('a widened result still reports credits', widened.credits?.used === 0.01)

  // The honest failure: every spelling refused. THEN the results really are
  // global, and saying so is the whole point.
  stubRefusingAlways(['geo', 'location', 'countries', 'country'], {
    data: CAPTURED_ROWS.slice(0, 1),
    meta: { total: 12, has_more: false },
  })
  const trulyGlobal = await searchProvenAds({ focus: 'services' })
  check(
    'when no spelling is accepted, the result SAYS it is wider',
    (trulyGlobal.note ?? '').toLowerCase().includes('all markets'),
    'serving global ads to someone who picked their markets must never look like success',
  )

  stubRefusing(['niche', 'status'], { data: [], meta: {} })
  const manyDropped = await searchProvenAds({ focus: 'services' })
  check(
    'a non-country refusal is named in the note',
    (manyDropped.note ?? '').includes('niche'),
    'the operator cannot act on a note that does not say what was dropped',
  )

  // A parameter we never sent must not trigger a pointless second billed call.
  stubRefusing(['some_filter_we_never_send'], { data: [], meta: {} })
  const noRetry = await searchProvenAds({ focus: 'services' })
  check('an irrelevant refusal does not retry', urls.length === 1, `${urls.length} requests`)
  check('an irrelevant refusal still surfaces its message', Boolean(noRetry.note))

  /* ------------------------------ 7. Clone text --------------------------- */
  console.log('\n7. Clone text')

  const text = adToCloneText(tridas!)
  check('clone text carries the headline', text.includes('Guaranteed To Land Projects'))
  check('clone text carries the primary text', text.includes('Painting Companies'))
  check('clone text carries the spoken words', text.includes('considerably longer spoken'))
  check(
    'clone text of a copy-only ad has no empty padding',
    !adToCloneText({ ...stony!, body: '' }).includes('\n\n\n'),
  )

  /* --------------------- 8. Automatic campaign research ------------------- */
  console.log('\n8. Automatic research — the agents\' own evidence')

  /**
   * One image row, shaped like the live payload. `days` is the whole point of
   * this section: the bar is ninety days of actual run time, and every check
   * below exists because the cheapest way to make a thin feed look full is to
   * quietly let a four-day-old ad through.
   */
  const row = (id: number, brand: string, days: number, extra: Record<string, unknown> = {}) => ({
    id,
    asset_type: 'image',
    display_format: 'image',
    title: `Headline ${id}`,
    body: 'A primary text long enough to carry an actual argument about the offer, the proof behind it and the reason to act now rather than later.',
    cta_text: 'Learn more',
    days_active: days,
    performance_score: 70,
    performance_score_title: 'Growing',
    primary_image_url: `https://app.gethookd.ai/still/${id}`,
    countries: ['US'],
    platform: 'facebook,instagram',
    brand: { id, name: brand },
    ...extra,
  })

  /**
   * Serve `body` only when the request carries no `query`, and count requests.
   * `craftBody`, when given, answers the craft rung instead — the one that
   * drops the niche filter and asks for the static archetypes.
   */
  function stubQueryless(body: unknown, craftBody?: unknown) {
    urls = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      lastUrl = typeof input === 'string' ? input : input.toString()
      urls.push(lastUrl)
      const sent = new URL(lastUrl).searchParams
      const isCraft = sent.get('creative_categories') !== null
      const payload = sent.get('query')
        ? { data: [], meta: {} }
        : isCraft
          ? (craftBody ?? { data: [], meta: {} })
          : body
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
  }

  /** Requests that belong to each track, by the filters they carry. */
  const craftUrls = () => urls.filter((u) => new URL(u).searchParams.get('creative_categories') !== null)
  const marketUrls = () => urls.filter((u) => new URL(u).searchParams.get('creative_categories') === null)

  // --- the bar itself -----------------------------------------------------
  const proven = {
    id: 'gethookd-1',
    brand: 'Brand',
    title: 'Headline',
    body: 'Body copy',
    format: 'image' as const,
    imageUrl: 'https://example.test/still',
    daysActive: 120,
    platforms: [],
    countries: [],
    focus: null,
  }
  check('ninety days is the bar', MIN_DAYS_ACTIVE === 90, `bar is ${MIN_DAYS_ACTIVE}`)
  check('a 120-day static ad is eligible', isEligible(proven))
  check('a 4-day ad is not', !isEligible({ ...proven, daysActive: 4 }))
  check('an 89-day ad is not', !isEligible({ ...proven, daysActive: 89 }))
  check('a video ad is not', !isEligible({ ...proven, format: 'video' }))
  check('a carousel is not', !isEligible({ ...proven, format: 'carousel' }))
  check(
    'an ad with no still is not',
    !isEligible({ ...proven, imageUrl: undefined }),
    'this run renders static ads; a reference with no image teaches the design nothing',
  )
  check(
    'an ad with no words is not',
    !isEligible({ ...proven, title: '', body: '' }),
    'a still with no copy is a mood board, not evidence',
  )
  check(
    'a row with unknown run time is not',
    !isEligible({ ...proven, daysActive: undefined }),
    'unknown is not the same as long',
  )
  check(
    'a 3,200-day zombie is not',
    !isEligible({ ...proven, daysActive: 3200 }),
    'the source never closed it; that is a data artefact, not a four-year winner',
  )

  // --- terms --------------------------------------------------------------
  const terms = researchTerms({
    offerName: 'Roofing Lead Machine',
    brief: 'We want more leads for our roofing campaign, targeting homeowners who need a new roof.',
  })
  check('a search term is drawn from the brief', terms.length > 0)
  check(
    'marketing words never become a search term',
    !terms.some((t) => ['leads', 'campaign', 'marketing', 'business'].includes(t)),
    terms.join(', '),
  )
  check('the market noun does', terms.includes('roofing'), terms.join(', '))
  check('at most two terms are ever tried', terms.length <= 2)
  check(
    'a brief with nothing but marketing words yields no term',
    researchTerms({ brief: 'We need more leads from our marketing campaign' }).length === 0,
    'an empty query is the browse rung, which is cheaper and returns more',
  )
  check(
    'a booked-call offer researches service ads',
    researchFocus({ offerType: 'Strategy Call / Application' }) === 'services',
  )
  check(
    'a cart offer researches e-commerce ads',
    researchFocus({ brief: 'drive checkout on our skincare store' }) === 'ecommerce',
  )
  check(
    'an unreadable brief researches both rather than guessing',
    researchFocus({ brief: 'make it good' }) === 'all',
  )

  // --- the operator's OWN category ---------------------------------------
  // The deployment is a digital marketing agency, so it runs two kinds of
  // campaign: its clients' and its own. They are not the same research
  // problem — an ad selling roof repairs and an ad selling a funnel build
  // share no buyer, no objection and no proof.
  check(
    'an agency campaign researches the marketing category',
    researchFocus({ industry: 'digital marketing agency', offerName: 'Funnel Build-Out' }) ===
      'marketing',
  )
  check(
    'named martech routes there too',
    researchFocus({ brief: 'Done-for-you funnel builds on ClickFunnels and Kajabi' }) === 'marketing',
  )
  check(
    'and a client brief still does not',
    researchFocus({ brief: 'more leads for our roofing campaign targeting homeowners' }) ===
      'services',
    'the agency sells TO roofers; the ads worth studying for a roofing campaign are roofing ads',
  )
  check(
    'the marketing focus carries martech, info and agencies',
    MARKETING_NICHE_IDS.includes(3) && MARKETING_NICHE_IDS.includes(9),
    'App/Software is the martech itself; Info is where funnel advertising is most developed',
  )
  check(
    'the everything focus lists no niche twice',
    new Set(nicheCsvFor('all').split(',')).size === nicheCsvFor('all').split(',').length,
    'the focuses overlap on purpose — Service Business sits in both services and marketing',
  )

  // --- provenance: a marketing word is noise, except when it is the subject -
  check(
    'a marketing word in the BRIEF BODY is still noise',
    !researchTerms({ brief: 'we need a better funnel for our marketing campaign' }).includes(
      'funnel',
    ),
    'every client brief is full of this vocabulary; searching it bills per row for nothing',
  )
  check(
    'but the same word NAMED in the offer is the subject',
    researchTerms({ offerName: 'Funnel Build-Out', industry: 'digital marketing agency' }).includes(
      'funnel',
    ),
    'an agency researching its own market must be able to search its own vocabulary',
  )
  check(
    'a real market noun still outranks trade vocabulary beside it',
    researchTerms({ offerName: 'Roof Replacement Quote' }).includes('roof') &&
      !researchTerms({ offerName: 'Roof Replacement Quote' }).includes('quote'),
    '"quote" is the mechanism; searching it returns every lead-gen ad in the library',
  )
  check(
    'a martech brand name survives intact',
    researchTerms({ offerName: 'ClickFunnels & Kajabi setup' }).includes('clickfunnels'),
  )
  check(
    'a three-letter market acronym is not lost to the length floor',
    researchTerms({ offerName: 'Local SEO retainer', industry: 'marketing agency' }).includes('seo'),
    'it should not lose a tiebreak to a longer, vaguer word like "local"',
  )
  check(
    'the offer TYPE reaches the term pool',
    researchTerms({ offerType: 'Free Audit / Teardown', industry: 'digital marketing agency' }).includes(
      'audit',
    ),
    'an audit campaign used to search everything except the word audit',
  )
  check(
    'a generic industry cannot supply every campaign its search terms',
    !researchTerms({
      industry: 'digital marketing agency',
      brief: 'Free ad account audit for founders spending over 10k a month',
    }).includes('digital'),
    '"digital marketing agency" is true of the business and useless for telling one campaign from another',
  )
  check(
    'plain filler never becomes a search term',
    !researchTerms({
      offerName: 'Funnel Build-Out',
      brief: 'business owners who already run ads but their funnel leaks',
    }).some((t) => ['already', 'owners', 'their'].includes(t)),
  )

  /* -------- the offer ladder an agency actually sells against ------------- */
  const offerLabels = offerOptions.map((o) => o.label)
  for (const required of [
    'Free Audit / Teardown',
    'DM / Comment Trigger',
    'Case Study / Proof Asset',
    'Free Trial / Pilot',
    'Done-For-You Retainer',
    'Performance / Risk Reversal',
  ]) {
    check(`the offer ladder carries "${required}"`, offerLabels.includes(required))
  }
  check(
    'every offer type states its own friction, proof burden and CTA frame',
    offerOptions.every((o) => o.directive.trim().length > 80),
    'the label is the menu item; the directive is what actually reaches the orchestrator',
  )
  check(
    'every offer but the sentinel explains itself in the picker',
    offerOptions.filter((o) => o.label !== NO_PREFERENCE).every((o) => Boolean(o.description)),
  )
  check(
    'the risk-reversal offer carries its compliance constraint',
    /no earnings claims|compliance/i.test(
      offerOptions.find((o) => o.label === 'Performance / Risk Reversal')?.directive ?? '',
    ),
    'a guarantee offer is the one most likely to write an unlawful claim',
  )
  check(
    'the case-study offer forbids borrowing a result',
    /never (manufacture|borrow)/i.test(
      offerOptions.find((o) => o.label === 'Case Study / Proof Asset')?.directive ?? '',
    ),
    'the proof IS the offer here, which is exactly when one gets invented',
  )

  // --- the ladder ---------------------------------------------------------
  stubQueryless({
    data: [row(1, 'Alpha', 300), row(2, 'Beta', 200), row(3, 'Gamma', 150), row(4, 'Delta', 95)],
    meta: {},
    used_credits: 0.04,
    remaining_credits: 50,
  })
  const climbed = await researchProvenAds({ offerName: 'Roofing Lead Machine' })
  check('the ladder falls back to the unqueried browse', climbed.market.length >= 3)
  check(
    'and it stops the moment it has enough',
    marketUrls().length <= 3,
    `${marketUrls().length} market requests — every one of them is billed`,
  )
  check(
    'no rung lowered the bar to fill a feed',
    climbed.ads.every((a) => (a.daysActive ?? 0) >= 90),
    'this layer re-checks every row itself — the API cannot be trusted to have',
  )
  check(
    'every reference is a static image',
    climbed.ads.every((a) => a.format === 'image'),
    'the design read needs a still, and the endpoint has no format filter to ask',
  )
  check(
    'every rung asked for live ads only',
    urls.every((u) => new URL(u).searchParams.get('status') === 'active'),
  )
  check(
    'no rung launched an unbounded page',
    urls.every((u) => Number(new URL(u).searchParams.get('per_page')) <= 8),
    'page size is the cost ceiling, and it is set before anything runs',
  )
  check('the path taken is reported', climbed.steps.length >= 1)
  check('every step names the pool it was filling', climbed.steps.every((s) => s.pool))
  check('credits spent are carried back', (climbed.credits?.used ?? 0) > 0)
  check(
    'the shortlist is ordered by run time',
    climbed.market[0]!.daysActive === 300,
    'the longest-running ad leads — that is the only direct evidence here',
  )

  // --- nothing qualifies --------------------------------------------------
  stubFetch({ data: [row(9, 'Fresh', 5)], meta: {} })
  const none = await researchProvenAds({ offerName: 'Roofing Lead Machine' })
  check('a corpus of fresh ads yields no references', none.ads.length === 0)
  check('and neither pool is filled', none.market.length === 0 && none.craft.length === 0)
  check('and it says so rather than lowering the bar', Boolean(none.note))
  check('the note names the bar', (none.note ?? '').includes('90'))
  check(
    'the ladder is bounded even when every rung is empty',
    urls.length <= 4,
    `${urls.length} billed requests`,
  )
  check(
    'an empty research set tells OPUS not to claim external validation',
    provenAdBlock(none).includes('Do not present any concept as validated'),
  )
  check('an empty research set gives SPARK nothing to read', sparkEvidence(none) === '')
  check('an empty research set gives ECHO nothing to read', echoEvidence(none) === '')

  // --- one advertiser cannot own the briefing -----------------------------
  stubQueryless({
    data: [
      row(11, 'Loud', 400),
      row(12, 'Loud', 390),
      row(13, 'Loud', 380),
      row(14, 'Loud', 370),
      row(15, 'Quiet', 100),
    ],
    meta: {},
  })
  const spread = await researchProvenAds({ offerName: 'Roofing Lead Machine' })
  check(
    'one advertiser cannot fill the reference set',
    spread.ads.filter((a) => a.brand === 'Loud').length <= 2,
    spread.ads.map((a) => a.brand).join(', '),
  )
  check('a second advertiser still makes it in', spread.ads.some((a) => a.brand === 'Quiet'))

  /* ------------ the two pools: breadth for design, not for copy ----------- */

  stubQueryless(
    { data: [row(41, 'Local Plumber', 200), row(42, 'Local Legal', 150)], meta: {} },
    {
      data: [
        row(51, 'Supplement Co', 600),
        row(52, 'Skincare Co', 500),
        // No headline. The archetype tag does not make an untreated product
        // photo a construction worth learning from.
        row(53, 'Watch Reseller', 480, { title: null }),
      ],
      meta: {},
    },
  )
  const split = await researchProvenAds({ offerName: 'Roofing Lead Machine' })

  check(
    'the craft rung drops the niche filter',
    craftUrls().every((u) => new URL(u).searchParams.get('niche') === null),
    'construction transfers between verticals; the market scope is what keeps the ARGUMENT honest',
  )
  check(
    'and narrows on static archetypes instead',
    craftUrls().every(
      (u) => new URL(u).searchParams.get('creative_categories') === CRAFT_ARCHETYPES.join(','),
    ),
    'breadth without the archetypes returns the market at large, most of it an untreated photo',
  )
  check(
    'the market rungs keep the niche filter',
    marketUrls().every((u) => (new URL(u).searchParams.get('niche') ?? '').length > 0),
  )
  check('exactly one craft search is ever run', craftUrls().length === 1, `${craftUrls().length}`)
  check('the craft pool is filled', split.craft.length > 0)
  check('the market pool is filled', split.market.length > 0)
  check(
    'a craft row with no headline is rejected',
    !split.craft.some((a) => a.brand === 'Watch Reseller'),
    'the library files untreated product photos under an archetype too',
  )
  check(
    'the pools never share a row',
    split.craft.every((c) => !split.market.some((m) => m.id === c.id)),
  )

  check(
    'ECHO is given the on-market ads ONLY',
    split.market.every((a) => echoEvidence(split).includes(a.brand)) &&
      split.craft.every((a) => !echoEvidence(split).includes(a.brand)),
    'a DTC ad sells a purchase in one line; a service ad sells a conversation. Widening this pool is the one widening that makes the ads worse',
  )
  check(
    'SPARK is given both, in labelled sets',
    split.market.every((a) => sparkEvidence(split).includes(a.brand)) &&
      split.craft.every((a) => sparkEvidence(split).includes(a.brand)),
  )
  check(
    'and SPARK is told the craft set is construction only',
    /CONSTRUCTION ONLY/.test(sparkEvidence(split)),
  )
  check(
    'OPUS is told which set carries the argument and which the construction',
    /ARGUMENT/.test(provenAdBlock(split)) && /CONSTRUCTION/.test(provenAdBlock(split)),
  )
  check(
    'the telemetry line names the mix',
    /on-market/.test(researchSummary(split)) && /best-built/.test(researchSummary(split)),
  )

  // Craft alone is a real state, and it must not be passed off as market fit.
  stubQueryless({ data: [], meta: {} }, { data: [row(61, 'Supplement Co', 600)], meta: {} })
  const craftOnly = await researchProvenAds({ offerName: 'Roofing Lead Machine' })
  check('craft can stand alone when nothing on-market qualifies', craftOnly.craft.length === 1)
  check('ECHO gets nothing rather than the wrong market', echoEvidence(craftOnly) === '')
  check(
    'and the gap is stated, not hidden',
    /construction only/i.test(craftOnly.note ?? ''),
    craftOnly.note ?? '(no note)',
  )

  // --- deduplication ------------------------------------------------------
  const dupes = shortlist(
    [
      { ...proven, id: 'gethookd-20', daysActive: 300 },
      { ...proven, id: 'gethookd-20', daysActive: 300 },
      { ...proven, id: 'gethookd-21', title: 'Different', body: 'Different body', daysActive: 250 },
    ],
    [],
  )
  check('the same ad id is never listed twice', dupes.length === 2)
  check(
    'the same words under two ad ids are one reference',
    shortlist(
      [
        { ...proven, id: 'gethookd-30', title: 'Same', body: 'Same body', daysActive: 300 },
        { ...proven, id: 'gethookd-31', title: 'Same', body: 'Same body', daysActive: 280 },
      ],
      [],
    ).length === 1,
    'the source collapses copy variants per request, not across the ladder',
  )

  // --- what the agents are actually told ----------------------------------
  const borrow = 'competitor'
  check(
    'SPARK is told these ads belong to somebody else',
    sparkEvidence(climbed).toLowerCase().includes(borrow),
    'without it, the shortest path to a strong ad is lifting a competitor\'s numbers',
  )
  check('ECHO is told the same', echoEvidence(climbed).toLowerCase().includes(borrow))
  check('OPUS is told the same', provenAdBlock(climbed).toLowerCase().includes(borrow))
  check(
    'the evidence carries the proof, not just the words',
    sparkEvidence(climbed).includes('300 days live'),
  )
  check('ECHO gets the primary text', echoEvidence(climbed).includes('Primary text'))
  check('SPARK gets the on-ad headline', sparkEvidence(climbed).includes('On-ad headline'))

  /* ------------------- the ladder walks past the first alias ---------------- */

  // Depth matters: `geo` was refused, and so was the first spelling tried
  // after it. A ladder one rename deep would have dropped the country filter
  // and served ads from every market on earth to an account scoped to US + AU.
  const COUNTRY_SPELLINGS = ['geo', 'location', 'countries', 'country']

  stubAcceptingOnly('countries', COUNTRY_SPELLINGS, { data: [], meta: {} })
  const deepRename = await searchProvenAds({ focus: 'services' })
  check(
    'a filter refused twice is found on the third spelling',
    new URL(lastUrl).searchParams.get('countries') === 'US,AU',
    'one alias was not enough against the live endpoint',
  )
  check(
    'a rename that WORKED is not reported as dropped',
    !(deepRename.note ?? '').toLowerCase().includes('all markets'),
    'warning about a filter that ran trains the operator to ignore the banner',
  )

  stubRefusingAlways(COUNTRY_SPELLINGS, { data: [], meta: {} })
  const allRefused = await searchProvenAds({ focus: 'services' })
  check(
    'every spelling refused still returns a feed',
    Array.isArray(allRefused.ads),
    'one honest failure beats an empty tab',
  )
  check(
    'and says the results are wider than asked for',
    (allRefused.note ?? '').toLowerCase().includes('all markets'),
    'silently serving global ads to someone who picked their markets looks like success',
  )
  check(
    'the ladder is bounded, not an open walk',
    urls.length <= 1 + 3 + 1,
    'as-asked + MAX_ALIAS_ROUNDS + the final drop',
  )

  /* ------------------------ the craft pool and ordering -------------------- */

  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services', scope: 'library' })
  check(
    'the craft pool drops the niche filter',
    new URL(lastUrl).searchParams.get('niche') === null,
    'breadth is the whole point of that pool',
  )

  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services', sort: 'newest' })
  check('newest-first orders by launch date', new URL(lastUrl).searchParams.get('sort_column') === 'start_date')
  check(
    'an unqueried newest sort does not ask for strict ordering',
    new URL(lastUrl).searchParams.get('sort_strict') === null,
    'relevance never led, so there is nothing to override',
  )

  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services', sort: 'newest', query: 'roofing' })
  check(
    'a queried newest sort DOES, or relevance silently keeps the old order',
    new URL(lastUrl).searchParams.get('sort_strict') === 'true',
  )

  stubFetch({ data: [], meta: {} })
  await searchProvenAds({ focus: 'services' })
  check(
    'longest-running stays the default',
    new URL(lastUrl).searchParams.get('sort_column') === 'days_active',
  )

  const headlineRows = {
    data: [
      { id: 1, title: 'Before and after in 14 days', description: 'body', days_active: 200, status: 'active', display_format: 'image' },
      { id: 2, title: '', description: 'body', days_active: 200, status: 'active', display_format: 'image' },
    ],
    meta: {},
  }
  stubFetch(headlineRows)
  const withHeadline = await searchProvenAds({ focus: 'services', requireHeadline: true })
  check(
    'a craft reference without a headline is not served',
    withHeadline.ads.every((a) => a.title.trim().length > 0),
    'the library files untreated product photos under an archetype too',
  )
  stubFetch(headlineRows)
  const noRule = await searchProvenAds({ focus: 'services' })
  check(
    'and the market pool is left alone',
    noRule.ads.length >= withHeadline.ads.length,
    'the argument matters more than the treatment there',
  )

  /* ------------- the bars the endpoint cannot apply, applied here ---------- */

  const MIXED = {
    data: [
      { id: 11, title: 'Static that qualifies', description: 'b', days_active: 200, status: 'active', display_format: 'image' },
      { id: 12, title: 'Video row', description: 'b', days_active: 200, status: 'active', display_format: 'video' },
      { id: 13, title: 'Too new', description: 'b', days_active: 30, status: 'active', display_format: 'image' },
      { id: 14, title: 'No run time reported', description: 'b', status: 'active', display_format: 'image' },
    ],
    meta: { total: 4, has_more: false },
    used_credits: 0.04,
  }

  stubFetch(MIXED)
  const statics = await searchProvenAds({ focus: 'services', format: 'image' })
  check(
    'a video row is not served to a page that asked for Static',
    statics.ads.every((a) => a.format === 'image'),
    'the endpoint refuses every spelling of the format filter, so this is the only place it can hold',
  )
  check(
    'an ad short of the 90-day bar is not served',
    statics.ads.every((a) => (a.daysActive ?? 0) >= 90),
    'the other half of what "proven" means here',
  )
  check(
    'a row reporting no run time gets no benefit of the doubt',
    !statics.ads.some((a) => a.daysActive === undefined),
    'it cannot clear a bar it does not report against',
  )
  check('exactly the qualifying row survives', statics.ads.length === 1 && statics.ads[0]!.id.endsWith('11'))
  check(
    'and the rows billed-for-then-binned are counted out loud',
    (statics.note ?? '').includes('3 of 4'),
    'the operator pays per returned row — a page that spent four to show one owes them that number',
  )

  stubFetch(MIXED)
  await searchProvenAds({ focus: 'services', format: 'image' })
  check(
    'no refused filter is sent at all by default',
    new URL(lastUrl).searchParams.get('ad_format') === null &&
      new URL(lastUrl).searchParams.get('run_time') === null,
    'probed dead under every spelling — sending them cost a round trip per search and bought nothing',
  )

  process.env.GETHOOKD_FORMAT_PARAM = 'display_format'
  stubFetch(MIXED)
  await searchProvenAds({ focus: 'services', format: 'image' })
  check(
    'a name confirmed by the probe narrows the search server-side',
    new URL(lastUrl).searchParams.get('display_format') === 'images',
    'so the feed stops paying for rows it is about to discard',
  )
  delete process.env.GETHOOKD_FORMAT_PARAM

  /* ---------------------------------- done -------------------------------- */
  restoreFetch()
  if (originalKey === undefined) delete process.env[KEY]
  else process.env[KEY] = originalKey

  console.log(
    failures === 0
      ? '\nAll proven-ad source checks passed.\n'
      : `\n${failures} check${failures === 1 ? '' : 's'} failed.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  restoreFetch()
  console.error('\nSelf-test crashed:', err)
  process.exit(1)
})
