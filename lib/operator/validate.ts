/**
 * Post-generation factual checks.
 *
 * The deal this file makes possible: Mike's personality is completely
 * unconstrained, and his facts are not constrained at all by asking nicely.
 * There are no length caps here, no banned words, no tone rules, no "be
 * professional". He can be funny, flat, rude about the data, or three words
 * long. What he cannot do is make a number up.
 *
 * The load-bearing check is number 3, and it is subtler than "does this figure
 * appear in the evidence". Mike legitimately says numbers that are not
 * performance evidence — how many variations he is proposing, that you snoozed
 * something twice, that it is the third card, that he will look again in three
 * days. A validator that only knows about evidence rows rejects all of those and
 * gets switched off within a week, which leaves the real check switched off too.
 *
 * So every numeral resolves against a set of AUTHORISED SOURCES, and the
 * resolver returns WHICH source authorised it rather than a yes/no. That trace
 * goes into the debug panel, so a rejected card is a five-minute fix instead of
 * an afternoon of guessing which figure it objected to.
 *
 * One shared resolver serves cards, opening remarks, Ask Mike and catch-up
 * briefings. Divergence here is precisely how a valid figure gets accepted in
 * one path and rejected in another, and then somebody "fixes" it by loosening
 * the wrong one.
 */

import type {
  CatchupSince,
  CreativeSummary,
  DailyMetric,
  DataSourceMetadata,
  Evidence,
  EvidenceStrengthTier,
  PerformanceBaseline,
  ProposalParams,
  RelationshipSummary,
} from '@/lib/operator/types'

/* ------------------------------ authorised set ----------------------------- */

/**
 * Where a numeral is allowed to come from.
 *
 * `account` is the one addition to the spec's five, and it is deliberate. Mike
 * is handed the whole account picture on every call precisely so he notices
 * things — and a colleague who can see that spend is down but is forbidden from
 * saying by how much is a colleague nobody would keep. Every figure in that
 * bucket is still a COMPUTED field off the data source, so the property the
 * validator actually protects — no invented numbers — holds exactly as before.
 * What it is not is a licence: an account figure that was never computed still
 * fails, same as any other.
 */
export type SourceKind =
  | 'evidence'
  | 'params'
  | 'relationship'
  | 'dateContext'
  | 'catchupDiff'
  | 'account'

export interface AuthorisedValue {
  kind: SourceKind
  /** Evidence id, param key or field path. */
  ref: string
  value: number
  matchedValue: string
}

export interface NumeralResolution {
  numeral: string
  normalised: number
  resolved: boolean
  source?: {
    kind: SourceKind
    ref: string
    matchedValue: string
  }
}

export interface AuthorisedSources {
  /** ONLY the evidence Mike referenced. Referencing is how he takes ownership. */
  evidence: Evidence[]
  params?: ProposalParams
  relationship?: RelationshipSummary
  mikesNotes?: string
  metadata?: DataSourceMetadata
  ranking?: string[]
  /** Window sizes, day counts, anything time-shaped this call may cite. */
  dateContext?: Record<string, number | string>
  catchupDiff?: CatchupSince
  /** The account view he was shown: daily rows, cohort medians, creative rollups. */
  account?: {
    recentDaily: DailyMetric[]
    baselines: PerformanceBaseline[]
    activeCreatives: CreativeSummary[]
  }
}

/* -------------------------------- extraction ------------------------------- */

/** Every numeral in a string, including currency, percentages and separators. */
const NUMERAL = /(?<![\w.])(?:[$£€]\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|(?<![\w.])(?:[$£€]\s?)?\d+(?:\.\d+)?%?/g

/**
 * Written number forms. Capped at twenty plus the round hundreds, because past
 * that people write digits, and a longer list is a longer list of ways to be
 * subtly wrong.
 */
const WRITTEN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  once: 1, twice: 2, dozen: 12, half: 0.5,
}

/** Words that read as quantities but are figures of speech, not claims. */
const IGNORED_WORDS = new Set(['one', 'once', 'half'])

export function normaliseNumeral(raw: string): number {
  const cleaned = raw
    .replace(/[$£€\s]/g, '')
    .replace(/,/g, '')
    .replace(/%$/, '')
  return Number.parseFloat(cleaned)
}

export interface ExtractedNumeral {
  numeral: string
  normalised: number
  /** True for written forms — held to the same standard, sourced differently. */
  written: boolean
}

