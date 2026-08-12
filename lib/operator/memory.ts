/**
 * The working relationship, as data.
 *
 * Three separate things live here and they are deliberately kept apart, because
 * conflating them is how a learning loop turns into a feedback loop that eats
 * itself:
 *
 * **Cooldowns** decide what may be SHOWN. A dismissal is a "no", and a "no" that
 * comes straight back tomorrow is not a recommendation engine, it is nagging.
 *
 * **Weights** decide what is shown FIRST. They multiply the ranking score and
 * nothing else. They never touch evidence strength and never change whether a
 * rule fires — a creative going wrong is a fact about the account, and no amount
 * of the operator dismissing fatigue calls should be able to make the maths stop
 * seeing one. That separation is the whole reason this is safe to learn from.
 *
 * **Edit patterns** decide the DEFAULTS. If somebody cuts five variations to
 * three, three times running, the honest response is to start proposing three
 * and say so on the card, rather than proposing five forever and letting them do
 * the same edit for the rest of their working life.
 */

import { addDays, daysBetween, dayOf, isAfter, isSameOrBefore } from '@/lib/operator/dates'
import { suppressionKey } from '@/lib/operator/fingerprint'
import type {
  AskLogEntry,
  Decision,
  DismissReason,
  ProposalParams,
  Proposal,
  ProposalState,
  RelationshipSummary,
} from '@/lib/operator/types'

export const OPERATOR_SCHEMA_VERSION = 1

export interface OperatorMemory {
  schemaVersion: number
  decisions: Decision[]
  /** Keyed `${type}` or `tag:${tag}`, clamped 0.5–1.5. Ranking only. */
  weights: Record<string, number>
  paused: boolean
  /** Mike's private running note, written to himself each session. */
  mikesNotes: string
  /** His last 10 opening lines, so he does not repeat himself. */
  recentOpenings: string[]
  lastSeenAt: string | null
  /**
   * subjectKey → ISO timestamp first seen. Lets a paused board stay actionable,
   * and lets "raised 3 days ago and still open" survive the week rolling over.
   */
  seen: Record<string, string>
  /** Keyed by subjectKey, never by the weekly display id. */
  states: Record<string, ProposalState>
  askLog: AskLogEntry[]
  /** Recovery suppressions carried between runs: key → ISO date it lifts. */
  suppressions: Record<string, { untilDate: string; note: string }>
  /** When the operator first started working with Mike. */
  startedAt: string | null
}

export function emptyMemory(): OperatorMemory {
  return {
    schemaVersion: OPERATOR_SCHEMA_VERSION,
    decisions: [],
    weights: {},
    paused: false,
    mikesNotes: '',
    recentOpenings: [],
    lastSeenAt: null,
    seen: {},
    states: {},
    askLog: [],
    suppressions: {},
    startedAt: null,
  }
}

/* --------------------------------- weights --------------------------------- */

export const WEIGHT_MIN = 0.5
export const WEIGHT_MAX = 1.5

const WEIGHT_DELTAS = {
  approved: 0.05,
  dismissedWrongRead: -0.1,
  dismissedOther: -0.03,
  snoozed: 0,
} as const

const clampWeight = (n: number) => Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, n))

function weightKeys(d: Pick<Decision, 'type' | 'subjectTags'>): string[] {
  return [d.type, ...d.subjectTags.map((t) => `tag:${t}`)]
}

function deltaFor(d: Decision): number {
  if (d.action === 'approved' || d.action === 'edited') return WEIGHT_DELTAS.approved
  if (d.action === 'snoozed') return WEIGHT_DELTAS.snoozed
  return d.reasonCode === 'wrong-read-of-data'
    ? WEIGHT_DELTAS.dismissedWrongRead
    : WEIGHT_DELTAS.dismissedOther
}

/** The ranking multiplier for a proposal, from everything decided before it. */
export function weightFor(
  memory: OperatorMemory,
  proposal: Pick<Proposal, 'type'>,
  tags: string[],
): number {
  const keys = [proposal.type, ...tags.map((t) => `tag:${t}`)]
  const values = keys.map((k) => memory.weights[k]).filter((v): v is number => typeof v === 'number')
  if (values.length === 0) return 1
  // Mean rather than product: three tags all nudged down should not compound
  // into a proposal that can never surface again.
  return clampWeight(values.reduce((s, v) => s + v, 0) / values.length)
}

