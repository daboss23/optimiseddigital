/**
 * Mike's one endpoint.
 *
 * Three modes — the session narration, Ask Mike and the catch-up briefing —
 * behind one handler, because the spec's hard requirement is that all three run
 * through the same validator and the same evidence-reference system. Three
 * routes would have been tidier to look at and would have grown three subtly
 * different notions of what counts as an authorised number, which is exactly
 * the failure the single shared resolver exists to prevent.
 *
 * The route is stateless. Proposals arrive computed from the client, which is
 * where the pipeline runs (it needs the decision log, and the decision log lives
 * in the operator's own browser). Nothing here writes anything.
 */

import { NextRequest, NextResponse } from 'next/server'
import { askMike, catchUp, narrateSession, type NarrationResult } from '@/lib/operator/narrate'
import type {
  AskContext,
  CatchupContext,
  NarrationContext,
  Proposal,
} from '@/lib/operator/types'

export const runtime = 'nodejs'
// Narration is a live read of a board that changes with every decision.
export const dynamic = 'force-dynamic'

type Mode = 'session' | 'ask' | 'catchup'

interface OperatorRequest {
  mode?: Mode
  session?: NarrationContext
  ask?: AskContext
  catchup?: CatchupContext
}

/** Enough shape-checking that a malformed body fails here, not inside Mike. */
function looksLikeProposal(p: unknown): p is Proposal {
  const candidate = p as Proposal | null
  return Boolean(
    candidate &&
      typeof candidate.id === 'string' &&
      typeof candidate.type === 'string' &&
      Array.isArray(candidate.evidence) &&
      candidate.strength &&
      typeof candidate.strength.tier === 'string',
  )
}

export async function POST(request: NextRequest) {
  let body: OperatorRequest
  try {
    body = (await request.json()) as OperatorRequest
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }

  const mode: Mode = body.mode ?? 'session'

  try {
    if (mode === 'session') {
      const ctx = body.session
      if (!ctx || !Array.isArray(ctx.proposals) || !ctx.proposals.every(looksLikeProposal)) {
        return NextResponse.json({ error: 'session.proposals is required.' }, { status: 400 })
      }
      if (ctx.proposals.length === 0) {
        // An empty board is a legitimate state — everything is actioned. There
        // is nothing for him to narrate and no call worth making.
        return NextResponse.json({
          output: {
            leadProposalId: '',
            leadReason: 'Nothing on the board.',
            cards: [],
            openingRemark: null,
            sessionNote: ctx.mikesNotes ?? '',
          },
          degraded: false,
          attempts: [],
          model: null,
        } satisfies Omit<NarrationResult, 'model'> & { model: null })
      }
      const result = await narrateSession(ctx)
      return NextResponse.json(result)
    }

    if (mode === 'ask') {
      const ctx = body.ask
      if (!ctx || !looksLikeProposal(ctx.proposal) || !ctx.question?.trim()) {
        return NextResponse.json(
          { error: 'ask.proposal and ask.question are required.' },
          { status: 400 },
        )
      }
      const result = await askMike(ctx)
      return NextResponse.json(result)
    }

    const ctx = body.catchup
    if (!ctx || !ctx.since) {
      return NextResponse.json({ error: 'catchup.since is required.' }, { status: 400 })
    }
    const result = await catchUp(ctx)
    return NextResponse.json(result)
  } catch (error) {
    // Mike failing is never allowed to be the dashboard failing — the client
    // falls back to the computed cards on a non-200.
    const message = error instanceof Error ? error.message : 'Narration failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
