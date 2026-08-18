/**
 * Approve → draft. That is the entire write path.
 *
 * The hand-off deliberately reuses the mechanism the Ad Library already uses to
 * send a clone reference into the Campaign Reactor: stage it in sessionStorage,
 * navigate, and let the Workbench pick it up and open the brief ready to
 * configure. Nothing renders, nothing publishes, nothing touches the ad
 * account — a human still has to read the brief and fire it.
 *
 * `stageDraft` runs the capability assertion before it writes. That is not
 * defensive theatre: the realistic failure is somebody six months from now
 * wiring Approve to a helper that already knows how to launch, because the
 * helper was right there. The assertion is what turns that from a shipped
 * incident into a thrown error on the first run.
 */

import { assertDraftOnly } from '@/lib/operator/safety'
import type { Proposal, ProposalParams } from '@/lib/operator/types'

export const OPERATOR_DRAFT_KEY = 'reactor.operator.draft.v1'

/** Where an approved proposal goes. A page, not an API. */
export const OPERATOR_DRAFT_HREF = '/campaign-reactor'

export interface OperatorDraft {
  proposalId: string
  type: Proposal['type']
  /** Pre-fills the campaign name on step one of the brief. */
  campaignName: string
  /** Pre-fills the brief body — the move, the reasoning and the evidence. */
  brief: string
  variations: number
  subjectIds: string[]
  subjectNames: string[]
  createdAt: string
}

const VERB: Record<Proposal['type'], string> = {
  ITERATE: 'Iterate',
  REPLACE: 'Successor',
  EXPLORE: 'Pattern test',
  COLLECT: 'Hold',
}

/**
 * Compose the brief from the proposal.
 *
 * Mike's words go in when he has some, the computed fallback when he does not,
 * and the evidence rows go in underneath either way — so the brief that reaches
 * the Reactor carries the actual numbers rather than a summary of them.
 */
export function draftFromProposal(
  proposal: Proposal,
  params: ProposalParams,
  narrated?: { recommendation: string; reasoning: string },
): OperatorDraft {
  const words = narrated ?? proposal.fallback
  const evidence = proposal.evidence
    .slice(0, 4)
    .map((e) => `- ${e.label}: ${e.displayValue}${e.comparisonValue ? ` (${e.comparisonValue})` : ''}`)
    .join('\n')

  const brief = [
    words.recommendation,
    '',
    words.reasoning,
    '',
    'Evidence behind this brief:',
    evidence,
    '',
    // The params are the authoritative spec — they are what the operator may
    // have just edited, so they are stated rather than left implicit.
    `Variations to produce: ${params.variations}.`,
    params.hookDirection ? `Angle to carry: ${params.hookDirection}.` : '',
    params.format ? `Reference format: ${params.format}.` : '',
    params.instructions ? `Operator notes: ${params.instructions}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .trim()

  return {
    proposalId: proposal.id,
    type: proposal.type,
    campaignName: `${VERB[proposal.type]} · ${proposal.subjectNames[0] ?? 'Account'}`,
    brief,
    variations: params.variations,
    subjectIds: proposal.subjectIds,
    subjectNames: proposal.subjectNames,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Stage the draft for the Campaign Reactor and return the destination.
 *
 * Throws if the destination is anything that could mutate the account. Callers
 * navigate to the returned href, which means the assertion cannot be skipped by
 * using the value without calling this.
 */
export function stageDraft(draft: OperatorDraft): string {
  const destination = assertDraftOnly(OPERATOR_DRAFT_HREF)
  if (typeof window === 'undefined') return destination
  try {
    window.sessionStorage.setItem(OPERATOR_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* private mode — the operator can still open the Reactor and brief it */
  }
  return destination
}

/**
 * Read and clear the staged draft.
 *
 * Cleared on read so a refresh does not silently re-raise a brief the operator
 * has already dismissed — the same discipline the clone hand-off uses.
 */
export function takeDraft(): OperatorDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(OPERATOR_DRAFT_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(OPERATOR_DRAFT_KEY)
    const parsed = JSON.parse(raw) as OperatorDraft
    return parsed && typeof parsed.brief === 'string' ? parsed : null
  } catch {
    return null
  }
}
