/**
 * The presentation adapter: proposals → queue rows.
 *
 * Mike thinks deeply backstage and speaks briefly onstage. This file is the
 * stage door. Everything upstream of it is unchanged — the same rules, the same
 * evidence, the same strength tiers — and everything downstream of it renders
 * only what a media buyer needs in order to decide within a few seconds.
 *
 * All the condensing lives HERE rather than in components. Truncation scattered
 * across a row, a chip and a drawer is how three surfaces end up disagreeing
 * about what Mike said, and how one of them quietly starts cutting a sentence
 * mid-number.
 *
 * Nothing is deleted. The full reasoning, every evidence item and the whole
 * comparison methodology stay on the proposal and surface in the drawer. They
 * are simply off the default reading path.
 */

import type {
  Evidence,
  EvidenceStrengthTier,
  NarratedCard,
  Proposal,
  ProposalType,
} from '@/lib/operator/types'

/* --------------------------------- the shape -------------------------------- */

/** REPLACE splits into a real replacement and a watch — they are not the same ask. */
export type QueueFamily = 'REPLACE' | 'ITERATE' | 'EXPLORE' | 'WATCH' | 'COLLECT'

export type QueueConfidence = 'strong' | 'moderate' | 'low'

export interface QueueMetric {
  /** `CPL`, `CTR`, `Freq` — the compact form off the evidence model. */
  label: string
  displayValue: string
  direction: Evidence['direction']
  evidenceId: string
}

export interface MikeQueueItem {
  id: string
  subjectKey: string
  priority: number
  family: QueueFamily
  creativeName: string
  /** Mobile/drawer title. Never more than eight words. */
  title: string
  /** One sentence. Never more than twenty-five words. */
  shortReason: string
  keyMetrics: QueueMetric[]
  confidence: QueueConfidence
  isProvisional: boolean
  returning: boolean
  /**
   * WATCH and COLLECT get their own verb. Calling a non-action "Approve" is how
   * an interface teaches somebody that approving means nothing in particular.
   */
  primaryAction: { label: string; intent: 'draft' | 'acknowledge' }
  /** The underlying proposal, for the drawer and the action handlers. */
  proposal: Proposal
  /** Mike's full words, when he had any. The drawer shows these. */
  narrated: NarratedCard | null
}

/* --------------------------------- copy rules ------------------------------- */

export const MAX_TITLE_WORDS = 8
export const MAX_REASON_WORDS = 25
export const MAX_COLLAPSED_METRICS = 3

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean)

/** Cut to a word budget on a word boundary, never mid-number. */
export function capWords(text: string, max: number): string {
  const parts = words(text)
  if (parts.length <= max) return text.trim()
  return `${parts.slice(0, max).join(' ').replace(/[,;:.]$/, '')}…`
}

