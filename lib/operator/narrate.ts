/**
 * Narration — the only layer a model touches.
 *
 * The system prompt is `operator/mike-delight-constitution.md`, unedited. His
 * personality is not managed here: there is no tone instruction, no length cap,
 * no list of words to avoid, no "be professional". Everything this file adds is
 * a machine contract — the JSON shape, the evidence IDs, and the payload.
 *
 * Two decisions carry most of the weight:
 *
 * **One call per session, not one per card.** Three independent calls produce
 * three cards that sound identical, because each one is the same prompt with a
 * different row. One call lets him deliberately vary himself, reference across
 * cards, and — the thing a per-card call structurally cannot do — CHOOSE THE
 * LEAD. He gets the full ranked list. The maths decides what is true; he decides
 * what matters most today. If he wants to bury the winner and open with the
 * fatigue call, that is a real analyst judgement and it is his to make.
 *
 * **The dashboard never waits on him.** Every proposal already carries its own
 * computed copy — a short line for the queue row, the full read for the
 * evidence drawer. Narration is an upgrade layered on top of that, never a
 * dependency of it. No API key, a refusal, a timeout, two failed validations —
 * the queue still renders, fully actionable, with real numbers on it.
 */

import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { ORCHESTRATOR_FALLBACK_MODEL } from '@/lib/models'
import { parseModelJson } from '@/lib/parse'
import { STRENGTH_LABELS } from '@/lib/operator/strength'
import {
  retryInstruction,
  validateNarration,
  type AuthorisedSources,
  type NumeralResolution,
  type ValidationFailure,
} from '@/lib/operator/validate'
import type {
  AskContext,
  AskOutput,
  CatchupContext,
  CatchupOutput,
  Evidence,
  EvidenceStrengthTier,
  NarrationContext,
  NarrationOutput,
  Proposal,
} from '@/lib/operator/types'

export const NARRATION_MODEL = ORCHESTRATOR_FALLBACK_MODEL
const MAX_TOKENS = 2400

/* ------------------------------- constitution ------------------------------ */

let cachedConstitution: string | null = null

/**
 * Block A (who he is) and Block B (the factual constraints) only.
 *
 * The document's trailing sections are engineering notes — the runtime payload
 * interface, the persistence design. Those are instructions to whoever builds
 * this, not to Mike, and feeding a TypeScript interface to the character is how
 * a person starts describing his own data structures.
 */
export function loadConstitution(): string {
  if (cachedConstitution !== null) return cachedConstitution
  try {
    const file = fs.readFileSync(
      path.join(process.cwd(), 'operator', 'mike-delight-constitution.md'),
      'utf-8',
    )
    const cut = file.indexOf('\n## Runtime payload')
    cachedConstitution = (cut > 0 ? file.slice(0, cut) : file).trim()
  } catch {
    cachedConstitution = ''
  }
  return cachedConstitution
}

/* --------------------------------- payload --------------------------------- */

/** What the model is shown of one proposal. Never the raw signals object. */
function proposalPayload(p: Proposal, rank: number) {
  return {
    id: p.id,
    rank,
    type: p.type,
    fatigueState: p.fatigueState,
    subjects: p.subjectNames,
    score: p.score,
    returning: p.returning ?? false,
    evidenceStrength: {
      tier: p.strength.tier,
      uiLabel: STRENGTH_LABELS[p.strength.tier],
      primaryResults: p.strength.primaryResults,
      completeDays: p.strength.completeDays,
      stability: p.strength.stability,
      cohortQuality: p.strength.cohortQuality,
      why: p.strength.reasons,
    },
    params: p.params,
    evidence: p.evidence.map((e) => ({
      id: e.id,
      label: e.label,
      value: e.displayValue,
      comparison: e.comparisonValue,
      direction: e.direction,
      provisional: e.source.provisional ?? false,
    })),
  }
}

const CONTRACT = `
## Machine contract

Everything above is who you are and is not negotiable by this section. Everything
here is how your answer gets read by a program.

- Return ONE JSON object. No prose outside it, no markdown fence.
- Every number you state must already appear in the payload. You may round and
  you may reformat. You may not compute a new figure from two old ones.
- The card's evidence rows are rendered by the UI from the structured evidence.
  You are not writing them and you should not repeat them wholesale. Reference
  the ids your reading rests on in "evidenceIds".
- You cannot publish, pause, scale, change a budget or touch the account. You
  propose and you draft. Everything needs their approval.
- Do not claim shared history that is not in "relationship" or "mikesNotes".
- Each proposal carries an evidence strength tier. You may be as uncertain as
  you like. You may not be more certain than the tier allows.
`.trim()