/* -------------------------------- decisions -------------------------------- */

/**
 * Record one decision. Pure — returns the next memory, mutates nothing, which
 * is what makes the persistence layer a thin wrapper and the tests trivial.
 */
export function applyDecision(memory: OperatorMemory, decision: Decision): OperatorMemory {
  const weights = { ...memory.weights }
  const delta = deltaFor(decision)
  for (const key of weightKeys(decision)) {
    weights[key] = clampWeight((weights[key] ?? 1) + delta)
  }

  const status: ProposalState['status'] =
    decision.action === 'dismissed'
      ? 'dismissed'
      : decision.action === 'snoozed'
        ? 'snoozed'
        : 'approved'

  return {
    ...memory,
    decisions: [...memory.decisions, decision],
    weights,
    states: {
      ...memory.states,
      [decision.subjectKey]: {
        status,
        updatedAt: decision.decidedAt,
        snoozedUntil: decision.snoozedUntil,
      },
    },
    startedAt: memory.startedAt ?? decision.decidedAt,
  }
}

/* -------------------------------- cooldowns -------------------------------- */

export const COOLDOWNS = {
  /** A dismissal is a no. It stays a no for a fortnight. */
  dismissedDays: 14,
  /** Twice, for the same stated reason, is a standing no. */
  dismissedTwiceSameReasonDays: 60,
  /** An approved subject is being worked on — do not re-propose the same type. */
  approvedSubjectDays: 7,
} as const

/** "an ITERATE" / "a REPLACE" — the trace is read by people, so it reads. */
const article = (type: string) => `${/^[AEIOU]/.test(type) ? 'an' : 'a'} ${type}`

export interface SuppressionVerdict {
  suppressed: boolean
  /** Why, in words, for the debug panel. */
  reason?: string
  /** A snoozed proposal that has come back around is flagged, not hidden. */
  returning?: boolean
}

/**
 * Should this proposal be shown?
 *
 * Reads the decision log rather than a separate cooldown table, so there is one
 * record of what happened and no way for the two to disagree.
 */
export function cooldownVerdict(
  memory: OperatorMemory,
  proposal: Proposal,
  evaluationDate: string,
): SuppressionVerdict {
  // Matched on the STABLE subject key, not the weekly display id. Keying this
  // on the id would quietly expire every cooldown at the week boundary, and the
  // card somebody said no to on Friday would be back on Monday with a new
  // number on it — which is worse than having no cooldown at all, because it
  // looks like the system forgot rather than like it never listened.
  const decisions = memory.decisions.filter((d) => d.subjectKey === proposal.subjectKey)
  const subjectSet = new Set(proposal.subjectIds)

  // Dismissed twice for the same reason → a long, deliberate silence.
  const dismissals = decisions.filter((d) => d.action === 'dismissed')
  const byReason = new Map<DismissReason, Decision[]>()
  for (const d of dismissals) {
    if (!d.reasonCode) continue
    byReason.set(d.reasonCode, [...(byReason.get(d.reasonCode) ?? []), d])
  }
  for (const [reason, list] of Array.from(byReason.entries())) {
    if (list.length < 2) continue
    const latest = list.map((entry) => dayOf(entry.decidedAt)).sort().slice(-1)[0]
    if (isSameOrBefore(evaluationDate, addDays(latest, COOLDOWNS.dismissedTwiceSameReasonDays))) {
      return {
        suppressed: true,
        reason: `dismissed twice as "${reason}" — held for ${COOLDOWNS.dismissedTwiceSameReasonDays} days from ${latest}`,
      }
    }
  }

  const latestDismissal = dismissals.map((d) => dayOf(d.decidedAt)).sort().slice(-1)[0]
  if (
    latestDismissal &&
    isSameOrBefore(evaluationDate, addDays(latestDismissal, COOLDOWNS.dismissedDays))
  ) {
    return {
      suppressed: true,
      reason: `dismissed on ${latestDismissal} — held for ${COOLDOWNS.dismissedDays} days`,
    }
  }

  // Snoozed → hidden until the date, then back with a marker.
  const state = memory.states[proposal.subjectKey]
  if (state?.status === 'snoozed' && state.snoozedUntil) {
    if (isAfter(state.snoozedUntil, evaluationDate)) {
      return { suppressed: true, reason: `snoozed until ${state.snoozedUntil}` }
    }
    return { suppressed: false, returning: true }
  }

  // Approved → the subject is being worked on. Do not propose the same type at
  // it again while the work is in flight, on this proposal id or any other.
  const approvals = memory.decisions.filter(
    (d) =>
      (d.action === 'approved' || d.action === 'edited') &&
      d.type === proposal.type &&
      d.subjectIds.some((id) => subjectSet.has(id)),
  )
  const latestApproval = approvals.map((d) => dayOf(d.decidedAt)).sort().slice(-1)[0]
  if (
    latestApproval &&
    isSameOrBefore(evaluationDate, addDays(latestApproval, COOLDOWNS.approvedSubjectDays))
  ) {
    return {
      suppressed: true,
      reason: `${article(proposal.type)} on this creative was approved on ${latestApproval} — held for ${COOLDOWNS.approvedSubjectDays} days`,
    }
  }

  return { suppressed: false }
}

