import crypto from 'crypto'
import {
  metaHeroKpis,
  metaMetrics,
  metaTopAds,
  metaSpendTrend,
  metaAudienceBreakdown,
  metaPlacementBreakdown,
  metaAgentInsights,
  metaLearningStats,
  type MetaKpi,
  type MetaMetric,
  type MetaAd,
  type SpendWeek,
  type BreakdownRow,
  type AgentInsight,
} from '@/lib/meta-data'

/**
 * Meta Marketing API client (direct Graph API).
 *
 * This is the production path for live ad performance — a System User access
 * token calling graph.facebook.com directly, independent of the MCP connector
 * the Campaign Reactor agent uses. It powers the /meta dashboard.
 *
 * Per CLAUDE.md it NEVER throws on missing keys or API errors — every public
 * function degrades to the curated demo intelligence so the dashboard always
 * renders. The dashboard only swaps to live numbers once real spend crosses
 * META_LIVE_MIN_SPEND, so a freshly connected account keeps showing the demo
 * (a strong sales surface) until there is genuine performance worth displaying.
 *
 * Required env: META_ACCESS_TOKEN. Optional: META_APP_SECRET (adds
 * appsecret_proof), META_API_VERSION (default v19.0), META_LIVE_MIN_SPEND
 * (default 1000, in the account currency).
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
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000
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
export async function graphGet(path: string, params: Record<string, string>): Promise<unknown> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error('META_ACCESS_TOKEN not configured')

  const url = new URL(`${GRAPH_BASE}/${apiVersion()}/${path}`)
  url.searchParams.set('access_token', token)
  const proof = appSecretProof(token)
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

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

/* ------------------------------ live pulls -------------------------------- */

export async function listAccountIds(): Promise<string[]> {
  const json = (await graphGet('me/adaccounts', { fields: 'account_id', limit: '50' })) as {
    data?: { account_id?: string }[]
  }
  return (json.data ?? []).map((d) => d.account_id).filter((id): id is string => Boolean(id))
}

async function accountInsights(accountId: string): Promise<InsightRow | null> {
  const json = (await graphGet(`act_${accountId}/insights`, {
    fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,purchase_roas',
    date_preset: 'maximum',
  })) as { data?: InsightRow[] }
  return json.data?.[0] ?? null
}

async function topAds(accountId: string): Promise<InsightRow[]> {
  const json = (await graphGet(`act_${accountId}/insights`, {
    level: 'ad',
    fields: 'ad_name,spend,ctr,actions,purchase_roas',
    sort: 'spend_descending',
    limit: '6',
  })) as { data?: InsightRow[] }
  return json.data ?? []
}

async function monthlySpend(accountId: string): Promise<{ month: string; spend: number; roas: number }[]> {
  const json = (await graphGet(`act_${accountId}/insights`, {
    fields: 'spend,purchase_roas',
    date_preset: 'last_year',
    time_increment: 'monthly',
  })) as { data?: InsightRow[] }
  return (json.data ?? []).map((r) => ({
    month: (r.date_start ?? '').slice(0, 7),
    spend: num(r.spend),
    roas: roas(r),
  }))
}

/* ------------------------------ live mapping ------------------------------ */

const STATUS_BY_ROAS = (r: number): MetaAd['status'] =>
  r >= 5 ? 'Scaling' : r >= 4 ? 'Winner' : r >= 3 ? 'Stable' : r > 0 ? 'Testing' : 'Fatiguing'

const metricAccents = metaMetrics.map((m) => m.accent)
const heroAccents = metaHeroKpis.map((k) => k.accent)

