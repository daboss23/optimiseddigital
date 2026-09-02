// Live aggregation layer for the Reactor Dashboard. Every panel on the command
// center reads from here. When Supabase is configured it derives real metrics
// from `knowledge_chunks`, `campaign_outcomes`, and `media_generations`; when it
// is not (or the store is empty), it degrades to the curated demo intelligence
// so the dashboard always renders meaningful, on-brand numbers.
//
// Design intent: nothing here is decorative. Each field powers a panel that
// answers a real question for the operator — is the intelligence base compounding, are
// generated concepts winning, which systems are fueling the agent, what has the
// reactor done lately.

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import {
  reactorKpis,
  winningAngles,
  creativeHeatmap,
  heatmapMonths as demoHeatmapMonths,
  performanceSignals as demoPerformanceSignals,
  type DataAccent,
  type PerformanceSignal,
} from '@/lib/reactor-data'
import { curatedVaultTotal } from '@/lib/knowledge'
import { demoDataEnabled } from '@/lib/demo-mode'

/* --------------------------------- Types ---------------------------------- */

export interface DashboardKpi {
  label: string
  value: number
  delta: string
  trend: 'up' | 'down' | 'flat'
  spark: number[] // cumulative-per-week shape, real when live
}

export interface GrowthPoint {
  label: string // short month/week label
  added: number // assets ingested that bucket
  cumulative: number // running total of the intelligence base
}

export interface OutcomeMetric {
  name: string // e.g. CTR, ROAS, book_rate
  value: number // average across outcomes
}

export interface OutcomeSummary {
  winners: number
  losers: number
  pending: number
  total: number
  winRate: number // 0-100, share of decided outcomes that won
  metrics: OutcomeMetric[]
}

export interface SystemLoad {
  system: string
  label: string
  count: number
  pct: number // share of the largest system, 0-100
  accent: DataAccent
}

export interface ActivityEvent {
  kind: 'ingest' | 'render' | 'outcome'
  label: string
  detail: string
  accent: DataAccent
  at: string // ISO timestamp
}

export interface HeatmapData {
  months: string[]
  rows: { dimension: string; cells: number[] }[]
}

export interface DashboardData {
  live: boolean
  total: number
  kpis: DashboardKpi[]
  growth: GrowthPoint[]
  outcomes: OutcomeSummary
  systemLoad: SystemLoad[]
  activity: ActivityEvent[]
  heatmap: HeatmapData
  performanceSignals: PerformanceSignal[]
}

/* ------------------------------- Constants -------------------------------- */

const GROWTH_WEEKS = 12
const SPARK_WEEKS = 8

// KPI identity + how each maps onto stored knowledge. The matcher runs over the
// raw (system, category) rows so totals, deltas, and sparklines all stay in sync.
type ChunkRow = { created_at: string; system: string | null; category: string | null }

const KPI_DEFS: {
  label: string
  accent: DataAccent
  match: (r: ChunkRow) => boolean
}[] = [
  { label: 'Knowledge Assets', accent: 'blue', match: () => true },
  { label: 'Winning Creatives', accent: 'emerald', match: (r) => r.system === 'creative' },
  {
    label: 'Winning Hooks',
    accent: 'violet',
    match: (r) =>
      !!r.category &&
      r.category.toLowerCase().includes('hook') &&
      !r.category.toLowerCase().includes('framework'),
  },
  {
    label: 'Frameworks',
    accent: 'cyan',
    match: (r) => !!r.category && r.category.toLowerCase().includes('framework'),
  },
  {
    label: 'SOPs',
    accent: 'emerald',
    match: (r) => !!r.category && r.category.toLowerCase().includes('sop'),
  },
  {
    label: 'Member Wins',
    accent: 'pink',
    match: (r) =>
      r.system === 'transformation' ||
      (!!r.category && r.category.toLowerCase().includes('member win')),
  },
  { label: 'Patterns Identified', accent: 'amber', match: (r) => r.system === 'pattern' },
  // Campaign Ideas Ready is sourced from campaign_outcomes, handled separately.
  { label: 'Campaign Ideas Ready', accent: 'blue', match: () => false },
]

