import type { Accent } from '@/components/reactor/ui'

/**
 * Demo Meta Ads intelligence. Mirrors the shape a live Pipeboard / Meta Ads
 * pull would return so the Meta Intelligence page (and, later, the reactor
 * agent) can read from one contract. When PIPEBOARD_API_TOKEN is configured the
 * page can swap these for live figures; until then this curated set keeps the
 * surface fully populated.
 */

export interface MetaKpi {
  label: string
  value: string
  sub: string
  delta: string
  trend: 'up' | 'down' | 'flat'
  accent: Accent
}

// Hero performance — the numbers a media buyer scans first.
export const metaHeroKpis: MetaKpi[] = [
  { label: 'Ad Spend', value: '$148,320', sub: 'last 30 days', delta: '+12%', trend: 'up', accent: 'blue' },
  { label: 'Blended ROAS', value: '4.7x', sub: 'return on ad spend', delta: '+0.4x', trend: 'up', accent: 'emerald' },
  { label: 'Conversions', value: '1,284', sub: 'leads + booked calls', delta: '+9%', trend: 'up', accent: 'violet' },
  { label: 'Avg CTR', value: '2.34%', sub: 'all active campaigns', delta: '+0.3pp', trend: 'up', accent: 'cyan' },
]

export interface MetaMetric {
  label: string
  value: string
  metric: string
  pct: number
  accent: Accent
}

// Secondary efficiency + creative-quality read-outs (pct drives the gauge).
export const metaMetrics: MetaMetric[] = [
  { label: 'CPC', value: '$0.82', metric: 'cost per click', pct: 74, accent: 'blue' },
  { label: 'CPM', value: '$19.40', metric: 'cost per 1k impressions', pct: 61, accent: 'cyan' },
  { label: 'CPA', value: '$42.10', metric: 'cost per acquisition', pct: 68, accent: 'violet' },
  { label: 'Reach', value: '612K', metric: 'unique people', pct: 82, accent: 'emerald' },
  { label: 'Frequency', value: '1.8', metric: 'avg impressions / person', pct: 45, accent: 'pink' },
  { label: 'Hook Rate', value: '31%', metric: '3s video views', pct: 62, accent: 'amber' },
  { label: 'Hold Rate', value: '18%', metric: 'thru-play to 15s', pct: 54, accent: 'cyan' },
  { label: 'Landing CVR', value: '9.2%', metric: 'page → lead', pct: 71, accent: 'emerald' },
]

export interface MetaAd {
  name: string
  format: string
  spend: string
  roas: number
  /** Thumb-stop / hook rate — 3-sec views over impressions, e.g. "34%". */
  hookRate: string
  ctr: string
  cpa: string
  status: 'Scaling' | 'Winner' | 'Stable' | 'Testing' | 'Fatiguing'
}

export const metaTopAds: MetaAd[] = [
  { name: 'The Profit Leak — Founder Cut', format: 'Founder Video', spend: '$24,100', roas: 6.2, hookRate: '38%', ctr: '3.1%', cpa: '$28', status: 'Scaling' },
  { name: '45-Hour Owner — UGC', format: 'UGC Video', spend: '$18,640', roas: 5.4, hookRate: '35%', ctr: '2.8%', cpa: '$33', status: 'Winner' },
  { name: 'Member Win — Jason', format: 'Testimonial', spend: '$8,210', roas: 4.8, hookRate: '33%', ctr: '2.6%', cpa: '$37', status: 'Winner' },
  { name: 'Margin Math', format: 'Static', spend: '$12,300', roas: 4.1, hookRate: '29%', ctr: '2.2%', cpa: '$46', status: 'Stable' },
  { name: 'Stop Scaling — VSL Opener', format: 'VSL', spend: '$9,820', roas: 3.6, hookRate: '26%', ctr: '1.9%', cpa: '$58', status: 'Testing' },
  { name: 'Systems Before Scale', format: 'Carousel', spend: '$6,450', roas: 2.9, hookRate: '24%', ctr: '1.6%', cpa: '$71', status: 'Fatiguing' },
]

export interface SpendWeek {
  week: string
  spend: number
  roas: number
}

export const metaSpendTrend: SpendWeek[] = [
  { week: 'W1', spend: 28200, roas: 3.9 },
  { week: 'W2', spend: 31100, roas: 4.1 },
  { week: 'W3', spend: 29800, roas: 4.0 },
  { week: 'W4', spend: 34500, roas: 4.4 },
  { week: 'W5', spend: 33200, roas: 4.6 },
  { week: 'W6', spend: 38900, roas: 4.5 },
  { week: 'W7', spend: 41200, roas: 4.8 },
  { week: 'W8', spend: 44300, roas: 5.0 },
]

export interface BreakdownRow {
  label: string
  share: number
  metric: string
  accent: Accent
}

// Where spend lands and how each slice performs.
export const metaAudienceBreakdown: BreakdownRow[] = [
  { label: 'Retargeting', share: 22, metric: '7.1x ROAS', accent: 'emerald' },
  { label: 'Lookalike 1–3%', share: 31, metric: '4.6x ROAS', accent: 'blue' },
  { label: 'Cold Interest', share: 34, metric: '3.2x ROAS', accent: 'cyan' },
  { label: 'Re-engagement', share: 13, metric: '5.3x ROAS', accent: 'violet' },
]

export const metaPlacementBreakdown: BreakdownRow[] = [
  { label: 'Reels', share: 38, metric: '2.9% CTR', accent: 'pink' },
  { label: 'Feed', share: 33, metric: '2.1% CTR', accent: 'blue' },
  { label: 'Stories', share: 17, metric: '1.8% CTR', accent: 'violet' },
  { label: 'Advantage+', share: 12, metric: '2.4% CTR', accent: 'emerald' },
]

export interface AgentInsight {
  insight: string
  action: string
  lift: string
}

// What the reactor agent extracts from this data to brief the next campaign.
export const metaAgentInsights: AgentInsight[] = [
  {
    insight: 'Founder-led video drives 38% lower CPA than static across cold audiences.',
    action: 'Prioritise Founder Concepts for cold prospecting in the next run.',
    lift: '−38% CPA',
  },
  {
    insight: '8–12 word hooks hold attention 22% longer than 13+ word hooks.',
    action: 'Constrain hook length when drafting Copy + VSL openers.',
    lift: '+22% hold',
  },
  {
    insight: 'Retargeting ROAS (7.1x) is 2.2x cold (3.2x), yet only gets 22% of spend.',
    action: 'Shift 15% of budget to retargeting creative; deepen objection-handling angles.',
    lift: '+0.4x ROAS',
  },
  {
    insight: 'Reels outperform Feed for UGC by 1.6x ROAS.',
    action: 'Default UGC + testimonial concepts to 9:16 for Reels placement.',
    lift: '+1.6x ROAS',
  },
]

// Headline figures for the learning-loop strip.
export const metaLearningStats = {
  signalsIngested: 6420,
  winnersLogged: 38,
  patternsUpdated: 17,
  lastSync: '4 min ago',
}
