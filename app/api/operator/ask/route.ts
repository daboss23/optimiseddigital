/**
 * Ask Mike, open-ended.
 *
 * Separate from `/api/operator` on purpose. That route is stateless narration
 * over a payload the client already computed, and it returns JSON. This one
 * runs a tool-use loop that reads the account itself and streams, because the
 * reading is most of what there is to watch — a spinner over eleven seconds of
 * silence would throw away the only part of the job the operator has never
 * been able to see.
 *
 * The data is loaded HERE rather than accepted from the browser. The client
 * sends its board (which it owns — the decision log lives in its own storage)
 * and nothing else; every figure Mike can reach comes from the server's own
 * read of the same source the dashboard renders. A payload of numbers posted
 * in from a page is a payload of numbers anybody can edit.
 *
 * Never throws at the client. A failure is an `error` event on the stream and
 * a surface that says what went wrong.
 */

import { NextRequest } from 'next/server'
import { getTenant } from '@/lib/tenant'
import { loadOperatorContext } from '@/lib/operator/ask/source'
import { runOpenAsk, type AskEvent, type AskTurn } from '@/lib/operator/ask/agent'
import type { Proposal } from '@/lib/operator/types'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A tool-use loop over a live account. Well inside Fluid compute's 300s.
export const maxDuration = 120

interface AskRequest {
  question?: string
  history?: AskTurn[]
  /** The operator's own board, as computed in their browser. */
  board?: Proposal[]
  relationship?: unknown
}

const MAX_QUESTION_CHARS = 1000
/** Enough thread to hold a follow-up, short enough to stay cheap. */
const MAX_HISTORY_TURNS = 8

function sse(controller: ReadableStreamDefaultController, event: AskEvent) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
}

export async function POST(request: NextRequest) {
  let body: AskRequest
  try {
    body = (await request.json()) as AskRequest
  } catch {
    return new Response(JSON.stringify({ error: 'Malformed request body.' }), { status: 400 })
  }

  const question = (body.question ?? '').trim().slice(0, MAX_QUESTION_CHARS)
  if (!question) {
    return new Response(JSON.stringify({ error: 'A question is required.' }), { status: 400 })
  }

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
    .slice(-MAX_HISTORY_TURNS)
  const board = Array.isArray(body.board) ? body.board : []

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AskEvent) => sse(controller, event)
      try {
        // The account's own today, not the browser's. A dashboard left open
        // across midnight in another timezone must not shift which days count
        // as complete.
        const { evaluationDate, creatives, baselines, metadata } = await loadOperatorContext(await currentAccount())
        const tenant = await getTenant(await currentAccount()).catch(() => null)

        await runOpenAsk(
          {
            question,
            history,
            context: { evaluationDate, creatives, baselines, metadata, board },
            client: {
              company: tenant?.companyName || null,
              industry: tenant?.industry || null,
              audience: tenant?.audienceDescriptor || null,
              positioning: tenant?.positioning || null,
              operatorName: (process.env.NEXT_PUBLIC_OPERATOR_NAME ?? '').trim() || null,
            },
            relationship: body.relationship ?? null,
          },
          emit,
        )
      } catch (error) {
        emit({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The account could not be read, so there was nothing to answer from.',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
