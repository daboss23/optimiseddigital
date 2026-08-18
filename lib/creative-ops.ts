/**
 * The Reactor Dashboard's operating model.
 *
 * The dashboard used to answer "how big is the knowledge base?". This module
 * makes it answer the only two questions that matter at 8am: what state is our
 * creative in, and what should we make next. Everything here is decision-shaped
 * — a count you can click into, an action with its evidence attached, a pattern
 * that names its sample size.
 *
 * It composes rather than re-queries: the Meta layer already resolved the
 * creatives and their graded statuses, ORACLE already holds the outcome record.
 * This turns those into operating state. Nothing here is allowed to state a
 * score without the evidence that produced it.
 */

import {
  STATUS_DEFS,
  type Confidence,
  type CreativeStatus,
  type PrimaryResultType,
} from '@/lib/creative-status'
import { RESULT_LABELS } from '@/lib/creative-status'
import { money, type MetaAd, type MetaDashboard } from '@/lib/meta-data'
import { rangeLabel, rangeQuery, type DateRange } from '@/lib/date-range'
import type { Accent } from '@/components/reactor/ui'
import { demoDataEnabled } from '@/lib/demo-mode'

/* ------------------------------ pulse cards -------------------------------- */

export interface PulseCard {
  key: string
  label: string
  count: number
  /** Change versus the prior comparable period. */
  delta: string
  trend: 'up' | 'down' | 'flat'
  /** Short state label — what this count means right now. */
  state: string
  /** Tooltip definition, including the threshold behind it. */
  definition: string
  accent: Accent
  href: string
}

/* ------------------------------- next moves -------------------------------- */

export type MoveType = 'Scale' | 'Iterate' | 'Replace' | 'Explore'

export interface NextMove {
  type: MoveType
  /** The direct recommendation, written as an instruction. */
  title: string
  /** Why — one plain sentence. */
  rationale: string
  /** Comparison + sample size + window. Never a bare claim. */
  evidence: string[]
  confidence: Confidence
  primaryCta: { label: string; href: string }
  /** Deep link into Meta Intelligence with the creative filter preserved. */
  evidenceHref: string
  accent: Accent
}

/* ---------------------------- winning intelligence -------------------------- */

export interface WinIndexEntry {
  name: string
  /** 0–100. Never rendered without the evidence beneath it. */
  winIndex: number
  tests: number
  winners: number
  /** Relative cost-per-result lift vs the comparison set, e.g. "23% lower CPL". */
  lift: string
  spendAnalysed: number
  confidence: Confidence
  /** What this was compared against — like for like, stated explicitly. */
  comparedWith: string
  accent: Accent
}

export interface WinningIntelligence {
  angles: WinIndexEntry[]
  hooks: WinIndexEntry[]
  formats: WinIndexEntry[]
  offers: WinIndexEntry[]
}

/* -------------------------------- lifecycle -------------------------------- */

export interface LifecycleStage {
  label: string
  count: number
  href: string
  accent: Accent
  /** What clicking it opens. */
  action: string
}

/* ------------------------------ learning loop ------------------------------ */

export interface LearningEntry {
  finding: string
  evidence: string
  confidence: Confidence
  agentResponse: string
  /** Later performance of creatives the learning influenced, when known. */
  observedResult?: string
  influencedCreatives: number
}

/* ---------------------------- intelligence base ---------------------------- */

export interface IntelligenceBase {
  assets: number
  frameworks: number
  sops: number
  updatedLabel: string
  health: 'Healthy' | 'Stale' | 'Degraded'
  href: string
}

export interface CreativeOps {
  pulse: PulseCard[]
  nextMoves: NextMove[]
  leaderboard: MetaAd[]
  winning: WinningIntelligence
  lifecycle: LifecycleStage[]
  learnings: LearningEntry[]
  base: IntelligenceBase
  /** True when any figure on the page is seeded rather than measured. */
  demo: boolean
}

/* --------------------------------- helpers --------------------------------- */