const SESSION_SHAPE = `
Return:

{
  "leadProposalId": "the id you want shown first",
  "leadReason": "one line, debug panel only, never shown to them",
  "cards": [
    { "proposalId": "...", "recommendation": "...", "reasoning": "...", "evidenceIds": ["..."] }
  ],
  "openingRemark": "a line above the queue, or null",
  "sessionNote": "two or three lines to yourself, fed back to you next time"
}

One card per proposal in "proposals".

The interface these land in is an approval queue, not a report. Somebody is
scanning a short ordered list and deciding. So:

- "recommendation" is the move, in your words, in EIGHT WORDS OR FEWER.
  "Replace this before you raise the budget." "Build three hooks off this one."
- "reasoning" is ONE SENTENCE, twelve to twenty-five words. The reason, not the
  workings — the full evidence sits behind a drawer and they can open it.
- "openingRemark" is at most one sentence, and it is genuinely optional. Some
  days you have a view on the account and some days you do not; returning null
  is a real answer that the interface handles by showing nothing.

This is a constraint on LENGTH, not on you. Be as blunt, as funny or as
uncertain as the data deserves — just do it in one sentence. Anything that
genuinely needs a paragraph is a thing to say when they ask you, not something
to open with.
`.trim()

/* --------------------------------- the call -------------------------------- */

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  return apiKey ? new Anthropic({ apiKey }) : null
}

/** The rejected attempt plus the reason, so the retry is a correction. */
interface Retry {
  assistant: string
  instruction: string
}

async function callMike(
  system: string,
  userPayload: string,
  retry?: Retry,
): Promise<string | null> {
  const anthropic = client()
  if (!anthropic) return null

  // The retry carries his own rejected answer back to him. Re-prompting from
  // scratch loses the voice he had just found and usually produces a blander
  // second draft that fails on a different number.
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPayload }]
  if (retry) {
    messages.push({ role: 'assistant', content: retry.assistant })
    messages.push({ role: 'user', content: retry.instruction })
  }

  try {
    const response = await anthropic.messages.create({
      model: NARRATION_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    })
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return text.trim() || null
  } catch {
    // A refusal, a rate limit, a cold network. The board still renders.
    return null
  }
}

/* -------------------------------- validation ------------------------------- */

export interface NarrationAttempt {
  failures: ValidationFailure[]
  /** Every numeral and the field that authorised it — the debug trace. */
  resolutions: Record<string, NumeralResolution[]>
}

export interface NarrationResult {
  output: NarrationOutput
  /** True when Mike could not be used and the template cards are showing. */
  degraded: boolean
  /** Why, in one line, when degraded. */
  degradedReason?: string
  attempts: NarrationAttempt[]
  model: string
}

/**
 * What comes back when Mike is unavailable.
 *
 * Deliberately NO cards. Every proposal already carries its own computed copy —
 * a short line for the queue row and the full read for the evidence drawer —
 * and the surface falls back to those directly. Fabricating narrated cards here
 * would hand the row the long form and leave the drawer with nothing else to
 * show, which is how a degraded board ends up looking more verbose than a
 * narrated one rather than less.
 */
function templateOutput(): NarrationOutput {
  return {
    leadProposalId: '',
    leadReason: 'Ranked by computed score — no narration available this session.',
    cards: [],
    openingRemark: null,
    sessionNote: '',
  }
}

const highestTier = (proposals: Proposal[]): EvidenceStrengthTier =>
  proposals.some((p) => p.strength.tier === 'STRONG')
    ? 'STRONG'
    : proposals.some((p) => p.strength.tier === 'MODERATE')
      ? 'MODERATE'
      : 'EARLY_SIGNAL'

function baseSources(ctx: NarrationContext): Omit<AuthorisedSources, 'evidence'> {
  return {
    relationship: ctx.relationship,
    mikesNotes: ctx.mikesNotes,
    metadata: ctx.metadata,
    ranking: ctx.ranking,
    account: ctx.account,
    dateContext: {
      rapidWindowDays: 3,
      confirmationWindowDays: 7,
      completeThrough: ctx.metadata.completeThrough,
      proposalCount: ctx.proposals.length,
    },
  }
}

/**
 * Validate everything Mike wrote in one pass.
 *
 * Cards are checked against their OWN proposal's evidence and tier. The opening
 * remark and the session note are checked against the whole board, since they
 * legitimately range across it — the session note included, because it comes
 * back next session as authorised history, and an invented figure that survives
 * one night becomes a fact the following morning.
 */
