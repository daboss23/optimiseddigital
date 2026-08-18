/**
 * The curated demo account, projected onto whatever date range is selected.
 *
 * A seeded demo is only honest if it behaves like the real thing: pick a
 * shorter window and spend, results and sample sizes fall, statuses drop back
 * to Testing or Insufficient data because the thresholds have not been cleared,
 * and the trend chart re-buckets. Nothing here is a fixed "last 30 days"
 * snapshot dressed up with a new label.
 *
 * Every value is deterministic in (range, entity) — the same window always
 * renders the same numbers, so switching back and forth never reshuffles the
 * dashboard.
 */

import {
  RESULT_LABELS,
  costLabel,
  evaluateStatus,
  type PrimaryResultType,
} from '@/lib/creative-status'
import {
  BASELINE_DAYS,
  baselineAds,
  heroAccents,
  metaAgentInsights,
  metaAudienceBreakdown,
  metaBaseline,
  metaLearningStats,
  metaPlacementBreakdown,
  metaPrimaryResultType,
  metaRevenueConnected,
  metaThresholds,
  metricAccents,
  money,
  type MetaAd,
  type MetaDashboard,
  type MetaKpi,
  type MetaMetric,
  type ResultSlice,
  type TrendPoint,
} from '@/lib/meta-data'
import {
  previousRange,
  rangeDays,
  rangeKey,
  rangeLabel,
  trendBuckets,
  type DateRange,
} from '@/lib/date-range'

/* --------------------------------- seeding --------------------------------- */

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic multiplier in [1-amp, 1+amp] for a given seed. */
function drift(seed: string, amp: number): number {
  return 1 + ((hash(seed) % 2000) / 1000 - 1) * amp
}

/* --------------------------------- totals ---------------------------------- */

interface Totals {
  spend: number
  mix: ResultSlice[]
  results: number
  costPerResult: number
  impressions: number
  clicks: number
  reach: number
  cpc: number
  cpm: number
  ctr: number
  frequency: number
  hookRate: number
  holdRate: number
  landingCvr: number
}

function totalsFor(range: DateRange): Totals {
  const days = rangeDays(range)
  const scale = days / BASELINE_DAYS
  const key = rangeKey(range)
  const b = metaBaseline

  // Volume scales with the window; rates drift slightly but stay realistic.
  const spend = Math.round(b.spend * scale * drift(`${key}:spend`, 0.08))
  const efficiency = drift(`${key}:eff`, 0.1)
  const mix: ResultSlice[] = b.resultMix.map((slice) => ({
    type: slice.type,
    count: Math.max(0, Math.round(slice.count * scale * efficiency * drift(`${key}:${slice.type}`, 0.06))),
  }))
  const results = mix.reduce((s, r) => s + r.count, 0)

  return {
    spend,
    mix,
    results,
    costPerResult: results > 0 ? spend / results : 0,
    impressions: Math.round(b.impressions * scale * drift(`${key}:imp`, 0.07)),
    clicks: Math.round(b.clicks * scale * drift(`${key}:clicks`, 0.07)),
    reach: Math.round(b.reach * scale * drift(`${key}:reach`, 0.09)),
    cpc: b.cpc * drift(`${key}:cpc`, 0.09),
    cpm: b.cpm * drift(`${key}:cpm`, 0.08),
    ctr: b.ctr * drift(`${key}:ctr`, 0.08),
    // Frequency genuinely accumulates with a longer window.
    frequency: Math.max(1, b.frequency * (0.55 + 0.45 * (days / BASELINE_DAYS)) * drift(`${key}:freq`, 0.05)),
    hookRate: b.hookRate * drift(`${key}:hook`, 0.08),
    holdRate: b.holdRate * drift(`${key}:hold`, 0.08),
    landingCvr: b.landingCvr * drift(`${key}:cvr`, 0.08),
  }
}

function deltaLabel(current: number, prior: number, invert = false): { delta: string; trend: 'up' | 'down' | 'flat' } {
  if (prior <= 0) return { delta: '', trend: 'flat' }
  const change = ((current - prior) / prior) * 100
  if (Math.abs(change) < 0.5) return { delta: '0%', trend: 'flat' }
  const better = invert ? change < 0 : change > 0
  return {
    delta: `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%`,
    trend: better ? 'up' : 'down',
  }
}

/* ---------------------------------- ads ------------------------------------ */