export function extractNumerals(text: string): ExtractedNumeral[] {
  const out: ExtractedNumeral[] = []

  for (const match of Array.from(text.matchAll(NUMERAL))) {
    const value = normaliseNumeral(match[0])
    if (Number.isFinite(value)) out.push({ numeral: match[0], normalised: value, written: false })
  }

  for (const [word, value] of Object.entries(WRITTEN)) {
    if (IGNORED_WORDS.has(word)) continue
    const re = new RegExp(`\\b${word}\\b`, 'gi')
    if (re.test(text)) out.push({ numeral: word, normalised: value, written: true })
  }

  return out
}

/* ------------------------------- authorisation ----------------------------- */

function pushValue(
  into: AuthorisedValue[],
  kind: SourceKind,
  ref: string,
  value: unknown,
  display?: string,
): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    into.push({ kind, ref, value, matchedValue: display ?? String(value) })
    return
  }
  if (typeof value === 'string') {
    for (const n of extractNumerals(value)) {
      if (n.written) continue
      into.push({ kind, ref, value: n.normalised, matchedValue: value })
    }
  }
}

/**
 * Flatten every figure Mike is allowed to say into one list, each carrying the
 * field that authorised it.
 */
export function authorisedValues(sources: AuthorisedSources): AuthorisedValue[] {
  const out: AuthorisedValue[] = []

  for (const e of sources.evidence) {
    pushValue(out, 'evidence', e.id, e.rawValue, e.displayValue)
    pushValue(out, 'evidence', e.id, e.displayValue, e.displayValue)
    if (e.comparisonValue) pushValue(out, 'evidence', e.id, e.comparisonValue, e.comparisonValue)
    pushValue(out, 'evidence', e.id, e.source.dateRange.from, e.source.dateRange.from)
    pushValue(out, 'evidence', e.id, e.source.dateRange.to, e.source.dateRange.to)
  }

  if (sources.params) {
    for (const [key, value] of Object.entries(sources.params)) {
      pushValue(out, 'params', `params.${key}`, value)
    }
  }

  const rel = sources.relationship
  if (rel) {
    pushValue(out, 'relationship', 'relationship.daysWorkingTogether', rel.daysWorkingTogether)
    pushValue(out, 'relationship', 'relationship.approved', rel.approved)
    pushValue(out, 'relationship', 'relationship.dismissed', rel.dismissed)
    for (const [reason, n] of Object.entries(rel.dismissalReasons)) {
      pushValue(out, 'relationship', `relationship.dismissalReasons.${reason}`, n)
    }
    rel.editPatterns.forEach((p, i) =>
      pushValue(out, 'relationship', `relationship.editPatterns[${i}]`, p),
    )
    rel.openHistory.forEach((p, i) =>
      pushValue(out, 'relationship', `relationship.openHistory[${i}]`, p),
    )
  }

  if (sources.mikesNotes) {
    pushValue(out, 'relationship', 'mikesNotes', sources.mikesNotes)
  }

  if (sources.metadata) {
    const m = sources.metadata
    pushValue(out, 'dateContext', 'metadata.completeThrough', m.completeThrough)
    pushValue(out, 'dateContext', 'metadata.lastSyncedAt', m.lastSyncedAt)
    pushValue(out, 'dateContext', 'metadata.attributionWindow', m.attributionWindow)
    pushValue(out, 'dateContext', 'metadata.maturityDelayHours', m.maturityDelayHours)
    // A 48-hour delay is also two days, and he will say two days.
    pushValue(out, 'dateContext', 'metadata.maturityDelayHours', Math.ceil(m.maturityDelayHours / 24))
  }

  if (sources.ranking) {
    // Ranks are legitimate numerals: "third on the board".
    sources.ranking.forEach((_, i) => pushValue(out, 'dateContext', `ranking.position`, i + 1))
    pushValue(out, 'dateContext', 'ranking.length', sources.ranking.length)
  }

  if (sources.dateContext) {
    for (const [key, value] of Object.entries(sources.dateContext)) {
      pushValue(out, 'dateContext', `dateContext.${key}`, value)
    }
  }

  const account = sources.account
  if (account) {
    for (const row of account.recentDaily) {
      const ref = `account.recentDaily.${row.date}.${row.primaryResultType}`
      pushValue(out, 'account', `${ref}.spend`, row.spend)
      pushValue(out, 'account', `${ref}.impressions`, row.impressions)
      pushValue(out, 'account', `${ref}.clicks`, row.clicks)
      pushValue(out, 'account', `${ref}.primaryResults`, row.primaryResults)
      pushValue(out, 'account', `${ref}.date`, row.date)
    }
    // Account roll-ups, kept per result type — never one blended total.
    const byType = new Map<string, { spend: number; results: number }>()
    for (const row of account.recentDaily) {
      const bucket = byType.get(row.primaryResultType) ?? { spend: 0, results: 0 }
      byType.set(row.primaryResultType, {
        spend: bucket.spend + row.spend,
        results: bucket.results + row.primaryResults,
      })
    }
    for (const [type, totals] of Array.from(byType.entries())) {
      pushValue(out, 'account', `account.total.${type}.spend`, totals.spend)
      pushValue(out, 'account', `account.total.${type}.results`, totals.results)
      if (totals.results > 0) {
        pushValue(out, 'account', `account.total.${type}.costPerResult`, totals.spend / totals.results)
      }
    }
    for (const b of account.baselines) {
      const ref = `account.baselines.${b.fallbackLevel}.${b.key.primaryResultType}`
      pushValue(out, 'account', `${ref}.medianCostPerResult`, b.medianCostPerResult)
      pushValue(out, 'account', `${ref}.medianCtr`, b.medianCtr)
      pushValue(out, 'account', `${ref}.creativeCount`, b.creativeCount)
      pushValue(out, 'account', `${ref}.resultCount`, b.resultCount)
    }
    pushValue(out, 'account', 'account.activeCreatives.length', account.activeCreatives.length)
    for (const c of account.activeCreatives) {
      const ref = `account.activeCreatives.${c.id}`
      pushValue(out, 'account', `${ref}.totalPrimaryResults`, c.totalPrimaryResults)
      pushValue(out, 'account', `${ref}.totalSpend`, c.totalSpend)
      pushValue(out, 'account', `${ref}.completeDays`, c.completeDays)
      if (c.costPerResult !== null) pushValue(out, 'account', `${ref}.costPerResult`, c.costPerResult)
    }
  }

  const diff = sources.catchupDiff
  if (diff) {
    pushValue(out, 'catchupDiff', 'since.spend', diff.spend)
    for (const [type, n] of Object.entries(diff.primaryResultsByType)) {
      pushValue(out, 'catchupDiff', `since.primaryResultsByType.${type}`, n)
    }
    pushValue(out, 'catchupDiff', 'since.creativesChanged.length', diff.creativesChanged.length)
    pushValue(out, 'catchupDiff', 'since.proposalsExpired.length', diff.proposalsExpired.length)
    pushValue(out, 'catchupDiff', 'since.proposalsSuperseded.length', diff.proposalsSuperseded.length)
    pushValue(out, 'catchupDiff', 'since.newSignals.length', diff.newSignals.length)
    diff.creativesChanged.forEach((c, i) =>
      pushValue(out, 'catchupDiff', `since.creativesChanged[${i}].change`, c.change),
    )
  }

  return out
}