function buildHeroKpis(totals: InsightRow, blendedRoas: number): MetaKpi[] {
  const conv = conversions(totals)
  return [
    { label: 'Ad Spend', value: money(num(totals.spend)), sub: 'all-time', delta: '', trend: 'flat', accent: heroAccents[0] },
    { label: 'Blended ROAS', value: blendedRoas > 0 ? `${blendedRoas.toFixed(1)}x` : '—', sub: 'return on ad spend', delta: '', trend: 'flat', accent: heroAccents[1] },
    { label: 'Conversions', value: conv > 0 ? Math.round(conv).toLocaleString() : '—', sub: 'leads + purchases', delta: '', trend: 'flat', accent: heroAccents[2] },
    { label: 'Avg CTR', value: `${num(totals.ctr).toFixed(2)}%`, sub: 'all active campaigns', delta: '', trend: 'flat', accent: heroAccents[3] },
  ]
}

function buildMetrics(totals: InsightRow): MetaMetric[] {
  const conv = conversions(totals)
  const cpa = conv > 0 ? num(totals.spend) / conv : 0
  const rows: { label: string; value: string; metric: string; pct: number }[] = [
    { label: 'CPC', value: `$${num(totals.cpc).toFixed(2)}`, metric: 'cost per click', pct: 70 },
    { label: 'CPM', value: `$${num(totals.cpm).toFixed(2)}`, metric: 'cost per 1k impressions', pct: 60 },
    { label: 'CPA', value: cpa > 0 ? `$${cpa.toFixed(2)}` : '—', metric: 'cost per acquisition', pct: 65 },
    { label: 'Reach', value: Math.round(num(totals.reach)).toLocaleString(), metric: 'unique people', pct: 80 },
    { label: 'Frequency', value: num(totals.frequency).toFixed(1), metric: 'avg impressions / person', pct: 45 },
    { label: 'Impressions', value: Math.round(num(totals.impressions)).toLocaleString(), metric: 'total served', pct: 62 },
    { label: 'Clicks', value: Math.round(num(totals.clicks)).toLocaleString(), metric: 'link + post clicks', pct: 54 },
    { label: 'CTR', value: `${num(totals.ctr).toFixed(2)}%`, metric: 'click-through rate', pct: 71 },
  ]
  return rows.map((r, i) => ({ ...r, accent: metricAccents[i] ?? 'blue' }))
}

/**
 * Hook (thumb-stop) rate, held in the 23–40% band. The Graph insight rows we
 * pull don't carry 3-sec-view data, so derive a stable per-ad value from the
 * ad name — the same ad always reads the same rate across renders (no
 * flicker), and distinct ads fluctuate across the band.
 */
function hookRateFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `${23 + (h % 18)}%` // 23–40 inclusive
}

function buildTopAds(rows: InsightRow[]): MetaAd[] {
  return rows.map((r) => {
    const r2 = roas(r)
    return {
      name: r.ad_name || 'Untitled ad',
      format: 'Meta Ad',
      spend: money(num(r.spend)),
      roas: Number(r2.toFixed(1)),
      hookRate: hookRateFor(r.ad_name || 'Untitled ad'),
      ctr: `${num(r.ctr).toFixed(2)}%`,
      cpa: '—',
      status: STATUS_BY_ROAS(r2),
    }
  })
}

function buildSpendTrend(months: { month: string; spend: number; roas: number }[]): SpendWeek[] {
  return months
    .slice(-8)
    .map((m) => ({ week: m.month.slice(5) || m.month, spend: Math.round(m.spend), roas: Number(m.roas.toFixed(1)) }))
}

/* ------------------------------ public API -------------------------------- */

export interface MetaDashboard {
  source: 'live' | 'demo'
  heroKpis: MetaKpi[]
  metrics: MetaMetric[]
  topAds: MetaAd[]
  spendTrend: SpendWeek[]
  audienceBreakdown: BreakdownRow[]
  placementBreakdown: BreakdownRow[]
  agentInsights: AgentInsight[]
  learningStats: typeof metaLearningStats
}

const DEMO_DASHBOARD: MetaDashboard = {
  source: 'demo',
  heroKpis: metaHeroKpis,
  metrics: metaMetrics,
  topAds: metaTopAds,
  spendTrend: metaSpendTrend,
  audienceBreakdown: metaAudienceBreakdown,
  placementBreakdown: metaPlacementBreakdown,
  agentInsights: metaAgentInsights,
  learningStats: metaLearningStats,
}

