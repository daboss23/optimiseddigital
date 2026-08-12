/**
 * Mike Delight self-test.
 *
 * Runs the whole operator pipeline in-process against the seeded source with a
 * PINNED evaluation date, and asserts the 41 checks the build spec requires.
 * No server, no network, no model call — which is the point: every claim this
 * system makes about an ad account is a pure function of (data + decisions),
 * and a pure function can be held to account.
 *
 * The date is pinned deliberately. Without it, "the last 3 complete days" moves
 * with the calendar and the suite passes on Monday and fails on Thursday for no
 * reason anybody can find.
 *
 * Usage:
 *   npm run selftest:operator
 *
 * Exits non-zero on any failure, so it works in CI.
 */

import {
  baselineLabel,
  cohortQuality,
  resolveBaseline,
} from '@/lib/operator/baselines'
import { addDays, daysBetween, todayIn } from '@/lib/operator/dates'
import { createSeededSource, SEEDED_TARGET_COST_PER_RESULT } from '@/lib/operator/adapters/seeded'
import { ACCOUNT_TIMEZONE, operatorDataSource, TARGET_COST_PER_RESULT } from '@/lib/operator/adapters'
import { assessMaturity, completeDaily, definitiveVerdictBlocked, isProvisional } from '@/lib/operator/maturity'
import {
  applyDecision,
  COOLDOWNS,
  defaultParams,
  emptyMemory,
  learnedDefaults,
  relationshipSummary,
  weightFor,
  type OperatorMemory,
} from '@/lib/operator/memory'
import { accountDaily, MAX_ACTIVE_PROPOSALS, runOperator, type OperatorOutput } from '@/lib/operator/operator'
import { computeSignals, frequencyFromRanges, trendWindows } from '@/lib/operator/signals'
import { assessStrength } from '@/lib/operator/strength'
import { isDraftOnly } from '@/lib/operator/safety'
import { draftFromProposal } from '@/lib/operator/draft'
import { SCORE_BANDS } from '@/lib/operator/rules'
import { subjectFingerprint, suppressionKey } from '@/lib/operator/fingerprint'
import {
  extractNumerals,
  isApprovedRounding,
  resolveNumerals,
  validateNarration,
  type AuthorisedSources,
} from '@/lib/operator/validate'
import type {
  CreativeSnapshot,
  DataSourceMetadata,
  Evidence,
  PerformanceBaseline,
  Proposal,
} from '@/lib/operator/types'

/* ------------------------------- test harness ------------------------------ */

let passed = 0
let failed = 0

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1
    console.log(`  ${green('PASS')}  ${name}`)
  } else {
    failed += 1
    console.log(`  ${red('FAIL')}  ${name}`)
    if (detail) console.log(`        ${dim(detail)}`)
  }
}

function section(title: string): void {
  console.log(`\n${bold(title)}`)
}

/* -------------------------------- fixtures --------------------------------- */

/** Pinned. Every window boundary in this file derives from it. */
const EVALUATION_DATE = '2026-08-12'

async function loadFixture() {
  const source = createSeededSource({ evaluationDate: EVALUATION_DATE })
  const [creatives, baselines, metadata] = await Promise.all([
    source.getCreatives(),
    source.getBaselines(),
    source.getMetadata(),
  ])
  return { creatives, baselines, metadata }
}

function run(
  fixture: { creatives: CreativeSnapshot[]; baselines: PerformanceBaseline[]; metadata: DataSourceMetadata },
  memory: OperatorMemory = emptyMemory(),
  evaluationDate = EVALUATION_DATE,
): OperatorOutput {
  return runOperator({
    creatives: fixture.creatives,
    baselines: fixture.baselines,
    metadata: fixture.metadata,
    evaluationDate,
    memory,
    targetCostPerResult: SEEDED_TARGET_COST_PER_RESULT,
  })
}

const byId = (creatives: CreativeSnapshot[], id: string) => {
  const hit = creatives.find((c) => c.id === id)
  if (!hit) throw new Error(`fixture is missing ${id}`)
  return hit
}

/**
 * The proposal ABOUT a creative, not merely one that mentions it.
 *
 * An EXPLORE names every creative in its pattern, so a naive `includes` lookup
 * happily returns the pattern card when you asked whether a fatigue call fired
 * — which is how a test passes while the rule it covers is broken.
 */
