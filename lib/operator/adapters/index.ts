/**
 * The data-source switch.
 *
 * This file is the seam. Everything above `adapters/` — signals, baselines,
 * strength, evidence, rules, the orchestrator, the validator, Mike — reads a
 * `DataSource` and knows nothing about where the numbers came from. Swapping
 * seeded delivery for the live account is the ONE line marked below, and the
 * self-test asserts that nothing outside this file needs to change with it.
 *
 * That property is worth protecting deliberately. The moment a rule reaches
 * past this seam for "just one field" from the Graph API, the pipeline stops
 * being testable against fixed data, and the fixed data is the only reason any
 * of the thresholds can be trusted.
 */

import {
  createSeededSource,
  SEEDED_ACCOUNT_TIMEZONE,
  SEEDED_TARGET_COST_PER_RESULT,
} from '@/lib/operator/adapters/seeded'
import { createMetaSource } from '@/lib/operator/adapters/meta'
import type { DataSource } from '@/lib/operator/types'

export interface SourceOptions {
  /** Injected. Never `new Date()` inside the pipeline. */
  evaluationDate: string
}

/* ─────────────────────────────────────────────────────────────────────────────
   THE ONE LINE — now an env flag. `NEXT_PUBLIC_OPERATOR_SOURCE=meta` reads the
   live account through /api/operator/source; anything else keeps the seeded
   source, so the self-test and the demo account never move. Nothing outside
   this file knows the difference.
   ───────────────────────────────────────────────────────────────────────── */
const createSource =
  process.env.NEXT_PUBLIC_OPERATOR_SOURCE === 'meta' ? createMetaSource : createSeededSource

export function operatorDataSource(options: SourceOptions): DataSource {
  return createSource({ evaluationDate: options.evaluationDate })
}

/**
 * The account's configured cost-per-result target, alongside its source.
 * Defaults to the seeded target — a live account sets its own via
 * NEXT_PUBLIC_OPERATOR_TARGET_CPR.
 */
const targetOverride = Number(process.env.NEXT_PUBLIC_OPERATOR_TARGET_CPR)
export const TARGET_COST_PER_RESULT =
  Number.isFinite(targetOverride) && targetOverride > 0 ? targetOverride : SEEDED_TARGET_COST_PER_RESULT

/**
 * The ad account's timezone — needed to resolve "today" before the source
 * exists. With the live source the server is authoritative (it reads
 * `timezone_name` off the account); this only seeds the client's first guess.
 */
export const ACCOUNT_TIMEZONE =
  process.env.NEXT_PUBLIC_OPERATOR_ACCOUNT_TZ || SEEDED_ACCOUNT_TIMEZONE

export type { DataSource }
