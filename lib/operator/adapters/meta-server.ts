/**
 * The live Meta source — server side.
 *
 * This module is the only place the operator pipeline talks to the Graph API,
 * and it runs on the server because the access token can never reach the
 * browser. The client adapter (`meta.ts`) is a thin HTTP shell over the route
 * that wraps this (`app/api/operator/source/route.ts`); the self-test script
 * imports it directly. One builder, three consumers, no divergence.
 *
 * What the Graph API is asked for, and why each call is not optional:
 *
 * **Daily rows** — `/act_<id>/insights` at `level=ad` with `time_increment=1`
 * over the last 30 complete days. Results are read per action type and mapped
 * onto ONE `PrimaryResultType` per creative (the dominant one, falling back to
 * the campaign objective) — never summed across types. A blended "conversions"
 * total is the exact ambiguity this pipeline exists to remove.
 *
 * **The ranges** — two further insights calls at `level=ad` WITHOUT
 * `time_increment`, one per 7-day evaluation window, reading `impressions`,
 * `reach` and `frequency`. Range frequency is impressions over reach
 * deduplicated across the whole window; it cannot be reconstructed from daily
 * rows at any level of effort, which is why these are separate calls.
 *
 * **Ad identity** — `/act_<id>/ads` with creative + ad set + campaign field
 * expansion: name, created_time, format signals (video_id / object_type), the
 * campaign objective, and targeting (custom audiences present → the audience
 * is not cold). `offerType`, `market`, `hookType` and `tags` are NOT knowable
 * from Meta — they stay empty until the creative-ledger join lands, and the
 * rules are built to tolerate that (EXPLORE simply will not fire untagged).
 *
 * **Baselines** — computed from the pulled snapshots, grouped by result type,
 * then temperature and objective. Thin cohorts are emitted anyway and honestly
 * labelled: the resolver's sufficiency floor is what rejects them, and a
 * rejected narrow cohort is exactly the fallback signal the strength tiering
 * is supposed to see.
 *
 * Failure philosophy: this module THROWS on any Graph failure rather than
 * returning partial figures. A source that silently degrades is how an
 * operator makes a four-hundred-thousand-dollar decision on half an account.
 * The client surface catches the throw and renders its disconnected state.
 */

import {
  graphGet,
  listAccountIds,
  num,
  resultCount,
  type InsightRow,
} from '@/lib/meta-graph'
import {
  resolveMetaCredentials,
  type ResolvedMetaCredentials,
} from '@/lib/operator/adapters/meta-credentials'
import { addDays, todayIn } from '@/lib/operator/dates'
import type {
  AudienceTemperature,
  CreativeFormat,
  CreativeSnapshot,
  DailyMetric,
  DataSourceMetadata,
  PerformanceBaseline,
  PrimaryResultType,
  RangeDeliveryMetric,
} from '@/lib/operator/types'

export class MetaSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaSourceError'
  }
}

export interface OperatorSourcePayload {
  /** Today in the AD ACCOUNT's timezone — the server is authoritative on this. */
  evaluationDate: string
  creatives: CreativeSnapshot[]
  baselines: PerformanceBaseline[]
  metadata: DataSourceMetadata
}

/* ------------------------------- constants ------------------------------- */

/** Days of daily rows pulled. The baselines window and the 7v7 both fit inside. */
const DAILY_LOOKBACK_DAYS = 30
/** Evaluation windows are 7 days — the ranges the fatigue rule reads. */
const WINDOW_DAYS = 7
/** Hard cap on paging followed per call, so a runaway cursor cannot loop forever. */
const MAX_PAGES = 6
const PAGE_TIMEOUT_MS = 20_000
/** Attribution results are treated as still landing for this long. */
const MATURITY_DELAY_HOURS = 48

/* ------------------------------ graph helpers ----------------------------- */

/** graphGet with pagination — follows paging.next (which carries its own auth). */
async function graphGetAll<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T[]> {
  const first = (await graphGet(path, params, token)) as {
    data?: T[]
    paging?: { next?: string }
    error?: { message?: string }
  }
  if (first.error) throw new MetaSourceError(first.error.message ?? 'Graph API error')
  const rows: T[] = [...(first.data ?? [])]

  let next = first.paging?.next
  let pages = 1
  while (next && pages < MAX_PAGES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
    try {
      const res = await fetch(next, { signal: controller.signal })
      const json = (await res.json()) as {
        data?: T[]
        paging?: { next?: string }
        error?: { message?: string }
      }
      if (!res.ok || json.error) {
        throw new MetaSourceError(json.error?.message ?? `Graph paging ${res.status}`)
      }
      rows.push(...(json.data ?? []))
      next = json.paging?.next
      pages += 1
    } finally {
      clearTimeout(timer)
    }
  }
  return rows
}