/** Is this fatigue read inside a live recovery suppression? */
export function recoverySuppressed(
  memory: OperatorMemory,
  proposal: Proposal,
  evaluationDate: string,
): SuppressionVerdict {
  if (proposal.type !== 'REPLACE' || !proposal.fatigueSignal) return { suppressed: false }
  const key = suppressionKey(proposal.subjectIds[0], proposal.fatigueSignal)
  const held = memory.suppressions[key]
  if (!held) return { suppressed: false }
  if (isAfter(held.untilDate, evaluationDate) || held.untilDate === evaluationDate) {
    return { suppressed: true, reason: held.note }
  }
  return { suppressed: false }
}

/* ------------------------------ edit patterns ------------------------------ */

/** How many consistent edits it takes before a default actually moves. */
export const EDIT_PATTERN_THRESHOLD = 3

export interface LearnedDefault {
  param: keyof ProposalParams
  value: number | string
  /** "you have cut variations to 3 on the last 3 briefs" — shown on the card. */
  note: string
}

/**
 * Defaults the operator's own edits have moved.
 *
 * Only fires on a genuinely consistent pattern: the last three edits to the
 * param all landed on the same value. Two edits down and one back up is
 * somebody thinking, not a preference, and changing the default on it would be
 * the system being clever at the user rather than useful to them.
 */
export function learnedDefaults(memory: OperatorMemory): LearnedDefault[] {
  const out: LearnedDefault[] = []
  const edits = memory.decisions.filter((d) => d.action === 'edited' && d.edits)

  const params: (keyof ProposalParams)[] = ['variations', 'hookDirection', 'format']
  for (const param of params) {
    const values = edits
      .map((d) => d.edits?.[param])
      .filter((v): v is number | string => v !== undefined && v !== null && v !== '')
    if (values.length < EDIT_PATTERN_THRESHOLD) continue

    const recent = values.slice(-EDIT_PATTERN_THRESHOLD)
    if (!recent.every((v) => v === recent[0])) continue

    out.push({
      param,
      value: recent[0],
      note:
        param === 'variations'
          ? `Default set to ${recent[0]} — that is what you have chosen on the last ${EDIT_PATTERN_THRESHOLD} briefs.`
          : `Default set to "${recent[0]}" from your last ${EDIT_PATTERN_THRESHOLD} edits.`,
    })
  }
  return out
}

/** The starting params for a new proposal, with learned defaults folded in. */
export const BASE_PARAMS: ProposalParams = {
  variations: 5,
  hookDirection: '',
  format: '',
  instructions: '',
}

export function defaultParams(memory: OperatorMemory): ProposalParams {
  const params: ProposalParams = { ...BASE_PARAMS }
  for (const learned of learnedDefaults(memory)) {
    if (learned.param === 'variations' && typeof learned.value === 'number') {
      params.variations = learned.value
    } else if (typeof learned.value === 'string' && learned.param !== 'variations') {
      params[learned.param] = learned.value as never
    }
  }
  return params
}