/**
 * The first sentence, which is where a competent analyst puts the point.
 *
 * Abbreviations are the trap: splitting naively on a full stop turns "$28.76"
 * into "$28." and "vs." into a sentence end. So the split only fires on a stop
 * followed by whitespace and a capital, and never inside a number.
 */
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  const match = /[.!?](?=\s+[A-Z"'—])/.exec(trimmed)
  if (!match) return trimmed
  return trimmed.slice(0, match.index + 1)
}

/** One sentence, inside the word budget, with its full stop intact. */
export function condenseReason(text: string): string {
  const sentence = capWords(firstSentence(text), MAX_REASON_WORDS)
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`
}

/* -------------------------------- vocabulary -------------------------------- */

export const FAMILY_LABEL: Record<QueueFamily, string> = {
  REPLACE: 'Replace',
  ITERATE: 'Iterate',
  EXPLORE: 'Explore',
  WATCH: 'Watch',
  COLLECT: 'Collect',
}

export const CONFIDENCE_LABEL: Record<QueueConfidence, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  low: 'Early signal',
}

const TIER_TO_CONFIDENCE: Record<EvidenceStrengthTier, QueueConfidence> = {
  STRONG: 'strong',
  MODERATE: 'moderate',
  EARLY_SIGNAL: 'low',
}

export function familyOf(proposal: Proposal): QueueFamily {
  if (proposal.type === 'REPLACE' && proposal.fatigueState === 'WATCH') return 'WATCH'
  return proposal.type as Exclude<QueueFamily, 'WATCH'>
}

/**
 * The primary control.
 *
 * `acknowledge` intents create nothing at all — they set a check-back and clear
 * the row. Only `draft` reaches the Campaign Reactor.
 */
function primaryActionFor(family: QueueFamily): MikeQueueItem['primaryAction'] {
  if (family === 'WATCH') return { label: 'Keep watching', intent: 'acknowledge' }
  if (family === 'COLLECT') return { label: 'Acknowledge', intent: 'acknowledge' }
  return { label: 'Approve', intent: 'draft' }
}

/**
 * A short title for the mobile card and the drawer header.
 *
 * Mike's own recommendation is used when it is short enough to scan; otherwise
 * it is replaced with the computed form rather than truncated, because half a
 * sentence reads like a bug and "Replace Systems Before Scale" does not.
 */
function titleFor(proposal: Proposal, narrated: NarratedCard | null): string {
  const family = familyOf(proposal)
  const computed = `${FAMILY_LABEL[family]} ${proposal.subjectNames[0] ?? 'this creative'}`
  const candidate = narrated?.recommendation?.trim() || proposal.fallback.recommendation
  return words(candidate).length <= MAX_TITLE_WORDS ? candidate : capWords(computed, MAX_TITLE_WORDS)
}

/* --------------------------------- metrics ---------------------------------- */

/**
 * Up to three metrics for the collapsed row.
 *
 * Ordered by what a buyer would look at first: the evidence Mike said he was
 * reading, then anything moving in a direction that matters, then the rest.
 * Deduplicated by short label, because a rapid CTR and a confirmation CTR both
 * render as "CTR" and a row showing it twice looks broken rather than thorough.
 */
export function keyMetricsFor(
  proposal: Proposal,
  narrated: NarratedCard | null,
  limit = MAX_COLLAPSED_METRICS,
): QueueMetric[] {
  const cited = new Set(narrated?.evidenceIds ?? [])

  const ranked = proposal.evidence
    .map((e, index) => ({
      e,
      rank:
        (cited.has(e.id) ? 0 : 10) + (e.direction === 'neutral' ? 5 : 0) + index * 0.01,
    }))
    .sort((a, b) => a.rank - b.rank)

  const seen = new Set<string>()
  const out: QueueMetric[] = []
  for (const { e } of ranked) {
    if (out.length >= limit) break
    // "No comparison available" is a finding for the drawer, not a chip.
    if (typeof e.rawValue === 'string' && e.rawValue === 'not resolved') continue
    if (seen.has(e.short)) continue
    seen.add(e.short)
    out.push({
      label: e.short,
      displayValue: e.displayValue,
      direction: e.direction,
      evidenceId: e.id,
    })
  }
  return out
}

/* ------------------------------- the adapter -------------------------------- */

export function toQueueItem(
  proposal: Proposal,
  narrated: NarratedCard | null,
  priority: number,
): MikeQueueItem {
  const family = familyOf(proposal)
  // Mike's sentence when he wrote one — his machine contract already asks for a
  // single sentence. Otherwise the rule's own short form, which is written to
  // fit the row rather than being the long version with its end cut off.
  const reasoning = narrated?.reasoning?.trim() || proposal.fallback.short

  return {
    id: proposal.id,
    subjectKey: proposal.subjectKey,
    priority,
    family,
    creativeName: proposal.subjectLabel,
    title: titleFor(proposal, narrated),
    shortReason: condenseReason(reasoning),
    keyMetrics: keyMetricsFor(proposal, narrated),
    confidence: TIER_TO_CONFIDENCE[proposal.strength.tier],
    isProvisional: proposal.evidence.some((e) => e.source.provisional),
    returning: proposal.returning ?? false,
    primaryAction: primaryActionFor(family),
    proposal,
    narrated,
  }
}

export function toQueue(
  proposals: Proposal[],
  cardFor: (id: string) => NarratedCard | null,
): MikeQueueItem[] {
  return proposals.map((p, i) => toQueueItem(p, cardFor(p.id), i + 1))
}

/* -------------------------------- summary copy ------------------------------ */

const COUNT_WORDS = ['no', 'One', 'Two', 'Three', 'Four', 'Five']

const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

/** "One creative needs replacing." — the per-family half of the summary. */
const FAMILY_SENTENCE: Record<QueueFamily, (n: number) => string> = {
  REPLACE: (n) =>
    `${countWord(n)} ${n === 1 ? 'creative needs' : 'creatives need'} replacing.`,
  ITERATE: (n) =>
    `${countWord(n)} ${n === 1 ? 'winner deserves' : 'winners deserve'} new variations.`,
  EXPLORE: (n) => `${countWord(n)} ${n === 1 ? 'pattern is' : 'patterns are'} worth testing.`,
  WATCH: (n) => `${countWord(n)} ${n === 1 ? 'creative is' : 'creatives are'} worth watching.`,
  COLLECT: (n) =>
    `${countWord(n)} ${n === 1 ? 'creative needs' : 'creatives need'} more delivery before ${
      n === 1 ? 'it' : 'they'
    } can be judged.`,
}

export interface QueueSummaryCopy {
  headline: string
  supporting: string
}

/**
 * The headline and its supporting line, generated from the queue itself.
 *
 * Deliberately not written by Mike. It is a count and a description of a count,
 * and a model asked to phrase one will eventually phrase it wrongly. His
 * judgement goes into the rows; the arithmetic at the top is arithmetic.
 */
export function summaryCopy(items: MikeQueueItem[]): QueueSummaryCopy {
  if (items.length === 0) {
    return {
      headline: 'Nothing needs your attention today.',
      supporting:
        'Mike is watching the account and will surface a decision when the evidence earns one.',
    }
  }

  const counts = new Map<QueueFamily, number>()
  for (const item of items) counts.set(item.family, (counts.get(item.family) ?? 0) + 1)

  // Ordered the way the queue is, so the supporting line reads down the board.
  const order: QueueFamily[] = ['REPLACE', 'ITERATE', 'EXPLORE', 'WATCH', 'COLLECT']
  const supporting = order
    .filter((family) => counts.has(family))
    .map((family) => FAMILY_SENTENCE[family](counts.get(family)!))
    .join(' ')

  return {
    headline: `Mike found ${items.length} ${
      items.length === 1 ? 'action' : 'actions'
    } worth taking today.`,
    supporting,
  }
}

/**
 * Mike's contextual remark, if he had one worth reading.
 *
 * One sentence, never a paragraph. He is allowed a view on the account; he is
 * not allowed to open the morning with three of them.
 */
export function condenseRemark(remark: string | null | undefined): string | null {
  if (!remark) return null
  const condensed = condenseReason(remark)
  return condensed.length > 1 ? condensed : null
}
