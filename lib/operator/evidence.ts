/**
 * Evidence items — the structured facts a proposal stands on.
 *
 * Every one carries a stable ID, and that ID is the join between the two halves
 * of this system. The maths produces the item. Mike references it by ID to say
 * "this is the bit I'm reading". The card renders the NUMBER from the item and
 * Mike's SENTENCE beside it.
 *
 * Which means the one failure mode that matters most here cannot happen: Mike
 * is never responsible for writing an evidence-row number. He can misread the
 * evidence — that is a judgement, and judgements are his job — but he cannot
 * mistype $186 as $168, because he never types it at all.
 *
 * IDs are derived from what the item IS (its kind plus its subjects), not from
 * when it was made. The same fact about the same creative is the same ID across
 * runs, which is what lets a narration be cached, a validator re-check a claim,
 * and a debug panel trace a numeral back to the field that authorised it.
 */

import { baselineLabel, FALLBACK_NOTES } from '@/lib/operator/baselines'
import { RESULT_LABELS } from '@/lib/creative-status'
import { rangeLabel } from '@/lib/operator/dates'
import type {
  CreativeSignals,
  Evidence,
  EvidenceSource,
  PerformanceBaseline,
  PrimaryResultType,
  TrendWindow,
} from '@/lib/operator/types'

/* --------------------------------- helpers --------------------------------- */

/** Short, stable, filesystem-safe slug for an ID segment. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export function evidenceId(kind: string, subjects: string[]): string {
  return `ev_${kind}_${subjects.map(slug).sort().join('-') || 'account'}`
}

export const money0 = (n: number): string => `$${Math.round(n).toLocaleString()}`
export const money2 = (n: number): string =>
  n >= 100 ? money0(n) : `$${n.toFixed(2).replace(/\.00$/, '')}`
export const pct1 = (n: number): string => `${n.toFixed(1)}%`

/**
 * A signed percentage that never renders "-0%".
 *
 * A movement that rounds away to nothing is flat, and printing a minus sign in
 * front of a zero invites somebody to read a decline into a rounding artefact.
 */
