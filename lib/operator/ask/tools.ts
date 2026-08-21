/**
 * Mike's instruments.
 *
 * The queue narration hands Mike a finished payload and asks him to speak over
 * it. This is the other shape of the same job: an open question he has to go
 * and LOOK to answer. The difference is not conversational polish, it is that
 * he now chooses what to read, and that choice is the thing worth watching.
 *
 * Three properties are load-bearing:
 *
 * **Read-only, enforced.** Every tool here computes over an already-fetched
 * snapshot. None of them writes, and none of them can reach the ad account —
 * `assertReadOnly` throws on any name that is not on the allowlist, so the way
 * this surface grows a publish tool is somebody deliberately editing the
 * allowlist, not somebody wiring a convenient helper into a switch statement.
 *
 * **Every figure is COMPUTED, never remembered.** The tools return the same
 * numbers the rules run on, from the same functions — `computeSignals`,
 * `resolveBaseline`, `assessMaturity`. Mike cannot be handed a figure the
 * dashboard would disagree with, because there is no second implementation for
 * him to be handed it from.
 *
 * **Every result is a fact ledger.** The values a tool returns become the only
 * numerals Mike is permitted to say (`facts.ts`). That is why the results are
 * flat, named JSON rather than prose summaries: a number buried in a sentence
 * cannot authorise anything, and a tool that pre-writes Mike's answer for him
 * is a tool that has taken over the interesting half of his job.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { baselineLabel, resolveBaseline } from '@/lib/operator/baselines'
import { addDays, daysBetween, isSameOrBefore, isValidDate } from '@/lib/operator/dates'
import { assessMaturity, completeDaily } from '@/lib/operator/maturity'
import { computeSignals } from '@/lib/operator/signals'
import type {
  CreativeSnapshot,
  DataSourceMetadata,
  EvaluationContext,
  PerformanceBaseline,
  Proposal,
} from '@/lib/operator/types'
import { searchKnowledge } from '@/lib/knowledge'
import { listOutcomes } from '@/lib/outcomes'

/* ------------------------------- the allowlist ----------------------------- */

/**
 * Every tool Mike may call, and the whole list. Names are checked against this
 * at dispatch, so an unlisted name is a thrown error rather than a silent
 * no-op that Mike then narrates around.
 */
export const ASK_TOOL_NAMES = [
  'list_creatives',
  'creative_performance',
  'compare_to_baseline',
  'account_summary',
  'todays_board',
  'search_knowledge',
  'past_outcomes',
] as const

export type AskToolName = (typeof ASK_TOOL_NAMES)[number]

export class ToolNotPermitted extends Error {
  constructor(name: string) {
    super(
      `"${name}" is not one of Mike's instruments. He reads: ${ASK_TOOL_NAMES.join(', ')}. ` +
        'Nothing on this surface writes, and nothing on it reaches the ad account.',
    )
    this.name = 'ToolNotPermitted'
  }
}

export function assertReadOnly(name: string): AskToolName {
  if (!(ASK_TOOL_NAMES as readonly string[]).includes(name)) throw new ToolNotPermitted(name)
  return name as AskToolName
}

/* ------------------------------- declarations ------------------------------ */

/**
 * The schemas Mike sees.
 *
 * Descriptions are written for the reader who has to CHOOSE between them, so
 * each one says what it is for rather than what it returns. `creative_performance`
 * naming its window default matters more than it looks: without it he asks for
 * 30 days to answer a question about this week and then reasons over a mean
 * that buries the thing he was looking for.
 */