function buildAds(range: DateRange, totals: Totals): MetaAd[] {
  const days = rangeDays(range)
  const scale = days / BASELINE_DAYS
  const key = rangeKey(range)
  const target = metaThresholds.targetCostPerResult

  return baselineAds.map((a) => {
    const spend = Math.round(a.spend * scale * drift(`${key}:${a.id}:spend`, 0.1))
    const results = Math.max(0, Math.round(a.primaryResults * scale * drift(`${key}:${a.id}:res`, 0.1)))
    const costPerResult = results > 0 ? spend / results : 0
    // Frequency accumulates within the window, so a 7-day read is never as
    // fatigued as a 90-day one on the same creative.
    const frequency = Math.max(1, a.frequency * (0.5 + 0.5 * scale) * drift(`${key}:${a.id}:f`, 0.05))
    const costTrendPct = a.trend === 'Declining' ? 18 : a.trend === 'Improving' ? -9 : 2
    const ctrTrendPct = a.trend === 'Declining' ? -21 : a.trend === 'Improving' ? 12 : 1

    // Days live is LIFECYCLE metadata: the creative's own age, capped by the
    // window only in the sense that it cannot have been live longer than it has.
    const daysLive = a.daysLive

    const verdict = evaluateStatus(
      {
        spend,
        results,
        // Evaluation uses the days the creative actually delivered INSIDE the
        // selected window — a 7-day range cannot confirm a winner on evidence
        // it has not looked at.
        daysLive: Math.min(daysLive, days),
        costPerResult,
        frequency,
        costTrendPct,
        ctrTrendPct,
        scaling: a.scaling && target ? costPerResult <= target * 0.85 : false,
      },
      metaThresholds,
    )

    return {
      id: a.id,
      name: a.name,
      format: a.format,
      spend,
      primaryResults: results,
      resultType: a.resultType,
      costPerResult: Number(costPerResult.toFixed(2)),
      hookRate: a.hookRate === null ? null : Number((a.hookRate * drift(`${key}:${a.id}:h`, 0.06)).toFixed(1)),
      ctr: Number((a.ctr * drift(`${key}:${a.id}:c`, 0.07)).toFixed(2)),
      frequency: Number(frequency.toFixed(1)),
      trend: a.trend,
      roas: null,
      status: verdict.status,
      statusReason: verdict.reason,
      daysLive,
    }
  })
    .sort((x, y) => y.spend - x.spend)
}

/* --------------------------------- trend ----------------------------------- */

function buildTrend(range: DateRange, totals: Totals): TrendPoint[] {
  const buckets = trendBuckets(range)
  if (buckets.length === 0) return []
  const perBucketSpend = totals.spend / buckets.length
  const perBucketResults = totals.results / buckets.length

  return buckets.map((b, i) => {
    // A gentle efficiency improvement across the window, plus per-bucket drift.
    const ramp = 1 + (i / Math.max(1, buckets.length - 1) - 0.5) * 0.28
    const spend = Math.round(perBucketSpend * ramp * drift(`${b.from}:spend`, 0.08))
    const results = Math.max(1, perBucketResults * (0.85 + 0.3 * (i / Math.max(1, buckets.length - 1))))
    return {
      label: b.label,
      from: b.from,
      to: b.to,
      spend,
      costPerResult: Number((spend / results).toFixed(2)),
      roas: null,
    }
  })
}

/* ---------------------------------- KPIs ----------------------------------- */

function heroKpis(range: DateRange, totals: Totals, prior: Totals): MetaKpi[] {
  const type = totals.mix[0]?.type ?? metaPrimaryResultType
  const label = RESULT_LABELS[type]
  const target = metaThresholds.targetCostPerResult
  const mixed = totals.mix.length > 1

  const spendDelta = deltaLabel(totals.spend, prior.spend)
  const resultDelta = deltaLabel(totals.results, prior.results)
  const costDelta = deltaLabel(totals.costPerResult, prior.costPerResult, true)

  const efficiencyPct =
    target && totals.costPerResult > 0
      ? ((totals.costPerResult - target) / target) * 100
      : null

  return [
    {
      label: 'Ad Spend',
      value: money(totals.spend),
      sub: rangeLabel(range).toLowerCase(),
      delta: spendDelta.delta,
      trend: spendDelta.trend,
      accent: heroAccents[0],
      definition:
        'Total amount spent across active campaigns in the selected range. The change compares against the equally long period immediately before it.',
    },
    {
      label: 'Primary Results',
      value: totals.results > 0 ? totals.results.toLocaleString() : 'Insufficient data',
      sub: mixed ? 'mixed result types — see the split' : label.many,
      delta: resultDelta.delta,
      trend: resultDelta.trend,
      accent: heroAccents[1],
      definition:
        'The optimisation result each campaign was actually buying. Types are counted separately and never treated as equivalent.',
      breakdown: totals.mix,
    },
    {
      label: 'Cost per Result',
      value: totals.costPerResult > 0 ? `$${totals.costPerResult.toFixed(2)}` : 'Insufficient data',
      sub: `Current result: ${label.one}`,
      delta: costDelta.delta,
      trend: costDelta.trend,
      accent: heroAccents[2],
      definition: mixed
        ? 'Spend over the dominant result type in this range. The account mixes result types, so read the split rather than treating this as one blended cost.'
        : `Spend divided by ${label.many} in the selected range.`,
    },
    {
      label: 'Result Efficiency',
      value:
        efficiencyPct === null
          ? 'Insufficient data'
          : `${Math.abs(Math.round(efficiencyPct))}% ${efficiencyPct <= 0 ? 'under' : 'over'} target`,
      sub: target ? `$${totals.costPerResult.toFixed(2)} vs $${target} ${costLabel(type)} target` : 'no target set',
      delta: '',
      trend: 'flat',
      accent: heroAccents[3],
      definition:
        'Cost per result against the campaign target. Shown in place of ROAS because no revenue or defensible conversion value is connected to these lead campaigns.',
    },
  ]
}

