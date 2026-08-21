import type { Accent } from '@/components/reactor/ui'
import {
  DEFAULT_THRESHOLDS,
  type CreativeStatus,
  type PrimaryResultType,
  type StatusThresholds,
} from '@/lib/creative-status'
import type { DateRange } from '@/lib/date-range'

/**
 * The Meta analytics contract, plus the curated baseline the demo dataset is
 * generated from.
 *
 * Semantics matter more than the numbers here. A "conversion" is never a
 * blended total — every result carries its TYPE (lead / registration /
 * application / booked call / purchase), every cost names the result it is the
 * cost OF, and ROAS only exists when real revenue is connected. Anything
 * seeded for demonstration is labelled DEMO DATA in the UI.
 *
 * Nothing in here is fixed to a window. The baseline describes a 30-day period;
 * `lib/meta-demo.ts` projects it onto whatever range the user has selected, and
 * the live path in `lib/meta-graph.ts` asks the Graph API for that same range.
 */

export interface MetaKpi {
  label: string
  value: string
  sub: string
  delta: string
  trend: 'up' | 'down' | 'flat'
  accent: Accent
  /** What this number means and how it is calculated — surfaced as a tooltip. */
  definition?: string
  /** Result-type split for a mixed, account-wide total. */
  breakdown?: ResultSlice[]
}

/** One result type inside an account-wide mixed total. */
export interface ResultSlice {
  type: PrimaryResultType
  count: number
}

export interface MetaMetric {
  label: string
  value: string
  metric: string
  pct: number
  accent: Accent
  definition?: string
}

export type CreativeTrend = 'Improving' | 'Stable' | 'Declining'

export interface MetaAd {
  id: string
  name: string
  format: string
  /** Creative thumbnail / video still. Absent → the UI renders a format tile. */
  thumbnailUrl?: string
  spend: number
  /** How many of the campaign's primary result this creative produced. */
  primaryResults: number
  resultType: PrimaryResultType
  costPerResult: number
  /** Thumb-stop rate. `null` = Not applicable (e.g. a static ad). */
  hookRate: number | null
  /** Outbound CTR, percent. */
  ctr: number
  frequency: number
  trend: CreativeTrend
  /** Only present when real revenue is connected to the campaign. */
  roas: number | null
  status: CreativeStatus
  /** Evidence sentence behind the status — required, never a bare colour. */
  statusReason: string
  /**
   * LIFECYCLE METADATA — the creative's own age, not the analysed window.
   * Always labelled as such in the UI so it can never be mistaken for a
   * range-scoped figure.
   */
  daysLive: number
  /** Lifecycle metadata: when this creative first delivered. */
  launchedOn?: string
}

export interface TrendPoint {
  /** Axis label derived from the selected range, never a fixed "W1". */
  label: string
  from: string
  to: string
  spend: number
  costPerResult: number
  /** Only when revenue is connected. */
  roas: number | null
}

export interface BreakdownRow {
  label: string
  share: number
  metric: string
  accent: Accent
}

export interface AgentInsight {
  insight: string
  action: string
  lift: string
}

export interface LearningStats {
  signalsIngested: number
  winnersLogged: number
  patternsUpdated: number
  lastSync: string
}

/** Everything both dashboards render for one date range. */
export interface MetaDashboard {
  /** 'empty' = Meta is not connected and demo data is off — a real zero state. */
  source: 'live' | 'demo' | 'empty'
  /** The single window every figure below was computed over. */
  range: DateRange
  /** The equally long window immediately before it, used for every delta. */
  comparison: DateRange
  heroKpis: MetaKpi[]
  metrics: MetaMetric[]
  topAds: MetaAd[]
  spendTrend: TrendPoint[]
  audienceBreakdown: BreakdownRow[]
  placementBreakdown: BreakdownRow[]
  agentInsights: AgentInsight[]
  learningStats: LearningStats
  /** Every result type counted separately — never one blended "conversions". */
  resultMix: ResultSlice[]
  /** The dominant result type an account-wide cost figure refers to. */
  primaryResultType: PrimaryResultType
  /** ROAS is only shown when this is true. */
  revenueConnected: boolean
  /** The evaluation gates every status in this payload was assigned under. */
  thresholds: StatusThresholds
  spendTotal: number
  /** Set when the live API is configured but could not be read. Surfaced in UI. */
  error?: string
}

