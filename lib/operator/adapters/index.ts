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
import type { DataSource } from '@/lib/operator/types'

export interface SourceOptions {
  /** Injected. Never `new Date()` inside the pipeline. */
  evaluationDate: string
}

/* ─────────────────────────────────────────────────────────────────────────────
   THE ONE LINE. Change `createSeededSource` to `createMetaSource` (imported
   from './meta') when the live adapter lands. Nothing else moves.
   ───────────────────────────────────────────────────────────────────────── */
const createSource = createSeededSource

export function operatorDataSource(options: SourceOptions): DataSource {
  return createSource({ evaluationDate: options.evaluationDate })
}

/** The account's configured cost-per-result target, alongside its source. */
export const TARGET_COST_PER_RESULT = SEEDED_TARGET_COST_PER_RESULT

/** The ad account's timezone — needed to resolve "today" before the source exists. */
export const ACCOUNT_TIMEZONE = SEEDED_ACCOUNT_TIMEZONE

export type { DataSource }
