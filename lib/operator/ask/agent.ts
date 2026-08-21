/**
 * Ask Mike, open-ended — the tool-use loop.
 *
 * The queue's `askMike` is a single call over ONE proposal, capped at a few
 * exchanges. It answers "why is this card here". It structurally cannot answer
 * "how did the tripwire webinar do last week", because the payload it was
 * handed does not contain the tripwire webinar and it has no way to go and get
 * it. This loop is that missing half: same character, same factual discipline,
 * but he decides what to read.
 *
 * **His personality is not written here, and that is deliberate.** The system
 * prompt is `operator/mike-delight-constitution.md`, unedited, exactly as the
 * narration path loads it — the character work already exists and every tone
 * instruction added on top of it would flatten him toward the assistant voice
 * the constitution was written to avoid. What this file adds is the machine
 * contract: which instruments exist, what a turn costs, and the fact that he
 * is now answering a question rather than narrating a board.
 *
 * **The reading is the show.** Every tool call streams before it runs, with a
 * human label, and its receipt streams after. That trace is not a loading
 * state — it is the part of the job that used to be invisible, and watching
 * him pull thirty days on one creative and then go find its cohort is what
 * makes the answer trustworthy rather than merely fluent.
 *
 * **He can end up with nothing and that is allowed.** No key, a refusal, an
 * empty account: the surface says so plainly. Nothing here ever invents a
 * figure to avoid an awkward silence.
 */

import Anthropic from '@anthropic-ai/sdk'
import { ORCHESTRATOR_FALLBACK_MODEL } from '@/lib/models'
import { loadConstitution } from '@/lib/operator/narrate'
import { checkAnswer, retryInstruction, type FactResolution } from '@/lib/operator/ask/facts'
import {
  ASK_TOOLS,
  runAskTool,
  type ToolContext,
  type ToolRun,
} from '@/lib/operator/ask/tools'
import type { ValidationFailure } from '@/lib/operator/validate'

/** Same tier as the queue narration — one voice across both surfaces. */
export const ASK_MODEL = ORCHESTRATOR_FALLBACK_MODEL

/**
 * Turns, not tool calls. Several tools can resolve inside one turn, so this is
 * a ceiling on rounds of thinking rather than on curiosity. Six is enough to
 * find a creative, read it, resolve its cohort, check the Vault and answer,
 * with a turn spare for a question that goes somewhere unexpected.
 */
const MAX_TURNS = 6
const MAX_TOKENS = 2000
const EPHEMERAL = { type: 'ephemeral' as const }

/* --------------------------------- events ---------------------------------- */

export type AskEvent =
  | { type: 'status'; state: 'thinking' | 'reading' | 'writing' }
  /** A sentence of his reasoning between tool calls — he thinks out loud here. */
  | { type: 'thought'; text: string }
  | { type: 'tool'; id: string; name: string; label: string }
  | { type: 'result'; id: string; receipt: string }
  | { type: 'answer'; text: string }
  | { type: 'sources'; tools: { name: string; receipt: string }[] }
  | { type: 'blocked'; failures: ValidationFailure[] }
  | { type: 'error'; message: string }
  | { type: 'done'; turns: number; toolCalls: number; resolutions: FactResolution[] }

export type AskEmitter = (event: AskEvent) => void

/* --------------------------------- prompt ---------------------------------- */

/**
 * The machine contract. Capability facts, never tone.
 *
 * Note what is absent: no instruction to be concise, friendly, professional or
 * insightful, no worked example of a good answer. An example would be copied,
 * and a copied answer is the one thing the constitution cannot survive.
 */
const CONTRACT = `---

## This surface

Someone on the dashboard has asked you a question directly. This is not the queue narration — there is no card, no JSON to return, no evidence ids to cite. Answer them the way you would answer across a desk.

You have instruments, listed as tools. Use them. You are not being handed a payload this time; if you want a number you go and get it, and if you cannot get it you say so.

Nothing you can reach writes anything. You read the account, your own queue, the Vault and strategic memory. You cannot pause, publish, scale or move a budget here any more than you can anywhere else — the same boundary as always.

Two hard rules, enforced in code after you speak:

1. Every figure you state must have come back from a tool this turn. Not remembered, not estimated, not inferred from a percentage. Round it however you like — "about forty quid a lead" off $41.20 is honest — but do not restate it as something else.
2. You cannot claim to have done anything. You propose and you draft.

Everything else — how long you take, what you lead with, whether the question was worth asking, whether you think they are looking at the wrong thing entirely — is yours.`

/* ---------------------------------- client --------------------------------- */

function client(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY
  return apiKey ? new Anthropic({ apiKey }) : null
}

/* ---------------------------------- input ---------------------------------- */

export interface AskTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface OpenAskInput {
  question: string
  /** Earlier in this conversation. Answers only — the tool traffic is not replayed. */
  history: AskTurn[]
  context: ToolContext
  /** Who this deployment serves. Null fields mean "do not invent it". */
  client: Record<string, string | null>
  /** What he already knows about working with this person. */
  relationship?: unknown
}

