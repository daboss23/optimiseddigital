/**
 * The shared creative status vocabulary.
 *
 * Both dashboards — Reactor (what does it mean / what next) and Meta
 * Intelligence (what happened) — speak the same nine words about a creative.
 * A status is never a colour on its own: every one carries a plain-language
 * MEANING, the THRESHOLD that has to be cleared before it can be assigned, and
 * on a real creative a `statusReason` written from the numbers that produced it.
 *
 * Thresholds are configurable per brand/campaign (see `StatusThresholds`) —
 * nothing here hard-codes a universal commercial benchmark, because a $28 CPL
 * is a triumph on one offer and a disaster on another.
 */

import type { Accent } from '@/components/reactor/ui'

export type CreativeStatus =
  | 'insufficient_data'
  | 'testing'
  | 'emerging_winner'
  | 'confirmed_winner'
  | 'scaling'
  | 'stable'
  | 'fatiguing'
  | 'loser'
  | 'paused'

export type StatusTone = 'default' | 'primary' | 'success' | 'warning' | 'danger'

export interface StatusDefinition {
  label: string
  /** Plain-language meaning, shown in tooltips and the explanation drawer. */
  meaning: string
  tone: StatusTone
  accent: Accent
}

export const STATUS_DEFS: Record<CreativeStatus, StatusDefinition> = {
  insufficient_data: {
    label: 'Insufficient data',
    meaning: 'Below the minimum spend, active time or result count needed to judge it.',
    tone: 'default',
    accent: 'blue',
  },
  testing: {
    label: 'Testing',
    meaning: 'Actively gathering data. No reliable conclusion yet.',
    tone: 'warning',
    accent: 'amber',
  },
  emerging_winner: {
    label: 'Emerging winner',
    meaning: 'Positive early signals against the target, confidence still incomplete.',
    tone: 'primary',
    accent: 'cyan',
  },
  confirmed_winner: {
    label: 'Confirmed winner',
    meaning: 'Meets the configured cost-per-result target with enough data to trust it.',
    tone: 'success',
    accent: 'emerald',
  },
  scaling: {
    label: 'Scaling',
    meaning: 'A confirmed winner now receiving increased spend or distribution.',
    tone: 'success',
    accent: 'emerald',
  },
  stable: {
    label: 'Stable',
    meaning: 'Acceptable performance with no material improvement or decline.',
    tone: 'primary',
    accent: 'blue',
  },
  fatiguing: {
    label: 'Fatiguing',
    meaning: 'Efficiency deteriorating, supported by delivery signals such as rising frequency.',
    tone: 'warning',
    accent: 'pink',
  },
  loser: {
    label: 'Loser',
    meaning: 'Reached the evaluation threshold and materially missed the target.',
    tone: 'danger',
    accent: 'pink',
  },
  paused: {
    label: 'Paused',
    meaning: 'No longer delivering. The historical result stays on the record.',
    tone: 'default',
    accent: 'blue',
  },
}

export const STATUS_ORDER: CreativeStatus[] = [
  'scaling',
  'confirmed_winner',
  'emerging_winner',
  'stable',
  'testing',
  'fatiguing',
  'loser',
  'insufficient_data',
  'paused',
]

export function statusLabel(s: CreativeStatus): string {
  return STATUS_DEFS[s].label
}

export function statusTone(s: CreativeStatus): StatusTone {
  return STATUS_DEFS[s].tone
}

/* ------------------------------ thresholds -------------------------------- */

/**
 * The gates a creative must clear before a commercial verdict is allowed.
 * Per brand or campaign — never global constants baked into a component.
 */
export interface StatusThresholds {
  /** Minimum spend, account currency, before Winner/Loser may be assigned. */
  minSpend: number
  /** Minimum days live. */
  minDays: number
  /** Minimum primary results recorded. */
  minResults: number
  /** The campaign's cost-per-result target — what "meets target" means here. */
  targetCostPerResult?: number
  /** Frequency above which delivery is treated as a fatigue signal. */
  fatigueFrequency: number
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
  minSpend: 500,
  minDays: 4,
  minResults: 15,
  fatigueFrequency: 3,
}

export function thresholdSummary(t: StatusThresholds): string {
  const parts = [
    `min spend $${t.minSpend.toLocaleString()}`,
    `${t.minDays} days live`,
    `${t.minResults} results`,
  ]
  if (t.targetCostPerResult) parts.push(`target $${t.targetCostPerResult} / result`)
  return parts.join(' · ')
}

/* ------------------------------ confidence -------------------------------- */

export type Confidence = 'Low' | 'Medium' | 'High'

export const CONFIDENCE_DEFS: Record<Confidence, string> = {
  Low: 'Thin sample or short window — treat as a promising signal, not a conclusion.',
  Medium: 'Enough comparable creatives to act on, not enough to change agent behaviour.',
  High: 'Consistent across a full evaluation window and a comparable cohort. May alter agent rules.',
}

export const confidenceTone: Record<Confidence, StatusTone> = {
  Low: 'default',
  Medium: 'warning',
  High: 'success',
}

/* ------------------------------- evaluation -------------------------------- */

export interface StatusSignals {
  spend: number
  results: number
  daysLive: number
  costPerResult: number
  frequency: number
  /** Percentage change in cost per result over the comparison window (+ = worse). */
  costTrendPct?: number
  /** Percentage change in outbound CTR over the comparison window (+ = better). */
  ctrTrendPct?: number
  /** Delivery has stopped. */
  paused?: boolean
  /** Budget has been increased on a confirmed winner. */
  scaling?: boolean
}