const SYSTEM_LABELS: Record<string, { label: string; accent: DataAccent }> = {
  vault: { label: 'Vault', accent: 'blue' },
  research: { label: 'Research', accent: 'cyan' },
  transformation: { label: 'Transformation', accent: 'pink' },
  creative: { label: 'Creative', accent: 'emerald' },
  copy: { label: 'Copy', accent: 'violet' },
  pattern: { label: 'Pattern', accent: 'amber' },
  learning: { label: 'Learning', accent: 'cyan' },
  website: { label: 'Website', accent: 'blue' },
}

/* -------------------------------- Helpers --------------------------------- */

function supabaseReady(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

const MS_WEEK = 7 * 24 * 60 * 60 * 1000

function startOfWeek(d: Date): number {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  t.setDate(t.getDate() - t.getDay())
  return t.getTime()
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Weekly cumulative shape for a filtered set of timestamps — drives KPI sparklines.
function weeklyCumulative(timestamps: number[], baseline: number, weeks: number): number[] {
  const now = Date.now()
  const buckets = new Array(weeks).fill(0)
  for (const ts of timestamps) {
    const ago = Math.floor((now - ts) / MS_WEEK)
    if (ago >= 0 && ago < weeks) buckets[weeks - 1 - ago] += 1
  }
  // baseline = everything older than the window, so the line starts where the
  // real running total actually sits rather than at zero.
  const series: number[] = []
  let running = baseline
  for (const b of buckets) {
    running += b
    series.push(running)
  }
  return series
}

/* ------------------------------- Live build ------------------------------- */

async function buildLive(): Promise<DashboardData | null> {
  const admin = getSupabaseAdmin()

  // One bounded pull of the lightweight columns (no embeddings) powers KPIs,
  // growth, heatmap, and sparklines without a query per panel.
  const { data: chunkData, error: chunkErr } = await admin
    .from('knowledge_chunks')
    .select('created_at, system, category')
    .order('created_at', { ascending: false })
    .limit(20000)
  if (chunkErr) throw chunkErr

  const rows = (chunkData ?? []) as ChunkRow[]
  if (rows.length === 0) return null // empty store → fall back to demo

  const total = rows.length
  const now = Date.now()
  const cutoff30 = now - 30 * 24 * 60 * 60 * 1000

  // ---- KPIs (value + 30d delta + 8-week sparkline), all from the same rows ----
  const kpis: DashboardKpi[] = KPI_DEFS.filter((d) => d.label !== 'Campaign Ideas Ready').map(
    (def) => {
      const matched = rows.filter(def.match)
      const value = matched.length
      const recent = matched.filter((r) => new Date(r.created_at).getTime() >= cutoff30).length
      const windowTotal = matched
        .map((r) => new Date(r.created_at).getTime())
        .filter((ts) => ts >= now - SPARK_WEEKS * MS_WEEK).length
      const spark = weeklyCumulative(
        matched.map((r) => new Date(r.created_at).getTime()),
        Math.max(0, value - windowTotal),
        SPARK_WEEKS,
      )
      return {
        label: def.label,
        value,
        delta: recent > 0 ? `+${recent}` : '0',
        trend: recent > 0 ? ('up' as const) : ('flat' as const),
        spark,
      }
    },
  )

  // ---- Outcomes (win rate + metric averages) ----
  const { data: outcomeData } = await admin
    .from('campaign_outcomes')
    .select('verdict, metric_name, metric_value, created_at')
    .limit(5000)
  const outcomes = summarizeOutcomes(outcomeData ?? [])

  // Campaign Ideas Ready = concepts logged as outcomes (proxy for ideas in play).
  kpis.push({
    label: 'Campaign Ideas Ready',
    value: outcomes.total,
    delta: outcomes.pending > 0 ? `+${outcomes.pending}` : '0',
    trend: outcomes.pending > 0 ? 'up' : 'flat',
    spark: weeklyCumulative(
      (outcomeData ?? []).map((o) => new Date((o as { created_at: string }).created_at).getTime()),
      0,
      SPARK_WEEKS,
    ),
  })

  // ---- Growth (cumulative intelligence base over the last 12 weeks) ----
  const growth = buildGrowth(rows)

  // ---- System load (agent fuel) ----
  const systemLoad = buildSystemLoad(rows)

  // ---- Heatmap (signal accumulation by system over the last 6 months) ----
  const heatmap = buildHeatmap(rows)

  // ---- Activity feed (recent ingests + renders + outcomes) ----
  const { data: mediaData } = await admin
    .from('media_generations')
    .select('model_id, provider, mode, status, created_at')
    .order('created_at', { ascending: false })
    .limit(6)
  const activity = buildActivity(rows, mediaData ?? [], outcomeData ?? [])

  // Performance signals: derive top format from outcomes where possible, else demo.
  const performanceSignals = demoPerformanceSignals

  return {
    live: true,
    total,
    kpis,
    growth,
    outcomes,
    systemLoad,
    activity,
    heatmap,
    performanceSignals,
  }
}

function summarizeOutcomes(
  data: { verdict?: string | null; metric_name?: string | null; metric_value?: number | null }[],
): OutcomeSummary {
  let winners = 0
  let losers = 0
  let pending = 0
  const metricSums: Record<string, { sum: number; n: number }> = {}
  for (const o of data) {
    const v = (o.verdict ?? 'pending').toLowerCase()
    if (v === 'winner') winners += 1
    else if (v === 'loser') losers += 1
    else pending += 1
    if (o.metric_name && typeof o.metric_value === 'number') {
      const key = o.metric_name
      metricSums[key] = metricSums[key] ?? { sum: 0, n: 0 }
      metricSums[key].sum += o.metric_value
      metricSums[key].n += 1
    }
  }
  const decided = winners + losers
  const metrics: OutcomeMetric[] = Object.entries(metricSums)
    .map(([name, { sum, n }]) => ({ name, value: Math.round((sum / n) * 100) / 100 }))
    .slice(0, 3)
  return {
    winners,
    losers,
    pending,
    total: data.length,
    winRate: decided > 0 ? Math.round((winners / decided) * 100) : 0,
    metrics,
  }
}

function buildGrowth(rows: ChunkRow[]): GrowthPoint[] {
  const now = Date.now()
  const weekly = new Array(GROWTH_WEEKS).fill(0)
  let older = 0
  for (const r of rows) {
    const ts = new Date(r.created_at).getTime()
    const ago = Math.floor((now - ts) / MS_WEEK)
    if (ago >= 0 && ago < GROWTH_WEEKS) weekly[GROWTH_WEEKS - 1 - ago] += 1
    else if (ago >= GROWTH_WEEKS) older += 1
  }
  const points: GrowthPoint[] = []
  let running = older
  for (let i = 0; i < GROWTH_WEEKS; i++) {
    running += weekly[i]
    const weekStart = new Date(startOfWeek(new Date(now - (GROWTH_WEEKS - 1 - i) * MS_WEEK)))
    points.push({
      label: `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()}`,
      added: weekly[i],
      cumulative: running,
    })
  }
  return points
}

function buildSystemLoad(rows: ChunkRow[]): SystemLoad[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const sys = r.system ?? 'vault'
    counts[sys] = (counts[sys] ?? 0) + 1
  }
  const max = Math.max(1, ...Object.values(counts))
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([system, count]) => {
      const meta = SYSTEM_LABELS[system] ?? { label: system, accent: 'blue' as DataAccent }
      return {
        system,
        label: meta.label,
        count,
        pct: Math.round((count / max) * 100),
        accent: meta.accent,
      }
    })
}

