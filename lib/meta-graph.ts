import crypto from 'crypto'
import {
  heroAccents,
  metaAgentInsights,
  metaAudienceBreakdown,
  metaLearningStats,
  metaPlacementBreakdown,
  metaPrimaryResultType,
  metaThresholds,
  metricAccents,
  money,
  type CreativeTrend,
  type MetaAd,
  type MetaDashboard,
  type MetaKpi,
  type MetaMetric,
  type ResultSlice,
  type TrendPoint,
} from '@/lib/meta-data'
import { buildDemoDashboard, buildEmptyDashboard } from '@/lib/meta-demo'
import {
  RESULT_LABELS,
  costLabel,
  evaluateStatus,
  type PrimaryResultType,
  type StatusThresholds,
} from '@/lib/creative-status'
import {
  DEFAULT_PRESET,
  graphTimeRange,
  previousRange,
  rangeDays,
  rangeFromPreset,
  rangeLabel,
  trendBuckets,
  type DateRange,
} from '@/lib/date-range'
import { demoDataEnabled } from '@/lib/demo-mode'
import { resolveMetaCredentials } from '@/lib/operator/adapters/meta-credentials'

/**
 * Meta Marketing API client (direct Graph API).
 *
 * This is the production path for live ad performance — a System User access
 * token calling graph.facebook.com directly, independent of the MCP connector
 * the Campaign Reactor agent uses. It powers the /meta dashboard.
 *
 * EVERY pull is scoped to the caller's `DateRange`: totals, per-ad rows, the
 * trend series and the comparison window all use the same `time_range`, so the
 * page can never mix two windows. Per CLAUDE.md it never throws — a failure
 * degrades to the curated demo set and reports the reason on `error`, which the
 * UI surfaces rather than hiding.
 *
 * Credentials come from `resolveMetaCredentials` — the connection stored from
 * the Meta Intelligence settings screen first, the META_ACCESS_TOKEN env var
 * as the fallback. Optional env: META_APP_SECRET (adds appsecret_proof),
 * META_API_VERSION (default v19.0), META_LIVE_MIN_SPEND (default 0 — a
 * connected account is live from the first dollar; raise it only to hold demo
 * data until spend proves the account), META_TARGET_COST_PER_RESULT.
 */

const GRAPH_BASE = 'https://graph.facebook.com'
const FETCH_TIMEOUT_MS = 6000

export function metaApiConfigured(): boolean {
  return Boolean(process.env.META_ACCESS_TOKEN)
}

function apiVersion(): string {
  return process.env.META_API_VERSION || 'v19.0'
}

function liveMinSpend(): number {
  const raw = Number(process.env.META_LIVE_MIN_SPEND)
  // Default 0: a connected account shows its own numbers from the first
  // dollar. The floor exists only for deployments that want demo data to hold
  // until the account proves itself — set META_LIVE_MIN_SPEND to raise one.
  return Number.isFinite(raw) && raw >= 0 ? raw : 0
}

// Meta's recommended request signing: HMAC-SHA256 of the access token keyed by
// the app secret. Only added when META_APP_SECRET is configured.
function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