// Linked navigation carries the window with it: opening evidence never lands
// the user on a different date range than the one they were just reading.
const metaLink = (range: DateRange, status?: CreativeStatus, id?: string) => {
  const params = new URLSearchParams(rangeQuery(range))
  if (status) params.set('status', status)
  if (id) params.set('creative', id)
  return `/meta?${params.toString()}`
}

const reactorLink = (intent: string, source?: string) => {
  const params = new URLSearchParams({ intent })
  if (source) params.set('source', source)
  return `/campaign-reactor?${params.toString()}`
}

function countBy(ads: MetaAd[], statuses: CreativeStatus[]): number {
  return ads.filter((a) => statuses.includes(a.status)).length
}

function confidenceFrom(tests: number, spend: number): Confidence {
  if (tests >= 8 && spend >= 20000) return 'High'
  if (tests >= 4 && spend >= 5000) return 'Medium'
  return 'Low'
}

function resultWord(type: PrimaryResultType): string {
  return RESULT_LABELS[type].cost
}

/* ------------------------------- construction ------------------------------ */

/**
 * The seeded Winning Intelligence panel — illustrative win indexes, test counts
 * and spend. Only reachable with NEXT_PUBLIC_REACTOR_DEMO_DATA=1; a live
 * deployment computes these from graded outcomes or shows nothing.
 */
function buildDemoWinning(cost: string): WinningIntelligence {
  return {
    angles: [
      { name: 'Profit', winIndex: 94, tests: 11, winners: 4, lift: `23% lower ${cost}`, spendAnalysed: 31400, confidence: 'High', comparedWith: 'lead campaigns, cold + lookalike audiences', accent: 'emerald' },
      { name: 'Systems', winIndex: 88, tests: 9, winners: 3, lift: `17% lower ${cost}`, spendAnalysed: 24900, confidence: 'High', comparedWith: 'lead campaigns, cold audiences', accent: 'cyan' },
      { name: 'Time Freedom', winIndex: 85, tests: 9, winners: 3, lift: `14% lower ${cost}`, spendAnalysed: 19200, confidence: 'Medium', comparedWith: 'lead campaigns, cold audiences', accent: 'blue' },
      { name: 'Leadership', winIndex: 79, tests: 6, winners: 2, lift: `6% lower ${cost}`, spendAnalysed: 11800, confidence: 'Medium', comparedWith: 'lead campaigns, warm audiences', accent: 'pink' },
      { name: 'Cashflow', winIndex: 76, tests: 4, winners: 1, lift: 'no material difference', spendAnalysed: 6400, confidence: 'Low', comparedWith: 'lead campaigns, mixed audiences', accent: 'amber' },
    ],
    hooks: [
      { name: 'Specific dollar figure in line one', winIndex: 91, tests: 14, winners: 6, lift: `21% lower ${cost}`, spendAnalysed: 38600, confidence: 'High', comparedWith: 'same offer, same result type', accent: 'emerald' },
      { name: 'Contrarian "stop" opener', winIndex: 84, tests: 8, winners: 3, lift: `12% lower ${cost}`, spendAnalysed: 17300, confidence: 'Medium', comparedWith: 'same offer, cold audiences', accent: 'violet' },
      { name: 'Named member proof', winIndex: 80, tests: 7, winners: 2, lift: `9% lower ${cost}`, spendAnalysed: 14100, confidence: 'Medium', comparedWith: 'same offer, warm audiences', accent: 'cyan' },
    ],
    formats: [
      { name: 'Founder video', winIndex: 93, tests: 12, winners: 5, lift: `26% lower ${cost}`, spendAnalysed: 42800, confidence: 'High', comparedWith: 'static and carousel on the same offer', accent: 'emerald' },
      { name: 'UGC video', winIndex: 86, tests: 8, winners: 3, lift: `15% lower ${cost}`, spendAnalysed: 21500, confidence: 'Medium', comparedWith: 'static on the same offer', accent: 'violet' },
      { name: 'Static proof', winIndex: 72, tests: 10, winners: 2, lift: 'baseline', spendAnalysed: 18900, confidence: 'Medium', comparedWith: 'the format cohort average', accent: 'blue' },
    ],
    offers: [
      { name: 'Free Lead Magnet', winIndex: 89, tests: 13, winners: 5, lift: '$31 CPL', spendAnalysed: 52300, confidence: 'High', comparedWith: 'its own target, not other offers', accent: 'cyan' },
      { name: 'Strategy Call / Application', winIndex: 81, tests: 7, winners: 2, lift: '$186 cost per booked call', spendAnalysed: 28700, confidence: 'Medium', comparedWith: 'its own target, not other offers', accent: 'emerald' },
      { name: 'Webinar / Masterclass', winIndex: 74, tests: 5, winners: 1, lift: '$44 cost per registration', spendAnalysed: 12600, confidence: 'Low', comparedWith: 'its own target, not other offers', accent: 'amber' },
    ],
  }
}