function buildHeatmap(rows: ChunkRow[]): HeatmapData {
  const now = new Date()
  const months: string[] = []
  const monthKeys: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(MONTH_LABELS[d.getMonth()])
    monthKeys.push(`${d.getFullYear()}-${d.getMonth()}`)
  }
  const dims = Object.keys(SYSTEM_LABELS).filter((s) => s !== 'website')
  // raw counts per system per month
  const grid: Record<string, number[]> = {}
  for (const s of dims) grid[s] = new Array(6).fill(0)
  for (const r of rows) {
    const sys = r.system ?? 'vault'
    if (!grid[sys]) continue
    const d = new Date(r.created_at)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const idx = monthKeys.indexOf(key)
    if (idx >= 0) grid[sys][idx] += 1
  }
  // normalize each value to 0-100 relative to the busiest cell
  const max = Math.max(1, ...dims.flatMap((s) => grid[s]))
  const rowsOut = dims
    .map((s) => ({
      dimension: SYSTEM_LABELS[s].label,
      cells: grid[s].map((c) => Math.round((c / max) * 100)),
    }))
    .filter((r) => r.cells.some((c) => c > 0))
  return { months, rows: rowsOut.length ? rowsOut : creativeHeatmap.map((r) => ({ ...r })) }
}

function buildActivity(
  rows: ChunkRow[],
  media: { model_id?: string; provider?: string; mode?: string; status?: string; created_at: string }[],
  outcomes: { verdict?: string | null; angle?: string | null; created_at?: string }[],
): ActivityEvent[] {
  const events: ActivityEvent[] = []
  for (const r of rows.slice(0, 5)) {
    const meta = SYSTEM_LABELS[r.system ?? 'vault'] ?? { label: r.system ?? 'Vault', accent: 'blue' as DataAccent }
    events.push({
      kind: 'ingest',
      label: `${meta.label} asset ingested`,
      detail: r.category ?? 'Knowledge chunk embedded',
      accent: meta.accent,
      at: r.created_at,
    })
  }
  for (const m of media.slice(0, 4)) {
    events.push({
      kind: 'render',
      label: `${m.mode === 'image-to-video' ? 'Clip' : 'Creative'} rendered`,
      detail: `${m.model_id ?? 'model'} · ${m.status ?? 'queued'}`,
      accent: 'cyan',
      at: m.created_at,
    })
  }
  for (const o of outcomes.slice(0, 4)) {
    const v = (o.verdict ?? 'pending').toLowerCase()
    events.push({
      kind: 'outcome',
      label: v === 'winner' ? 'Concept marked winner' : v === 'loser' ? 'Concept retired' : 'Concept in market',
      detail: o.angle ?? 'Campaign outcome logged',
      accent: v === 'winner' ? 'emerald' : v === 'loser' ? 'pink' : 'amber',
      at: o.created_at ?? new Date().toISOString(),
    })
  }
  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8)
}

