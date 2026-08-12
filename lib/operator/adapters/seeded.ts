/**
 * The seeded data source.
 *
 * This is not a fixture that hands the rules their answers. It is 24 days of
 * plausible delivery per creative with SHAPES in it, and the rules have to find
 * them the same way they would find them in a live account. That distinction is
 * the whole test: if a rule only fires because the seed contains a field called
 * `isFatiguing`, the rule has never actually run.
 *
 * The shapes deliberately cover every state the system claims to handle:
 *
 *   The Profit Leak        a genuine winner, comfortably inside its cohort  → ITERATE
 *   Systems Before Scale   both windows down, frequency saturating          → REPLACE (CONFIRMED)
 *   45-Hour Owner          last 3 days off a cliff, the week disagrees      → WATCH
 *   Margin Math            a bad week that has already turned               → RECOVERING (no card)
 *   Member Win — Jason     booked calls, never blended with the leads       → no proposal
 *   Stop Scaling           five days old, nothing is knowable yet           → no proposal
 *
 * Plus, on every creative: a `completeThrough` that leaves today incomplete,
 * two dates inside the attribution delay, and range-level frequency supplied as
 * range-level frequency. `Stop Scaling` has no ranges at all, which is how the
 * suite proves that a missing range produces a null frequency rather than one
 * quietly reconstructed out of daily reach.
 *
 * The creatives share their names and identities with the rest of the platform's
 * demo account, so Mike is talking about the same ads the Creative Leaderboard
 * is showing rather than a parallel fiction.
 */

import { addDays } from '@/lib/operator/dates'
import { hash } from '@/lib/operator/fingerprint'
import type {
  AudienceTemperature,
  CreativeFormat,
  CreativeSnapshot,
  DailyMetric,
  DataSource,
  DataSourceMetadata,
  PerformanceBaseline,
  PrimaryResultType,
  RangeDeliveryMetric,
} from '@/lib/operator/types'

/* --------------------------------- shaping --------------------------------- */

/** A run of consecutive days holding one performance profile. */
interface Phase {
  days: number
  /** Outbound CTR, percent. */
  ctr: number
  /** Cost per primary result, account currency. */
  cpr: number
  /** Daily spend. */
  spend: number
}

interface Seed {
  id: string
  name: string
  format: CreativeFormat
  hookType: string
  tags: string[]
  primaryResultType: PrimaryResultType
  offerType: string
  audienceTemperature: AudienceTemperature
  market: string
  campaignObjective: string
  cpm: number
  /** How noisy this creative's daily delivery is, 0–1. Drives the stability read. */
  jitter: number
  /** Oldest first. Total days = the creative's history length. */
  phases: Phase[]
  /** Range-level frequency for the two 7-day evaluation windows. */
  frequency?: { previous: number; current: number }
}

/** Deterministic ±1 noise from a string. Same seed, same account, every time. */
function noise(key: string): number {
  const h = Number.parseInt(hash(key), 36)
  return ((h % 2000) / 1000 - 1)
}

