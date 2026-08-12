/**
 * Persistence for the operator's side of the relationship.
 *
 * What is stored is DECISIONS and their consequences: what was approved,
 * dismissed, snoozed and edited; the weights those produced; whether Mike is
 * paused; his running note; his last ten openings; when the operator was last
 * here.
 *
 * What is deliberately NOT stored: signals, evidence, proposals. Those
 * recompute on every load from the data source plus the decision log, which is
 * the property that makes a stale card impossible. A persisted proposal is a
 * claim about the account frozen at the moment it was written, and it goes on
 * being displayed long after the account has stopped agreeing with it.
 *
 * Same storage pattern as the Creative Ledger: client-side, survives a refresh,
 * needs no database, and works on a cold platform with nothing configured —
 * which is the environment the rest of the Reactor already degrades to.
 */

import {
  emptyMemory,
  OPERATOR_SCHEMA_VERSION,
  type OperatorMemory,
} from '@/lib/operator/memory'
import type { NarrationOutput } from '@/lib/operator/types'

const STORAGE_KEY = 'reactor.operator.v1'
const NARRATION_KEY = 'reactor.operator.narration.v1'

const isBrowser = () => typeof window !== 'undefined'

/* -------------------------------- migration -------------------------------- */

/**
 * Bring a stored payload up to the current schema, or start clean.
 *
 * The guard is deliberately conservative in one direction: a payload written by
 * a NEWER version than this build is not down-migrated, it is discarded. Two
 * tabs on two deploys sharing one localStorage key is a real situation, and
 * losing a decision log is recoverable in a way that acting on a
 * misinterpreted one is not.
 */
function migrate(raw: unknown): OperatorMemory | null {
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as Partial<OperatorMemory>
  const version = typeof stored.schemaVersion === 'number' ? stored.schemaVersion : 0

  if (version > OPERATOR_SCHEMA_VERSION) return null
  if (version < OPERATOR_SCHEMA_VERSION) {
    // No shipped schema predates v1, so anything older is pre-release state and
    // is dropped rather than guessed at. Future versions add their step here.
    return null
  }

  const base = emptyMemory()
  return {
    ...base,
    ...stored,
    schemaVersion: OPERATOR_SCHEMA_VERSION,
    decisions: Array.isArray(stored.decisions) ? stored.decisions : [],
    weights: stored.weights && typeof stored.weights === 'object' ? stored.weights : {},
    recentOpenings: Array.isArray(stored.recentOpenings) ? stored.recentOpenings : [],
    seen: stored.seen && typeof stored.seen === 'object' ? stored.seen : {},
    states: stored.states && typeof stored.states === 'object' ? stored.states : {},
    askLog: Array.isArray(stored.askLog) ? stored.askLog : [],
    suppressions:
      stored.suppressions && typeof stored.suppressions === 'object' ? stored.suppressions : {},
  }
}

/* ---------------------------------- memory --------------------------------- */

/** Never throws. A corrupt or foreign value resolves to a clean memory. */
export function loadMemory(): OperatorMemory {
  if (!isBrowser()) return emptyMemory()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyMemory()
    return migrate(JSON.parse(raw)) ?? emptyMemory()
  } catch {
    return emptyMemory()
  }
}

export function saveMemory(memory: OperatorMemory): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    /* quota or private mode — the session keeps working, it just will not persist */
  }
}

export function clearMemory(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.sessionStorage.removeItem(NARRATION_KEY)
  } catch {
    /* nothing to do — the caller is resetting anyway */
  }
}

/* ------------------------------ narration cache ---------------------------- */

/**
 * Mike's session, cached against the exact board it was written about.
 *
 * Keyed on the ranked proposal ids, so a refresh inside the same session reuses
 * his words instead of billing a second call and — worse — producing subtly
 * different language about identical evidence, which reads as him changing his
 * mind for no reason. Any change to the board invalidates it immediately.
 *
 * `sessionStorage`, not `localStorage`: a new tab tomorrow is a new session,
 * and he should have a fresh look at the account.
 */
export interface CachedNarration {
  key: string
  output: NarrationOutput
  degraded: boolean
  /** When it was written, so the opening remark can label itself honestly. */
  writtenAt: string
}

export function narrationKey(ranking: string[], evaluationDate: string): string {
  return `${evaluationDate}::${ranking.join('|')}`
}

export function loadNarration(key: string): CachedNarration | null {
  if (!isBrowser()) return null
  try {
    const raw = window.sessionStorage.getItem(NARRATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedNarration
    return parsed && parsed.key === key ? parsed : null
  } catch {
    return null
  }
}

export function saveNarration(entry: CachedNarration): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.setItem(NARRATION_KEY, JSON.stringify(entry))
  } catch {
    /* non-fatal: he just gets asked again next refresh */
  }
}

/** Drop the cached session so "Refresh analysis" gets a genuinely fresh read. */
export function clearNarration(): void {
  if (!isBrowser()) return
  try {
    window.sessionStorage.removeItem(NARRATION_KEY)
  } catch {
    /* nothing cached to clear */
  }
}