/**
 * The account the source reads: the one the connection names, else the first
 * the token can see. A token with no accounts is a permissions problem, and it
 * is reported as one rather than read as an empty account.
 */
async function resolveAccountId(credentials: ResolvedMetaCredentials): Promise<string> {
  if (credentials.accountId) return credentials.accountId
  const ids = await listAccountIds(credentials.token)
  if (ids.length === 0) {
    throw new MetaSourceError('The token can see no ad accounts — check its permissions.')
  }
  return ids[0]
}

/* -------------------------------- row types ------------------------------- */

type DailyInsightRow = InsightRow & {
  outbound_clicks?: { action_type: string; value: string }[]
}

interface AdObject {
  id?: string
  name?: string
  created_time?: string
  effective_status?: string
  creative?: { object_type?: string; video_id?: string; image_url?: string }
  adset?: {
    name?: string
    targeting?: { custom_audiences?: unknown[] }
    campaign?: { name?: string; objective?: string }
  }
}

/* -------------------------------- mapping --------------------------------- */

/** Campaign objective → result type, used only when an ad has no actions yet. */
const OBJECTIVE_RESULT_TYPE: Record<string, PrimaryResultType> = {
  OUTCOME_LEADS: 'lead',
  OUTCOME_SALES: 'purchase',
}

const RESULT_TYPES: PrimaryResultType[] = [
  'lead',
  'registration',
  'application',
  'booked_call',
  'purchase',
  'custom',
]

/**
 * The ONE result type a creative is graded on: the dominant action across its
 * own rows, else the campaign objective's outcome, else 'custom'. Summing
 * across types is the blend this pipeline exists to prevent.
 */
function dominantType(rows: DailyInsightRow[], ad?: AdObject): PrimaryResultType {
  const totals = new Map<PrimaryResultType, number>()
  for (const row of rows) {
    for (const type of RESULT_TYPES) {
      const n = resultCount(row, type)
      if (n > 0) totals.set(type, (totals.get(type) ?? 0) + n)
    }
  }
  let best: PrimaryResultType | null = null
  let bestCount = 0
  totals.forEach((count, type) => {
    if (count > bestCount) {
      best = type
      bestCount = count
    }
  })
  if (best) return best
  const objective = ad?.adset?.campaign?.objective
  return (objective && OBJECTIVE_RESULT_TYPE[objective]) || 'custom'
}

/** Outbound clicks where Meta reported them — all-clicks inflates CTR with engagement. */
function clickCount(row: DailyInsightRow): number {
  const outbound = row.outbound_clicks?.find((a) => a.action_type === 'outbound_click')?.value
  return outbound !== undefined ? num(outbound) : num(row.clicks)
}

function formatOf(ad?: AdObject): CreativeFormat {
  if (ad?.creative?.video_id) return 'video'
  if (ad?.creative?.object_type === 'CAROUSEL') return 'carousel'
  return 'static'
}

/**
 * Conservative temperature read: a custom audience in targeting means the ad
 * set is not broad. 'warm', never 'retargeting' — we cannot distinguish a
 * website-visitor audience from a lookalike without extra calls, and a cold
 * creative graded against a retargeting cohort is the specific wrong answer
 * the baseline resolver exists to prevent.
 */
function temperatureOf(ad?: AdObject): AudienceTemperature {
  const custom = ad?.adset?.targeting?.custom_audiences
  return Array.isArray(custom) && custom.length > 0 ? 'warm' : 'cold'
}

function rangeFrom(
  row: InsightRow | undefined,
  window: { since: string; until: string },
  label: 'current' | 'previous',
): RangeDeliveryMetric | null {
  if (!row) return null
  const reach = num(row.reach)
  const impressions = num(row.impressions)
  // No deduplicated reach, no frequency — the honest null the rules handle.
  if (reach <= 0 || impressions <= 0) return null
  return {
    from: window.since,
    to: window.until,
    impressions,
    reach,
    frequency: num(row.frequency) || impressions / reach,
    window: label,
    days: WINDOW_DAYS,
  }
}