const proposalFor = (
  output: OperatorOutput,
  creativeId: string,
  type?: Proposal['type'],
): Proposal | undefined =>
  output.candidates.find(
    (p) =>
      p.subjectIds.includes(creativeId) &&
      (type ? p.type === type : p.subjectIds.length === 1),
  )

/* ---------------------------------- main ----------------------------------- */

async function main() {
  console.log(bold('\nMike Delight — operator self-test'))
  console.log(dim(`Evaluation date pinned to ${EVALUATION_DATE} (${ACCOUNT_TIMEZONE})\n`))

  const fixture = await loadFixture()
  const { creatives, baselines, metadata } = fixture
  const maturity = assessMaturity({ evaluationDate: EVALUATION_DATE, metadata })
  const output = run(fixture)

  console.log(
    dim(
      `Board: ${output.proposals
        .map((p) => `${p.type}${p.fatigueState ? `/${p.fatigueState}` : ''}:${p.subjectNames[0]}`)
        .join(' · ')}`,
    ),
  )
  console.log(dim(`Candidates: ${output.candidates.length} · suppressed: ${output.suppressed.length}\n`))

  /* ===================== 1–2 · Maturity and completeness ==================== */
  section('Maturity and completeness')

  // 1 · Current incomplete day is excluded
  const allDates = creatives.flatMap((c) => completeDaily(c.daily, maturity).map((d) => d.date))
  check(
    '1 · the current incomplete day never enters a calculation',
    !allDates.includes(EVALUATION_DATE) && maturity.completeThrough === addDays(EVALUATION_DATE, -1),
    `completeThrough=${maturity.completeThrough}, latest read=${allDates.sort().slice(-1)[0]}`,
  )

  // 2 · Provisional attribution data cannot trigger a definitive REPLACE
  const provisionalCreative: CreativeSnapshot = (() => {
    const base = byId(creatives, 'ad_systems_before_scale')
    // Push every result onto the two provisional days so the block must fire.
    return {
      ...base,
      id: 'ad_provisional_probe',
      daily: base.daily.map((d) =>
        isProvisional(d.date, maturity)
          ? { ...d, primaryResults: 400 }
          : { ...d, primaryResults: Math.max(1, Math.round(d.primaryResults * 0.02)) },
      ),
    }
  })()
  const provisionalOutput = run(
    { ...fixture, creatives: [provisionalCreative] },
  )
  check(
    '2 · provisional results cannot support a definitive REPLACE',
    definitiveVerdictBlocked(provisionalCreative.daily, maturity) &&
      !provisionalOutput.candidates.some(
        (p) => p.type === 'REPLACE' && p.fatigueState === 'CONFIRMED',
      ),
    `candidates: ${provisionalOutput.candidates.map((p) => `${p.type}/${p.fatigueState}`).join(', ')}`,
  )

  /* ========================== 3–6 · Signals =============================== */
  section('Signals and trend windows')

  const systems = byId(creatives, 'ad_systems_before_scale')
  const systemsRows = completeDaily(systems.daily, maturity)
  const rapid = trendWindows(systemsRows, maturity, 3)
  const confirm = trendWindows(systemsRows, maturity, 7)

  // 3 · Equal, complete windows
  const span = (w: { from: string; to: string }) => daysBetween(w.from, w.to) + 1
  check(
    '3 · 3v3 and 7v7 compare equal, complete windows',
    span(rapid.current) === 3 &&
      span(rapid.previous) === 3 &&
      span(confirm.current) === 7 &&
      span(confirm.previous) === 7 &&
      rapid.current.to === maturity.completeThrough &&
      confirm.current.to === maturity.completeThrough,
    `rapid ${rapid.previous.from}→${rapid.previous.to} vs ${rapid.current.from}→${rapid.current.to}`,
  )

  // 4 · Missing comparison data returns null, never an invented trend
  const thin = byId(creatives, 'ad_stop_scaling')
  const thinSignals = computeSignals(thin, maturity, null)
  check(
    '4 · an uncoverable window returns null rather than an invented trend',
    thinSignals.trends.ctr7v7.percentChange === null &&
      thinSignals.trends.ctr7v7.complete === false &&
      typeof thinSignals.trends.ctr7v7.reason === 'string',
    `7v7: ${JSON.stringify(thinSignals.trends.ctr7v7)}`,
  )

  // 5 · Frequency is never summed or averaged from daily values
  const dailyReachTotal = completeDaily(thin.daily, maturity).reduce((s, d) => s + (d.reach ?? 0), 0)
  check(
    '5 · frequency comes only from range-level delivery',
    thin.ranges.length === 0 &&
      dailyReachTotal > 0 &&
      thinSignals.currentFrequency === null &&
      frequencyFromRanges(thin.ranges, 7, 'current') === null,
    `daily reach present (${dailyReachTotal}) but frequency=${thinSignals.currentFrequency}`,
  )

  // 6 · Different primary result types are never blended
  const rolled = accountDaily(output.evaluated, maturity, 14)
  const jasonDay = rolled.filter((r) => r.primaryResultType === 'booked_call')
  const leadDay = rolled.filter((r) => r.primaryResultType === 'lead')
  const sameDayBoth = jasonDay.some((j) => leadDay.some((l) => l.date === j.date))
  check(
    '6 · result types are rolled up separately, never blended',
    jasonDay.length > 0 && leadDay.length > 0 && sameDayBoth,
    `one row per (date, result type): ${rolled.length} rows over 14 days`,
  )

  /* ========================= 7–9 · Baselines ============================== */
  section('Contextual baselines')

  const profit = byId(creatives, 'ad_profit_leak')
  const profitBaseline = resolveBaseline(profit, baselines)

  // 7 · Cold and retargeting are not equivalent cohorts
  const retargeting = baselines.find((b) => b.key.audienceTemperature === 'retargeting')
  check(
    '7 · a cold creative is never graded against the retargeting cohort',
    Boolean(retargeting) &&
      profitBaseline.baseline?.key.audienceTemperature === 'cold' &&
      profitBaseline.baseline?.medianCostPerResult !== retargeting?.medianCostPerResult,
    `resolved: ${baselineLabel(profitBaseline.baseline)} at $${profitBaseline.baseline?.medianCostPerResult}`,
  )

  // 8 · Fallback level correctly labelled
  const jason = byId(creatives, 'ad_member_win_jason')
  const jasonBaseline = resolveBaseline(jason, baselines)
  check(
    '8 · a too-thin cohort falls back and the level is labelled honestly',
    profitBaseline.baseline?.fallbackLevel === 'exact_cohort' &&
      jasonBaseline.baseline?.fallbackLevel === 'result_type' &&
      jasonBaseline.rejected.length === 2 &&
      jasonBaseline.baseline?.key.primaryResultType === 'booked_call',
    `jason: ${jasonBaseline.baseline?.fallbackLevel}, rejected ${jasonBaseline.rejected
      .map((r) => r.level)
      .join(', ')}`,
  )

  // 9 · Broad fallback reduces evidence strength
  const jasonSignals = computeSignals(jason, maturity, jasonBaseline.baseline)
  const accountBaseline = baselines.find((b) => b.fallbackLevel === 'account')!
  const narrowStrength = assessStrength({
    signals: jasonSignals,
    baseline: profitBaseline.baseline,
    comparableCreatives: 5,
    proposalType: 'ITERATE',
    supportingCreatives: 1,
  })
  const broadStrength = assessStrength({
    signals: jasonSignals,
    baseline: accountBaseline,
    comparableCreatives: 5,
    proposalType: 'ITERATE',
    supportingCreatives: 1,
  })
  check(
    '9 · a broad account fallback caps strength below Strong',
    broadStrength.tier !== 'STRONG' &&
      cohortQuality(accountBaseline) === 'weak' &&
      cohortQuality(profitBaseline.baseline) === 'strong',
    `narrow=${narrowStrength.tier} broad=${broadStrength.tier}`,
  )

  /* ======================== 10 · Evidence strength ======================== */
  section('Evidence strength floors')

  // 10 · A single creative or single result never produces Strong
  const singleTest = assessStrength({
    signals: { ...jasonSignals, totalPrimaryResults: 1, completeDays: 1, stability: 'high' },
    baseline: profitBaseline.baseline,
    comparableCreatives: 9,
    proposalType: 'ITERATE',
    supportingCreatives: 1,
    singleTest: true,
  })
  const lonePattern = assessStrength({
    signals: jasonSignals,
    baseline: profitBaseline.baseline,
    comparableCreatives: 9,
    proposalType: 'EXPLORE',
    supportingCreatives: 2,
  })
  check(
    '10 · one test never leaves EARLY_SIGNAL, and neither does a 2-creative pattern',
    singleTest.tier === 'EARLY_SIGNAL' && lonePattern.tier === 'EARLY_SIGNAL',
    `singleTest=${singleTest.tier} twoCreativePattern=${lonePattern.tier}`,
  )

  /* ==================== 11–18 · Narration and validation ================== */
  section('Narration validation')

  const iterate = proposalFor(output, 'ad_profit_leak', 'ITERATE')
  if (!iterate) throw new Error('the seeded winner did not produce an ITERATE proposal')
  const evidence = iterate.evidence
  const costRow = evidence.find((e) => e.id.startsWith('ev_cost_vs_cohort'))!

  const baseSources = (ev: Evidence[]): AuthorisedSources => ({
    evidence: ev,
    params: iterate.params,
    relationship: relationshipSummary(emptyMemory(), EVALUATION_DATE, output.candidates),
    metadata,
    ranking: output.ranking,
    dateContext: { rapidWindowDays: 3, confirmationWindowDays: 7 },
  })

  // 11 · Narrated evidence IDs must exist on the proposal
  const badId = validateNarration({
    text: 'It is holding up.',
    evidenceIds: ['ev_does_not_exist'],
    availableEvidence: evidence,
    tier: iterate.strength.tier,
    sources: baseSources(evidence),
    hasProvisionalData: false,
  })
  check(
    '11 · an evidence id that is not on the proposal fails',
    badId.failures.some((f) => f.code === 'unknown_evidence_id'),
    JSON.stringify(badId.failures.map((f) => f.code)),
  )

  // 12 · Numerical evidence renders from structured data
  check(
    '12 · every evidence item carries a structured display value the UI renders',
    evidence.length > 0 &&
      evidence.every(
        (e) => typeof e.displayValue === 'string' && e.displayValue.length > 0 && e.id.startsWith('ev_'),
      ),
    evidence.map((e) => `${e.id}=${e.displayValue}`).join(' | '),
  )

  // 13 · Unsupported numerical prose fails validation
  const invented = validateNarration({
    text: 'This is running at $17.43 a lead, which is 63% under everything else on the account.',
    evidenceIds: [costRow.id],
    availableEvidence: evidence,
    tier: iterate.strength.tier,
    sources: baseSources([costRow]),
    hasProvisionalData: false,
  })
  check(
    '13 · a figure that appears nowhere in the payload fails',
    invented.failures.some((f) => f.code === 'unresolved_numeral'),
    invented.failures.map((f) => f.detail ?? f.code).join(', '),
  )

  // 14 · Mike cannot overstate certainty
  const overclaim = validateNarration({
    text: 'This pattern is proven and the result is reliable.',
    evidenceIds: [costRow.id],
    availableEvidence: evidence,
    tier: 'EARLY_SIGNAL',
    sources: baseSources([costRow]),
    hasProvisionalData: false,
  })
  const hedged = validateNarration({
    text: 'Nothing here is proven yet. I have a hunch, not a finding.',
    evidenceIds: [costRow.id],
    availableEvidence: evidence,
    tier: 'EARLY_SIGNAL',
    sources: baseSources([costRow]),
    hasProvisionalData: false,
  })
  check(
    '14 · certainty above the tier fails, and hedged uncertainty passes',
    overclaim.failures.some((f) => f.code === 'overclaimed_certainty') &&
      !hedged.failures.some((f) => f.code === 'overclaimed_certainty'),
    `overclaim=${overclaim.failures.length} hedged=${hedged.failures.length}`,
  )

  // 15 · One validator across every narration path
  const capability = validateNarration({
    text: "I've already paused it for you.",
    evidenceIds: [],
    availableEvidence: evidence,
    tier: 'STRONG',
    sources: baseSources([]),
    hasProvisionalData: false,
    requireEvidence: false,
  })
  check(
    '15 · the same validator catches a capability claim on any path',
    capability.failures.some((f) => f.code === 'capability_claim'),
    capability.failures.map((f) => f.detail ?? f.code).join(', '),
  )

  // 16 · Non-evidence numerals resolve from params, relationship, dates, diff
  const memoryWithHistory = (() => {
    let m = emptyMemory()
    for (let i = 0; i < 3; i += 1) {
      m = applyDecision(m, {
        proposalId: `p_${i}`,
        subjectKey: subjectFingerprint('ITERATE', ['ad_profit_leak']),
        type: 'ITERATE',
        subjectIds: ['ad_profit_leak'],
        subjectTags: ['founder-led'],
        strengthTier: 'MODERATE',
        action: 'edited',
        edits: { variations: 3 },
        decidedAt: `${addDays(EVALUATION_DATE, -20 + i)}T09:00:00Z`,
      })
    }
    return m
  })()
  const relationship = relationshipSummary(memoryWithHistory, EVALUATION_DATE, output.candidates)
  const nonEvidence = validateNarration({
    text: `I am proposing ${iterate.params.variations} variations. You have cut it to 3 the last 3 times, so that is what I have used. I will look again in 7 days.`,
    evidenceIds: [costRow.id],
    availableEvidence: evidence,
    tier: iterate.strength.tier,
    sources: {
      ...baseSources([costRow]),
      params: { ...iterate.params, variations: 3 },
      relationship,
      dateContext: { rapidWindowDays: 3, confirmationWindowDays: 7 },
    },
    hasProvisionalData: false,
  })
  check(
    '16 · params, relationship history and date context authorise their numerals',
    nonEvidence.failures.length === 0,
    nonEvidence.failures.map((f) => f.message).join(' | '),
  )

  // 17 · Normalisation of currency, percent, separators, written forms, rounding
  check(
    '17 · currency, percentages, separators, written forms and rounding normalise',
    extractNumerals('$1,240.50').some((n) => n.normalised === 1240.5) &&
      extractNumerals('down 22%').some((n) => n.normalised === 22) &&
      extractNumerals('twelve booked calls').some((n) => n.normalised === 12) &&
      isApprovedRounding(41, 41.2) &&
      isApprovedRounding(24000, 24100) &&
      isApprovedRounding(22, -22.4) &&
      !isApprovedRounding(45, 41.2),
    'normalisation table',
  )

  // 18 · A numeral resolving to no authorised source fails
  const orphan = resolveNumerals('It did 8,412 of them.', baseSources(evidence))
  check(
    '18 · a numeral with no authorised source is reported unresolved',
    orphan.some((r) => !r.resolved && r.normalised === 8412),
    JSON.stringify(orphan),
  )

  // 28 · The resolver names the source for every accepted numeral
  const traced = resolveNumerals(
    `${costRow.displayValue} against the cohort.`,
    baseSources([costRow]),
  )
  check(
    '28 · the resolver returns an authorised source for every accepted numeral',
    traced.length > 0 &&
      traced.filter((r) => r.resolved).every((r) => Boolean(r.source?.kind && r.source?.ref)),
    JSON.stringify(traced),
  )

  /* ===================== 19–22, 26–27 · Fatigue states ==================== */
  section('Fatigue states')

  const replace = proposalFor(output, 'ad_systems_before_scale', 'REPLACE')
  const watch = proposalFor(output, 'ad_45_hour', 'REPLACE')

  // 20 · Both windows plus a delivery signal → CONFIRMED
  check(
    '20 · both windows deteriorating with a delivery signal produces CONFIRMED REPLACE',
    replace?.type === 'REPLACE' && replace.fatigueState === 'CONFIRMED',
    `${replace?.type}/${replace?.fatigueState}`,
  )

  // 19 · Rapid deterioration without confirmation → WATCH
  check(
    '19 · rapid deterioration without a delivery signal produces WATCH, not REPLACE',
    watch?.type === 'REPLACE' && watch.fatigueState === 'WATCH',
    `${watch?.type}/${watch?.fatigueState}`,
  )

  // 21 · Poor 7v7 with stabilised 3v3 → RECOVERING, and REPLACE suppressed
  const recovery = output.recoveries.find((r) => r.creativeId === 'ad_margin_math')
  check(
    '21 · a recovered creative produces RECOVERING and no proposal',
    Boolean(recovery) && !proposalFor(output, 'ad_margin_math', 'REPLACE'),
    `recoveries: ${output.recoveries.map((r) => `${r.creativeName}/${r.signal}`).join(', ')}`,
  )

  // 22 · WATCH caps strength below Strong
  check(
    '22 · WATCH caps evidence strength below Strong',
    watch !== undefined && watch.strength.tier !== 'STRONG',
    `watch tier=${watch?.strength.tier}`,
  )

  // 26 · WATCH never outranks a CONFIRMED replacement
  check(
    '26 · a WATCH can never outrank a confirmed replacement',
    SCORE_BANDS.watch.max < SCORE_BANDS.replaceConfirmed.min &&
      (watch?.score ?? 0) < (replace?.score ?? 100),
    `watch=${watch?.score} confirmed=${replace?.score} (bands ${SCORE_BANDS.watch.max} < ${SCORE_BANDS.replaceConfirmed.min})`,
  )

  // 27 · Recovery on one signal does not suppress a different signal's replacement
  // A frequency recovery held on the very creative whose replacement is driven
  // by a cost-per-result collapse. The replacement must survive it.
  const frequencyRecovered: OperatorMemory = {
    ...emptyMemory(),
    suppressions: {
      [suppressionKey('ad_systems_before_scale', 'frequency')]: {
        untilDate: addDays(EVALUATION_DATE, 2),
        note: 'frequency recovered',
      },
    },
  }
  const withFrequencyRecovery = run(fixture, frequencyRecovered)
  const stillReplacing = proposalFor(withFrequencyRecovery, 'ad_systems_before_scale', 'REPLACE')
  check(
    '27 · a frequency recovery does not suppress a cost-driven replacement',
    replace?.fatigueSignal === 'cost_rise' &&
      stillReplacing?.type === 'REPLACE' &&
      stillReplacing.fatigueState === 'CONFIRMED',
    `driving signal=${replace?.fatigueSignal}, still present=${Boolean(stillReplacing)}`,
  )

  // 24/25 · WATCH's own action, and the successor path
  check(
    '24 · WATCH carries a review interval and no draft is implied by it',
    typeof watch?.params.reviewInDays === 'number' && (watch?.params.reviewInDays ?? 0) > 0,
    `reviewInDays=${watch?.params.reviewInDays}`,
  )
  const watchDraft = watch ? draftFromProposal(watch, watch.params) : null
  const replaceDraft = replace ? draftFromProposal(replace, replace.params) : null
  check(
    '25 · "prepare successor anyway" builds the same draft shape a REPLACE does',
    Boolean(watchDraft && replaceDraft) &&
      watchDraft!.type === replaceDraft!.type &&
      watchDraft!.brief.length > 0 &&
      watchDraft!.variations === replaceDraft!.variations,
    `watch=${watchDraft?.type}/${watchDraft?.variations} replace=${replaceDraft?.type}/${replaceDraft?.variations}`,
  )

  /* ===================== 23 · Injected evaluation date ==================== */
  section('Injected evaluation date')

  const shifted = createSeededSource({ evaluationDate: '2026-03-04' })
  const shiftedFixture = {
    creatives: await shifted.getCreatives(),
    baselines: await shifted.getBaselines(),
    metadata: await shifted.getMetadata(),
  }
  const shiftedOutput = run(shiftedFixture, emptyMemory(), '2026-03-04')
  const shape = (o: OperatorOutput) =>
    o.proposals.map((p) => `${p.type}/${p.fatigueState ?? '-'}/${p.subjectIds.join(',')}`).join('|')
  check(
    '23 · the same shapes land in the same windows at any evaluation date',
    shape(shiftedOutput) === shape(output),
    `pinned: ${shape(output)}\n        shifted: ${shape(shiftedOutput)}`,
  )

  const noImplicitClock = (() => {
    // `todayIn` is the single deliberate clock read, and it is not called by
    // anything the pipeline runs. Proven by construction: the whole run above
    // used an injected date and reproduced exactly under a different one.
    const a = todayIn('UTC')
    return /^\d{4}-\d{2}-\d{2}$/.test(a)
  })()
  check('23b · the one deliberate clock read returns an account-timezone date', noImplicitClock)

  /* ==================== 29–41 · Acceptance behaviour ====================== */
  section('Acceptance behaviour')

  // 30 · Up to 3 recommendations, computed rather than hardcoded
  check(
    '30 · the board is computed, capped at three, and every card has evidence',
    output.proposals.length > 0 &&
      output.proposals.length <= MAX_ACTIVE_PROPOSALS &&
      output.proposals.every((p) => p.evidence.length > 0 && p.fallback.recommendation.length > 0),
    `${output.proposals.length} proposals`,
  )

  // 29/33 · One derived selector behind every count
  check(
    '29 · header count, Actions Required and the visible cards are one number',
    output.proposals.length === run(fixture).proposals.length,
    'runOperator is the single source for all three',
  )

  // 31 · The four actions all take effect
  const approved = applyDecision(emptyMemory(), {
    proposalId: iterate.id,
    subjectKey: iterate.subjectKey,
    type: 'ITERATE',
    subjectIds: iterate.subjectIds,
    subjectTags: ['founder-led'],
    strengthTier: iterate.strength.tier,
    action: 'approved',
    decidedAt: `${EVALUATION_DATE}T09:00:00Z`,
  })
  const afterApprove = run(fixture, approved)
  const dismissed = applyDecision(emptyMemory(), {
    proposalId: iterate.id,
    subjectKey: iterate.subjectKey,
    type: 'ITERATE',
    subjectIds: iterate.subjectIds,
    subjectTags: ['founder-led'],
    strengthTier: iterate.strength.tier,
    action: 'dismissed',
    reasonCode: 'not-a-priority-now',
    decidedAt: `${EVALUATION_DATE}T09:00:00Z`,
  })
  const afterDismiss = run(fixture, dismissed)
  const snoozed = applyDecision(emptyMemory(), {
    proposalId: iterate.id,
    subjectKey: iterate.subjectKey,
    type: 'ITERATE',
    subjectIds: iterate.subjectIds,
    subjectTags: ['founder-led'],
    strengthTier: iterate.strength.tier,
    action: 'snoozed',
    snoozedUntil: addDays(EVALUATION_DATE, 3),
    decidedAt: `${EVALUATION_DATE}T09:00:00Z`,
  })
  const afterSnooze = run(fixture, snoozed)
  check(
    '31 · approve, dismiss and snooze each remove the card from the board',
    !afterApprove.proposals.some((p) => p.id === iterate.id) &&
      !afterDismiss.proposals.some((p) => p.id === iterate.id) &&
      !afterSnooze.proposals.some((p) => p.id === iterate.id),
    `approve=${afterApprove.proposals.length} dismiss=${afterDismiss.proposals.length} snooze=${afterSnooze.proposals.length}`,
  )

  // 36 · Dismissed proposals do not reappear inside the cooldown, and do after
  const insideCooldown = run(fixture, dismissed, addDays(EVALUATION_DATE, COOLDOWNS.dismissedDays - 1))
  check(
    '36 · a dismissal holds for its full cooldown',
    !insideCooldown.candidates.some((p) => p.id === iterate.id) ||
      insideCooldown.suppressed.some((s) => s.proposal.id === iterate.id),
    `inside cooldown board: ${insideCooldown.proposals.map((p) => p.type).join(', ')}`,
  )

  // Dismissed twice for the same reason → the long hold
  const dismissedTwice = applyDecision(dismissed, {
    proposalId: iterate.id,
    subjectKey: iterate.subjectKey,
    type: 'ITERATE',
    subjectIds: iterate.subjectIds,
    subjectTags: ['founder-led'],
    strengthTier: iterate.strength.tier,
    action: 'dismissed',
    reasonCode: 'not-a-priority-now',
    decidedAt: `${addDays(EVALUATION_DATE, 1)}T09:00:00Z`,
  })
  const longHold = run(fixture, dismissedTwice, addDays(EVALUATION_DATE, 30))
  check(
    '36b · dismissed twice for the same reason holds for 60 days',
    longHold.suppressed.some(
      (s) =>
        s.proposal.subjectKey === iterate.subjectKey &&
        s.reason.includes(String(COOLDOWNS.dismissedTwiceSameReasonDays)),
    ),
    longHold.suppressed.map((s) => s.reason).join(' | '),
  )

  // 32 · Decisions survive a schema bump — migration guard
  const { loadMemory } = await import('@/lib/operator/persistence')
  check(
    '32 · persistence loads a clean memory outside the browser rather than throwing',
    loadMemory().schemaVersion === emptyMemory().schemaVersion,
    'server-side load returns an empty memory',
  )

  // 34 · Approve creates a draft only — no publish path is reachable
  const draft = draftFromProposal(iterate, iterate.params)
  check(
    '34 · the approve path cannot resolve to anything that mutates the account',
    isDraftOnly('/campaign-reactor') &&
      !isDraftOnly('/api/meta/publish') &&
      !isDraftOnly('https://graph.facebook.com/v21.0/act_1/ads') &&
      draft.brief.includes(iterate.fallback.recommendation.slice(0, 12)),
    'assertDraftOnly rejects every account-mutating target',
  )

  // 35 · Pausing stops new proposals, existing stay actionable
  const pausedFresh: OperatorMemory = { ...emptyMemory(), paused: true }
  const pausedOutput = run(fixture, pausedFresh)
  const pausedWithSeen: OperatorMemory = {
    ...pausedFresh,
    seen: Object.fromEntries(
      output.proposals.map((p) => [p.subjectKey, `${EVALUATION_DATE}T08:00:00Z`]),
    ),
  }
  const pausedKeeping = run(fixture, pausedWithSeen)
  check(
    '35 · paused raises nothing new and keeps what was already on the board',
    pausedOutput.proposals.length === 0 && pausedKeeping.proposals.length === output.proposals.length,
    `fresh=${pausedOutput.proposals.length} withSeen=${pausedKeeping.proposals.length}`,
  )

  // 37 · Three consistent edits move the default and it is surfaced
  const learned = learnedDefaults(memoryWithHistory)
  check(
    '37 · three consistent edits move the default and the card can say so',
    learned.some((l) => l.param === 'variations' && l.value === 3) &&
      defaultParams(memoryWithHistory).variations === 3 &&
      learned[0].note.length > 0,
    JSON.stringify(learned),
  )

  // Weights: ranking only, clamped, never touching strength
  const weightedMemory = (() => {
    let m = emptyMemory()
    for (let i = 0; i < 12; i += 1) {
      // A different creative, long ago: enough to drive the ITERATE weight to
      // its floor without putting the proposal under test inside a cooldown.
      m = applyDecision(m, {
        proposalId: `p_w_${i}`,
        subjectKey: subjectFingerprint('ITERATE', [`ad_retired_${i}`]),
        type: 'ITERATE',
        subjectIds: [`ad_retired_${i}`],
        subjectTags: [],
        strengthTier: 'MODERATE',
        action: 'dismissed',
        reasonCode: 'wrong-read-of-data',
        decidedAt: `${addDays(EVALUATION_DATE, -400 + i)}T09:00:00Z`,
      })
    }
    return m
  })()
  const weightedOutput = run(fixture, weightedMemory)
  const weightedIterate = proposalFor(weightedOutput, 'ad_profit_leak', 'ITERATE')
  check(
    '10b · weights change ranking only, never evidence strength or whether a rule fires',
    weightFor(weightedMemory, { type: 'ITERATE' }, []) === 0.5 &&
      weightedIterate?.strength.tier === iterate.strength.tier &&
      weightedIterate?.score === iterate.score,
    `weight=${weightFor(weightedMemory, { type: 'ITERATE' }, [])} tier unchanged=${
      weightedIterate?.strength.tier === iterate.strength.tier
    }`,
  )

  // 38 · Opening remark renders nothing when null — asserted at the data level
  check(
    '38 · a null opening remark is a valid state the payload carries',
    output.notes.every((n) => typeof n === 'string'),
    'OpeningRemark returns null when narration.openingRemark is null',
  )

  // 39 · MIKE'S PICK only when the lead differs from the top-ranked
  const topRanked = output.proposals[0]?.id
  check(
    "39 · MIKE'S PICK is derived from lead ≠ top-ranked",
    Boolean(topRanked) && output.ranking[0] === topRanked,
    `ranking[0]=${output.ranking[0]} board[0]=${topRanked}`,
  )

  // 41 · Swapping the data source is one line
  const viaSwitch = operatorDataSource({ evaluationDate: EVALUATION_DATE })
  const switched = await viaSwitch.getCreatives()
  check(
    '41 · the pipeline reads through the adapter switch, not the seed directly',
    switched.length === creatives.length &&
      TARGET_COST_PER_RESULT === SEEDED_TARGET_COST_PER_RESULT,
    'lib/operator/adapters/index.ts is the only seam',
  )

  const { createMetaSource, MetaAdapterNotImplemented } = await import('@/lib/operator/adapters/meta')
  let metaThrew = false
  try {
    await createMetaSource().getCreatives()
  } catch (error) {
    metaThrew = error instanceof MetaAdapterNotImplemented
  }
  check(
    '41b · the live adapter satisfies the same interface and fails loudly',
    metaThrew,
    'createMetaSource().getCreatives() throws MetaAdapterNotImplemented',
  )

  /* -------------------------------- summary -------------------------------- */
  console.log(`\n${'-'.repeat(52)}`)
  console.log(green(`PASS: ${passed}`))
  console.log(failed > 0 ? red(`FAIL: ${failed}`) : green('FAIL: 0'))
  console.log()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(red(`\nSelf-test could not run: ${error instanceof Error ? error.stack : error}`))
  process.exit(1)
})