export const ASK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_creatives',
    description:
      'Every creative in the account with its identity and a rolled-up read over complete days: spend, results, cost per result, CTR, days live. Start here when the question names something you have to find first ("the tripwire webinar", "the video ads"), or when it is about the account as a whole.',
    input_schema: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description:
            'Optional case-insensitive match against name, hook type, tags, offer type and format. Omit for everything.',
        },
      },
    },
  },
  {
    name: 'creative_performance',
    description:
      'Day-by-day rows plus the computed signals for one or more creatives: 3v3 and 7v7 trends on CTR and cost per result, stability, range-level frequency (current and previous window), and how much of the read is still inside the attribution delay. This is the tool for "how is X doing" and for anything about a change over time.',
    input_schema: {
      type: 'object',
      properties: {
        creativeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ids from list_creatives. One or several.',
        },
        days: {
          type: 'number',
          description:
            'How many complete days back to return daily rows for. Default 14. The trend windows are always computed on their own fixed 3v3 / 7v7 spans regardless of this.',
        },
      },
      required: ['creativeIds'],
    },
  },
  {
    name: 'compare_to_baseline',
    description:
      'Where a creative sits against its cohort median, and — the part that matters — WHICH cohort answered. Returns the fallback level the resolver had to walk to, every level it rejected and why. Use it before calling anything good or bad: "below median" against an account-wide fallback is a much weaker statement than against an exact cohort.',
    input_schema: {
      type: 'object',
      properties: {
        creativeId: { type: 'string', description: 'Id from list_creatives.' },
      },
      required: ['creativeId'],
    },
  },
  {
    name: 'account_summary',
    description:
      'The account rolled up over a window: spend, results by result type, cost per result, CTR, active creative count, and the data metadata (timezone, attribution window, last sync, how complete the days are). Use it for "how are we doing overall" and to ground any account-level claim.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Complete days back from today. Default 30.' },
      },
    },
  },
  {
    name: 'todays_board',
    description:
      "The decisions already on your queue right now, with their evidence rows, evidence-strength tiering and the reasoning behind each. Use it when the question is about what you are recommending, why a card is there, or what you would do next.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_knowledge',
    description:
      'Semantic search over the Knowledge Vault — frameworks, SOPs, positioning, winning patterns, ad design DNA. Use it for "what have we learned about…", for why something worked, and to ground a creative recommendation in what has actually won before. Returns text, not performance figures.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in plain language.' },
        limit: { type: 'number', description: 'Max results. Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'past_outcomes',
    description:
      'Graded campaign outcomes from strategic memory (ORACLE) — what was launched, what verdict it earned and the attributes behind it. Use it for "has this angle worked before" and to check whether a pattern is repeating.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max rows. Default 20.' },
      },
    },
  },
]

/* --------------------------------- context --------------------------------- */

export interface ToolContext {
  evaluationDate: string
  creatives: CreativeSnapshot[]
  baselines: PerformanceBaseline[]
  metadata: DataSourceMetadata
  /** The board as the operator's own browser computed it. Never recomputed here. */
  board: Proposal[]
}

/** One tool call's outcome, ready to stream and to enter the fact ledger. */
export interface ToolRun {
  name: AskToolName
  /** What the operator sees while it runs — his hand reaching for an instrument. */
  label: string
  result: unknown
  /** A one-line receipt of what came back, for the trace. */
  receipt: string
}

/* --------------------------------- helpers --------------------------------- */

const round = (n: number, dp = 2): number => Number(n.toFixed(dp))

function evaluationContext(ctx: ToolContext): EvaluationContext {
  return { evaluationDate: ctx.evaluationDate, metadata: ctx.metadata }
}

/** Days live, counted the way a person counts them: launch day included. */
function daysLive(creative: CreativeSnapshot, evaluationDate: string): number {
  const launched = creative.launchedAt.slice(0, 10)
  return isValidDate(launched) ? Math.max(0, daysBetween(launched, evaluationDate)) : 0
}

function rollup(creative: CreativeSnapshot, ctx: ToolContext) {
  const rows = completeDaily(creative.daily, assessMaturity(evaluationContext(ctx)))
  const spend = rows.reduce((s, d) => s + d.spend, 0)
  const results = rows.reduce((s, d) => s + d.primaryResults, 0)
  const impressions = rows.reduce((s, d) => s + d.impressions, 0)
  const clicks = rows.reduce((s, d) => s + d.clicks, 0)
  return {
    spend: round(spend),
    results,
    resultType: creative.primaryResultType,
    costPerResult: results > 0 ? round(spend / results) : null,
    ctr: impressions > 0 ? round((clicks / impressions) * 100) : null,
    impressions,
    clicks,
    completeDays: rows.length,
  }
}