/* -------------------------------- baselines ------------------------------- */

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface CreativeWindowStats {
  creative: CreativeSnapshot
  spend: number
  results: number
  /** Null when undeliverable — never an invented zero. */
  costPerResult: number | null
  ctr: number | null
}

function windowStats(creative: CreativeSnapshot): CreativeWindowStats {
  const spend = creative.daily.reduce((s, d) => s + d.spend, 0)
  const results = creative.daily.reduce((s, d) => s + d.primaryResults, 0)
  const clicks = creative.daily.reduce((s, d) => s + d.clicks, 0)
  const impressions = creative.daily.reduce((s, d) => s + d.impressions, 0)
  return {
    creative,
    spend,
    results,
    costPerResult: results > 0 ? spend / results : null,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
  }
}

function baselineFrom(
  members: CreativeWindowStats[],
  key: PerformanceBaseline['key'],
  fallbackLevel: PerformanceBaseline['fallbackLevel'],
  from: string,
  to: string,
): PerformanceBaseline {
  const cprs = members.map((m) => m.costPerResult).filter((v): v is number => v !== null)
  const ctrs = members.map((m) => m.ctr).filter((v): v is number => v !== null)
  return {
    key,
    medianCostPerResult: Math.round(median(cprs) * 100) / 100,
    medianCtr: Math.round(median(ctrs) * 100) / 100,
    creativeCount: members.length,
    resultCount: members.reduce((s, m) => s + m.results, 0),
    from,
    to,
    fallbackLevel,
  }
}

/**
 * Cohort medians from the pulled snapshots. Two levels are emittable from what
 * Meta knows: the exact cohort (result type + temperature + objective) and the
 * result-type pool. `result_and_offer` waits on offer data Meta does not have;
 * `account` would duplicate `result_type` on a single-account feed. The
 * resolver walks past missing levels — that is what it is for.
 */
function buildBaselines(
  creatives: CreativeSnapshot[],
  from: string,
  to: string,
): PerformanceBaseline[] {
  const stats = creatives.map(windowStats)
  const baselines: PerformanceBaseline[] = []

  const cohorts = new Map<string, CreativeWindowStats[]>()
  for (const s of stats) {
    const key = [s.creative.primaryResultType, s.creative.audienceTemperature, s.creative.campaignObjective].join('|')
    const list = cohorts.get(key) ?? []
    list.push(s)
    cohorts.set(key, list)
  }
  cohorts.forEach((members) => {
    const first = members[0].creative
    baselines.push(
      baselineFrom(
        members,
        {
          primaryResultType: first.primaryResultType,
          audienceTemperature: first.audienceTemperature,
          campaignObjective: first.campaignObjective,
        },
        'exact_cohort',
        from,
        to,
      ),
    )
  })

  const byType = new Map<PrimaryResultType, CreativeWindowStats[]>()
  for (const s of stats) {
    const list = byType.get(s.creative.primaryResultType) ?? []
    list.push(s)
    byType.set(s.creative.primaryResultType, list)
  }
  byType.forEach((members, type) => {
    baselines.push(
      baselineFrom(members, { primaryResultType: type }, 'result_type', from, to),
    )
  })

  return baselines
}

/* --------------------------------- main ----------------------------------- */

/**
 * Pull the account and shape it into the operator's DataSource contract.
 * Throws MetaSourceError on any failure — partial data never crosses this seam.
 */
