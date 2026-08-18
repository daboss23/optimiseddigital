/**
 * The rule set.
 *
 * One file per rule, registered here in the order they are evaluated. COLLECT
 * is deliberately NOT in this array: its precondition is "nothing else fired",
 * which is a fact about the other rules rather than about the data, so the
 * orchestrator calls it directly as a last resort.
 *
 * Adding a rule is: write the file, add it here. Nothing else in the pipeline
 * needs to know it exists.
 */

import { exploreRule } from '@/lib/operator/rules/explore'
import { fatigueRule } from '@/lib/operator/rules/fatigue'
import { iterateRule } from '@/lib/operator/rules/iterate'
import type { Rule } from '@/lib/operator/rules/shared'

export const RULES: Rule[] = [iterateRule, fatigueRule, exploreRule]

export { collectProposal } from '@/lib/operator/rules/collect'
export * from '@/lib/operator/rules/shared'