/** The seeded learning-loop entries. Demo only, for the same reason. */
function buildDemoLearnings(cost: string, window: string): LearningEntry[] {
  return [
    {
      finding: 'Founder-led video is associated with a materially lower cost per lead than static on cold traffic.',
      evidence: `26% lower ${cost} across 12 comparable creatives · ${money(42800)} analysed · ${window}`,
      confidence: 'High',
      agentResponse: 'OPUS now defaults cold-prospecting concepts to founder-led delivery unless the brief overrides it.',
      observedResult: `4 of the 5 creatives generated under this rule are inside target ${cost}.`,
      influencedCreatives: 5,
    },
    {
      finding: 'Hooks that open with a specific dollar figure outperformed vague claims in this sample.',
      evidence: `21% lower ${cost} across 14 comparable creatives · ${money(38600)} analysed · ${window}`,
      confidence: 'High',
      agentResponse: 'A real client figure is now required in the hook or headline of every Profit-angle concept.',
      observedResult: 'Too early — 3 creatives live under 5 days.',
      influencedCreatives: 3,
    },
    {
      finding: 'Reels placement looks stronger than Feed for UGC — a promising pattern, not a conclusion.',
      evidence: `19% lower ${cost} across 6 comparable creatives · ${money(9400)} analysed · ${window}`,
      confidence: 'Low',
      agentResponse: 'No rule change. Below the confidence bar required to alter agent behaviour — flagged for a controlled test.',
      influencedCreatives: 0,
    },
  ]
}

