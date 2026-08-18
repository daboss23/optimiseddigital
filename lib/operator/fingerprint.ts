/**
 * Deterministic identity for proposals and suppressions.
 *
 * A proposal's ID is `hash(type + sorted(subjectIds) + weekBucket)`. Every part
 * of that earns its place:
 *
 * - **type + subjects** so "replace Systems Before Scale" is one thing, no
 *   matter how the wording moves.
 * - **sorted** so a group proposal about the same three creatives is the same
 *   proposal whichever order the pipeline happened to walk them in.
 * - **weekBucket** so it stays ONE proposal for the week. Without it, tomorrow's
 *   recompute mints a fresh ID, the 14-day dismissal cooldown never matches, and
 *   a card the operator has already said no to comes straight back — which is
 *   the fastest way to make somebody stop reading their own dashboard.
 */

import { weekBucket } from '@/lib/operator/dates'
import type { FatigueSignal, ProposalType } from '@/lib/operator/types'

/** FNV-1a, 32-bit, rendered base36. Short, stable, and not a security boundary. */
export function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function proposalFingerprint(
  type: ProposalType,
  subjectIds: string[],
  evaluationDate: string,
): string {
  const subjects = subjectIds.slice().sort().join('|')
  return `p_${type.toLowerCase()}_${hash(`${type}::${subjects}::${weekBucket(evaluationDate)}`)}`
}

/**
 * The SAME proposal across weeks: type + subjects, no week bucket.
 *
 * This exists because the two requirements the fingerprint has to satisfy pull
 * in opposite directions. The week bucket is what stops a card re-minting a new
 * id every morning — but it also means a 14-day dismissal cooldown keyed on the
 * id would silently expire the moment the week rolled over, and the card the
 * operator said no to on Friday would be back on Monday wearing a new number.
 *
 * So: `proposalFingerprint` is the DISPLAY identity, stable for a week.
 * `subjectFingerprint` is the MEMORY identity, stable forever, and it is what
 * every decision, cooldown and snooze is recorded against.
 */
export function subjectFingerprint(type: ProposalType, subjectIds: string[]): string {
  return `k_${type.toLowerCase()}_${hash(`${type}::${subjectIds.slice().sort().join('|')}`)}`
}

/**
 * Suppression identity: one creative, one fatigue signal.
 *
 * Deliberately NOT keyed by creative alone. A creative whose frequency has come
 * back down has recovered on frequency — it has not recovered on a cost per
 * result that is still climbing, and suppressing the whole REPLACE category for
 * it would hide a legitimate replacement behind an unrelated piece of good news.
 */
export function suppressionKey(creativeId: string, signal: FatigueSignal): string {
  return `s_${hash(`${creativeId}::${signal}`)}`
}