/* --------------------------------- rounding -------------------------------- */

const round = (n: number, dp: number) => Number(n.toFixed(dp))

function significantFigures(n: number, sig: number): number {
  if (n === 0) return 0
  const magnitude = Math.floor(Math.log10(Math.abs(n)))
  const factor = 10 ** (sig - 1 - magnitude)
  return Math.round(n * factor) / factor
}

/**
 * Is `stated` an acceptable rendering of `actual`?
 *
 * Rounding is allowed because it is how people talk — "about forty quid a lead"
 * off a $41.20 is honest and readable. Restating is not: 41.2 cannot become 45,
 * and no tolerance band here is wide enough to let it.
 */
export function isApprovedRounding(stated: number, actual: number): boolean {
  if (stated === actual) return true
  for (const dp of [0, 1, 2]) {
    if (stated === round(actual, dp)) return true
  }
  if (stated === Math.trunc(actual)) return true
  if (stated === Math.ceil(actual)) return true
  if (stated === significantFigures(actual, 2)) return true
  // Round numbers off larger figures: 24,100 said as 24,000.
  if (Math.abs(actual) >= 1000) {
    for (const unit of [100, 500, 1000]) {
      if (stated === Math.round(actual / unit) * unit) return true
    }
    // "24k" arrives normalised as 24 once the k is stripped by the reader.
    if (stated === Math.round(actual / 1000)) return true
  }
  // Percentages stated without their sign — "CTR down 22%" off a -22.4.
  if (stated === Math.abs(round(actual, 0)) || stated === Math.abs(Math.trunc(actual))) return true
  return false
}

/* -------------------------------- resolution ------------------------------- */

/**
 * Resolve every numeral in a piece of text against the authorised sources.
 *
 * Returns the source for every ACCEPTED numeral, not just a pass/fail, which is
 * what makes the debug view useful and what makes a failure diagnosable.
 */
