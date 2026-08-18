/**
 * EXPLORE — a pattern several creatives share, worth testing deliberately.
 *
 * One test is a story. Three tests is a pattern. This rule is where that belief
 * is enforced structurally rather than argued about: it cannot fire on fewer
 * than three creatives, and three is where a pattern STARTS — the strength
 * tiering caps a three- or four-creative pattern below STRONG, so the card can
 * never present itself as settled on the strength of its best member alone.
 *
 * Compatibility is the other half. Grouping "founder-led" creatives across a
 * lead-magnet campaign and a booked-call campaign produces a group mean that
 * describes nothing real — the two costs are not on the same scale and never
 * were. So patterns are grouped WITHIN a primary result type, always.
 */

import { RESULT_LABELS } from '@/lib/creative-status'
import { rangeLabel } from '@/lib/operator/dates'
import { collectEvidence, costWord, groupEvidence, money2 } from '@/lib/operator/evidence'
import { proposalFingerprint, subjectFingerprint } from '@/lib/operator/fingerprint'
import { assessStrength } from '@/lib/operator/strength'
import {
  bandScore,
  emptyResult,
  SCORE_BANDS,
  THRESHOLDS,
  type EvaluatedCreative,
  type Rule,
  type RuleResult,
} from '@/lib/operator/rules/shared'
import type { PrimaryResultType, Proposal } from '@/lib/operator/types'

/**
 * Tags arrive machine-shaped (`specific-dollar-figure`) because that is what a
 * tag is. A queue column is read by a person, so it gets the readable form —
 * and only here, at the presentation boundary, so grouping still matches on the
 * exact tag.
 */
function humanisePattern(pattern: string): string {
  const spaced = pattern.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

interface PatternGroup {
  /** "founder-led" or "specific dollar figure" — the shared attribute. */
  pattern: string
  kind: 'tag' | 'hook'
  resultType: PrimaryResultType
  members: EvaluatedCreative[]
}

/** Group by shared tag and by shared hook type, never across result types. */
function buildGroups(evaluated: EvaluatedCreative[]): PatternGroup[] {
  const buckets = new Map<string, PatternGroup>()

  const add = (pattern: string, kind: 'tag' | 'hook', item: EvaluatedCreative) => {
    const resultType = item.creative.primaryResultType
    const key = `${kind}:${pattern}:${resultType}`
    const existing = buckets.get(key)
    if (existing) existing.members.push(item)
    else buckets.set(key, { pattern, kind, resultType, members: [item] })
  }

  for (const item of evaluated) {
    // Only creatives with a resolved cohort ratio can join a group mean —
    // averaging a ratio with a missing one is how a pattern gets invented.
    if (item.signals.costPerResultVsBaseline === null) continue
    for (const tag of item.creative.tags) add(tag, 'tag', item)
    if (item.creative.hookType) add(item.creative.hookType, 'hook', item)
  }

  return Array.from(buckets.values())
}

export const exploreRule: Rule = (ctx): RuleResult => {
  const result = emptyResult()
  const groups = buildGroups(ctx.evaluated)

  // One EXPLORE at most, and it should be the strongest pattern on the board —
  // three near-identical "test the founder angle" cards is not three insights.
  const qualifying = groups
    .filter((g) => g.members.length >= THRESHOLDS.patternMinCreatives)
    .map((g) => {
      const ratios = g.members.map((m) => m.signals.costPerResultVsBaseline as number)
      const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length
      return { group: g, mean }
    })
    .filter((g) => g.mean <= THRESHOLDS.patternCostRatio)
    .sort((a, b) => a.mean - b.mean)

  const best = qualifying[0]
  if (!best) return result

  const { group, mean } = best
  const members = group.members
  const ids = members.map((m) => m.creative.id)
  const resultWord = RESULT_LABELS[group.resultType]

  const totalResults = members.reduce((s, m) => s + m.signals.totalPrimaryResults, 0)
  const totalSpend = members.reduce((s, m) => s + m.signals.totalSpend, 0)
  const from = members.map((m) => m.signals.analysed.from).sort()[0]
  const to = members.map((m) => m.signals.analysed.to).sort().slice(-1)[0]
  const cheaperBy = Math.round((1 - mean) * 100)

  const evidence = collectEvidence([
    groupEvidence({
      kind: 'pattern_cost',
      label: `Group ${costWord(group.resultType)} vs cohort median`,
      short: 'Cohort',
      creativeIds: ids,
      rawValue: mean,
      displayValue: `${cheaperBy}% below`,
      comparisonValue: `mean of ${members.length} creatives sharing "${group.pattern}" · ${members
        .map((m) => m.creative.name)
        .join(', ')}`,
      direction: 'good',
      dateRange: { from, to },
      baselineKey: members[0].baseline?.key,
    }),
    groupEvidence({
      kind: 'pattern_volume',
      short: 'Volume',
      label: 'Evidence behind the pattern',
      creativeIds: ids,
      rawValue: totalResults,
      displayValue: `${totalResults.toLocaleString()} ${totalResults === 1 ? resultWord.one.toLowerCase() : resultWord.many}`,
      comparisonValue: `${money2(totalSpend)} spend across ${members.length} creatives · ${rangeLabel(from, to)}`,
      direction: 'neutral',
      dateRange: { from, to },
    }),
    groupEvidence({
      kind: 'pattern_scope',
      short: 'Creatives',
      label: 'Comparability',
      creativeIds: ids,
      rawValue: members.length,
      displayValue: `${members.length}`,
      comparisonValue: `all ${resultWord.many} — no cross-result-type blending in this group mean`,
      direction: 'neutral',
      dateRange: { from, to },
    }),
  ])

  const leader = members
    .slice()
    .sort(
      (a, b) =>
        (a.signals.costPerResultVsBaseline as number) - (b.signals.costPerResultVsBaseline as number),
    )[0]

  const strength = assessStrength({
    signals: leader.signals,
    baseline: leader.baseline,
    comparableCreatives: leader.resolution.comparableCreatives,
    proposalType: 'EXPLORE',
    supportingCreatives: members.length,
    targetCostPerResult: ctx.targetCostPerResult,
  })

  const severity = (THRESHOLDS.patternCostRatio - mean) / 0.45

  result.proposals.push({
    id: proposalFingerprint('EXPLORE', ids, ctx.evaluationDate),
    subjectKey: subjectFingerprint('EXPLORE', ids),
    type: 'EXPLORE',
    subjectIds: ids,
    subjectNames: members.map((m) => m.creative.name),
    // The subject of a pattern proposal is the PATTERN. Listing three creative
    // names in a queue column is a list, not a subject; the members are in the
    // drawer where they can be read properly.
    subjectLabel: humanisePattern(group.pattern),
    score: bandScore(SCORE_BANDS.explore, severity),
    strength,
    evidence,
    params: {
      ...ctx.defaults,
      hookDirection: group.pattern,
      format: leader.creative.format,
    },
    createdAt: ctx.evaluationDate,
    draftIntent: 'explore',
    fallback: {
      recommendation: `Test "${group.pattern}" deliberately on a new creative`,
      short: `${members.length} creatives share this pattern and all sit below the cohort median.`,
      reasoning: `${members.length} creatives carrying "${group.pattern}" average ${cheaperBy}% below the cohort median ${costWord(group.resultType)} on ${totalResults} ${
        totalResults === 1 ? resultWord.one.toLowerCase() : resultWord.many
      } (${rangeLabel(from, to)}). The pattern has never been isolated in a creative built around it.`,
    },
  } satisfies Proposal)

  return result
}