export interface OpenAskResult {
  answer: string
  runs: ToolRun[]
  turns: number
  blocked: boolean
}

/* ----------------------------------- loop ---------------------------------- */

function textOf(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export async function runOpenAsk(
  input: OpenAskInput,
  emit: AskEmitter,
): Promise<OpenAskResult> {
  const anthropic = client()
  const constitution = loadConstitution()

  if (!anthropic || !constitution) {
    const message = !anthropic
      ? 'Mike is not reachable — this deployment has no ANTHROPIC_API_KEY. The queue still works; he just cannot talk.'
      : 'Mike is not reachable — his character file could not be read.'
    emit({ type: 'error', message })
    return { answer: '', runs: [], turns: 0, blocked: false }
  }

  const system = `${constitution}\n\n${CONTRACT}`
  const runs: ToolRun[] = []

  // The account context rides in the first user message rather than the system
  // prompt: it changes every session, and pinning it in the system block would
  // invalidate the cached prefix on every single call.
  const opening = [
    '<context>',
    JSON.stringify(
      {
        today: input.context.evaluationDate,
        client: input.client,
        relationship: input.relationship ?? null,
        data: {
          origin: input.context.metadata.origin,
          timezone: input.context.metadata.accountTimezone,
          attributionWindow: input.context.metadata.attributionWindow,
          completeThrough: input.context.metadata.completeThrough,
          creativesInAccount: input.context.creatives.length,
          openDecisions: input.context.board.length,
        },
      },
      null,
      1,
    ),
    '</context>',
    '',
    input.question,
  ].join('\n')

  const messages: Anthropic.MessageParam[] = [
    ...input.history.map((t) => ({ role: t.role, content: t.text }) satisfies Anthropic.MessageParam),
    { role: 'user', content: opening },
  ]

  let turns = 0
  let answer = ''
  let blocked = false
  let correction: string | null = null

  while (turns < MAX_TURNS) {
    turns += 1
    emit({ type: 'status', state: turns === 1 ? 'thinking' : 'reading' })

    let response: Anthropic.Message
    try {
      response = await anthropic.messages.create({
        model: ASK_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: system, cache_control: EPHEMERAL }],
        tools: ASK_TOOLS,
        messages,
      })
    } catch (error) {
      emit({
        type: 'error',
        message: error instanceof Error ? error.message : 'Mike could not be reached.',
      })
      return { answer: '', runs, turns, blocked: false }
    }

    const said = textOf(response.content)
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    // Text alongside tool calls is him narrating his own reasoning mid-read.
    // It belongs in the trace, not in the answer — the answer is the turn he
    // stops reading on.
    if (said && toolUses.length > 0) emit({ type: 'thought', text: said })

    if (toolUses.length === 0) {
      const check = checkAnswer(said, runs)
      if (check.ok) {
        answer = said
        emit({ type: 'answer', text: answer })
        emit({
          type: 'sources',
          tools: runs.map((r) => ({ name: r.name, receipt: r.receipt })),
        })
        emit({ type: 'done', turns, toolCalls: runs.length, resolutions: check.resolutions })
        return { answer, runs, turns, blocked: false }
      }

      // One correction, carrying his own rejected answer back to him. A
      // from-scratch re-prompt loses the voice he had just found and usually
      // returns something blander that fails on a different figure.
      if (correction === null) {
        correction = retryInstruction(check.failures)
        messages.push({ role: 'assistant', content: said })
        messages.push({ role: 'user', content: correction })
        continue
      }

      blocked = true
      emit({ type: 'blocked', failures: check.failures })
      emit({ type: 'done', turns, toolCalls: runs.length, resolutions: check.resolutions })
      return { answer: '', runs, turns, blocked }
    }

    messages.push({ role: 'assistant', content: response.content })

    // Independent reads resolve together — he does not wait for the account
    // roll-up before starting the Vault search.
    const results = await Promise.all(
      toolUses.map(async (use) => {
        emit({
          type: 'tool',
          id: use.id,
          name: use.name,
          label: 'Reading…',
        })
        try {
          const run = await runAskTool(
            use.name,
            (use.input ?? {}) as Record<string, unknown>,
            input.context,
          )
          emit({ type: 'tool', id: use.id, name: run.name, label: run.label })
          emit({ type: 'result', id: use.id, receipt: run.receipt })
          runs.push(run)
          return {
            type: 'tool_result' as const,
            tool_use_id: use.id,
            content: JSON.stringify(run.result),
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool failed.'
          emit({ type: 'result', id: use.id, receipt: message })
          return {
            type: 'tool_result' as const,
            tool_use_id: use.id,
            content: message,
            is_error: true,
          }
        }
      }),
    )

    messages.push({ role: 'user', content: results })
    emit({ type: 'status', state: 'writing' })
  }

  // Out of turns with no answer. Said plainly — a fabricated summary of an
  // unfinished read is worse than an admission.
  emit({
    type: 'error',
    message:
      'He ran out of turns on that one without landing an answer. Narrow it down and ask again.',
  })
  return { answer, runs, turns, blocked }
}