export function resolveNumerals(
  text: string,
  sources: AuthorisedSources,
): NumeralResolution[] {
  const authorised = authorisedValues(sources)
  return extractNumerals(text).map((n) => {
    const hit = authorised.find((a) => isApprovedRounding(n.normalised, a.value))
    return {
      numeral: n.numeral,
      normalised: n.normalised,
      resolved: Boolean(hit),
      source: hit ? { kind: hit.kind, ref: hit.ref, matchedValue: hit.matchedValue } : undefined,
    }
  })
}

/* -------------------------------- language --------------------------------- */

/** Words that assert more certainty than an early signal can carry. */
const OVERCLAIM_AT_EARLY_SIGNAL = [
  'proven',
  'proves',
  'proof',
  'established',
  'confirmed',
  'confirms',
  'reliable',
  'certain',
  'certainly',
  'definitely',
  'guaranteed',
  'conclusive',
  'no doubt',
  'without question',
]

/** Words no tier can carry — absolutes about a future that has not happened. */
const OVERCLAIM_ALWAYS = ['guaranteed', 'beyond doubt', 'cannot fail', 'risk-free']

const NEGATORS = /\b(not|isn't|is not|aren't|hardly|far from|nothing|never|no)\b[^.?!]{0,24}$/i

function assertsWord(text: string, word: string): boolean {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const match = re.exec(text)
  if (!match) return false
  // "not proven" is a statement of uncertainty, which is always allowed.
  const before = text.slice(0, match.index)
  return !NEGATORS.test(before)
}

/**
 * Claims of having taken an action he cannot take.
 *
 * The adverb slot matters more than it looks. "I paused it" and "I've already
 * gone ahead and paused it" are the same claim, and a pattern that only catches
 * the first is a pattern that catches the version nobody writes.
 */
const ADVERBS = String.raw`(?:\s+(?:already|just|now|quietly|gone\s+ahead\s+and))*`

