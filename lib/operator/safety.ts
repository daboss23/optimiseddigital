/**
 * The capability boundary, enforced rather than described.
 *
 * Mike can propose and he can draft. That is the entire list. He cannot
 * publish, cannot pause, cannot scale, cannot move a budget, cannot edit
 * permanent brand knowledge and cannot change code.
 *
 * A comment saying so is worth nothing — the risk is not that somebody writes
 * `fetch('/api/meta/publish')` on purpose, it is that six months from now
 * "Approve" gets wired to a helper that already knows how to launch, because
 * that helper was right there and it looked convenient. So the approve path
 * runs its target through `assertDraftOnly` and THROWS if it resolves anywhere
 * that mutates the ad account. The assertion is the boundary. The comment is
 * just the explanation.
 */

export const OPERATOR_CAPABILITIES = ['propose', 'draft'] as const
export type OperatorCapability = (typeof OPERATOR_CAPABILITIES)[number]

/**
 * Anything that changes the state of the live ad account, or writes permanent
 * knowledge. Matched loosely on purpose: a near-miss should fail closed.
 */
const FORBIDDEN_TARGETS: { pattern: RegExp; what: string }[] = [
  { pattern: /\/api\/meta\/publish/i, what: 'publishing a creative to Meta' },
  { pattern: /\/api\/meta\/ingest/i, what: 'writing graded outcomes into ORACLE' },
  { pattern: /\/api\/vault\/(ingest|website)/i, what: 'writing permanent brand knowledge' },
  { pattern: /\/api\/campaign-reactor\/outcome/i, what: 'recording a campaign outcome' },
  { pattern: /\bpublish\b/i, what: 'publishing' },
  { pattern: /\bpause\b/i, what: 'pausing delivery' },
  { pattern: /\bbudget\b/i, what: 'changing a budget' },
  { pattern: /graph\.facebook\.com/i, what: 'calling the Meta Marketing API directly' },
]

export class CapabilityViolation extends Error {
  constructor(target: string, what: string) {
    super(
      `Mike Delight cannot ${what}. Approve creates a draft only — the operator's capabilities are ${OPERATOR_CAPABILITIES.join(
        ' and ',
      )}. Blocked target: ${target}`,
    )
    this.name = 'CapabilityViolation'
  }
}

/**
 * Assert an approve target is a draft destination and return it.
 *
 * Used as `router.push(assertDraftOnly(href))` so the check cannot be
 * accidentally skipped by someone using the value without calling it.
 */
export function assertDraftOnly(target: string): string {
  for (const { pattern, what } of FORBIDDEN_TARGETS) {
    if (pattern.test(target)) throw new CapabilityViolation(target, what)
  }
  return target
}

/** Non-throwing form, for tests and for a defensive UI check. */
export function isDraftOnly(target: string): boolean {
  try {
    assertDraftOnly(target)
    return true
  } catch {
    return false
  }
}