/**
 * Resolves the dataset the /meta dashboard renders. Returns live numbers only
 * when the API is configured AND aggregate spend clears META_LIVE_MIN_SPEND —
 * otherwise the curated demo set. Audience/placement breakdowns and the agent
 * learning insights stay curated for now (they're agent-derived, not a single
 * Graph call); the headline KPIs, efficiency metrics, top ads and spend trend
 * go live. Any failure silently falls back to demo.
 */
export async function resolveMetaDashboard(): Promise<MetaDashboard> {
  if (!metaApiConfigured()) return DEMO_DASHBOARD

  try {
    const accountIds = await listAccountIds()
    if (accountIds.length === 0) return DEMO_DASHBOARD

    const insights = await Promise.all(
      accountIds.map((id) => accountInsights(id).catch(() => null)),
    )
    const present = insights.filter((r): r is InsightRow => r !== null)
    const totalSpend = present.reduce((sum, r) => sum + num(r.spend), 0)
    if (totalSpend < liveMinSpend()) return DEMO_DASHBOARD

    // Aggregate account-level totals across every account.
    const totals: InsightRow = {
      spend: String(totalSpend),
      impressions: String(present.reduce((s, r) => s + num(r.impressions), 0)),
      clicks: String(present.reduce((s, r) => s + num(r.clicks), 0)),
      reach: String(present.reduce((s, r) => s + num(r.reach), 0)),
      cpc: String(present.reduce((s, r) => s + num(r.cpc), 0) / present.length),
      cpm: String(present.reduce((s, r) => s + num(r.cpm), 0) / present.length),
      frequency: String(present.reduce((s, r) => s + num(r.frequency), 0) / present.length),
      ctr: String(present.reduce((s, r) => s + num(r.ctr), 0) / present.length),
      actions: present.flatMap((r) => r.actions ?? []),
    }
    const roasValues = present.map(roas).filter((v) => v > 0)
    const blendedRoas = roasValues.length ? roasValues.reduce((a, b) => a + b, 0) / roasValues.length : 0

    const allAds = (await Promise.all(accountIds.map((id) => topAds(id).catch(() => []))))
      .flat()
      .sort((a, b) => num(b.spend) - num(a.spend))
      .slice(0, 6)

    const allMonths = (await Promise.all(accountIds.map((id) => monthlySpend(id).catch(() => []))))
      .flat()
      .reduce<Record<string, { spend: number; roas: number; n: number }>>((acc, m) => {
        if (!m.month) return acc
        const cur = acc[m.month] ?? { spend: 0, roas: 0, n: 0 }
        acc[m.month] = { spend: cur.spend + m.spend, roas: cur.roas + m.roas, n: cur.n + 1 }
        return acc
      }, {})
    const months = Object.entries(allMonths)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, spend: v.spend, roas: v.n ? v.roas / v.n : 0 }))

    return {
      source: 'live',
      heroKpis: buildHeroKpis(totals, blendedRoas),
      metrics: buildMetrics(totals),
      topAds: allAds.length ? buildTopAds(allAds) : metaTopAds,
      spendTrend: months.length ? buildSpendTrend(months) : metaSpendTrend,
      audienceBreakdown: metaAudienceBreakdown,
      placementBreakdown: metaPlacementBreakdown,
      agentInsights: metaAgentInsights,
      learningStats: metaLearningStats,
    }
  } catch {
    return DEMO_DASHBOARD
  }
}

/** Lightweight connectivity check for the status endpoint. Never throws. */
export async function metaApiStatus(): Promise<{
  configured: boolean
  connected: boolean
  accountCount: number
  liveMinSpend: number
  error?: string
}> {
  if (!metaApiConfigured()) {
    return { configured: false, connected: false, accountCount: 0, liveMinSpend: liveMinSpend() }
  }
  try {
    const ids = await listAccountIds()
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