export const signedPct = (n: number): string => {
  const rounded = Math.round(n)
  if (rounded === 0) return '0%'
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

/**
 * Cost labels in running prose.
 *
 * "CPL" is an acronym and stays one; "Cost per Booked Call" is a phrase and
 * lowercases mid-sentence. Blanket `.toLowerCase()` turns the first into "cpl",
 * which reads like a typo in the middle of an otherwise careful sentence.
 */
export const costWord = (type: PrimaryResultType): string => {
  const label = RESULT_LABELS[type].cost
  return label === label.toUpperCase() ? label : label.toLowerCase()
}

const resultWords = (type: PrimaryResultType, n: number) =>
  n === 1 ? RESULT_LABELS[type].one.toLowerCase() : RESULT_LABELS[type].many

/* ------------------------------ item builders ------------------------------ */

function sourceFor(
  s: CreativeSignals,
  extra?: Partial<EvidenceSource>,
): EvidenceSource {
  return {
    creativeIds: [s.creativeId],
    dateRange: { from: s.analysed.from, to: s.analysed.to },
    ...extra,
  }
}

/**
 * Cost per result against the resolved cohort — the single most load-bearing
 * row on any card. It names the comparison in `comparisonValue` rather than
 * leaving "vs baseline" to the reader's imagination.
 */
export function costVsBaselineEvidence(
  s: CreativeSignals,
  baseline: PerformanceBaseline | null,
): Evidence | null {
  if (s.costPerResult === null || !baseline) return null
  const ratio = s.costPerResultVsBaseline
  const delta = ratio !== null ? Math.round((1 - ratio) * 100) : 0

  return {
    id: evidenceId('cost_vs_cohort', [s.creativeId]),
    label: `${RESULT_LABELS[s.primaryResultType].cost} vs cohort median`,
    short: RESULT_LABELS[s.primaryResultType].short,
    rawValue: s.costPerResult,
    displayValue: money2(s.costPerResult),
    comparisonValue: `${money2(baseline.medianCostPerResult)} median for ${baselineLabel(baseline)} — ${
      delta === 0 ? 'level with' : delta > 0 ? `${delta}% cheaper than` : `${Math.abs(delta)}% dearer than`
    } the cohort · ${FALLBACK_NOTES[baseline.fallbackLevel]}`,
    direction: delta > 5 ? 'good' : delta < -5 ? 'bad' : 'neutral',
    source: sourceFor(s, {
      baselineKey: baseline.key,
      dateRange: { from: baseline.from, to: baseline.to },
    }),
  }
}

/** Volume and spend — the sample size, always stated next to the claim. */
export function volumeEvidence(s: CreativeSignals, provisional: boolean): Evidence {
  return {
    id: evidenceId('volume', [s.creativeId]),
    label: 'Results and spend behind the read',
    // Not the result word: the value already ends in it, and a chip reading
    // "LEADS 827 leads" is the same noun twice.
    short: 'Volume',
    rawValue: s.totalPrimaryResults,
    displayValue: `${s.totalPrimaryResults.toLocaleString()} ${resultWords(s.primaryResultType, s.totalPrimaryResults)}`,
    comparisonValue: `${money0(s.totalSpend)} spend across ${s.completeDays} complete ${
      s.completeDays === 1 ? 'day' : 'days'
    } · ${rangeLabel(s.analysed.from, s.analysed.to)}`,
    direction: 'neutral',
    source: sourceFor(s, { provisional }),
  }
}

/** A trend window, rendered with both sides visible and its span named. */
export function trendEvidence(
  s: CreativeSignals,
  window: TrendWindow,
  opts: {
    kind: string
    label: string
    /** The compact chip form — `CTR`, `CPL`. */
    short: string
    /** Which direction is the good one — CTR up is good, cost up is not. */
    goodWhen: 'up' | 'down'
    unit: 'pct' | 'money'
  },
): Evidence | null {
  if (!window.complete || window.percentChange === null) return null
  const fmt = opts.unit === 'money' ? money2 : pct1
  const change = window.percentChange
  const good = opts.goodWhen === 'up' ? change > 0 : change < 0

  return {
    id: evidenceId(opts.kind, [s.creativeId]),
    label: opts.label,
    short: opts.short,
    rawValue: change,
    displayValue: signedPct(change),
    comparisonValue: `${fmt(window.previous)} → ${fmt(window.current)} · ${rangeLabel(
      window.currentRange!.from,
      window.currentRange!.to,
    )} vs ${rangeLabel(window.previousRange!.from, window.previousRange!.to)}`,
    direction: Math.abs(change) < 5 ? 'neutral' : good ? 'good' : 'bad',
    source: sourceFor(s, {
      dateRange: { from: window.previousRange!.from, to: window.currentRange!.to },
    }),
  }
}

/**
 * A window that did NOT resolve, rendered as evidence in its own right.
 *
 * "We could not compare this" is a finding. Leaving it off the card is how a
 * missing confirmation window turns into an assumed flat one.
 */
export function nullWindowEvidence(
  s: CreativeSignals,
  window: TrendWindow,
  opts: { kind: string; label: string; short: string },
): Evidence | null {
  if (window.complete) return null
  return {
    id: evidenceId(opts.kind, [s.creativeId]),
    label: opts.label,
    short: opts.short,
    rawValue: 'not resolved',
    displayValue: 'No comparison available',
    comparisonValue: window.reason ?? 'insufficient delivery in the prior window',
    direction: 'neutral',
    source: sourceFor(s),
  }
}

/** Range-level frequency, explicitly labelled as range-level. */
export function frequencyEvidence(s: CreativeSignals): Evidence | null {
  if (s.currentFrequency === null) return null
  const prev = s.previousFrequency
  return {
    id: evidenceId('frequency', [s.creativeId]),
    label: 'Frequency (range-level, deduplicated reach)',
    short: 'Freq',
    rawValue: s.currentFrequency,
    displayValue: s.currentFrequency.toFixed(1),
    comparisonValue:
      prev !== null
        ? `${prev.toFixed(1)} → ${s.currentFrequency.toFixed(1)} across the last two 7-day windows`
        : 'no prior 7-day window to compare against',
    direction: s.currentFrequency >= 2.5 ? 'bad' : 'neutral',
    source: sourceFor(s),
  }
}

/** Data completeness, surfaced wherever it changes what may be concluded. */
export function completenessEvidence(
  s: CreativeSignals,
  opts: { completeThrough: string; provisionalDates: string[]; attributionWindow: string },
): Evidence | null {
  if (opts.provisionalDates.length === 0 || s.provisionalResults === 0) return null
  const from = opts.provisionalDates[0]
  const to = opts.provisionalDates[opts.provisionalDates.length - 1]
  return {
    id: evidenceId('provisional', [s.creativeId]),
    label: 'Results still attributing',
    short: 'Provisional',
    rawValue: s.provisionalResults,
    displayValue: `${s.provisionalResults.toLocaleString()} ${resultWords(s.primaryResultType, s.provisionalResults)} provisional`,
    comparisonValue: `${rangeLabel(from, to)} sits inside the ${opts.attributionWindow} attribution window · complete through ${rangeLabel(opts.completeThrough, opts.completeThrough)}`,
    direction: 'neutral',
    source: {
      creativeIds: [s.creativeId],
      dateRange: { from, to },
      provisional: true,
    },
  }
}

/** A pattern shared across several creatives — EXPLORE's core row. */
export function groupEvidence(opts: {
  kind: string
  label: string
  short: string
  creativeIds: string[]
  rawValue: number
  displayValue: string
  comparisonValue: string
  direction: Evidence['direction']
  dateRange: { from: string; to: string }
  baselineKey?: PerformanceBaseline['key']
}): Evidence {
  return {
    id: evidenceId(opts.kind, opts.creativeIds),
    label: opts.label,
    short: opts.short,
    rawValue: opts.rawValue,
    displayValue: opts.displayValue,
    comparisonValue: opts.comparisonValue,
    direction: opts.direction,
    source: {
      creativeIds: opts.creativeIds,
      dateRange: opts.dateRange,
      baselineKey: opts.baselineKey,
    },
  }
}

/** What is missing and roughly when it will be there — COLLECT's whole job. */
export function gapEvidence(opts: {
  kind: string
  label: string
  short: string
  creativeIds: string[]
  displayValue: string
  comparisonValue: string
  dateRange: { from: string; to: string }
}): Evidence {
  return {
    id: evidenceId(opts.kind, opts.creativeIds),
    label: opts.label,
    short: opts.short,
    rawValue: opts.displayValue,
    displayValue: opts.displayValue,
    comparisonValue: opts.comparisonValue,
    direction: 'neutral',
    source: { creativeIds: opts.creativeIds, dateRange: opts.dateRange },
  }
}

/** Drop nulls and guarantee ID uniqueness inside one proposal. */
export function collectEvidence(items: (Evidence | null)[]): Evidence[] {
  const seen = new Set<string>()
  const out: Evidence[] = []
  for (const item of items) {
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}