const SEEDS: Seed[] = [
  {
    id: 'ad_profit_leak',
    name: 'The Profit Leak — Founder Cut',
    format: 'video',
    hookType: 'specific dollar figure',
    tags: ['founder-led', 'specific-dollar-figure', 'profit'],
    primaryResultType: 'lead',
    offerType: 'Free Lead Magnet',
    audienceTemperature: 'cold',
    market: 'AU',
    campaignObjective: 'OUTCOME_LEADS',
    cpm: 19.4,
    jitter: 0.06,
    phases: [
      { days: 10, ctr: 3.0, cpr: 30, spend: 950 },
      { days: 7, ctr: 3.1, cpr: 28.5, spend: 1000 },
      { days: 4, ctr: 3.15, cpr: 28, spend: 1050 },
      { days: 3, ctr: 3.2, cpr: 27, spend: 1100 },
    ],
    frequency: { previous: 1.9, current: 2.1 },
  },
  {
    id: 'ad_systems_before_scale',
    name: 'Systems Before Scale',
    format: 'carousel',
    hookType: 'systems promise',
    tags: ['carousel', 'systems'],
    primaryResultType: 'lead',
    offerType: 'Free Lead Magnet',
    audienceTemperature: 'cold',
    market: 'AU',
    campaignObjective: 'OUTCOME_LEADS',
    cpm: 21.2,
    jitter: 0.08,
    phases: [
      { days: 10, ctr: 2.2, cpr: 38, spend: 320 },
      { days: 7, ctr: 1.9, cpr: 44, spend: 300 },
      { days: 4, ctr: 1.6, cpr: 52, spend: 290 },
      { days: 3, ctr: 1.25, cpr: 68, spend: 280 },
    ],
    frequency: { previous: 2.7, current: 3.4 },
  },
  {
    id: 'ad_45_hour',
    name: '45-Hour Owner — UGC',
    format: 'video',
    hookType: 'contrarian stop opener',
    tags: ['ugc', 'specific-dollar-figure', 'time-freedom'],
    primaryResultType: 'lead',
    offerType: 'Free Lead Magnet',
    audienceTemperature: 'cold',
    market: 'AU',
    campaignObjective: 'OUTCOME_LEADS',
    cpm: 18.6,
    jitter: 0.09,
    phases: [
      { days: 18, ctr: 2.85, cpr: 32, spend: 780 },
      { days: 3, ctr: 2.9, cpr: 31, spend: 800 },
      { days: 3, ctr: 2.05, cpr: 41, spend: 800 },
    ],
    frequency: { previous: 1.8, current: 1.9 },
  },
  {
    id: 'ad_margin_math',
    name: 'Margin Math',
    format: 'static',
    hookType: 'proof-led static',
    tags: ['static', 'specific-dollar-figure', 'profit'],
    primaryResultType: 'lead',
    offerType: 'Free Lead Magnet',
    audienceTemperature: 'cold',
    market: 'AU',
    campaignObjective: 'OUTCOME_LEADS',
    cpm: 17.8,
    jitter: 0.14,
    phases: [
      { days: 10, ctr: 2.4, cpr: 36, spend: 520 },
      { days: 7, ctr: 2.35, cpr: 37, spend: 510 },
      // A genuinely bad four days — deep enough that the 7-day window reads as
      // deterioration — followed by three that have already turned. This is the
      // shape that catches a naive fatigue rule out.
      { days: 4, ctr: 1.45, cpr: 54, spend: 500 },
      { days: 3, ctr: 2.4, cpr: 36, spend: 520 },
    ],
    frequency: { previous: 2.8, current: 2.4 },
  },
  {
    id: 'ad_member_win_jason',
    name: 'Member Win — Jason',
    format: 'video',
    hookType: 'named member proof',
    tags: ['testimonial', 'named-proof'],
    primaryResultType: 'booked_call',
    offerType: 'Strategy Call / Application',
    audienceTemperature: 'warm',
    market: 'AU',
    campaignObjective: 'OUTCOME_LEADS',
    cpm: 22.6,
    jitter: 0.11,
    phases: [
      { days: 14, ctr: 2.6, cpr: 178, spend: 350 },
      { days: 10, ctr: 2.55, cpr: 181, spend: 360 },
    ],
    frequency: { previous: 1.6, current: 1.7 },
  },
  {
    id: 'ad_stop_scaling',
    name: 'Stop Scaling — VSL Opener',
    format: 'video',
    hookType: 'authority open',
    tags: ['vsl', 'authority'],
    primaryResultType: 'lead',
    offerType: 'Free Lead Magnet',
    audienceTemperature: 'cold',
    market: 'AU',
    campaignObjective: 'OUTCOME_LEADS',
    cpm: 20.1,
    jitter: 0.18,
    // Five days old. Nothing is knowable, and the pipeline has to say so rather
    // than reading a trend off half a window.
    phases: [{ days: 5, ctr: 1.9, cpr: 58, spend: 420 }],
  },
]

