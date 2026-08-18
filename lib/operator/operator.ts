/**
 * The orchestrator — data in, at most three proposals out.
 *
 * The whole pipeline in one place, in the order it runs:
 *
 *   maturity  →  what may be read at all
 *   baselines →  what each creative is fairly compared against
 *   signals   →  the metrics and equal-window trends
 *   strength  →  how much weight the read can carry
 *   rules     →  candidate proposals, each with its evidence
 *   suppress  →  recovery holds, precise to creative + signal
 *   cooldowns →  what the operator has already answered
 *   weights   →  what they tend to care about, ranking only
 *   cap       →  one REPLACE, three cards
 *
 * Everything above `adapters/` is agnostic to where the data came from, which
 * is the property that makes the seeded → live Meta swap a one-line import
 * change rather than a rewrite.
 *
 * Nothing here is persisted. Signals, evidence and proposals recompute on every
 * load from the source plus the decision log, so there is exactly one version of
 * the truth and no stale card can survive a change in the underlying data.
 */

import { resolveBaseline } from '@/lib/operator/baselines'
import { assessMaturity, completeDaily, type MaturityReport } from '@/lib/operator/maturity'
import {
  cooldownVerdict,
  defaultParams,
  recoverySuppressed,
  relationshipSummary,
  weightFor,
  type OperatorMemory,
} from '@/lib/operator/memory'
import { collectProposal, RULES, type EvaluatedCreative, type RuleContext, type Suppression } from '@/lib/operator/rules'
import { computeSignals } from '@/lib/operator/signals'
import type {
  CreativeSnapshot,
  CreativeSummary,
  DailyMetric,
  DataSourceMetadata,
  PerformanceBaseline,
  Proposal,
  RelationshipSummary,
} from '@/lib/operator/types'

/** The board never carries more than this. Three decisions is a morning. */
export const MAX_ACTIVE_PROPOSALS = 3
/** One replacement per run. Two is a panic, not a plan. */
export const MAX_REPLACE_PER_RUN = 1

export interface OperatorInput {
  creatives: CreativeSnapshot[]
  baselines: PerformanceBaseline[]
  metadata: DataSourceMetadata
  /** Injected. Never derived inside the pipeline. */
  evaluationDate: string
  memory: OperatorMemory
  targetCostPerResult?: number
}

export interface SuppressedProposal {
  proposal: Proposal
  reason: string
}

export interface OperatorOutput {
  /** The board: up to three, ranked. */
  proposals: Proposal[]
  /** Every candidate that survived suppression — Mike sees all of them. */
  candidates: Proposal[]
  /** Candidate ids in computed score order. */
  ranking: string[]
  /** Held back, with the reason, for the debug panel. */
  suppressed: SuppressedProposal[]
  /** Live recovery holds produced by this run. */
  recoveries: Suppression[]
  /** Things worth Mike knowing that never became a proposal. */
  notes: string[]
  maturity: MaturityReport
  evaluated: EvaluatedCreative[]
  relationship: RelationshipSummary
  paused: boolean
}

/* ------------------------------- the pipeline ------------------------------ */

