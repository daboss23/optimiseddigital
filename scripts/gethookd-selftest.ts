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
  check('"all" is the union', all.length === services.length + ecom.length)
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
  check(
    'a minimum run time is sent',
    Number(param('run_time')) > 0,
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

  stubRefusing(['geo'], {
    data: CAPTURED_ROWS.slice(0, 1),
    meta: { total: 12, has_more: false },
    used_credits: 0.01,
    remaining_credits: 59.8,
  })
  const widened = await searchProvenAds({ focus: 'services' })

  check('a refused filter triggers exactly one retry', urls.length === 2, `${urls.length} requests`)
  check(
    'the retry stops sending the name that was refused',
    new URL(urls[1]!).searchParams.get('geo') === null,
  )
  // A refused name is usually a RENAME, not a missing capability. Dropping the
  // country filter outright is what served ads from every market on earth to an
  // account scoped to US + AU, so the alternate spelling is tried FIRST.
  check(
    'the country filter is retried under its other name, not abandoned',
    new URL(urls[1]!).searchParams.get('location') === 'US,AU',
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