/* ------------------------------- construction ------------------------------ */

function buildDaily(seed: Seed, lastCompleteDay: string): DailyMetric[] {
  const totalDays = seed.phases.reduce((s, p) => s + p.days, 0)
  const rows: DailyMetric[] = []

  let index = 0
  for (const phase of seed.phases) {
    for (let i = 0; i < phase.days; i += 1) {
      const date = addDays(lastCompleteDay, -(totalDays - 1 - index))
      const wobble = (amount: number, salt: string) =>
        1 + noise(`${seed.id}:${date}:${salt}`) * amount

      const spend = phase.spend * wobble(seed.jitter, 'spend')
      const cpr = phase.cpr * wobble(seed.jitter, 'cpr')
      const ctr = phase.ctr * wobble(seed.jitter * 0.5, 'ctr')
      const impressions = Math.round((spend / seed.cpm) * 1000)

      rows.push({
        date,
        spend: Math.round(spend * 100) / 100,
        impressions,
        // Daily reach is supplied precisely so the tests can prove nothing
        // derives a range frequency from it.
        reach: Math.round(impressions / 1.14),
        clicks: Math.round((impressions * ctr) / 100),
        primaryResults: Math.max(0, Math.round(spend / cpr)),
        primaryResultType: seed.primaryResultType,
      })
      index += 1
    }
  }

  return rows
}

function buildRanges(seed: Seed, lastCompleteDay: string, daily: DailyMetric[]): RangeDeliveryMetric[] {
  if (!seed.frequency) return []

  const window = (offset: number, frequency: number, label: 'current' | 'previous') => {
    const to = addDays(lastCompleteDay, -offset)
    const from = addDays(to, -6)
    const impressions = daily
      .filter((d) => d.date >= from && d.date <= to)
      .reduce((s, d) => s + d.impressions, 0)
    return {
      from,
      to,
      impressions,
      // Range reach is deduplicated across the whole window — which is exactly
      // why it cannot be reconstructed from the daily rows above.
      reach: Math.round(impressions / frequency),
      frequency,
      window: label,
      days: 7,
    } satisfies RangeDeliveryMetric
  }

  return [
    window(0, seed.frequency.current, 'current'),
    window(7, seed.frequency.previous, 'previous'),
  ]
}

/**
 * Cohort medians.
 *
 * Four levels for the lead cohorts so the resolver's progressive fallback is
 * genuinely exercised, and a booked-call ladder whose two narrow levels are
 * deliberately too thin — Member Win has to fall back to `result_type` and
 * carry the reduced strength that goes with it.
 *
 * The retargeting cohort at $24 exists to be NOT used. Every cold creative in
 * this seed would look spectacular against it, and none of them may be graded
 * against it, which is the point.
 */
