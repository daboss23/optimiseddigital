/**
 * Probe the GetHookd REST endpoint for its current filter names.
 *
 * The MCP wrapper and the REST endpoint do NOT share a vocabulary: the wrapper
 * takes `geo`, `limit` and `compact`, and the endpoint answers
 * "Unrecognized parameter(s): geo, limit, compact". That mismatch shipped an Ad
 * Library tab that authenticated perfectly and returned nothing, which is the
 * expensive kind of bug — everything looks connected.
 *
 * Rather than guess a name and ship it, this asks the API directly, the same
 * way `npm run muapi:slugs` asks Muapi which model slugs are real.
 *
 * Run: GETHOOKD_API_KEY=... npx tsx scripts/gethookd-params.ts
 *
 * COST: each ACCEPTED probe returns one row (~0.01 credits); a rejected one is
 * refused before the search runs and costs nothing. A full run is under 0.1
 * credits. `per_page=1` is what keeps it there — never raise it.
 */

const BASE = (process.env.GETHOOKD_API_BASE || 'https://app.gethookd.ai/api/v1').replace(/\/+$/, '')
const KEY = (process.env.GETHOOKD_API_KEY ?? '').trim()

/** Names this API plausibly uses for the country filter, likeliest first. */
const COUNTRY_CANDIDATES = [
  'geo',
  'countries',
  'country',
  'location',
  'locations',
  'geo_locations',
  'ad_reached_countries',
]

/** Names for the page-size filter. `per_page` is the convention elsewhere here. */
const PAGE_SIZE_CANDIDATES = ['per_page', 'limit', 'page_size', 'results_per_page']

/**
 * Names for the creative-format filter. Refused as `ad_format` in production,
 * which silently serves video and carousel rows to an operator who selected
 * Image — and every card's design read needs a still.
 */
const FORMAT_CANDIDATES = [
  'ad_format',
  'format',
  'ad_formats',
  'formats',
  'asset_type',
  // Round two, after all five above were refused. These are the names the
  // ROWS carry, which is the likeliest vocabulary for a filter over them.
  'display_format',
  'asset_types',
  'display_formats',
  'media_type',
  'creative_format',
  'ad_type',
]

/**
 * Names for the minimum-run-time filter — the 90-day bar, half of what this
 * platform means by "proven". Refused as `run_time` in production, and its
 * absence is invisible: the duration sort still puts long-running ads on top,
 * so the feed looks right while the bar is simply not applied.
 */
const RUN_TIME_CANDIDATES = [
  'run_time',
  'min_days_active',
  'days_active_min',
  'min_run_time',
  // Round two. `days_active` is what the row calls the field and what
  // sort_column accepts as a value, so it is the likeliest bare spelling —
  // and it was missing from the first batch entirely.
  'days_active',
  'min_days',
  'days_running',
  'active_days',
  'runtime',
]

interface Probe {
  ok: boolean
  rows: number
  unrecognised: string[]
  message?: string
  status: number
}