// Exported so the performance-ingest layer (lib/meta-ingest.ts) reuses the same
// signed, timeout-guarded Graph plumbing instead of duplicating it.
//
// `token` is passed explicitly wherever the credentials were resolved from the
// stored connection; left unset it falls back to the deployment environment,
// so every pre-existing caller keeps working unchanged.
export async function graphGet(
  path: string,
  params: Record<string, string>,
  token?: string,
): Promise<unknown> {
  const resolvedToken = token ?? process.env.META_ACCESS_TOKEN
  if (!resolvedToken) throw new Error('META_ACCESS_TOKEN not configured')

  const url = new URL(`${GRAPH_BASE}/${apiVersion()}/${path}`)
  url.searchParams.set('access_token', resolvedToken)
  const proof = appSecretProof(resolvedToken)
  if (proof) url.searchParams.set('appsecret_proof', proof)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    const json = (await res.json()) as { error?: { message?: string } }
    if (!res.ok || json.error) {
      throw new Error(json.error?.message || `Graph API ${res.status}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------- parsing ---------------------------------- */

export type InsightRow = {
  spend?: string
  impressions?: string
  clicks?: string
  ctr?: string
  cpc?: string
  cpm?: string
  reach?: string
  frequency?: string
  ad_id?: string
  ad_name?: string
  campaign_name?: string
  date_start?: string
  date_stop?: string
  actions?: { action_type: string; value: string }[]
  purchase_roas?: { action_type: string; value: string }[]
  video_3_sec_watched_actions?: { action_type: string; value: string }[]
  outbound_clicks_ctr?: { action_type: string; value: string }[]
}

/**
 * Meta action types mapped onto the result vocabulary the platform speaks.
 * Deliberately explicit: a booked call is not a lead, a registration is not an
 * application, and nothing here rolls them into one "conversions" number.
 */
const RESULT_ACTION_TYPES: Record<PrimaryResultType, string[]> = {
  lead: ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
  application: ['submit_application', 'offsite_conversion.fb_pixel_submit_application'],
  booked_call: ['schedule', 'offsite_conversion.fb_pixel_schedule', 'onsite_conversion.schedule'],
  registration: ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration'],
  purchase: ['purchase', 'offsite_conversion.fb_pixel_purchase'],
  custom: ['offsite_conversion.fb_pixel_custom'],
}

/** Count one result type on an insight row. */
export function resultCount(row: InsightRow, type: PrimaryResultType): number {
  const wanted = new Set(RESULT_ACTION_TYPES[type])
  return (row.actions ?? [])
    .filter((a) => wanted.has(a.action_type))
    .reduce((sum, a) => sum + num(a.value), 0)
}

/** The full result mix on a row — every type counted separately. */
export function resultMix(row: InsightRow): ResultSlice[] {
  return (Object.keys(RESULT_ACTION_TYPES) as PrimaryResultType[])
    .map((type) => ({ type, count: Math.round(resultCount(row, type)) }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** The dominant result type — what an account-wide cost figure is the cost OF. */
export function dominantResult(mix: ResultSlice[]): PrimaryResultType {
  return mix[0]?.type ?? metaPrimaryResultType
}

const CONVERSION_ACTIONS = new Set([
  'lead',
  'purchase',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.lead_grouped',
])

export function num(v: unknown): number {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function conversions(row: InsightRow): number {
  return (row.actions ?? [])
    .filter((a) => CONVERSION_ACTIONS.has(a.action_type))
    .reduce((sum, a) => sum + num(a.value), 0)
}

export function roas(row: InsightRow): number {
  return num(row.purchase_roas?.[0]?.value)
}

/* ------------------------------ live pulls -------------------------------- */

/** The accounts a token can see, with names — the connect flow's picker data. */
export async function listAccounts(token?: string): Promise<{ id: string; name: string }[]> {
  const json = (await graphGet('me/adaccounts', { fields: 'account_id,name', limit: '50' }, token)) as {
    data?: { account_id?: string; name?: string }[]
  }
  return (json.data ?? [])
    .filter((d): d is { account_id: string; name?: string } => Boolean(d.account_id))
    .map((d) => ({ id: d.account_id, name: d.name || d.account_id }))
}

export async function listAccountIds(token?: string): Promise<string[]> {
  return (await listAccounts(token)).map((a) => a.id)
}

/** Account totals for exactly the requested window. */
async function accountInsights(
  accountId: string,
  range: DateRange,
  token?: string,
): Promise<InsightRow | null> {
  const json = (await graphGet(
    `act_${accountId}/insights`,
    {
      fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,purchase_roas',
      time_range: graphTimeRange(range),
    },
    token,
  )) as { data?: InsightRow[] }
  return json.data?.[0] ?? null
}

async function topAds(accountId: string, range: DateRange, token?: string): Promise<InsightRow[]> {
  const json = (await graphGet(
    `act_${accountId}/insights`,
    {
      level: 'ad',
      fields:
        'ad_id,ad_name,spend,ctr,impressions,frequency,actions,purchase_roas,video_3_sec_watched_actions,outbound_clicks_ctr,date_start,date_stop',
      time_range: graphTimeRange(range),
      sort: 'spend_descending',
      limit: '6',
    },
    token,
  )) as { data?: InsightRow[] }
  return json.data ?? []
}

/**
 * Creative thumbnails for the ads we are about to render. The insights edge
 * carries no imagery, so the ad objects are pulled separately and joined by id.
 * A miss is not an error — the table falls back to a format tile.
 */
async function adThumbnails(accountId: string, token?: string): Promise<Record<string, string>> {
  const json = (await graphGet(
    `act_${accountId}/ads`,
    {
      fields: 'id,creative{thumbnail_url}',
      limit: '50',
    },
    token,
  )) as { data?: { id?: string; creative?: { thumbnail_url?: string } }[] }
  const map: Record<string, string> = {}
  for (const ad of json.data ?? []) {
    if (ad.id && ad.creative?.thumbnail_url) map[ad.id] = ad.creative.thumbnail_url
  }
  return map
}

/**
 * The trend series, bucketed from the SELECTED range — daily for short windows,
 * weekly for long ones. There is no fixed eight-week series any more.
 */
async function trendSeries(
  accountId: string,
  range: DateRange,
  token?: string,
): Promise<{ date: string; spend: number; results: number; roas: number }[]> {
  const days = rangeDays(range)
  const increment = days <= 14 ? '1' : days <= 90 ? '7' : 'monthly'
  const json = (await graphGet(
    `act_${accountId}/insights`,
    {
      fields: 'spend,purchase_roas,actions',
      time_range: graphTimeRange(range),
      time_increment: increment,
    },
    token,
  )) as { data?: InsightRow[] }
  return (json.data ?? []).map((r) => ({
    date: r.date_start ?? '',
    spend: num(r.spend),
    results: resultMix(r).reduce((s, x) => s + x.count, 0),
    roas: roas(r),
  }))
}

/* ------------------------------ live mapping ------------------------------ */

/** Live thresholds. Env-overridable so a brand can set its own evaluation gates. */
function liveThresholds(costPerResult: number): StatusThresholds {
  const target = Number(process.env.META_TARGET_COST_PER_RESULT)
  return {
    ...metaThresholds,
    targetCostPerResult:
      Number.isFinite(target) && target > 0
        ? target
        : costPerResult > 0
          ? Math.round(costPerResult) // no configured target → the account's own average
          : undefined,
  }
}

function deltaLabel(
  current: number,
  prior: number,
  invert = false,
): { delta: string; trend: 'up' | 'down' | 'flat' } {
  if (prior <= 0 || current <= 0) return { delta: '', trend: 'flat' }
  const change = ((current - prior) / prior) * 100
  if (Math.abs(change) < 0.5) return { delta: '0%', trend: 'flat' }
  const better = invert ? change < 0 : change > 0
  return {
    delta: `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%`,
    trend: better ? 'up' : 'down',
  }
}

function buildHeroKpis(
  range: DateRange,
  totals: InsightRow,
  mix: ResultSlice[],
  prior: { spend: number; results: number; costPerResult: number },
  blendedRoas: number,
  thresholds: StatusThresholds,
): MetaKpi[] {
  const spend = num(totals.spend)
  const results = mix.reduce((s, r) => s + r.count, 0)
  const type = dominantResult(mix)
  const cpr = results > 0 ? spend / results : 0
  const target = thresholds.targetCostPerResult
  const mixed = mix.length > 1

  const spendDelta = deltaLabel(spend, prior.spend)
  const resultDelta = deltaLabel(results, prior.results)
  const costDelta = deltaLabel(cpr, prior.costPerResult, true)

  const efficiency: MetaKpi =
    blendedRoas > 0
      ? {
          label: 'ROAS',
          value: `${blendedRoas.toFixed(1)}x`,
          sub: 'revenue connected via purchase value',
          delta: '',
          trend: 'flat',
          accent: heroAccents[3],
          definition: 'Purchase ROAS reported by Meta for this range. Shown because real revenue is connected.',
        }
      : {
          label: 'Result Efficiency',
          value:
            target && cpr > 0
              ? `${Math.abs(Math.round(((cpr - target) / target) * 100))}% ${cpr <= target ? 'under' : 'over'} target`
              : 'Insufficient data',
          sub: target ? `$${cpr.toFixed(2)} vs $${target} ${costLabel(type)} target` : 'no target set',
          delta: '',
          trend: 'flat',
          accent: heroAccents[3],
          definition:
            'Cost per result against target for this range. ROAS is hidden because no revenue or defensible conversion value is connected to this account.',
        }

  return [
    {
      label: 'Ad Spend',
      value: money(spend),
      sub: rangeLabel(range).toLowerCase(),
      delta: spendDelta.delta,
      trend: spendDelta.trend,
      accent: heroAccents[0],
      definition:
        'Total amount spent across the connected ad accounts in the selected range, compared against the equally long period before it.',
    },
    {
      label: 'Primary Results',
      value: results > 0 ? results.toLocaleString() : 'Insufficient data',
      sub: mixed ? 'mixed result types — see the split' : RESULT_LABELS[type].many,
      delta: resultDelta.delta,
      trend: resultDelta.trend,
      accent: heroAccents[1],
      definition:
        'The optimisation result each campaign was buying, counted per type. Leads, registrations, applications, booked calls and purchases are never blended.',
      breakdown: mix,
    },
    {
      label: 'Cost per Result',
      value: cpr > 0 ? `$${cpr.toFixed(2)}` : 'Insufficient data',
      sub: `Current result: ${RESULT_LABELS[type].one}`,
      delta: costDelta.delta,
      trend: costDelta.trend,
      accent: heroAccents[2],
      definition: mixed
        ? 'Spend over the dominant result type. The account mixes result types — use the split rather than reading this as one blended cost.'
        : `Spend divided by ${RESULT_LABELS[type].many} in this range.`,
    },
    efficiency,
  ]
}

function buildMetrics(totals: InsightRow, mix: ResultSlice[]): MetaMetric[] {
  const results = mix.reduce((s, r) => s + r.count, 0)
  const cpr = results > 0 ? num(totals.spend) / results : 0
  const type = dominantResult(mix)
  const frequency = num(totals.frequency)
  const rows: Omit<MetaMetric, 'accent'>[] = [
    { label: 'CPC', value: `$${num(totals.cpc).toFixed(2)}`, metric: 'cost per link click', pct: 70, definition: 'Spend divided by link clicks in the selected range.' },
    { label: 'CPM', value: `$${num(totals.cpm).toFixed(2)}`, metric: 'cost per 1k impressions', pct: 60, definition: 'Delivery cost in the selected range, not a performance verdict.' },
    {
      label: costLabel(type),
      value: cpr > 0 ? `$${cpr.toFixed(2)}` : 'N/A',
      metric: `cost per ${RESULT_LABELS[type].one.toLowerCase()}`,
      pct: 65,
      definition: `Spend divided by ${RESULT_LABELS[type].many} — the result this account optimises for.`,
    },
    { label: 'Reach', value: Math.round(num(totals.reach)).toLocaleString(), metric: 'unique people', pct: 80, definition: 'Unique people who saw an ad at least once inside the selected range.' },
    { label: 'Frequency', value: frequency.toFixed(1), metric: 'avg impressions / person', pct: Math.min(100, Math.round((frequency / 4) * 100)), definition: 'Average impressions per person in this range. Rising frequency alongside falling CTR is the primary fatigue signal.' },
    { label: 'Impressions', value: Math.round(num(totals.impressions)).toLocaleString(), metric: 'total served', pct: 62, definition: 'Times an ad was rendered in this range, including repeats to the same person.' },
    { label: 'Clicks', value: Math.round(num(totals.clicks)).toLocaleString(), metric: 'link + post clicks', pct: 54, definition: 'All clicks in this range, including engagement clicks that never leave Meta.' },
    { label: 'Outbound CTR', value: `${num(totals.ctr).toFixed(2)}%`, metric: 'clicks over impressions', pct: 71, definition: 'Click-through rate for this range. Never proof of a commercial winner on its own.' },
  ]
  return rows.map((r, i) => ({ ...r, accent: metricAccents[i] ?? 'blue' }))
}

/** Hook rate from real 3-sec views. `null` when the ad carries no video data. */
function hookRateFrom(row: InsightRow): number | null {
  const views = num(row.video_3_sec_watched_actions?.[0]?.value)
  const impressions = num(row.impressions)
  if (views <= 0 || impressions <= 0) return null
  return Number(((views / impressions) * 100).toFixed(1))
}

function daysBetween(start?: string, stop?: string): number {
  if (!start) return 0
  const a = new Date(start).getTime()
  const b = stop ? new Date(stop).getTime() : Date.now()
  return Math.max(1, Math.round((b - a) / 86_400_000))
}

function buildTopAds(
  rows: InsightRow[],
  range: DateRange,
  thumbs: Record<string, string>,
  thresholds: StatusThresholds,
  priorById: Record<string, { costPerResult: number; ctr: number }>,
): MetaAd[] {
  return rows.map((r) => {
    const mix = resultMix(r)
    const type = dominantResult(mix)
    const results = mix.reduce((s, x) => s + x.count, 0)
    const spend = num(r.spend)
    const cpr = results > 0 ? spend / results : 0
    const frequency = num(r.frequency)
    const ctr = num(r.ctr)
    const purchaseRoas = roas(r)
    // Delivery days inside the selected window — the evidence actually examined.
    const daysLive = Math.min(daysBetween(r.date_start, r.date_stop), rangeDays(range))

    const prior = priorById[r.ad_id ?? '']
    const costTrendPct =
      prior && prior.costPerResult > 0 ? ((cpr - prior.costPerResult) / prior.costPerResult) * 100 : 0
    const ctrTrendPct = prior && prior.ctr > 0 ? ((ctr - prior.ctr) / prior.ctr) * 100 : 0

    const verdict = evaluateStatus(
      { spend, results, daysLive, costPerResult: cpr, frequency, costTrendPct, ctrTrendPct },
      thresholds,
    )

    const trend: CreativeTrend =
      costTrendPct <= -5 ? 'Improving' : costTrendPct >= 5 ? 'Declining' : 'Stable'

    return {
      id: r.ad_id || r.ad_name || 'ad',
      name: r.ad_name || 'Untitled ad',
      format: 'Meta Ad',
      thumbnailUrl: r.ad_id ? thumbs[r.ad_id] : undefined,
      spend,
      primaryResults: results,
      resultType: type,
      costPerResult: Number(cpr.toFixed(2)),
      hookRate: hookRateFrom(r),
      ctr: Number(ctr.toFixed(2)),
      frequency: Number(frequency.toFixed(1)),
      trend,
      roas: purchaseRoas > 0 ? Number(purchaseRoas.toFixed(1)) : null,
      status: verdict.status,
      statusReason: verdict.reason,
      daysLive,
      launchedOn: r.date_start,
    }
  })
}

/** Fold the daily/weekly rows the Graph returned into the range's own buckets. */
function buildTrend(
  range: DateRange,
  rows: { date: string; spend: number; results: number; roas: number }[],
  revenueConnected: boolean,
): TrendPoint[] {
  const buckets = trendBuckets(range)
  return buckets.map((b) => {
    const inBucket = rows.filter((r) => r.date >= b.from && r.date <= b.to)
    const spend = inBucket.reduce((s, r) => s + r.spend, 0)
    const results = inBucket.reduce((s, r) => s + r.results, 0)
    const roasValues = inBucket.map((r) => r.roas).filter((v) => v > 0)
    return {
      label: b.label,
      from: b.from,
      to: b.to,
      spend: Math.round(spend),
      costPerResult: results > 0 ? Number((spend / results).toFixed(2)) : 0,
      roas:
        revenueConnected && roasValues.length
          ? Number((roasValues.reduce((a, c) => a + c, 0) / roasValues.length).toFixed(1))
          : null,
    }
  })
}

/* ------------------------------ public API -------------------------------- */

export type { MetaDashboard }

function aggregate(rows: InsightRow[]): InsightRow {
  const n = Math.max(1, rows.length)
  return {
    spend: String(rows.reduce((s, r) => s + num(r.spend), 0)),
    impressions: String(rows.reduce((s, r) => s + num(r.impressions), 0)),
    clicks: String(rows.reduce((s, r) => s + num(r.clicks), 0)),
    reach: String(rows.reduce((s, r) => s + num(r.reach), 0)),
    cpc: String(rows.reduce((s, r) => s + num(r.cpc), 0) / n),
    cpm: String(rows.reduce((s, r) => s + num(r.cpm), 0) / n),
    frequency: String(rows.reduce((s, r) => s + num(r.frequency), 0) / n),
    ctr: String(rows.reduce((s, r) => s + num(r.ctr), 0) / n),
    actions: rows.flatMap((r) => r.actions ?? []),
  }
}

/**
 * Resolves the dataset both dashboards render, for ONE date range.
 *
 * Live numbers are returned whenever the API is configured (an optional
 * META_LIVE_MIN_SPEND floor can hold demo data until spend clears it — off by
 * default); otherwise the curated demo set projected
 * onto the same range. A live failure returns the demo set WITH an `error` the
 * UI shows, rather than pretending seeded numbers are live ones.
 */
export async function resolveMetaDashboard(
  accountId: string | null,
  range: DateRange = rangeFromPreset(DEFAULT_PRESET),
): Promise<MetaDashboard> {
  // With demo data off, "not connected" must read as an empty account rather
  // than another company's spend and campaign names.
  const demo = demoDataEnabled() ? buildDemoDashboard(range) : buildEmptyDashboard(range)
  // The stored connection wins; the env token is the fallback. Neither → demo.
  const credentials = await resolveMetaCredentials(accountId)
  if (!credentials) return demo
  const token = credentials.token

  const comparison = previousRange(range)

  try {
    const accountIds = credentials.accountId
      ? [credentials.accountId]
      : await listAccountIds(token)
    if (accountIds.length === 0) return demo

    const [current, previous] = await Promise.all([
      Promise.all(accountIds.map((id) => accountInsights(id, range, token).catch(() => null))),
      Promise.all(accountIds.map((id) => accountInsights(id, comparison, token).catch(() => null))),
    ])
    const present = current.filter((r): r is InsightRow => r !== null)
    if (present.length === 0) return demo

    const totals = aggregate(present)
    const totalSpend = num(totals.spend)
    if (totalSpend < liveMinSpend()) return demo

    const priorTotals = aggregate(previous.filter((r): r is InsightRow => r !== null))
    const priorMix = resultMix(priorTotals)
    const priorResults = priorMix.reduce((s, r) => s + r.count, 0)
    const priorSpend = num(priorTotals.spend)

    const roasValues = present.map(roas).filter((v) => v > 0)
    const blendedRoas = roasValues.length ? roasValues.reduce((a, b) => a + b, 0) / roasValues.length : 0
    const revenueConnected = blendedRoas > 0

    const [adRows, priorAdRows, thumbSets, trendRows] = await Promise.all([
      Promise.all(accountIds.map((id) => topAds(id, range, token).catch(() => []))),
      Promise.all(accountIds.map((id) => topAds(id, comparison, token).catch(() => []))),
      Promise.all(accountIds.map((id) => adThumbnails(id, token).catch(() => ({})))),
      Promise.all(accountIds.map((id) => trendSeries(id, range, token).catch(() => []))),
    ])

    const allAds = adRows.flat().sort((a, b) => num(b.spend) - num(a.spend)).slice(0, 10)
    const priorById: Record<string, { costPerResult: number; ctr: number }> = {}
    for (const r of priorAdRows.flat()) {
      const results = resultMix(r).reduce((s, x) => s + x.count, 0)
      if (!r.ad_id) continue
      priorById[r.ad_id] = {
        costPerResult: results > 0 ? num(r.spend) / results : 0,
        ctr: num(r.ctr),
      }
    }
    const thumbs = Object.assign({}, ...thumbSets) as Record<string, string>

    const mix = resultMix(totals)
    const totalResults = mix.reduce((s, r) => s + r.count, 0)
    const thresholds = liveThresholds(totalResults > 0 ? totalSpend / totalResults : 0)

    return {
      source: 'live',
      range,
      comparison,
      heroKpis: buildHeroKpis(
        range,
        totals,
        mix,
        {
          spend: priorSpend,
          results: priorResults,
          costPerResult: priorResults > 0 ? priorSpend / priorResults : 0,
        },
        revenueConnected ? blendedRoas : 0,
        thresholds,
      ),
      metrics: buildMetrics(totals, mix),
      topAds: allAds.length
        ? buildTopAds(allAds, range, thumbs, thresholds, priorById)
        : demo.topAds,
      spendTrend: buildTrend(range, trendRows.flat(), revenueConnected),
      audienceBreakdown: metaAudienceBreakdown,
      placementBreakdown: metaPlacementBreakdown,
      agentInsights: metaAgentInsights,
      learningStats: metaLearningStats,
      resultMix: mix.length ? mix : demo.resultMix,
      primaryResultType: dominantResult(mix),
      revenueConnected,
      thresholds,
      spendTotal: totalSpend,
    }
  } catch (e) {
    // Configured but unreachable: say so. The dashboard still renders the demo
    // set so the surface is never blank, and the UI shows the failure.
    return {
      ...demo,
      error: e instanceof Error ? e.message : 'Meta data could not be loaded',
    }
  }
}

/** Lightweight connectivity check for the status endpoint. Never throws. */
export async function metaApiStatus(accountId: string | null): Promise<{
  configured: boolean
  connected: boolean
  accountCount: number
  liveMinSpend: number
  error?: string
}> {
  const credentials = await resolveMetaCredentials(accountId)
  if (!credentials) {
    return { configured: false, connected: false, accountCount: 0, liveMinSpend: liveMinSpend() }
  }
  try {
    const ids = credentials.accountId
      ? [credentials.accountId]
      : await listAccountIds(credentials.token)
    return { configured: true, connected: true, accountCount: ids.length, liveMinSpend: liveMinSpend() }
  } catch (e) {
    return {
      configured: true,
      connected: false,
      accountCount: 0,
      liveMinSpend: liveMinSpend(),
      error: e instanceof Error ? e.message : 'unknown error',
    }
  }
}