/* ------------------------------- Demo build ------------------------------- */
// Synthesizes a plausible, on-brand snapshot from the curated intelligence so
// the dashboard is fully populated before any real keys/data are wired.

function demoBuild(): DashboardData {
  const total = curatedVaultTotal()

  const kpis: DashboardKpi[] = reactorKpis.map((k) => {
    // a gently rising 8-point shape ending at the current value
    const spark = Array.from({ length: SPARK_WEEKS }, (_, i) =>
      Math.round(k.value * (0.7 + (0.3 * (i + 1)) / SPARK_WEEKS)),
    )
    return {
      label: k.label,
      value: k.value,
      delta: k.delta,
      trend: k.trend,
      spark,
    }
  })

  // Cumulative growth curve that lands on `total`.
  const now = Date.now()
  const growth: GrowthPoint[] = Array.from({ length: GROWTH_WEEKS }, (_, i) => {
    const frac = (i + 1) / GROWTH_WEEKS
    const cumulative = Math.round(total * (0.62 + 0.38 * frac))
    const prev = i === 0 ? Math.round(total * 0.6) : Math.round(total * (0.62 + 0.38 * (i / GROWTH_WEEKS)))
    const weekStart = new Date(startOfWeek(new Date(now - (GROWTH_WEEKS - 1 - i) * MS_WEEK)))
    return {
      label: `${MONTH_LABELS[weekStart.getMonth()]} ${weekStart.getDate()}`,
      added: Math.max(0, cumulative - prev),
      cumulative,
    }
  })

  const outcomes: OutcomeSummary = {
    winners: 38,
    losers: 14,
    pending: 9,
    total: 61,
    winRate: Math.round((38 / 52) * 100),
    metrics: [
      { name: 'ROAS', value: 4.7 },
      { name: 'CTR', value: 4.2 },
      { name: 'book_rate', value: 38 },
    ],
  }

  const systemBase: SystemLoad[] = [
    { system: 'research', label: 'Research', count: 1240, pct: 0, accent: 'cyan' },
    { system: 'copy', label: 'Copy', count: 689, pct: 0, accent: 'violet' },
    { system: 'transformation', label: 'Transformation', count: 538, pct: 0, accent: 'pink' },
    { system: 'creative', label: 'Creative', count: 412, pct: 0, accent: 'emerald' },
    { system: 'vault', label: 'Vault', count: 332, pct: 0, accent: 'blue' },
    { system: 'pattern', label: 'Pattern', count: 96, pct: 0, accent: 'amber' },
  ]
  const systemMax = Math.max(...systemBase.map((a) => a.count))
  const systemLoad: SystemLoad[] = systemBase.map((s) => ({
    ...s,
    pct: Math.round((s.count / systemMax) * 100),
  }))

  const heatmap: HeatmapData = {
    months: demoHeatmapMonths,
    rows: creativeHeatmap.map((r) => ({ ...r })),
  }

  const activity: ActivityEvent[] = [
    { kind: 'outcome', label: 'Concept marked winner', detail: 'The Profit Leak Campaign', accent: 'emerald', at: iso(2) },
    { kind: 'ingest', label: 'Creative asset ingested', detail: 'Founder Video — VIC', accent: 'emerald', at: iso(6) },
    { kind: 'render', label: 'Creative rendered', detail: 'fal-flux · completed', accent: 'cyan', at: iso(9) },
    { kind: 'ingest', label: 'Copy asset ingested', detail: 'Hooks', accent: 'violet', at: iso(14) },
    { kind: 'outcome', label: 'Concept in market', detail: 'The 45-Hour Owner', accent: 'amber', at: iso(20) },
    { kind: 'ingest', label: 'Transformation asset ingested', detail: 'Member Wins', accent: 'pink', at: iso(28) },
  ]

  return {
    live: false,
    total,
    kpis,
    growth,
    outcomes,
    systemLoad,
    activity,
    heatmap,
    performanceSignals: demoPerformanceSignals,
  }
}