function unrecognisedParams(message: string | undefined): string[] {
  if (!message) return []
  const m = /unrecognized parameter\(s\)\s*:\s*(.+)/i.exec(message)
  if (!m) return []
  return m[1]!
    .split(',')
    .map((s) => s.trim().replace(/[.'"`]/g, ''))
    .filter(Boolean)
}

async function probe(params: Record<string, string | number>): Promise<Probe> {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) q.set(k, String(v))
  try {
    const res = await fetch(`${BASE}/explore?${q.toString()}`, {
      headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    })
    const json = (await res.json().catch(() => null)) as {
      data?: unknown[]
      message?: string
      errors?: unknown
    } | null
    const message = json?.message
    return {
      ok: res.ok && !json?.errors && Array.isArray(json?.data),
      rows: Array.isArray(json?.data) ? json!.data!.length : 0,
      unrecognised: unrecognisedParams(message),
      message,
      status: res.status,
    }
  } catch (err) {
    return {
      ok: false,
      rows: 0,
      unrecognised: [],
      message: err instanceof Error ? err.message : 'request failed',
      status: 0,
    }
  }
}

/**
 * Find the first candidate the endpoint accepts. A name that comes back in
 * "Unrecognized parameter(s)" is a definite no; anything else is treated as a
 * yes, since a filter that matches nothing is still a filter that EXISTS.
 */
async function findName(
  label: string,
  candidates: string[],
  value: string | number,
  base: Record<string, string | number>,
): Promise<string | null> {
  console.log(`\n${label}`)
  for (const name of candidates) {
    const res = await probe({ ...base, [name]: value })
    if (res.unrecognised.includes(name)) {
      console.log(`  ✗ ${name.padEnd(22)} rejected by name`)
      continue
    }
    if (res.ok) {
      console.log(`  ✓ ${name.padEnd(22)} ACCEPTED — ${res.rows} row(s) returned`)
      return name
    }
    console.log(`  ? ${name.padEnd(22)} ${res.status} ${res.message ?? 'no message'}`)
  }
  return null
}

async function main() {
  if (!KEY) {
    console.error(
      '\nGETHOOKD_API_KEY is not set.\n\n' +
        'Run it with the key in front of the command so it never lands in a file:\n' +
        '  GETHOOKD_API_KEY=your_key npx tsx scripts/gethookd-params.ts\n',
    )
    process.exit(1)
  }

  console.log(`\nProbing ${BASE}/explore\n${'─'.repeat(52)}`)

  // Baseline with nothing but a niche, to prove auth and separate a bad key
  // from a bad parameter name before any candidate is blamed.
  const baseline = await probe({ niche: '25' })
  if (!baseline.ok) {
    console.error(
      `\nThe baseline request failed (${baseline.status}): ${baseline.message ?? 'no message'}\n` +
        'That is the key or the endpoint, not a parameter name. Nothing else here will be meaningful.\n',
    )
    process.exit(1)
  }
  console.log(`\n✓ Authenticated — baseline returned ${baseline.rows} row(s)`)

  const pageSize = await findName('Page size', PAGE_SIZE_CANDIDATES, 1, { niche: '25' })
  const sizeBase: Record<string, string | number> = { niche: '25' }
  if (pageSize) sizeBase[pageSize] = 1

  const country = await findName('Country filter', COUNTRY_CANDIDATES, 'US', sizeBase)
  const format = await findName('Creative format', FORMAT_CANDIDATES, 'images', sizeBase)
  const runTime = await findName('Minimum run time', RUN_TIME_CANDIDATES, 90, sizeBase)

  console.log(`\n${'─'.repeat(52)}\nResult\n`)
  console.log(`  page size     ${pageSize ?? 'NONE ACCEPTED'}`)
  console.log(`  country       ${country ?? 'NONE ACCEPTED'}`)
  console.log(`  format        ${format ?? 'NONE ACCEPTED'}`)
  console.log(`  run time      ${runTime ?? 'NONE ACCEPTED'}`)

  if (country && country !== 'geo') {
    console.log(
      `\nSet this in Vercel so the country filter works again:\n\n` +
        `  GETHOOKD_GEO_PARAM=${country}\n`,
    )
  } else if (country === 'geo') {
    console.log('\nThe default is already correct — no env var needed.\n')
  } else {
    console.log(
      '\nNo country filter name was accepted. The tab still works; it returns\n' +
        'ads from every market and says so. Leave GETHOOKD_GEO_PARAM unset.\n',
    )
  }

  for (const [label, found, sent] of [
    ['format', format, 'ad_format'],
    ['run time', runTime, 'run_time'],
  ] as const) {
    if (found && found !== sent) {
      const envVar = label === 'format' ? 'GETHOOKD_FORMAT_PARAM' : 'GETHOOKD_RUN_TIME_PARAM'
      console.log(
        `\nThe ${label} filter answers to "${found}". Set this so the search narrows\n` +
          `  server-side instead of paying for rows it discards:\n\n` +
          `  ${envVar}=${found}\n`,
      )
    } else if (!found) {
      console.log(
        `\nNo ${label} filter name was accepted — this endpoint does not appear to have\n` +
          `  one. Nothing is sent, and the bar is enforced on the returned rows instead,\n` +
          `  which is authoritative. The cost is that discarded rows were still billed;\n` +
          `  the feed reports how many.\n`,
      )
    }
  }

  if (pageSize && pageSize !== 'per_page') {
    console.log(`The page-size name is "${pageSize}", not "per_page" — tell Claude to change it in lib/gethookd/index.ts.\n`)
  }
}

main().catch((err) => {
  console.error('\nProbe crashed:', err)
  process.exit(1)
})

// This file declares top-level names (KEY, probe, main) that other scripts in
// this folder also use. Without an export it is a global script, not a module,
// and those names collide at compile time.
export {}