function validateSession(
  output: NarrationOutput,
  ctx: NarrationContext,
): NarrationAttempt {
  const failures: ValidationFailure[] = []
  const resolutions: Record<string, NumeralResolution[]> = {}
  const base = baseSources(ctx)
  const hasProvisional = ctx.proposals.some((p) =>
    p.evidence.some((e) => e.source.provisional),
  )

  for (const card of output.cards) {
    const proposal = ctx.proposals.find((p) => p.id === card.proposalId)
    if (!proposal) {
      failures.push({
        code: 'unknown_evidence_id',
        message: `Card references proposal "${card.proposalId}", which is not on the board.`,
        detail: card.proposalId,
      })
      continue
    }
    const result = validateNarration({
      text: `${card.recommendation}\n${card.reasoning}`,
      evidenceIds: card.evidenceIds ?? [],
      availableEvidence: proposal.evidence,
      tier: proposal.strength.tier,
      sources: { ...base, evidence: proposal.evidence, params: proposal.params },
      hasProvisionalData: proposal.evidence.some((e) => e.source.provisional),
    })
    failures.push(...result.failures)
    resolutions[card.proposalId] = result.resolutions
  }

  const allEvidence: Evidence[] = ctx.proposals.flatMap((p) => p.evidence)

  if (output.openingRemark) {
    const result = validateNarration({
      text: output.openingRemark,
      evidenceIds: [],
      availableEvidence: allEvidence,
      tier: highestTier(ctx.proposals),
      sources: { ...base, evidence: allEvidence },
      hasProvisionalData: hasProvisional,
      requireEvidence: false,
    })
    failures.push(...result.failures)
    resolutions.openingRemark = result.resolutions
  }

  if (output.sessionNote) {
    const result = validateNarration({
      text: output.sessionNote,
      evidenceIds: [],
      availableEvidence: allEvidence,
      tier: highestTier(ctx.proposals),
      sources: { ...base, evidence: allEvidence },
      hasProvisionalData: hasProvisional,
      requireEvidence: false,
    })
    failures.push(...result.failures)
    resolutions.sessionNote = result.resolutions
  }

  if (!ctx.proposals.some((p) => p.id === output.leadProposalId)) {
    failures.push({
      code: 'unknown_evidence_id',
      message: `leadProposalId "${output.leadProposalId}" is not one of the proposals.`,
      detail: output.leadProposalId,
    })
  }

  return { failures, resolutions }
}

/* -------------------------------- narration -------------------------------- */

/**
 * One session, all cards, one call.
 *
 * On a validation failure: one regeneration with the reasons appended. On a
 * second failure: the template cards. The dashboard never depends on a model
 * call to display, and the failures are kept so the debug panel can show
 * exactly which numeral he could not source.
 */
export async function narrateSession(ctx: NarrationContext): Promise<NarrationResult> {
  const constitution = loadConstitution()
  const attempts: NarrationAttempt[] = []

  if (!constitution || !client()) {
    return {
      output: templateOutput(),
      degraded: true,
      degradedReason: !constitution
        ? 'The character constitution could not be read.'
        : 'No ANTHROPIC_API_KEY — the board is running on computed template cards.',
      attempts,
      model: NARRATION_MODEL,
    }
  }

  const system = `${constitution}\n\n---\n\n${CONTRACT}\n\n${SESSION_SHAPE}`
  const payload = JSON.stringify(
    {
      proposals: ctx.proposals.map((p, i) => proposalPayload(p, ctx.ranking.indexOf(p.id) + 1 || i + 1)),
      ranking: ctx.ranking,
      account: ctx.account,
      metadata: ctx.metadata,
      relationship: ctx.relationship,
      mikesNotes: ctx.mikesNotes,
      recentOpenings: ctx.recentOpenings,
    },
    null,
    1,
  )

  let retry: Retry | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await callMike(system, payload, retry)
    if (!raw) break

    let parsed: NarrationOutput
    try {
      parsed = parseModelJson<NarrationOutput>(raw)
    } catch {
      attempts.push({
        failures: [{ code: 'unsupported_claim', message: 'Response was not valid JSON.' }],
        resolutions: {},
      })
      retry = {
        assistant: raw,
        instruction: 'That was not valid JSON. Return the object and nothing else.',
      }
      continue
    }

    // Guard the shape before validating the content: a missing cards array is a
    // different failure from a bad number and needs a different retry.
    if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
      attempts.push({
        failures: [{ code: 'unsupported_claim', message: 'Response contained no cards.' }],
        resolutions: {},
      })
      retry = {
        assistant: raw,
        instruction: 'That contained no "cards" array. One card per proposal, please.',
      }
      continue
    }

    const check = validateSession(parsed, ctx)
    attempts.push(check)

    if (check.failures.length === 0) {
      // A proposal he skipped simply has no card. The row renders its own
      // computed line rather than a hand-me-down of somebody else's.
      return {
        output: {
          ...parsed,
          openingRemark: parsed.openingRemark?.trim() || null,
          sessionNote: parsed.sessionNote ?? '',
        },
        degraded: false,
        attempts,
        model: NARRATION_MODEL,
      }
    }

    retry = { assistant: raw, instruction: retryInstruction(check.failures) }
  }

  return {
    output: templateOutput(),
    degraded: true,
    degradedReason:
      attempts.length > 0
        ? 'Narration failed the factual checks twice — showing the computed cards.'
        : 'Narration was unavailable — showing the computed cards.',
    attempts,
    model: NARRATION_MODEL,
  }
}

