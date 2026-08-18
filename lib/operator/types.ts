/**
 * Mike Delight — the shared type contract.
 *
 * One principle runs through every type in this file:
 *
 *   Maths decides what is true. Mike decides what matters. The human decides
 *   what happens.
 *
 * So the types are split by who owns them. Everything down to `Proposal` is
 * computed — no model touches it. `NarratedCard` is Mike's, and carries only
 * language plus references BACK into the computed evidence. The UI renders
 * every number from `Evidence`, never from a sentence.
 *
 * Two data hygiene rules are enforced by the shapes themselves rather than by
 * convention:
 *
 * 1. There is no generic `conversions` field. Every result carries its
 *    `PrimaryResultType`, because a lead and a booked call are not the same
 *    outcome and must never be blended into one total.
 * 2. Frequency only exists on `RangeDeliveryMetric`. Reach deduplicates across
 *    days, so a range frequency cannot be summed or averaged out of daily rows
 *    — the type gives the rules nowhere to do it from.
 */

import type { PrimaryResultType } from '@/lib/creative-status'

export type { PrimaryResultType }

/* ------------------------------- source data ------------------------------- */

/** One complete (or provisional) day of delivery for one creative. */
export interface DailyMetric {
  /** YYYY-MM-DD in the ad account's timezone. */
  date: string
  spend: number
  impressions: number
  /**
   * Daily deduplicated reach. Valid for single-day analysis only — never
   * combined across days, because the same person recurs.
   */
  reach?: number
  clicks: number
  primaryResults: number
  primaryResultType: PrimaryResultType
}

/**
 * Delivery measured over a whole window, pulled at range level.
 *
 * This is the ONLY place frequency is allowed to come from. `frequency` is
 * `impressions / reach` on reach deduplicated across the entire window.
 */
export interface RangeDeliveryMetric {
  from: string
  to: string
  impressions: number
  reach: number
  frequency: number
  /** Which evaluation window this describes — 'current' or 'previous'. */
  window: 'current' | 'previous'
  /** Window length in days, so a 3v3 range is never compared with a 7v7 one. */
  days: number
}

export type CreativeFormat = 'video' | 'static' | 'carousel'
export type AudienceTemperature = 'cold' | 'warm' | 'retargeting'

export interface CreativeSnapshot {
  id: string
  name: string
  format: CreativeFormat
  hookType: string
  tags: string[]
  launchedAt: string
  primaryResultType: PrimaryResultType
  offerType?: string
  audienceTemperature?: AudienceTemperature
  market?: string
  campaignObjective?: string
  /** Ordered oldest → newest. */
  daily: DailyMetric[]
  /** One entry per evaluation window the rules need. */
  ranges: RangeDeliveryMetric[]
}

export interface DataSourceMetadata {
  accountTimezone: string
  attributionWindow: string
  lastSyncedAt: string
  /** Last date considered complete. Anything after it is excluded. */
  completeThrough: string
  /** Results inside this many hours of the evaluation date are still landing. */
  maturityDelayHours: number
  /** Where these figures came from — surfaced so seeded data is never passed off as measured. */
  origin: 'seeded' | 'meta'
}

export interface DataSource {
  getCreatives(): Promise<CreativeSnapshot[]>
  getBaselines(): Promise<PerformanceBaseline[]>
  getMetadata(): Promise<DataSourceMetadata>
}

/**
 * The injected "today".
 *
 * Nothing below this file calls `new Date()`. Complete days, provisional
 * windows and the 3v3 / 7v7 boundaries all derive from `evaluationDate`, so a
 * test pinned to a fixed date produces the same answer on a Thursday as it does
 * on a Monday.
 */
export interface EvaluationContext {
  evaluationDate: string
  metadata: DataSourceMetadata
}

/* -------------------------------- baselines -------------------------------- */

export interface BaselineKey {
  offerType?: string
  primaryResultType: PrimaryResultType
  audienceTemperature?: AudienceTemperature
  market?: string
  campaignObjective?: string
}

export type BaselineFallbackLevel =
  | 'exact_cohort'
  | 'result_and_offer'
  | 'result_type'
  | 'account'

export interface PerformanceBaseline {
  key: BaselineKey
  medianCostPerResult: number
  medianCtr: number
  creativeCount: number
  resultCount: number
  from: string
  to: string
  fallbackLevel: BaselineFallbackLevel
}

/* --------------------------------- signals --------------------------------- */

export interface TrendWindow {
  current: number
  previous: number
  /** Null is a valid, honest state: there was not enough delivery to compare. */
  percentChange: number | null
  complete: boolean
  /** Why the window is incomplete, when it is. Rendered, never guessed at. */
  reason?: string
  /** The dates each side of the comparison actually covered. */
  currentRange?: { from: string; to: string }
  previousRange?: { from: string; to: string }
}