function efficiencyMetrics(totals: Totals, prior: Totals): MetaMetric[] {
  const type = totals.mix[0]?.type ?? metaPrimaryResultType
  const rows: Omit<MetaMetric, 'accent'>[] = [
    { label: 'CPC', value: `$${totals.cpc.toFixed(2)}`, metric: 'cost per link click', pct: 74, definition: 'Spend divided by link clicks in the selected range.' },
    { label: 'CPM', value: `$${totals.cpm.toFixed(2)}`, metric: 'cost per 1k impressions', pct: 61, definition: 'Delivery cost in the selected range, not a performance verdict.' },
    { label: 'Outbound CTR', value: `${totals.ctr.toFixed(2)}%`, metric: 'clicks leaving Meta', pct: 68, definition: 'Outbound clicks over impressions — the click that actually reaches the landing page.' },
    { label: 'Reach', value: `${(totals.reach / 1000).toFixed(0)}K`, metric: 'unique people', pct: 82, definition: 'Unique people who saw an ad at least once inside the selected range.' },
    { label: 'Frequency', value: totals.frequency.toFixed(1), metric: 'avg impressions / person', pct: Math.min(100, Math.round((totals.frequency / 4) * 100)), definition: 'Average impressions per person in this range. Rising frequency alongside falling CTR is the primary fatigue signal.' },
    { label: 'Hook Rate', value: `${totals.hookRate.toFixed(0)}%`, metric: '3s views / impressions', pct: 62, definition: 'Video only. Not applicable to static creatives, and never proof of a commercial winner on its own.' },
    { label: 'Hold Rate', value: `${totals.holdRate.toFixed(0)}%`, metric: 'thru-play to 15s', pct: 54, definition: 'Video only. Attention retained past the hook.' },
    { label: `Landing CVR`, value: `${totals.landingCvr.toFixed(1)}%`, metric: `page → ${RESULT_LABELS[type].one.toLowerCase()}`, pct: 71, definition: 'Share of landing page visits that produced the campaign primary result.' },
  ]
  void prior
  return rows.map((r, i) => ({ ...r, accent: metricAccents[i] ?? 'blue' }))
}

/* --------------------------------- assembly -------------------------------- */

/** Build the whole demo dashboard for one range. Pure and deterministic. */
/**
 * The dashboard with no Meta account connected and demo data off.
 *
 * Same shape, all zeroes, no ads. The seeded snapshot names another company's
 * campaigns and spend — shown to a customer who has connected nothing, it reads
 * as their own account, and no badge fixes that.
 */
export function buildEmptyDashboard(range: DateRange): MetaDashboard {
  const demo = buildDemoDashboard(range)
  return {
    ...demo,
    source: 'empty',
    heroKpis: demo.heroKpis.map((k) => ({ ...k, value: '—', delta: '0', trend: 'flat' as const })),
    metrics: [],
    topAds: [],
    spendTrend: [],
    audienceBreakdown: [],
    placementBreakdown: [],
    agentInsights: [],
    resultMix: [],
    revenueConnected: false,
    spendTotal: 0,
    learningStats: {
      signalsIngested: 0,
      winnersLogged: 0,
      patternsUpdated: 0,
      lastSync: 'never',
    },
  }
}

export function buildDemoDashboard(range: DateRange): MetaDashboard {
  const comparison = previousRange(range)
  const totals = totalsFor(range)
  const prior = totalsFor(comparison)
  const type: PrimaryResultType = totals.mix[0]?.type ?? metaPrimaryResultType

  return {
    source: 'demo',
    range,
    comparison,
    heroKpis: heroKpis(range, totals, prior),
    metrics: efficiencyMetrics(totals, prior),
    topAds: buildAds(range, totals),
    spendTrend: buildTrend(range, totals),
    audienceBreakdown: metaAudienceBreakdown,
    placementBreakdown: metaPlacementBreakdown,
    agentInsights: metaAgentInsights,
    learningStats: metaLearningStats,
    resultMix: totals.mix,
    primaryResultType: type,
    revenueConnected: metaRevenueConnected,
    thresholds: metaThresholds,
    spendTotal: totals.spend,
  }
}