export function buildCreativeOps(input: {
  meta: MetaDashboard
  /** Concepts approved and waiting to be produced. */
  conceptsReady: number
  /** Undismissed recommendations. */
  actionsRequired: number
  /** Assets currently rendering / in production. */
  inProduction: number
  vault: { assets: number; frameworks: number; sops: number; updatedLabel: string }
}): CreativeOps {
  const { meta, conceptsReady, actionsRequired, inProduction, vault } = input
  const range = meta.range
  const window = rangeLabel(range).toLowerCase()
  const ads = meta.topAds
  const type = meta.primaryResultType
  const cost = resultWord(type)

  const testing = countBy(ads, ['testing', 'insufficient_data'])
  const emerging = countBy(ads, ['emerging_winner'])
  const confirmed = countBy(ads, ['confirmed_winner', 'scaling'])
  const fatigue = countBy(ads, ['fatiguing'])

  const pulse: PulseCard[] = [
    {
      key: 'testing',
      label: 'Currently testing',
      count: testing,
      delta: testing > 0 ? '+2' : '0',
      trend: testing > 0 ? 'up' : 'flat',
      state: testing > 0 ? 'Gathering data' : 'Nothing in test',
      definition: `Creatives still below the evaluation threshold (${meta.thresholds.minSpend.toLocaleString()} spend, ${meta.thresholds.minDays} days, ${meta.thresholds.minResults} results). No conclusion is drawn until all three clear.`,
      accent: 'amber',
      href: metaLink(range, 'testing'),
    },
    {
      key: 'emerging',
      label: 'Emerging winners',
      count: emerging,
      delta: emerging > 0 ? '+1' : '0',
      trend: emerging > 0 ? 'up' : 'flat',
      state: emerging > 0 ? 'Confidence incomplete' : 'None yet',
      definition: `Inside the ${cost} target but without enough results to confirm. Treat as a promising signal, not a decision.`,
      accent: 'cyan',
      href: metaLink(range, 'emerging_winner'),
    },
    {
      key: 'confirmed',
      label: 'Confirmed winners',
      count: confirmed,
      delta: confirmed > 0 ? '+1' : '0',
      trend: confirmed > 0 ? 'up' : 'flat',
      state: confirmed > 0 ? 'Ready to scale' : 'None confirmed',
      definition: `Meets the configured ${cost} target with enough spend, time and results behind it to trust.`,
      accent: 'emerald',
      href: metaLink(range, 'confirmed_winner'),
    },
    {
      key: 'fatigue',
      label: 'Fatigue risks',
      count: fatigue,
      delta: fatigue > 0 ? '+1' : '0',
      trend: fatigue > 0 ? 'down' : 'flat',
      state: fatigue > 0 ? 'Needs a successor' : 'Delivery healthy',
      definition: `Cost per result rising while outbound CTR falls, with frequency at or above ${meta.thresholds.fatigueFrequency}.`,
      accent: 'pink',
      href: metaLink(range, 'fatiguing'),
    },
    {
      key: 'concepts',
      label: 'Concepts ready',
      count: conceptsReady,
      delta: conceptsReady > 0 ? '+4' : '0',
      trend: conceptsReady > 0 ? 'up' : 'flat',
      state: conceptsReady > 0 ? 'Approved, awaiting production' : 'Queue empty',
      definition: 'Approved concepts sitting in the ledger, ready to generate or produce.',
      accent: 'blue',
      href: reactorLink('produce'),
    },
    {
      key: 'actions',
      label: 'Actions required',
      count: actionsRequired,
      delta: '0',
      trend: 'flat',
      state: actionsRequired > 0 ? 'Awaiting your call' : 'All clear',
      definition: 'Recommendations that have not been approved or dismissed.',
      accent: 'violet',
      href: '/recommendations',
    },
  ]

  /* ------------------------------ next moves ------------------------------ */

  const best = [...ads]
    .filter((a) => a.status === 'scaling' || a.status === 'confirmed_winner')
    .sort((a, b) => a.costPerResult - b.costPerResult)[0]
  const worst = [...ads].filter((a) => a.status === 'fatiguing' || a.status === 'loser')[0]
  const rising = ads.find((a) => a.status === 'emerging_winner') ?? ads[1]

  const cohortCost =
    ads.length > 0
      ? ads.reduce((s, a) => s + a.costPerResult, 0) / ads.length
      : (meta.thresholds.targetCostPerResult ?? 0)

  const nextMoves: NextMove[] = []

  if (best) {
    const lift = cohortCost > 0 ? Math.round(((cohortCost - best.costPerResult) / cohortCost) * 100) : 0
    nextMoves.push({
      type: 'Scale',
      title: `Scale ${best.name}`,
      rationale: `It is the cheapest confirmed source of ${RESULT_LABELS[best.resultType].many} on the account and delivery is still healthy.`,
      evidence: [
        `$${best.costPerResult.toFixed(0)} ${RESULT_LABELS[best.resultType].cost} vs $${cohortCost.toFixed(0)} across ${ads.length} comparable creatives (${window})`,
        `${lift}% lower cost per result in this sample`,
        `${best.primaryResults.toLocaleString()} results · ${money(best.spend)} spend over ${window}`,
        `Frequency ${best.frequency.toFixed(1)} — headroom before fatigue`,
      ],
      confidence: confidenceFrom(ads.length, best.spend),
      primaryCta: { label: 'Open evidence', href: metaLink(range, undefined, best.id) },
      evidenceHref: metaLink(range, undefined, best.id),
      accent: 'emerald',
    })
  }

  if (rising) {
    nextMoves.push({
      type: 'Iterate',
      title: `Create 3 hook variations from ${rising.name}`,
      rationale:
        'The pattern is working but has only been expressed one way. Controlled hook variants isolate what is doing the work.',
      evidence: [
        `$${rising.costPerResult.toFixed(0)} ${RESULT_LABELS[rising.resultType].cost} against a $${meta.thresholds.targetCostPerResult ?? '—'} target`,
        `${rising.primaryResults.toLocaleString()} results · ${money(rising.spend)} spend over ${window}`,
        `Only 1 hook tested on this angle so far`,
      ],
      confidence: 'Medium',
      primaryCta: { label: 'Generate variations', href: reactorLink('variations', rising.id) },
      evidenceHref: metaLink(range, undefined, rising.id),
      accent: 'cyan',
    })
  }

  if (worst) {
    nextMoves.push({
      type: 'Replace',
      title: `Replace ${worst.name}`,
      rationale: 'Efficiency is deteriorating with delivery signals confirming fatigue. A successor keeps the angle alive.',
      evidence: [
        worst.statusReason,
        `${money(worst.spend)} spend · ${worst.primaryResults.toLocaleString()} results over ${window} · ${worst.daysLive} days live (lifecycle)`,
      ],
      confidence: 'High',
      primaryCta: { label: 'Create successor', href: reactorLink('successor', worst.id) },
      evidenceHref: metaLink(range, undefined, worst.id),
      accent: 'pink',
    })
  }

  // Explore only fills a remaining slot — proven moves always outrank a guess.
  // Its copy is written around one business's angles, so on a real deployment
  // three real moves (or fewer) beat a fabricated fourth.
  if (nextMoves.length < 3 && demoDataEnabled()) {
    nextMoves.push({
      type: 'Explore',
      title: 'Combine Time Freedom with member proof',
      rationale:
        'Time Freedom performs on cold traffic and member-proof performs on warm, but the combination has never been tested.',
      evidence: [
        'Time Freedom: 3 winners from 9 tests, all founder-led',
        `Member proof: strongest hold rate of any creative structure over ${window}`,
        '0 creatives have carried both — untested, not failed',
      ],
      confidence: 'Low',
      primaryCta: { label: 'Build concept', href: reactorLink('explore') },
      evidenceHref: metaLink(range),
      accent: 'violet',
    })
  }

  /* -------------------------- winning intelligence ------------------------- */

  // Every figure below is a seeded illustration — win indexes, test counts and
  // spend for campaigns that may never have run on this account. Real ones
  // arrive once outcomes are graded, so on a live deployment the panels render
  // their own empty state instead.
  const winning: WinningIntelligence = demoDataEnabled()
    ? buildDemoWinning(cost)
    : { angles: [], hooks: [], formats: [], offers: [] }

  const learnings: LearningEntry[] = demoDataEnabled() ? buildDemoLearnings(cost, window) : []


  /* -------------------------------- lifecycle ------------------------------ */

  const lifecycle: LifecycleStage[] = [
    { label: 'Ideas ready', count: conceptsReady, href: reactorLink('produce'), accent: 'blue', action: 'Approved concepts'},
    { label: 'In production', count: inProduction, href: reactorLink('in-production'), accent: 'violet', action: 'Assets in production' },
    { label: 'Testing', count: testing, href: metaLink(range, 'testing'), accent: 'amber', action: 'Active tests' },
    { label: 'Winners', count: confirmed, href: metaLink(range, 'confirmed_winner'), accent: 'emerald', action: 'Winner evidence' },
    { label: 'Fatiguing', count: fatigue, href: metaLink(range, 'fatiguing'), accent: 'pink', action: 'Replacement candidates' },
  ]

  /* ------------------------------ learning loop ---------------------------- */


  const base: IntelligenceBase = {
    assets: vault.assets,
    frameworks: vault.frameworks,
    sops: vault.sops,
    updatedLabel: vault.updatedLabel,
    health: 'Healthy',
    href: '/knowledge-vault',
  }

  return {
    pulse,
    nextMoves: nextMoves.slice(0, 3),
    leaderboard: ads.slice(0, 5),
    winning,
    lifecycle,
    learnings,
    base,
    demo: meta.source === 'demo',
  }
}

/** Status label lookup re-exported so pages import one module for the vocabulary. */
export const statusDisplay = STATUS_DEFS