function buildBaselines(from: string, to: string): PerformanceBaseline[] {
  return [
    {
      key: {
        primaryResultType: 'lead',
        offerType: 'Free Lead Magnet',
        audienceTemperature: 'cold',
        market: 'AU',
        campaignObjective: 'OUTCOME_LEADS',
      },
      medianCostPerResult: 41,
      medianCtr: 2.4,
      creativeCount: 5,
      resultCount: 1840,
      from,
      to,
      fallbackLevel: 'exact_cohort',
    },
    {
      key: {
        primaryResultType: 'lead',
        offerType: 'Free Lead Magnet',
        audienceTemperature: 'retargeting',
        market: 'AU',
        campaignObjective: 'OUTCOME_LEADS',
      },
      medianCostPerResult: 24,
      medianCtr: 3.4,
      creativeCount: 4,
      resultCount: 610,
      from,
      to,
      fallbackLevel: 'exact_cohort',
    },
    {
      key: { primaryResultType: 'lead', offerType: 'Free Lead Magnet' },
      medianCostPerResult: 43,
      medianCtr: 2.35,
      creativeCount: 6,
      resultCount: 2110,
      from,
      to,
      fallbackLevel: 'result_and_offer',
    },
    {
      key: { primaryResultType: 'lead' },
      medianCostPerResult: 45,
      medianCtr: 2.3,
      creativeCount: 8,
      resultCount: 2640,
      from,
      to,
      fallbackLevel: 'result_type',
    },
    {
      key: { primaryResultType: 'lead' },
      medianCostPerResult: 47,
      medianCtr: 2.25,
      creativeCount: 9,
      resultCount: 2900,
      from,
      to,
      fallbackLevel: 'account',
    },
    // Booked calls: the two narrow cohorts are under the floor on purpose.
    {
      key: {
        primaryResultType: 'booked_call',
        offerType: 'Strategy Call / Application',
        audienceTemperature: 'warm',
        market: 'AU',
        campaignObjective: 'OUTCOME_LEADS',
      },
      medianCostPerResult: 172,
      medianCtr: 2.5,
      creativeCount: 2,
      resultCount: 38,
      from,
      to,
      fallbackLevel: 'exact_cohort',
    },
    {
      key: { primaryResultType: 'booked_call', offerType: 'Strategy Call / Application' },
      medianCostPerResult: 180,
      medianCtr: 2.45,
      creativeCount: 2,
      resultCount: 44,
      from,
      to,
      fallbackLevel: 'result_and_offer',
    },
    {
      key: { primaryResultType: 'booked_call' },
      medianCostPerResult: 186,
      medianCtr: 2.4,
      creativeCount: 3,
      resultCount: 190,
      from,
      to,
      fallbackLevel: 'result_type',
    },
  ]
}

/* --------------------------------- factory --------------------------------- */

export interface SeededOptions {
  /**
   * The date the account is being read on. Everything is generated relative to
   * it, so a test pins it and the browser passes today — and the intended
   * shapes land in the intended windows either way.
   */
  evaluationDate: string
  /** Hours of attribution delay. Two days by default, as Meta typically runs. */
  maturityDelayHours?: number
}

export function createSeededSource(options: SeededOptions): DataSource {
  const { evaluationDate, maturityDelayHours = 48 } = options
  // Today is still running, so the last complete day is yesterday.
  const lastCompleteDay = addDays(evaluationDate, -1)

  const creatives: CreativeSnapshot[] = SEEDS.map((seed) => {
    const daily = buildDaily(seed, lastCompleteDay)
    return {
      id: seed.id,
      name: seed.name,
      format: seed.format,
      hookType: seed.hookType,
      tags: seed.tags,
      launchedAt: `${daily[0].date}T00:00:00Z`,
      primaryResultType: seed.primaryResultType,
      offerType: seed.offerType,
      audienceTemperature: seed.audienceTemperature,
      market: seed.market,
      campaignObjective: seed.campaignObjective,
      daily,
      ranges: buildRanges(seed, lastCompleteDay, daily),
    }
  })

  const metadata: DataSourceMetadata = {
    accountTimezone: 'Australia/Brisbane',
    attributionWindow: '7-day click, 1-day view',
    // Synced this morning, which is why yesterday is readable and today is not.
    lastSyncedAt: `${evaluationDate}T07:20:00Z`,
    completeThrough: lastCompleteDay,
    maturityDelayHours,
    origin: 'seeded',
  }

  const baselineFrom = addDays(lastCompleteDay, -29)
  const baselines = buildBaselines(baselineFrom, lastCompleteDay)

  return {
    getCreatives: async () => creatives,
    getBaselines: async () => baselines,
    getMetadata: async () => metadata,
  }
}

/** The campaign's configured cost-per-result target for the seeded account. */
export const SEEDED_TARGET_COST_PER_RESULT = 45

/**
 * The ad account's timezone.
 *
 * Exported separately from the metadata because the caller needs it BEFORE the
 * source exists: "today" has to be resolved in the account's calendar in order
 * to build the source for that day. With the live adapter this comes from
 * `/act_<id>?fields=timezone_name` and is read once at boot.
 */
export const SEEDED_ACCOUNT_TIMEZONE = 'Australia/Brisbane'