export interface CreativeTrends {
  /** Rapid window — early fatigue detection and sudden change. */
  ctr3v3: TrendWindow
  cpr3v3: TrendWindow
  /** Confirmation window — whether the short-term movement persists. */
  ctr7v7: TrendWindow
  cpr7v7: TrendWindow
}

export type Stability = 'low' | 'mixed' | 'high'

export interface CreativeSignals {
  creativeId: string
  name: string
  completeDays: number
  totalSpend: number
  totalPrimaryResults: number
  primaryResultType: PrimaryResultType
  costPerResult: number | null
  ctr: number | null
  trends: CreativeTrends
  stability: Stability
  /** Coefficient of variation across complete days. Null when undeliverable. */
  dailyVariation: number | null
  /** Range-level frequency for the current window. Never derived from daily rows. */
  currentFrequency: number | null
  previousFrequency: number | null
  frequencyRising: boolean
  /** Ratio against the resolved cohort median. 0.8 = 20% cheaper. */
  costPerResultVsBaseline: number | null
  /** Results that landed on a date still inside the attribution delay. */
  provisionalResults: number
  /** True when the read materially depends on results that are still arriving. */
  resultsAreProvisional: boolean
  /** The window every figure above was computed over. */
  analysed: { from: string; to: string }
}

/* ------------------------------ evidence strength -------------------------- */

export type EvidenceStrengthTier = 'EARLY_SIGNAL' | 'MODERATE' | 'STRONG'

export type CohortQuality = 'weak' | 'acceptable' | 'strong'

export interface EvidenceStrength {
  tier: EvidenceStrengthTier
  /** Structured, human-readable causes. Never used as the display sentence. */
  reasons: string[]
  primaryResults: number
  completeDays: number
  stability: Stability
  cohortQuality: CohortQuality
}

/* --------------------------------- evidence -------------------------------- */

export interface EvidenceSource {
  creativeIds: string[]
  dateRange: { from: string; to: string }
  baselineKey?: BaselineKey
  provisional?: boolean
}

export interface Evidence {
  id: string
  label: string
  /**
   * Two or three characters for the collapsed queue chip — `CPL`, `CTR`, `Freq`.
   *
   * Lives on the model rather than being derived in a component, so the one
   * place that decides how a metric is abbreviated is the place that built it.
   * `label` stays the full form for the evidence drawer.
   */
  short: string
  rawValue: number | string
  displayValue: string
  comparisonValue?: string
  direction: 'good' | 'bad' | 'neutral'
  source: EvidenceSource
}

/* -------------------------------- proposals -------------------------------- */

export type ProposalType = 'ITERATE' | 'REPLACE' | 'EXPLORE' | 'COLLECT'

export type FatigueState = 'CONFIRMED' | 'WATCH' | 'RECOVERING'

/** The distinct delivery signals fatigue can be driven by, tracked separately. */
export type FatigueSignal = 'frequency' | 'ctr_decline' | 'cost_rise'

export interface ProposalParams {
  /** How many variations the draft should carry. */
  variations: number
  /** The angle the successor / iteration should take. */
  hookDirection: string
  format: string
  /** Anything the operator added on the Edit modal. */
  instructions: string
  /** WATCH only — days until the check-back. */
  reviewInDays?: number
}

export interface Proposal {
  /** Display identity: hash(type + sorted(subjectIds) + weekBucket). Weekly. */
  id: string
  /**
   * Memory identity: hash(type + sorted(subjectIds)), with no week bucket.
   * Decisions, cooldowns and snoozes are recorded against THIS, so a fortnight's
   * cooldown survives the week rolling over.
   */
  subjectKey: string
  type: ProposalType
  /** REPLACE only. WATCH is a distinct state, not a softer replacement. */
  fatigueState?: FatigueState
  /** REPLACE only — which signal drove it, so recovery suppresses precisely. */
  fatigueSignal?: FatigueSignal
  subjectIds: string[]
  subjectNames: string[]
  /**
   * What the row names in its Creative column. Usually the creative; for a
   * pattern proposal it is the PATTERN, because "The Profit Leak, 45-Hour
   * Owner, Margin Math" is a list, not a subject, and the members belong in the
   * drawer.
   */
  subjectLabel: string
  /** 0–100, ranking only. Never shown as a confidence. */
  score: number
  strength: EvidenceStrength
  evidence: Evidence[]
  params: ProposalParams
  createdAt: string
  /**
   * The card the dashboard renders when narration is unavailable or fails
   * validation twice. Composed from the evidence, not written by hand — the
   * dashboard never depends on a model call to display.
   *
   * Two lengths, because two surfaces need it. `short` is the queue row: plain
   * English, no figures, because the metric chips sit right beside it. Anything
   * longer would be truncated at the column edge, and a sentence cut mid-clause
   * reads as a bug rather than as brevity. `reasoning` is the full read, and it
   * lives in the evidence drawer.
   */
  fallback: { recommendation: string; short: string; reasoning: string }
  /** Where Approve sends the draft. */
  draftIntent: string
  /** Set when a snoozed proposal has come back around. */
  returning?: boolean
}