function iso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString()
}

/* --------------------------------- Entry ---------------------------------- */

export async function getDashboardData(): Promise<DashboardData> {
  if (supabaseReady()) {
    try {
      const live = await buildLive()
      if (live) return live
    } catch (err) {
      console.error('Dashboard live build failed:', err)
    }
  }
  // The curated snapshot is a different business's numbers. Showing it to a
  // customer who has stored nothing presents invented totals, growth curves and
  // activity as their own — so it is opt-in, and the honest state is zero.
  return demoDataEnabled() ? demoBuild() : emptyBuild()
}

/** The dashboard before anything has been stored: real zeroes, no invention. */
function emptyBuild(): DashboardData {
  return {
    live: false,
    total: 0,
    kpis: reactorKpis.map((k) => ({
      label: k.label,
      value: 0,
      delta: '0',
      trend: 'flat' as const,
      spark: Array.from({ length: SPARK_WEEKS }, () => 0),
    })),
    growth: [],
    outcomes: { winners: 0, losers: 0, pending: 0, total: 0, winRate: 0, metrics: [] },
    systemLoad: [],
    activity: [],
    heatmap: { months: [], rows: [] },
    performanceSignals: [],
  }
}

// Re-export the winning angles (already curated; wired through here so the page
// has a single dashboard data source).
export { winningAngles }