export interface StatusVerdict {
  status: CreativeStatus
  /** Evidence-based sentence: why this creative carries this status. */
  reason: string
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n)}%`

/**
 * Assign a status from signals + the campaign's thresholds. Deliberately
 * conservative: no Winner or Loser is issued until every gate is cleared, and
 * every verdict returns the sentence that justifies it.
 */
export function evaluateStatus(
  s: StatusSignals,
  t: StatusThresholds = DEFAULT_THRESHOLDS,
): StatusVerdict {
  if (s.paused) {
    return {
      status: 'paused',
      reason: `No longer delivering. Final read: $${s.costPerResult.toFixed(2)} per result across ${s.results} results and $${Math.round(s.spend).toLocaleString()} spend.`,
    }
  }

  const gated = s.spend < t.minSpend || s.daysLive < t.minDays || s.results < t.minResults
  if (gated) {
    return {
      status: s.spend > 0 ? 'testing' : 'insufficient_data',
      reason:
        s.spend > 0
          ? `Gathering data: $${Math.round(s.spend).toLocaleString()} of $${t.minSpend.toLocaleString()} minimum spend, ${s.results} of ${t.minResults} results, ${s.daysLive} of ${t.minDays} days live.`
          : `Below the evaluation threshold (${thresholdSummary(t)}). No conclusion is being drawn.`,
    }
  }

  const fatigue =
    s.frequency >= t.fatigueFrequency && (s.costTrendPct ?? 0) > 10 && (s.ctrTrendPct ?? 0) < 0
  if (fatigue) {
    return {
      status: 'fatiguing',
      reason: `Outbound CTR ${pct(s.ctrTrendPct ?? 0)}, cost per result ${pct(s.costTrendPct ?? 0)} and frequency at ${s.frequency.toFixed(1)} over the comparison window.`,
    }
  }

  const target = t.targetCostPerResult
  if (target) {
    if (s.costPerResult <= target * 0.85) {
      const status: CreativeStatus = s.scaling ? 'scaling' : 'confirmed_winner'
      return {
        status,
        reason: `$${s.costPerResult.toFixed(2)} per result against a $${target} target across ${s.results} results and $${Math.round(s.spend).toLocaleString()} spend${s.scaling ? ' — budget increased' : ''}.`,
      }
    }
    if (s.costPerResult <= target) {
      return {
        status: 'emerging_winner',
        reason: `$${s.costPerResult.toFixed(2)} per result is inside the $${target} target, but only ${s.results} results so far — confidence incomplete.`,
      }
    }
    if (s.costPerResult >= target * 1.4) {
      return {
        status: 'loser',
        reason: `$${s.costPerResult.toFixed(2)} per result against a $${target} target after $${Math.round(s.spend).toLocaleString()} spend — materially missed.`,
      }
    }
  }

  return {
    status: 'stable',
    reason: `$${s.costPerResult.toFixed(2)} per result, ${pct(s.costTrendPct ?? 0)} cost movement and frequency ${s.frequency.toFixed(1)} — holding without material change.`,
  }
}

/* ----------------------------- result types -------------------------------- */

/**
 * The result a campaign optimises for. Leads, registrations, applications and
 * booked calls are NEVER treated as equivalent — a blended "conversions" count
 * is exactly the ambiguity this type exists to remove.
 */
export type PrimaryResultType =
  | 'lead'
  | 'application'
  | 'booked_call'
  | 'registration'
  | 'purchase'
  | 'custom'

export const RESULT_LABELS: Record<
  PrimaryResultType,
  { one: string; many: string; cost: string; short: string }
> = {
  lead: { one: 'Lead', many: 'leads', cost: 'CPL', short: 'CPL' },
  application: { one: 'Application', many: 'applications', cost: 'Cost per Application', short: 'CPA·app' },
  booked_call: { one: 'Booked call', many: 'booked calls', cost: 'Cost per Booked Call', short: 'CP call' },
  registration: { one: 'Registration', many: 'registrations', cost: 'Cost per Registration', short: 'CP reg' },
  purchase: { one: 'Purchase', many: 'purchases', cost: 'Purchase CPA', short: 'CPA' },
  custom: { one: 'Custom conversion', many: 'conversions', cost: 'Cost per Result', short: 'CPR' },
}

/** The offer → default result → how a winner is judged mapping from the brief. */
export interface OfferResultRule {
  offer: string
  defaultResult: PrimaryResultType | null
  judgedBy: string
}

export const OFFER_RESULT_RULES: OfferResultRule[] = [
  { offer: 'Strategy Call / Application', defaultResult: 'booked_call', judgedBy: 'Cost per chosen result' },
  { offer: 'Webinar / Masterclass', defaultResult: 'registration', judgedBy: 'Cost per registration' },
  { offer: 'Free Lead Magnet', defaultResult: 'lead', judgedBy: 'CPL' },
  { offer: 'Live Event / In-Person', defaultResult: 'registration', judgedBy: 'Cost per registration' },
  { offer: 'Low-Ticket Offer', defaultResult: 'purchase', judgedBy: 'Purchase CPA and ROAS' },
  { offer: 'Custom', defaultResult: 'custom', judgedBy: 'User-selected target' },
  { offer: 'No Preference', defaultResult: null, judgedBy: 'Confirm the result target before launch' },
]

export function defaultResultForOffer(offer: string): PrimaryResultType | null {
  return OFFER_RESULT_RULES.find((r) => r.offer === offer)?.defaultResult ?? null
}

/** "$42.10 · Current result: Lead" — the cost label always names its result. */
export function costLabel(type: PrimaryResultType): string {
  return RESULT_LABELS[type].cost
}

export function resultPhrase(count: number, type: PrimaryResultType): string {
  const l = RESULT_LABELS[type]
  return `${count.toLocaleString()} ${count === 1 ? l.one.toLowerCase() : l.many}`
}