/* --------------------------------- Ask Mike -------------------------------- */

const ASK_SHAPE = `
Return:

{ "answer": "...", "evidenceIds": ["..."] }

You are answering a question about ONE proposal. You can only speak to what is
in the payload. If the answer is not in there, say so — that is a real answer
and a more useful one than a guess.
`.trim()

export interface AskResult {
  output: AskOutput
  degraded: boolean
  attempts: NarrationAttempt[]
}

/**
 * Ask Mike — the same validator, the same evidence-reference system.
 *
 * Deliberately routed through `validateNarration` rather than a second handler.
 * A parallel path is how a figure gets accepted on a card and rejected in the
 * answer underneath it, and then somebody loosens the wrong one to make the
 * inconsistency go away.
 */
export async function askMike(ctx: AskContext): Promise<AskResult> {
  const constitution = loadConstitution()
  const attempts: NarrationAttempt[] = []
  const unavailable: AskResult = {
    output: {
      answer:
        'Mike is not reachable right now. The evidence on the card is the whole of what the read rests on.',
      evidenceIds: [],
    },
    degraded: true,
    attempts,
  }

  if (!constitution || !client()) return unavailable

  const system = `${constitution}\n\n---\n\n${CONTRACT}\n\n${ASK_SHAPE}`
  const payload = JSON.stringify(
    {
      proposal: proposalPayload(ctx.proposal, ctx.ranking.indexOf(ctx.proposal.id) + 1),
      question: ctx.question,
      earlierInThisThread: ctx.exchanges,
      metadata: ctx.metadata,
      relationship: ctx.relationship,
      mikesNotes: ctx.mikesNotes,
    },
    null,
    1,
  )

  const sources: AuthorisedSources = {
    evidence: ctx.proposal.evidence,
    params: ctx.proposal.params,
    relationship: ctx.relationship,
    mikesNotes: ctx.mikesNotes,
    metadata: ctx.metadata,
    ranking: ctx.ranking,
    dateContext: { rapidWindowDays: 3, confirmationWindowDays: 7 },
  }

  let retry: Retry | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await callMike(system, payload, retry)
    if (!raw) break

    let parsed: AskOutput
    try {
      parsed = parseModelJson<AskOutput>(raw)
    } catch {
      retry = {
        assistant: raw,
        instruction: 'That was not valid JSON. Return the object and nothing else.',
      }
      attempts.push({
        failures: [{ code: 'unsupported_claim', message: 'Response was not valid JSON.' }],
        resolutions: {},
      })
      continue
    }

    const check = validateNarration({
      text: parsed.answer ?? '',
      evidenceIds: parsed.evidenceIds ?? [],
      availableEvidence: ctx.proposal.evidence,
      tier: ctx.proposal.strength.tier,
      sources,
      hasProvisionalData: ctx.proposal.evidence.some((e) => e.source.provisional),
    })
    attempts.push({ failures: check.failures, resolutions: { answer: check.resolutions } })

    if (check.failures.length === 0) {
      return { output: { ...parsed, evidenceIds: parsed.evidenceIds ?? [] }, degraded: false, attempts }
    }
    retry = { assistant: raw, instruction: retryInstruction(check.failures) }
  }

  return {
    output: {
      answer:
        'I had a go at that twice and could not answer it without reaching past what is actually on the card. The evidence rows are the whole of it.',
      evidenceIds: [],
    },
    degraded: true,
    attempts,
  }
}