export function runOperator(input: OperatorInput): OperatorOutput {
  const { creatives, baselines, metadata, evaluationDate, memory } = input

  const maturity = assessMaturity({ evaluationDate, metadata })

  const evaluated: EvaluatedCreative[] = creatives.map((creative) => {
    const resolution = resolveBaseline(creative, baselines)
    return {
      creative,
      resolution,
      baseline: resolution.baseline,
      signals: computeSignals(creative, maturity, resolution.baseline),
    }
  })

  const ctx: RuleContext = {
    evaluated,
    maturity,
    metadata,
    evaluationDate,
    defaults: defaultParams(memory),
    targetCostPerResult: input.targetCostPerResult,
  }

  /* -- run the rules ------------------------------------------------------- */

  let candidates: Proposal[] = []
  const recoveries: Suppression[] = []
  const notes: string[] = []

  for (const rule of RULES) {
    const result = rule(ctx)
    candidates.push(...result.proposals)
    recoveries.push(...result.suppressions)
    notes.push(...result.notes)
  }

  // COLLECT is the last resort, never a co-star.
  if (candidates.length === 0) {
    const fallback = collectProposal(ctx)
    candidates.push(...fallback.proposals)
    notes.push(...fallback.notes)
  }

  /* -- dedupe by fingerprint ---------------------------------------------- */

  const byId = new Map<string, Proposal>()
  for (const p of candidates) {
    const existing = byId.get(p.id)
    // Same fingerprint, different read: keep the stronger claim.
    if (!existing || p.score > existing.score) byId.set(p.id, p)
  }
  candidates = Array.from(byId.values())

  /* -- suppression: recoveries, then cooldowns ----------------------------- */

  // This run's recoveries apply immediately, alongside any still live from
  // previous runs, so a creative that turned this morning is not replaced this
  // morning on the strength of a window that has already stopped being true.
  const liveSuppressions: OperatorMemory['suppressions'] = { ...memory.suppressions }
  for (const s of recoveries) {
    liveSuppressions[s.key] = { untilDate: s.untilDate, note: s.note }
  }
  const memoryWithRecoveries: OperatorMemory = { ...memory, suppressions: liveSuppressions }

  const suppressed: SuppressedProposal[] = []
  const surviving: Proposal[] = []

  for (const proposal of candidates) {
    const recovery = recoverySuppressed(memoryWithRecoveries, proposal, evaluationDate)
    if (recovery.suppressed) {
      suppressed.push({ proposal, reason: recovery.reason ?? 'recovered' })
      continue
    }

    const cooldown = cooldownVerdict(memory, proposal, evaluationDate)
    if (cooldown.suppressed) {
      suppressed.push({ proposal, reason: cooldown.reason ?? 'inside a cooldown' })
      continue
    }

    surviving.push(cooldown.returning ? { ...proposal, returning: true } : proposal)
  }

  /* -- paused: nothing new, everything already raised stays actionable ----- */

  const visible = memory.paused
    ? surviving.filter((p) => Boolean(memory.seen[p.subjectKey]))
    : surviving

  if (memory.paused) {
    for (const p of surviving) {
      if (!memory.seen[p.subjectKey]) {
        suppressed.push({ proposal: p, reason: 'Mike is off the clock — no new proposals' })
      }
    }
  }

  /* -- rank ---------------------------------------------------------------- */

  // Weights multiply the ranking score and nothing else. Evidence strength is
  // untouched: what the operator prefers changes the ORDER of true things, it
  // never changes whether something is true.
  const tagsFor = (p: Proposal) =>
    Array.from(
      new Set(
        p.subjectIds.flatMap(
          (id) => creatives.find((c) => c.id === id)?.tags ?? [],
        ),
      ),
    )

  const ranked = visible
    .map((p) => ({ p, weighted: p.score * weightFor(memory, p, tagsFor(p)) }))
    .sort((a, b) => b.weighted - a.weighted)
    .map((r) => r.p)

  /* -- caps ---------------------------------------------------------------- */

  const board: Proposal[] = []
  let replaces = 0
  for (const p of ranked) {
    if (board.length >= MAX_ACTIVE_PROPOSALS) break
    if (p.type === 'REPLACE') {
      if (replaces >= MAX_REPLACE_PER_RUN) {
        suppressed.push({ proposal: p, reason: 'one replacement per run — a stronger one leads' })
        continue
      }
      replaces += 1
    }
    board.push(p)
  }

  return {
    proposals: board,
    candidates: ranked,
    ranking: ranked.map((p) => p.id),
    suppressed,
    recoveries,
    notes,
    maturity,
    evaluated,
    relationship: relationshipSummary(memory, evaluationDate, ranked),
    paused: memory.paused,
  }
}

/* ------------------------------ derived views ------------------------------ */

/**
 * THE selector.
 *
 * The header count, the Actions Required tile and the visible cards all read
 * from this one function. When they were three separate counts they disagreed
 * within a week, and a dashboard that contradicts itself in the same viewport
 * is worse than one that says nothing.
 */
export function actionsRequired(output: OperatorOutput): number {
  return output.proposals.length
}

/** Compact creative rows for the narration payload. */
export function creativeSummaries(
  evaluated: EvaluatedCreative[],
): CreativeSummary[] {
  return evaluated.map(({ creative, signals }) => ({
    id: creative.id,
    name: creative.name,
    format: creative.format,
    hookType: creative.hookType,
    tags: creative.tags,
    primaryResultType: creative.primaryResultType,
    audienceTemperature: creative.audienceTemperature,
    totalPrimaryResults: signals.totalPrimaryResults,
    totalSpend: signals.totalSpend,
    costPerResult: signals.costPerResult,
    completeDays: signals.completeDays,
  }))
}

/**
 * Account-level daily rows, complete only, for Mike's wider view.
 *
 * Rolled up per DATE AND RESULT TYPE, never per date alone. A day with 40 leads
 * and 3 booked calls is two rows, because "43 conversions" is a number that
 * describes nothing and would be the one figure on the whole payload capable of
 * making him say something false.
 *
 * Reach is dropped in the roll-up for the same reason it is never summed across
 * days: it deduplicates people, so adding it across creatives overstates it.
 */
export function accountDaily(
  evaluated: EvaluatedCreative[],
  maturity: MaturityReport,
  days = 14,
): DailyMetric[] {
  const rows = new Map<string, DailyMetric>()
  for (const { creative } of evaluated) {
    for (const row of completeDaily(creative.daily, maturity)) {
      const key = `${row.date}::${row.primaryResultType}`
      const existing = rows.get(key)
      if (!existing) {
        rows.set(key, { ...row, reach: undefined })
        continue
      }
      rows.set(key, {
        ...existing,
        spend: existing.spend + row.spend,
        impressions: existing.impressions + row.impressions,
        clicks: existing.clicks + row.clicks,
        primaryResults: existing.primaryResults + row.primaryResults,
      })
    }
  }

  const dates = Array.from(new Set(Array.from(rows.values()).map((r) => r.date)))
    .sort()
    .slice(-days)
  const kept = new Set(dates)

  return Array.from(rows.values())
    .filter((r) => kept.has(r.date))
    .sort((a, b) => (a.date === b.date ? (a.primaryResultType < b.primaryResultType ? -1 : 1) : a.date < b.date ? -1 : 1))
}