/* -------------------------------- decisions -------------------------------- */

export type DismissReason =
  | 'already-doing-it'
  | 'wrong-read-of-data'
  | 'not-a-priority-now'
  | 'budget-constrained'
  | 'brand-mismatch'
  | 'other'

export const DISMISS_REASONS: { id: DismissReason; label: string }[] = [
  { id: 'already-doing-it', label: 'Already doing it' },
  { id: 'wrong-read-of-data', label: 'Wrong read of the data' },
  { id: 'not-a-priority-now', label: 'Not a priority right now' },
  { id: 'budget-constrained', label: 'Budget constrained' },
  { id: 'brand-mismatch', label: 'Brand mismatch' },
  { id: 'other', label: 'Something else' },
]

export type DecisionAction = 'approved' | 'edited' | 'dismissed' | 'snoozed'

export interface Decision {
  proposalId: string
  /** The stable memory identity — what cooldowns actually match on. */
  subjectKey: string
  type: ProposalType
  subjectIds: string[]
  subjectTags: string[]
  strengthTier: EvidenceStrengthTier
  action: DecisionAction
  edits?: Partial<ProposalParams>
  reasonCode?: DismissReason
  note?: string
  /** Snooze only — ISO date the proposal comes back. */
  snoozedUntil?: string
  decidedAt: string
}

export type ProposalStatus = 'open' | 'approved' | 'dismissed' | 'snoozed'

export interface ProposalState {
  status: ProposalStatus
  updatedAt: string
  snoozedUntil?: string
}

/* -------------------------------- narration -------------------------------- */

export interface RelationshipSummary {
  daysWorkingTogether: number
  approved: number
  dismissed: number
  dismissalReasons: Record<DismissReason, number>
  /** "consistently reduces variation count 5 → 3" */
  editPatterns: string[]
  /** "flagged fatigue on Systems Before Scale 9 days ago, snoozed twice" */
  openHistory: string[]
}

export interface CreativeSummary {
  id: string
  name: string
  format: CreativeFormat
  hookType: string
  tags: string[]
  primaryResultType: PrimaryResultType
  audienceTemperature?: AudienceTemperature
  totalPrimaryResults: number
  totalSpend: number
  costPerResult: number | null
  completeDays: number
}

export interface NarrationContext {
  /** ALL candidates, not just the top three. He picks the lead. */
  proposals: Proposal[]
  ranking: string[]
  account: {
    recentDaily: DailyMetric[]
    baselines: PerformanceBaseline[]
    activeCreatives: CreativeSummary[]
  }
  metadata: DataSourceMetadata
  relationship: RelationshipSummary
  mikesNotes: string
  /** His last 10 first lines, so he can avoid repeating himself. */
  recentOpenings: string[]
}

export interface NarratedCard {
  proposalId: string
  recommendation: string
  reasoning: string
  /** Which evidence supports his interpretation. He does not write the numbers. */
  evidenceIds: string[]
}

export interface NarrationOutput {
  leadProposalId: string
  /** Debug panel only — never shown on a card. */
  leadReason: string
  cards: NarratedCard[]
  openingRemark: string | null
  /** Persisted as `mikesNotes` and fed back next session. */
  sessionNote: string
}

/* -------------------------------- catch-up --------------------------------- */

export interface CreativeDelta {
  creativeId: string
  name: string
  change: string
}

export interface CatchupSince {
  spend: number
  primaryResultsByType: Partial<Record<PrimaryResultType, number>>
  creativesChanged: CreativeDelta[]
  proposalsExpired: Proposal[]
  proposalsSuperseded: Proposal[]
  newSignals: Proposal[]
}

export interface CatchupContext {
  awayDays: number
  lastSeenAt: string
  since: CatchupSince
  metadata: DataSourceMetadata
  mikesNotes: string
  relationship: RelationshipSummary
}

export interface CatchupOutput {
  briefing: string
  evidenceIds: string[]
  sessionNote: string
}

/* -------------------------------- Ask Mike --------------------------------- */

export interface AskContext {
  proposal: Proposal
  question: string
  /** Prior exchanges on this card, oldest first. Capped at three. */
  exchanges: { question: string; answer: string }[]
  metadata: DataSourceMetadata
  relationship: RelationshipSummary
  mikesNotes: string
  ranking: string[]
}

export interface AskOutput {
  answer: string
  evidenceIds: string[]
}

export interface AskLogEntry {
  proposalId: string
  proposalType: ProposalType
  strengthTier: EvidenceStrengthTier
  question: string
  askedAt: string
}