/* -------------------------------- formatters ------------------------------- */

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export function compactMoney(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`
}

export function pctLabel(n: number | null): string {
  return n === null ? 'N/A' : `${n.toFixed(1)}%`
}

/* --------------------------------- baseline -------------------------------- */

/** The window the curated baseline describes. Everything scales from here. */
export const BASELINE_DAYS = 30

/**
 * Whether real revenue (or a defensible conversion value) is connected. Lead
 * campaigns with no revenue feedback must NOT display ROAS — the dashboard
 * shows result efficiency instead.
 */
export const metaRevenueConnected = false

/** Campaign-level evaluation gates. Configurable per brand/campaign. */
export const metaThresholds: StatusThresholds = {
  ...DEFAULT_THRESHOLDS,
  minSpend: 1500,
  minDays: 5,
  minResults: 20,
  targetCostPerResult: 45,
}

export const metaPrimaryResultType: PrimaryResultType = 'lead'

export interface MetaBaseline {
  spend: number
  resultMix: ResultSlice[]
  cpc: number
  cpm: number
  ctr: number
  reach: number
  impressions: number
  clicks: number
  frequency: number
  hookRate: number
  holdRate: number
  landingCvr: number
}

/** Curated 30-day baseline for the demo account. */
export const metaBaseline: MetaBaseline = {
  spend: 148_320,
  resultMix: [
    { type: 'lead', count: 2530 },
    { type: 'registration', count: 590 },
    { type: 'application', count: 280 },
    { type: 'booked_call', count: 130 },
  ],
  cpc: 0.82,
  cpm: 19.4,
  ctr: 2.34,
  reach: 612_000,
  impressions: 7_645_000,
  clicks: 178_900,
  frequency: 1.8,
  hookRate: 31,
  holdRate: 18,
  landingCvr: 9.2,
}

/** The demo creatives, expressed over the 30-day baseline window. */
export interface BaselineAd {
  id: string
  name: string
  format: string
  spend: number
  primaryResults: number
  resultType: PrimaryResultType
  hookRate: number | null
  ctr: number
  frequency: number
  trend: CreativeTrend
  /** Lifecycle metadata — independent of the analysed window. */
  daysLive: number
  scaling?: boolean
}

export const baselineAds: BaselineAd[] = [
  { id: 'ad_profit_leak', name: 'The Profit Leak — Founder Cut', format: 'Founder Video', spend: 24100, primaryResults: 861, resultType: 'lead', hookRate: 38, ctr: 3.1, frequency: 2.2, trend: 'Improving', daysLive: 26, scaling: true },
  { id: 'ad_45_hour', name: '45-Hour Owner — UGC', format: 'UGC Video', spend: 18640, primaryResults: 565, resultType: 'lead', hookRate: 35, ctr: 2.8, frequency: 2.0, trend: 'Improving', daysLive: 21 },
  { id: 'ad_member_win_jason', name: 'Member Win — Jason', format: 'Testimonial', spend: 8210, primaryResults: 191, resultType: 'booked_call', hookRate: 33, ctr: 2.6, frequency: 1.7, trend: 'Stable', daysLive: 14 },
  { id: 'ad_margin_math', name: 'Margin Math', format: 'Static', spend: 12300, primaryResults: 267, resultType: 'lead', hookRate: null, ctr: 2.2, frequency: 2.4, trend: 'Stable', daysLive: 19 },
  { id: 'ad_stop_scaling', name: 'Stop Scaling — VSL Opener', format: 'VSL', spend: 2940, primaryResults: 51, resultType: 'lead', hookRate: 26, ctr: 1.9, frequency: 1.2, trend: 'Stable', daysLive: 8 },
  { id: 'ad_systems_before_scale', name: 'Systems Before Scale', format: 'Carousel', spend: 6450, primaryResults: 91, resultType: 'lead', hookRate: null, ctr: 1.6, frequency: 3.4, trend: 'Declining', daysLive: 31 },
  // Two creatives that have NOT yet reached a verdict, so the board carries the
  // states an ad account really spends most of its time in. Without them the
  // demo skips straight from launch to a graded winner, and the two tiles that
  // describe the middle of the funnel — Currently testing, Emerging winners —
  // sit at zero on a dashboard that is otherwise busy.
  //
  // The numbers are chosen to land on those statuses through `evaluateStatus`
  // rather than being labelled: below the $1,500 / 5 day / 20 result gate is
  // "testing", and inside the $45 target but light on results is "emerging".
  { id: 'ad_quiet_quote', name: 'The Quiet Quote — Hook Test', format: 'UGC Video', spend: 940, primaryResults: 13, resultType: 'lead', hookRate: 31, ctr: 2.4, frequency: 1.1, trend: 'Improving', daysLive: 4 },
  { id: 'ad_two_week_build', name: 'Two-Week Build — Reel Cut', format: 'Founder Video', spend: 5180, primaryResults: 116, resultType: 'lead', hookRate: 34, ctr: 2.7, frequency: 1.5, trend: 'Improving', daysLive: 11 },
]

// Where spend lands and how each slice performs. Cold and retargeting are shown
// side by side but never compared as equivalent cohorts.
export const metaAudienceBreakdown: BreakdownRow[] = [
  { label: 'Retargeting', share: 22, metric: '$26 CPL', accent: 'emerald' },
  { label: 'Lookalike 1–3%', share: 31, metric: '$39 CPL', accent: 'blue' },
  { label: 'Cold Interest', share: 34, metric: '$48 CPL', accent: 'cyan' },
  { label: 'Re-engagement', share: 13, metric: '$31 CPL', accent: 'violet' },
]

export const metaPlacementBreakdown: BreakdownRow[] = [
  { label: 'Reels', share: 38, metric: '2.9% CTR', accent: 'pink' },
  { label: 'Feed', share: 33, metric: '2.1% CTR', accent: 'blue' },
  { label: 'Stories', share: 17, metric: '1.8% CTR', accent: 'violet' },
  { label: 'Advantage+', share: 12, metric: '2.4% CTR', accent: 'emerald' },
]

/** Accent channels for the hero and efficiency cards, in render order. */
export const heroAccents: Accent[] = ['blue', 'violet', 'emerald', 'cyan']
export const metricAccents: Accent[] = [
  'blue',
  'cyan',
  'violet',
  'emerald',
  'pink',
  'amber',
  'cyan',
  'emerald',
]

// What the reactor agent extracts from this data to brief the next campaign.
export const metaAgentInsights: AgentInsight[] = [
  {
    insight: 'Founder-led video is associated with a 38% lower cost per lead than static across cold audiences.',
    action: 'Prioritise Founder Concepts for cold prospecting in the next run.',
    lift: '−38% CPL',
  },
  {
    insight: '8–12 word hooks outperformed 13+ word hooks on hold rate in this sample.',
    action: 'Constrain hook length when drafting Copy + VSL openers.',
    lift: '+22% hold',
  },
  {
    insight: 'Retargeting produces leads at $26 vs $48 cold, yet takes only 22% of spend.',
    action: 'Shift 15% of budget to retargeting creative; deepen objection-handling angles.',
    lift: '−46% CPL',
  },
  {
    insight: 'Reels outperform Feed for UGC on cost per lead — a promising pattern, not yet confirmed.',
    action: 'Default UGC + testimonial concepts to 9:16 for Reels placement.',
    lift: '−19% CPL',
  },
]

// Headline figures for the learning-loop strip.
export const metaLearningStats: LearningStats = {
  signalsIngested: 6420,
  winnersLogged: 38,
  patternsUpdated: 17,
  lastSync: '4 min ago',
}