/* ------------------------------ catch-up briefing -------------------------- */

const CATCHUP_SHAPE = `
Return:

{ "briefing": "...", "evidenceIds": ["..."], "sessionNote": "..." }

This is a briefing on what changed while they were away, not a thread — there is
no reply field on it. The payload is a DIFF rather than a summary, so lead with
what actually moved.
`.trim()

export interface CatchupResult {
  output: CatchupOutput
  degraded: boolean
  attempts: NarrationAttempt[]
}

export async function catchUp(ctx: CatchupContext): Promise<CatchupResult> {
  const constitution = loadConstitution()
  const attempts: NarrationAttempt[] = []
  const evidence = [
    ...ctx.since.newSignals,
    ...ctx.since.proposalsExpired,
    ...ctx.since.proposalsSuperseded,
  ].flatMap((p) => p.evidence)

  const fallbackBriefing = () => {
    const results = Object.entries(ctx.since.primaryResultsByType)
      .map(([type, n]) => `${n} ${type.replace('_', ' ')}`)
      .join(', ')
    return [
      `${ctx.awayDays} ${ctx.awayDays === 1 ? 'day' : 'days'} away.`,
      `$${Math.round(ctx.since.spend).toLocaleString()} spent${results ? `, ${results}` : ''}.`,
      `${ctx.since.newSignals.length} new ${ctx.since.newSignals.length === 1 ? 'signal' : 'signals'}, ${ctx.since.creativesChanged.length} ${ctx.since.creativesChanged.length === 1 ? 'creative' : 'creatives'} changed state.`,
    ].join(' ')
  }

  if (!constitution || !client()) {
    return {
      output: { briefing: fallbackBriefing(), evidenceIds: [], sessionNote: ctx.mikesNotes },
      degraded: true,
      attempts,
    }
  }

  const system = `${constitution}\n\n---\n\n${CONTRACT}\n\n${CATCHUP_SHAPE}`
  const payload = JSON.stringify(
    {
      awayDays: ctx.awayDays,
      lastSeenAt: ctx.lastSeenAt,
      since: {
        ...ctx.since,
        newSignals: ctx.since.newSignals.map((p, i) => proposalPayload(p, i + 1)),
        proposalsExpired: ctx.since.proposalsExpired.map((p, i) => proposalPayload(p, i + 1)),
        proposalsSuperseded: ctx.since.proposalsSuperseded.map((p, i) => proposalPayload(p, i + 1)),
      },
      metadata: ctx.metadata,
      relationship: ctx.relationship,
      mikesNotes: ctx.mikesNotes,
    },
    null,
    1,
  )

  const sources: AuthorisedSources = {
    evidence,
    relationship: ctx.relationship,
    mikesNotes: ctx.mikesNotes,
    metadata: ctx.metadata,
    catchupDiff: ctx.since,
    dateContext: {
      awayDays: ctx.awayDays,
      rapidWindowDays: 3,
      confirmationWindowDays: 7,
      lastSeenAt: ctx.lastSeenAt,
    },
  }

  let retry: Retry | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await callMike(system, payload, retry)
    if (!raw) break

    let parsed: CatchupOutput
    try {
      parsed = parseModelJson<CatchupOutput>(raw)
    } catch {
      retry = {
        assistant: raw,
        instruction: 'That was not valid JSON. Return the object and nothing else.',
      }
      attempts.push({
        failures: [{ code: 'unsupported_claim', message: 'Response was not valid JSON.' }],
        resolutions: {},
      })
      continue
    }

    const check = validateNarration({
      text: `${parsed.briefing ?? ''}\n${parsed.sessionNote ?? ''}`,
      evidenceIds: parsed.evidenceIds ?? [],
      availableEvidence: evidence,
      tier: highestTier(ctx.since.newSignals),
      sources,
      hasProvisionalData: evidence.some((e) => e.source.provisional),
      requireEvidence: false,
    })
    attempts.push({ failures: check.failures, resolutions: { briefing: check.resolutions } })

    if (check.failures.length === 0) {
      return {
        output: {
          briefing: parsed.briefing,
          evidenceIds: parsed.evidenceIds ?? [],
          sessionNote: parsed.sessionNote ?? ctx.mikesNotes,
        },
        degraded: false,
        attempts,
      }
    }
    retry = { assistant: raw, instruction: retryInstruction(check.failures) }
  }

  return {
    output: { briefing: fallbackBriefing(), evidenceIds: [], sessionNote: ctx.mikesNotes },
    degraded: true,
    attempts,
  }
}
