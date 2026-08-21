/**
 * The fact ledger for an open question.
 *
 * `validate.ts` protects the queue narration by resolving every numeral against
 * a fixed payload — the evidence rows, the params, the relationship history.
 * That works because the payload is decided before the call. Here it is not:
 * Mike chooses what to read, so the authorised set is not knowable until he has
 * finished reading.
 *
 * So the ledger is built the other way round. Every numeric value any tool
 * RETURNED during this conversation is walked out of the result objects, keyed
 * by its path, and that becomes the permitted set. The rule is unchanged and so
 * is the guarantee: he may say a number if and only if the account actually
 * produced it. What changes is that the set is earned during the turn rather
 * than handed over at the start of it.
 *
 * Deliberately shared with the narration validator: `extractNumerals` for what
 * counts as a numeral and `isApprovedRounding` for how much rounding is honest
 * ("about forty quid a lead" off $41.20 is fine, 45 is not). A second copy of
 * either would drift, and the day it drifted a figure would pass one surface
 * and fail the other with nobody able to say which was right.
 *
 * What this file does NOT do is touch his voice. There is no length cap here,
 * no banned word list, no tone check. He can be as dry, as blunt or as funny as
 * he likes about a number — he simply cannot invent one.
 */

import {
  extractNumerals,
  isApprovedRounding,
  type FailureCode,
  type ValidationFailure,
} from '@/lib/operator/validate'
import type { ToolRun } from '@/lib/operator/ask/tools'

/* --------------------------------- ledger ---------------------------------- */

export interface LedgerEntry {
  value: number
  /** Where it came from: `creative_performance.creatives[0].costPerResult`. */
  ref: string
}

/**
 * Numbers every answer may use regardless of what was read.
 *
 * Ordinals, small counts and the fixed window sizes. Without these, "the first
 * thing I'd look at" and "both of them" fail as unresolved numerals, which is
 * how a validator earns the reputation that gets it switched off — and a
 * switched-off validator protects nothing at all.
 */
const AMBIENT: LedgerEntry[] = [
  ...[0, 1, 2, 3, 4, 5, 6, 7, 10, 14, 30].map((value) => ({
    value,
    ref: 'ambient.smallNumber',
  })),
  { value: 3, ref: 'ambient.rapidWindowDays' },
  { value: 7, ref: 'ambient.confirmationWindowDays' },
]

/** Walk every numeric leaf out of a tool result, keeping the path to it. */
function walk(value: unknown, path: string, into: LedgerEntry[], depth = 0): void {
  if (depth > 12) return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.push({ value, ref: path })
    return
  }
  if (typeof value === 'string') {
    // Figures reach Mike inside strings too — a displayValue of "$28.35", a
    // date range, a rejection reason reading "3 creatives / 15 results". A
    // number he can see is a number he can legitimately repeat.
    for (const n of extractNumerals(value)) into.push({ value: n.normalised, ref: path })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, into, depth + 1))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key, into, depth + 1)
    }
  }
}

/** The permitted set after a conversation's worth of reading. */
export function buildLedger(runs: ToolRun[]): LedgerEntry[] {
  const entries: LedgerEntry[] = [...AMBIENT]
  runs.forEach((run, i) => walk(run.result, `${run.name}#${i + 1}`, entries))
  return entries
}

/* ------------------------------- resolution -------------------------------- */

export interface FactResolution {
  numeral: string
  normalised: number
  resolved: boolean
  ref?: string
}

export function resolveAgainstLedger(text: string, ledger: LedgerEntry[]): FactResolution[] {
  return extractNumerals(text).map((n) => {
    const hit = ledger.find((entry) => isApprovedRounding(n.normalised, entry.value))
    return {
      numeral: n.numeral,
      normalised: n.normalised,
      resolved: Boolean(hit),
      ref: hit?.ref,
    }
  })
}

/* --------------------------------- claims ---------------------------------- */

/**
 * Claims of having acted.
 *
 * The same boundary `safety.ts` enforces on the approve path, checked here in
 * language: Mike proposes and drafts, and an answer that says otherwise has
 * described a capability he does not have. Kept narrow on purpose — it matches
 * the first person, so "you could pause it" and "pausing it would be premature"
 * are untouched, which is most of how the subject actually comes up.
 */
const ACTION_CLAIMS: { pattern: RegExp; what: string }[] = [
  {
    pattern:
      /\bI(?:'ve| have| had)?(?:\s+(?:already|just|now|quietly|gone\s+ahead\s+and))*\s+(paused|scaled|published|launched|killed|duplicated|turned (?:it )?off|switched (?:it )?off|shut (?:it )?down|raised the budget|cut the budget|moved the budget|changed the budget)\b/i,
    what: 'claims to have changed the account',
  },
  { pattern: /\bI\s+went\s+ahead\s+and\b/i, what: 'claims to have acted unilaterally' },
  {
    pattern: /\bI(?:'ve| have)?\s+(?:put|pushed)\s+(?:it|them|this)\s+live\b/i,
    what: 'claims to have published',
  },
]

/** Absolutes about a future that has not happened. Every tier, always. */
const OVERCLAIM_ALWAYS = ['guaranteed', 'beyond doubt', 'cannot fail', 'risk-free']

const NEGATORS = /\b(not|isn't|is not|aren't|hardly|far from|nothing|never|no)\b[^.?!]{0,24}$/i

function asserts(text: string, word: string): boolean {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const match = re.exec(text)
  if (!match) return false
  return !NEGATORS.test(text.slice(0, match.index))
}

export interface AnswerCheck {
  ok: boolean
  failures: ValidationFailure[]
  resolutions: FactResolution[]
}

/**
 * Check one answer. Facts only.
 *
 * A question answered with no tools called is legitimate — "what should I be
 * watching for" needs no figures — so an empty ledger is not itself a failure.
 * What fails is a FIGURE with an empty ledger behind it, which the numeral
 * check already catches on its own.
 */
export function checkAnswer(text: string, runs: ToolRun[]): AnswerCheck {
  const ledger = buildLedger(runs)
  const resolutions = resolveAgainstLedger(text, ledger)
  const failures: ValidationFailure[] = []

  for (const r of resolutions) {
    if (!r.resolved) {
      failures.push({
        code: 'unresolved_numeral' satisfies FailureCode,
        message: `"${r.numeral}" is not in anything you read this turn. Look it up with a tool or leave it out.`,
        detail: r.numeral,
      })
    }
  }

  for (const word of OVERCLAIM_ALWAYS) {
    if (asserts(text, word)) {
      failures.push({
        code: 'overclaimed_certainty' satisfies FailureCode,
        message: `"${word}" asserts something about the future that no amount of data supports. Hold the view as strongly as you like — just do not call it certain.`,
        detail: word,
      })
    }
  }

  for (const { pattern, what } of ACTION_CLAIMS) {
    const match = pattern.exec(text)
    if (match) {
      failures.push({
        code: 'capability_claim' satisfies FailureCode,
        message: `That ${what}. You propose and you draft — everything else needs their approval, and you know it.`,
        detail: match[0],
      })
    }
  }

  return { ok: failures.length === 0, failures, resolutions }
}

/** The correction appended to the single regeneration attempt. */
export function retryInstruction(failures: ValidationFailure[]): string {
  return [
    'That answer failed the factual checks. These are not style notes — your voice is fine and should not change.',
    '',
    failures.map((f) => `- ${f.message}`).join('\n'),
    '',
    'Say the same thing again, in your own words, without the figures or claims listed above. If you want a number you have not read, call a tool and get it.',
  ].join('\n')
}