export async function fetchOperatorSource(): Promise<OperatorSourcePayload> {
  // The stored connection (Meta Intelligence settings screen) wins; the
  // META_ACCESS_TOKEN env var is the fallback. Neither → the loud throw the
  // client surface renders as its disconnected state.
  const credentials = await resolveMetaCredentials()
  if (!credentials) {
    throw new MetaSourceError(
      'Meta is not connected — add a System User token on Meta Intelligence or set META_ACCESS_TOKEN.',
    )
  }
  const { token } = credentials

  const accountId = await resolveAccountId(credentials)
  const account = (await graphGet(`act_${accountId}`, { fields: 'timezone_name' }, token)) as {
    timezone_name?: string
  }
  const timezone = account.timezone_name || 'UTC'

  // The server is the clock boundary: today in the ACCOUNT's timezone, so an
  // operator in Sydney reading a New York account gets New York's yesterday.
  const evaluationDate = todayIn(timezone)
  const lastCompleteDay = addDays(evaluationDate, -1)
  const dailyFrom = addDays(lastCompleteDay, -(DAILY_LOOKBACK_DAYS - 1))
  const currentWindow = { since: addDays(lastCompleteDay, -(WINDOW_DAYS - 1)), until: lastCompleteDay }
  const previousWindow = {
    since: addDays(lastCompleteDay, -(2 * WINDOW_DAYS - 1)),
    until: addDays(lastCompleteDay, -WINDOW_DAYS),
  }

  const [dailyRows, currentRows, previousRows, adObjects] = await Promise.all([
    graphGetAll<DailyInsightRow>(
      `act_${accountId}/insights`,
      {
        level: 'ad',
        time_increment: '1',
        time_range: JSON.stringify({ since: dailyFrom, until: lastCompleteDay }),
        fields:
          'ad_id,ad_name,spend,impressions,reach,clicks,outbound_clicks,actions,date_start,date_stop',
        limit: '500',
      },
      token,
    ),
    graphGetAll<InsightRow>(
      `act_${accountId}/insights`,
      {
        level: 'ad',
        time_range: JSON.stringify(currentWindow),
        fields: 'ad_id,impressions,reach,frequency',
        limit: '500',
      },
      token,
    ),
    graphGetAll<InsightRow>(
      `act_${accountId}/insights`,
      {
        level: 'ad',
        time_range: JSON.stringify(previousWindow),
        fields: 'ad_id,impressions,reach,frequency',
        limit: '500',
      },
      token,
    ),
    graphGetAll<AdObject>(
      `act_${accountId}/ads`,
      {
        fields:
          'id,name,created_time,effective_status,creative{object_type,video_id,image_url},adset{name,targeting,campaign{name,objective}}',
        limit: '200',
      },
      token,
    ),
  ])

  const adsById = new Map<string, AdObject>()
  for (const ad of adObjects) if (ad.id) adsById.set(ad.id, ad)

  const rowsByAd = new Map<string, DailyInsightRow[]>()
  for (const row of dailyRows) {
    if (!row.ad_id || !row.date_start) continue
    const list = rowsByAd.get(row.ad_id) ?? []
    list.push(row)
    rowsByAd.set(row.ad_id, list)
  }

  const creatives: CreativeSnapshot[] = []
  rowsByAd.forEach((rows, adId) => {
    rows.sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)))
    if (rows.reduce((s, r) => s + num(r.impressions), 0) <= 0) return

    const ad = adsById.get(adId)
    const type = dominantType(rows, ad)

    const daily: DailyMetric[] = rows.map((r) => ({
      date: String(r.date_start),
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      clicks: clickCount(r),
      primaryResults: resultCount(r, type),
      primaryResultType: type,
    }))

    const ranges: RangeDeliveryMetric[] = []
    const current = rangeFrom(currentRows.find((r) => r.ad_id === adId), currentWindow, 'current')
    const previous = rangeFrom(previousRows.find((r) => r.ad_id === adId), previousWindow, 'previous')
    if (current) ranges.push(current)
    if (previous) ranges.push(previous)

    creatives.push({
      id: adId,
      name: ad?.name || rows[0]?.ad_name || 'Untitled ad',
      format: formatOf(ad),
      // Not knowable from Meta — the creative-ledger join fills these later.
      hookType: 'unknown',
      tags: [],
      launchedAt: ad?.created_time ?? `${daily[0].date}T00:00:00Z`,
      primaryResultType: type,
      audienceTemperature: temperatureOf(ad),
      campaignObjective: ad?.adset?.campaign?.objective,
      daily,
      ranges,
    })
  })

  const metadata: DataSourceMetadata = {
    accountTimezone: timezone,
    attributionWindow: '7-day click, 1-day view',
    lastSyncedAt: new Date().toISOString(),
    completeThrough: lastCompleteDay,
    maturityDelayHours: MATURITY_DELAY_HOURS,
    origin: 'meta',
  }

  return {
    evaluationDate,
    creatives,
    baselines: buildBaselines(creatives, dailyFrom, lastCompleteDay),
    metadata,
  }
}