function matchesSearch(creative: CreativeSnapshot, needle: string): boolean {
  const haystack = [
    creative.name,
    creative.hookType,
    creative.format,
    creative.offerType ?? '',
    creative.audienceTemperature ?? '',
    creative.market ?? '',
    creative.campaignObjective ?? '',
    ...creative.tags,
  ]
    .join(' ')
    .toLowerCase()
  // Every word has to appear somewhere, so "tripwire webinar" does not match a
  // creative that merely mentions webinars.
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/* ------------------------------- the executor ------------------------------ */

/**
 * Run one tool call.
 *
 * Every branch returns a plain object. Nothing here formats a sentence, adds an
 * adjective, or decides whether a figure is good news — those are Mike's, and a
 * tool that makes them for him produces an answer that sounds like a tool.
 */
export async function runAskTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolRun> {
  const tool = assertReadOnly(name)

  switch (tool) {
    case 'list_creatives': {
      const search = asString(input.search)
      const matched = search ? ctx.creatives.filter((c) => matchesSearch(c, search)) : ctx.creatives
      const creatives = matched.map((c) => ({
        id: c.id,
        name: c.name,
        format: c.format,
        hookType: c.hookType,
        tags: c.tags,
        offerType: c.offerType ?? null,
        audienceTemperature: c.audienceTemperature ?? null,
        launched: c.launchedAt.slice(0, 10),
        daysLive: daysLive(c, ctx.evaluationDate),
        ...rollup(c, ctx),
      }))
      return {
        name: tool,
        label: search ? `Looking for "${search}"` : 'Reading the creative list',
        result: { matched: creatives.length, ofTotal: ctx.creatives.length, creatives },
        receipt:
          creatives.length === 0
            ? search
              ? `nothing matching "${search}"`
              : 'no creatives in the account'
            : `${creatives.length} creative${creatives.length === 1 ? '' : 's'}`,
      }
    }

    case 'creative_performance': {
      const ids = asIds(input.creativeIds)
      const days = Math.max(1, Math.min(90, asNumber(input.days, 14)))
      const maturity = assessMaturity(evaluationContext(ctx))
      const from = addDays(ctx.evaluationDate, -days)

      const found = ctx.creatives.filter((c) => ids.includes(c.id))
      const creatives = found.map((c) => {
        const signals = computeSignals(c, maturity, resolveBaseline(c, ctx.baselines).baseline)
        const rows = completeDaily(c.daily, maturity).filter((d) => !isSameOrBefore(d.date, from))
        return {
          id: c.id,
          name: c.name,
          resultType: c.primaryResultType,
          analysed: signals.analysed,
          completeDays: signals.completeDays,
          spend: round(signals.totalSpend),
          results: signals.totalPrimaryResults,
          costPerResult: signals.costPerResult === null ? null : round(signals.costPerResult),
          ctr: signals.ctr === null ? null : round(signals.ctr),
          stability: signals.stability,
          dailyVariation: signals.dailyVariation === null ? null : round(signals.dailyVariation),
          costPerResultVsBaseline:
            signals.costPerResultVsBaseline === null
              ? null
              : round(signals.costPerResultVsBaseline),
          frequency: {
            current: signals.currentFrequency === null ? null : round(signals.currentFrequency),
            previous: signals.previousFrequency === null ? null : round(signals.previousFrequency),
            rising: signals.frequencyRising,
            note: 'Range-level, deduplicated across the whole window. Never summed from daily reach.',
          },
          trends: signals.trends,
          attribution: {
            provisionalResults: signals.provisionalResults,
            readIsProvisional: signals.resultsAreProvisional,
            maturityDelayHours: ctx.metadata.maturityDelayHours,
          },
          daily: rows.map((d) => ({
            date: d.date,
            spend: round(d.spend),
            impressions: d.impressions,
            clicks: d.clicks,
            results: d.primaryResults,
          })),
        }
      })

      const missing = ids.filter((id) => !found.some((c) => c.id === id))
      return {
        name: tool,
        label:
          found.length === 1
            ? `Pulling ${days} days on ${found[0].name}`
            : `Pulling ${days} days on ${found.length} creatives`,
        result: { creatives, missing },
        receipt:
          found.length === 0
            ? 'no matching creative'
            : `${found.length} read over ${days} days`,
      }
    }

    case 'compare_to_baseline': {
      const id = asString(input.creativeId)
      const creative = ctx.creatives.find((c) => c.id === id)
      if (!creative) {
        return {
          name: tool,
          label: 'Resolving a cohort',
          result: { error: `No creative with id "${id ?? ''}".` },
          receipt: 'no matching creative',
        }
      }
      const resolution = resolveBaseline(creative, ctx.baselines)
      const signals = computeSignals(
        creative,
        assessMaturity(evaluationContext(ctx)),
        resolution.baseline,
      )
      return {
        name: tool,
        label: `Finding the cohort for ${creative.name}`,
        result: {
          creative: { id: creative.id, name: creative.name },
          costPerResult: signals.costPerResult === null ? null : round(signals.costPerResult),
          ctr: signals.ctr === null ? null : round(signals.ctr),
          baseline: resolution.baseline
            ? {
                fallbackLevel: resolution.baseline.fallbackLevel,
                medianCostPerResult: round(resolution.baseline.medianCostPerResult),
                medianCtr: round(resolution.baseline.medianCtr),
                creativeCount: resolution.baseline.creativeCount,
                resultCount: resolution.baseline.resultCount,
                from: resolution.baseline.from,
                to: resolution.baseline.to,
              }
            : null,
          ratioToMedian:
            signals.costPerResultVsBaseline === null
              ? null
              : round(signals.costPerResultVsBaseline),
          comparableCreatives: resolution.comparableCreatives,
          rejectedCohorts: resolution.rejected,
          note: resolution.baseline
            ? 'A comparison is only as strong as the cohort that answered. Say which one did.'
            : 'No cohort was comparable. There is no median to be above or below.',
        },
        // The receipt is read by a person, so it names the cohort the way the
        // rest of the product names it. `result_and_offer` is a field value,
        // not a sentence, and a raw enum on screen is how an interface admits
        // nobody looked at it.
        receipt: resolution.baseline
          ? `${baselineLabel(resolution.baseline)} · ${resolution.baseline.creativeCount} creatives`
          : 'no comparable cohort',
      }
    }

    case 'account_summary': {
      const days = Math.max(1, Math.min(90, asNumber(input.days, 30)))
      const maturity = assessMaturity(evaluationContext(ctx))
      const from = addDays(ctx.evaluationDate, -days)

      const byResultType = new Map<string, { spend: number; results: number }>()
      let spend = 0
      let results = 0
      let impressions = 0
      let clicks = 0
      let active = 0

      for (const creative of ctx.creatives) {
        const rows = completeDaily(creative.daily, maturity).filter(
          (d) => !isSameOrBefore(d.date, from),
        )
        if (rows.length === 0) continue
        active += 1
        for (const row of rows) {
          spend += row.spend
          results += row.primaryResults
          impressions += row.impressions
          clicks += row.clicks
          const bucket = byResultType.get(row.primaryResultType) ?? { spend: 0, results: 0 }
          bucket.spend += row.spend
          bucket.results += row.primaryResults
          byResultType.set(row.primaryResultType, bucket)
        }
      }

      return {
        name: tool,
        label: `Rolling up the last ${days} days`,
        result: {
          window: { from: addDays(from, 1), to: maturity.completeThrough, days },
          spend: round(spend),
          impressions,
          clicks,
          ctr: impressions > 0 ? round((clicks / impressions) * 100) : null,
          activeCreatives: active,
          totalCreatives: ctx.creatives.length,
          // Never blended into one "conversions" figure — each result type
          // carries its own cost, because they are not the same thing.
          byResultType: Array.from(byResultType.entries()).map(([type, v]) => ({
            resultType: type,
            spend: round(v.spend),
            results: v.results,
            costPerResult: v.results > 0 ? round(v.spend / v.results) : null,
          })),
          data: {
            origin: ctx.metadata.origin,
            timezone: ctx.metadata.accountTimezone,
            attributionWindow: ctx.metadata.attributionWindow,
            lastSynced: ctx.metadata.lastSyncedAt,
            completeThrough: ctx.metadata.completeThrough,
          },
        },
        receipt: `${active} active over ${days} days`,
      }
    }

    case 'todays_board': {
      return {
        name: tool,
        label: 'Re-reading my own queue',
        result: {
          count: ctx.board.length,
          proposals: ctx.board.map((p, i) => ({
            rank: i + 1,
            id: p.id,
            type: p.type,
            fatigueState: p.fatigueState ?? null,
            subject: p.subjectLabel,
            subjects: p.subjectNames,
            score: p.score,
            strength: {
              tier: p.strength.tier,
              primaryResults: p.strength.primaryResults,
              completeDays: p.strength.completeDays,
              cohortQuality: p.strength.cohortQuality,
              why: p.strength.reasons,
            },
            reasoning: p.fallback.reasoning,
            evidence: p.evidence.map((e) => ({
              id: e.id,
              label: e.label,
              value: e.displayValue,
              comparison: e.comparisonValue ?? null,
              direction: e.direction,
              provisional: Boolean(e.source.provisional),
            })),
          })),
        },
        receipt: `${ctx.board.length} open decision${ctx.board.length === 1 ? '' : 's'}`,
      }
    }

    case 'search_knowledge': {
      const query = asString(input.query) ?? ''
      const limit = Math.max(1, Math.min(10, asNumber(input.limit, 5)))
      const hits = await searchKnowledge(query, { k: limit }).catch(() => [])
      return {
        name: tool,
        label: `Searching the Vault for "${query}"`,
        result: {
          query,
          hits: hits.map((h) => ({
            system: h.system,
            title: h.title,
            content: h.content.slice(0, 900),
            similarity: typeof h.similarity === 'number' ? round(h.similarity, 3) : null,
          })),
        },
        receipt: `${hits.length} vault result${hits.length === 1 ? '' : 's'}`,
      }
    }

    case 'past_outcomes': {
      const limit = Math.max(1, Math.min(50, asNumber(input.limit, 20)))
      const rows = await listOutcomes(limit).catch(() => [])
      return {
        name: tool,
        label: 'Checking strategic memory',
        result: {
          outcomes: rows.map((r) => ({
            id: r.id,
            angle: r.angle,
            verdict: r.verdict,
            conceptType: r.conceptType,
            recordedAt: r.created_at,
            attributes: r.attributes ?? null,
          })),
        },
        receipt: `${rows.length} graded outcome${rows.length === 1 ? '' : 's'}`,
      }
    }
  }
}