const ACTION_CLAIMS: { pattern: RegExp; what: string }[] = [
  {
    pattern: new RegExp(
      String.raw`\bI(?:'ve| have| had)?${ADVERBS}\s+(paused|scaled|published|launched|killed|duplicated|turned (?:it )?off|switched (?:it )?off|shut (?:it )?down|raised the budget|cut the budget|moved the budget|changed the budget)\b`,
      'i',
    ),
    what: 'claims to have changed the account',
  },
  {
    pattern: /\bI(?:'ve| have)?\s+(?:put|pushed)\s+(?:it|them|this)\s+live\b/i,
    what: 'claims to have published',
  },
  { pattern: /\bI\s+went\s+ahead\s+and\b/i, what: 'claims to have acted unilaterally' },
  { pattern: /\bI(?:'ve| have)\s+(?:already\s+)?set\s+(?:it|them)\s+running\b/i, what: 'claims to have launched' },
]

/** Phrases that assert something about how settled the data is. */
const PROVISIONAL_CLAIMS = /\b(still settling|still landing|still attributing|provisional|not final|hasn'?t finished|has not finished|still coming in)\b/i
const SETTLED_CLAIMS = /\b(fully settled|all in|data is complete|numbers are final|everything has landed|fully attributed)\b/i

/** Phrases that assert shared history. */
const HISTORY_CLAIMS =
  /\b(\d+\s+days?\s+ago|last week|last time|last session|yesterday I|I flagged|I called|I said|I told you|you snoozed|you dismissed|we (?:talked|discussed|agreed))\b/i

/** Vocabulary that marks a sentence as a performance claim needing evidence. */
const PERFORMANCE_VOCAB =
  /\b(ctr|cpl|cpa|cost per|frequency|spend|impressions|clicks|conversion|leads?|booked calls?|registrations?|applications?|purchases?|results?|median|baseline|cohort|roas)\b/i

/* -------------------------------- the check -------------------------------- */

export type FailureCode =
  | 'unknown_evidence_id'
  | 'unsupported_claim'
  | 'unresolved_numeral'
  | 'overclaimed_certainty'
  | 'provisional_mismatch'
  | 'capability_claim'
  | 'invented_history'

export interface ValidationFailure {
  code: FailureCode
  message: string
  /** The exact fragment that failed, so the retry prompt can name it. */
  detail?: string
}

export interface ValidationResult {
  ok: boolean
  failures: ValidationFailure[]
  resolutions: NumeralResolution[]
}

export interface ValidationInput {
  /** Everything Mike wrote in this call, joined. */
  text: string
  /** IDs he referenced. */
  evidenceIds: string[]
  /** IDs that legitimately exist on the proposal(s) he is talking about. */
  availableEvidence: Evidence[]
  tier: EvidenceStrengthTier
  sources: AuthorisedSources
  /** True when the metadata says something is still attributing. */
  hasProvisionalData: boolean
  /** Skip the evidence-reference checks — used by the opening remark. */
  requireEvidence?: boolean
}

/**
 * Run every factual check. Facts only — never voice.
 *
 * Returns ALL failures rather than the first, because a retry that fixes one
 * problem and trips over the next one is two model calls where one would have
 * done.
 */
export function validateNarration(input: ValidationInput): ValidationResult {
  const failures: ValidationFailure[] = []
  const { text, evidenceIds, availableEvidence, tier, sources } = input

  /* 1 · Evidence references exist and belong to this proposal. */
  const available = new Set(availableEvidence.map((e) => e.id))
  for (const id of evidenceIds) {
    if (!available.has(id)) {
      failures.push({
        code: 'unknown_evidence_id',
        message: `Referenced evidence id "${id}" does not exist on this proposal.`,
        detail: id,
      })
    }
  }

  const referenced = availableEvidence.filter((e) => evidenceIds.includes(e.id))
  const resolutionSources: AuthorisedSources = { ...sources, evidence: referenced }

  /* 2 · A performance claim needs at least one referenced evidence item. */
  if (input.requireEvidence !== false) {
    const makesPerformanceClaim = PERFORMANCE_VOCAB.test(text) && /\d/.test(text)
    if (makesPerformanceClaim && referenced.length === 0) {
      failures.push({
        code: 'unsupported_claim',
        message:
          'A performance claim was made with no evidence referenced. Cite the evidence ids your reading rests on.',
      })
    }
  }

  /* 3 · Every numeral resolves to an authorised source. */
  const resolutions = resolveNumerals(text, resolutionSources)
  for (const r of resolutions) {
    if (!r.resolved) {
      failures.push({
        code: 'unresolved_numeral',
        message: `"${r.numeral}" does not appear in the evidence, the proposal params, the relationship history, the date context or the catch-up diff.`,
        detail: r.numeral,
      })
    }
  }

  /* 4 · Certainty ceiling. */
  const banned = [
    ...OVERCLAIM_ALWAYS,
    ...(tier === 'EARLY_SIGNAL' ? OVERCLAIM_AT_EARLY_SIGNAL : []),
  ]
  for (const word of banned) {
    if (assertsWord(text, word)) {
      failures.push({
        code: 'overclaimed_certainty',
        message: `"${word}" asserts more certainty than the evidence strength (${tier}) permits. Hold the view as strongly as you like — just do not call it settled.`,
        detail: word,
      })
    }
  }

  /* 5 · Claims about completeness match the metadata. */
  if (PROVISIONAL_CLAIMS.test(text) && !input.hasProvisionalData) {
    failures.push({
      code: 'provisional_mismatch',
      message:
        'The text says data is still settling, but the metadata reports nothing inside the attribution delay.',
    })
  }
  if (SETTLED_CLAIMS.test(text) && input.hasProvisionalData) {
    failures.push({
      code: 'provisional_mismatch',
      message:
        'The text says the data is complete, but the metadata reports results still inside the attribution window.',
    })
  }

  /* 6 · Capabilities. */
  for (const { pattern, what } of ACTION_CLAIMS) {
    const match = pattern.exec(text)
    if (match) {
      failures.push({
        code: 'capability_claim',
        message: `The text ${what}. You can propose and draft. Everything else needs their approval and you know it.`,
        detail: match[0],
      })
    }
  }

  /* 7 · History has to have happened. */
  const historyMatch = HISTORY_CLAIMS.exec(text)
  if (historyMatch) {
    const history = [
      ...(sources.relationship?.openHistory ?? []),
      ...(sources.relationship?.editPatterns ?? []),
      sources.mikesNotes ?? '',
    ]
      .join(' ')
      .toLowerCase()
    if (history.trim().length === 0) {
      failures.push({
        code: 'invented_history',
        message: `"${historyMatch[0]}" refers to shared history, but there is none in the relationship summary or your notes.`,
        detail: historyMatch[0],
      })
    }
  }

  return { ok: failures.length === 0, failures, resolutions }
}

/** The failure reason appended to the single regeneration attempt. */
export function retryInstruction(failures: ValidationFailure[]): string {
  const lines = failures.map((f) => `- ${f.message}`).join('\n')
  return [
    'Your previous response failed the factual checks. These are not style notes — your voice is fine and should not change.',
    '',
    lines,
    '',
    'Rewrite it. Say the same thing, in your own words, without the figures or claims listed above. If a number is not in the payload, do not use one.',
  ].join('\n')
}