/* ----------------------------- relationship -------------------------------- */

const EMPTY_REASONS: Record<DismissReason, number> = {
  'already-doing-it': 0,
  'wrong-read-of-data': 0,
  'not-a-priority-now': 0,
  'budget-constrained': 0,
  'brand-mismatch': 0,
  other: 0,
}

/**
 * What Mike knows about working with this person.
 *
 * It is not flattery and it is not a leaderboard. It is the handful of facts
 * that change how a competent colleague talks to you: how long you have been at
 * this together, what you keep saying no to, what you always edit, and what you
 * have been sitting on.
 */
export function relationshipSummary(
  memory: OperatorMemory,
  evaluationDate: string,
  proposals: Proposal[],
): RelationshipSummary {
  const dismissalReasons = { ...EMPTY_REASONS }
  let approved = 0
  let dismissed = 0

  for (const d of memory.decisions) {
    if (d.action === 'approved' || d.action === 'edited') approved += 1
    if (d.action === 'dismissed') {
      dismissed += 1
      if (d.reasonCode) dismissalReasons[d.reasonCode] += 1
    }
  }

  const editPatterns = learnedDefaults(memory).map((l) => l.note)

  // Variation edits get their own sentence because it is the pattern that comes
  // up most and the one Mike is most likely to have a view about.
  const variationEdits = memory.decisions
    .filter((d) => d.action === 'edited' && typeof d.edits?.variations === 'number')
    .map((d) => d.edits!.variations as number)
  if (variationEdits.length >= 2) {
    const from = BASE_PARAMS.variations
    const to = variationEdits[variationEdits.length - 1]
    if (to !== from) {
      editPatterns.push(
        `consistently ${to < from ? 'reduces' : 'raises'} variation count ${from} → ${to} (${variationEdits.length} times)`,
      )
    }
  }

  const openHistory: string[] = []
  const snoozeCounts = new Map<string, number>()
  for (const d of memory.decisions.filter((d) => d.action === 'snoozed')) {
    snoozeCounts.set(d.subjectKey, (snoozeCounts.get(d.subjectKey) ?? 0) + 1)
  }
  for (const p of proposals) {
    const snoozes = snoozeCounts.get(p.subjectKey) ?? 0
    const first = memory.seen[p.subjectKey]
    if (!first && snoozes === 0) continue
    const ageDays = first ? daysBetween(dayOf(first), evaluationDate) : 0
    const bits: string[] = []
    if (ageDays > 0) {
      bits.push(`raised ${ageDays} ${ageDays === 1 ? 'day' : 'days'} ago and still open`)
    }
    if (snoozes > 0) bits.push(`snoozed ${snoozes} ${snoozes === 1 ? 'time' : 'times'}`)
    if (bits.length > 0) {
      openHistory.push(`${p.type} on ${p.subjectNames.join(', ')}: ${bits.join(', ')}`)
    }
  }

  const started = memory.startedAt ?? memory.decisions[0]?.decidedAt ?? null

  return {
    daysWorkingTogether: started ? Math.max(0, daysBetween(dayOf(started), evaluationDate)) : 0,
    approved,
    dismissed,
    dismissalReasons,
    editPatterns,
    openHistory,
  }
}

/* -------------------------------- openings --------------------------------- */

export const MAX_RECENT_OPENINGS = 10

export function recordOpening(memory: OperatorMemory, opening: string | null): OperatorMemory {
  if (!opening) return memory
  return {
    ...memory,
    recentOpenings: [...memory.recentOpenings, opening].slice(-MAX_RECENT_OPENINGS),
  }
}

/* ------------------------------- Ask Mike log ------------------------------ */

export const MAX_ASK_EXCHANGES = 3
const MAX_ASK_LOG = 100

export function logAsk(memory: OperatorMemory, entry: AskLogEntry): OperatorMemory {
  return { ...memory, askLog: [...memory.askLog, entry].slice(-MAX_ASK_LOG) }
}

export function askCount(memory: OperatorMemory, proposalId: string): number {
  return memory.askLog.filter((a) => a.proposalId === proposalId).length
}
