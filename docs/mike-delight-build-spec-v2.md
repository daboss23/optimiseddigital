# Mike Delight — Build Spec (v2)

Supersedes `reactor-operator-spec.md` and `mike-delight-build-spec.md`. Use with `mike-delight-constitution.md`, which is the narration system prompt and is unchanged.

Build into the existing Creative Reactor dashboard. Do not redesign it. Reuse the existing "Your Next Moves" cards as the approval queue. Preserve the current visual system exactly: dark command centre aesthetic, existing typography, glow colours, card structure, borders, spacing, responsive behaviour.

---

## 0. Core principle

**Maths decides what is true. Mike decides what matters. The human decides what happens.**

Everything in this spec serves that split. The v2 changes make Mike's evidence more defensible. They do not make Mike less Mike. His constitution, history, humour, judgement, running note, MIKE'S PICK, opening remarks, Ask Mike and catch-up briefings all stay exactly as specified.

---

## 1. Architecture

Three layers, separately replaceable:

```
/lib/operator/
  signals.ts       Pure: raw data -> typed metrics and trend windows
  baselines.ts     Cohort resolution and progressive fallback
  rules.ts         Pure: metrics -> candidate proposals with scores
  evidence.ts      Builds structured Evidence items with stable IDs
  strength.ts      Evidence strength tiering (was confidence.ts)
  maturity.ts      Data completeness and attribution-delay handling
  memory.ts        Decision log, weights, Mike's running note
  narrate.ts       LLM layer: Mike's language, evidence-ID referencing
  validate.ts      Post-generation factual checks, shared by ALL narration paths
  operator.ts      Orchestrator: pipeline, dedupe, rank, top N
  types.ts         Shared types
/lib/operator/adapters/
  seeded.ts        Fake data, implements DataSource
  meta.ts          Stub, throws "not implemented", same interface
```

Everything above `adapters/` is agnostic to data origin. Swapping seeded for real Meta data is a one-line import change.

---

## 2. Data contract

### Daily metrics

```ts
type PrimaryResultType =
  | 'lead' | 'registration' | 'application'
  | 'booked_call' | 'purchase' | 'custom';

interface DailyMetric {
  date: string;                      // account timezone
  spend: number;
  impressions: number;
  reach?: number;                    // daily only, never combined across days
  clicks: number;
  primaryResults: number;
  primaryResultType: PrimaryResultType;
}
```

The generic `conversions` field is removed. A lead, registration, application, booked call and purchase are not equivalent outcomes and must never be blended.

### Range-level delivery

Frequency is `impressions / reach` on deduplicated reach. Daily reach cannot be combined into range reach because the same person appears across days.

```ts
interface RangeDeliveryMetric {
  from: string;
  to: string;
  impressions: number;
  reach: number;
  frequency: number;
}
```

**Preferred:** pull range-level impressions, reach and frequency directly from Meta for each comparison window.

**Seeded interim:** store explicit range-level frequency values per evaluation window, labelled as range metrics. Daily rows may carry impressions and reach for daily analysis, but any frequency used by the fatigue rule must come from a valid range-level value.

Tests must prove frequency is never summed or naively averaged across days.

### Creative snapshot

```ts
interface CreativeSnapshot {
  id: string;
  name: string;
  format: 'video' | 'static' | 'carousel';
  hookType: string;
  tags: string[];
  launchedAt: string;
  primaryResultType: PrimaryResultType;
  offerType?: string;
  audienceTemperature?: 'cold' | 'warm' | 'retargeting';
  market?: string;
  campaignObjective?: string;
  daily: DailyMetric[];              // ordered oldest to newest
  ranges: RangeDeliveryMetric[];     // one per evaluation window
}
```

### Source metadata

```ts
interface DataSourceMetadata {
  accountTimezone: string;
  attributionWindow: string;
  lastSyncedAt: string;
  completeThrough: string;           // last date considered complete
  maturityDelayHours: number;
}

interface DataSource {
  getCreatives(): Promise<CreativeSnapshot[]>;
  getBaselines(): Promise<PerformanceBaseline[]>;
  getMetadata(): Promise<DataSourceMetadata>;
}
```

### Seeded data requirements

The seed must produce, per creative:

- at least 14 days of daily rows, with realistic shapes so rules discover patterns rather than being told them
- explicit range-level frequency for every evaluation window the rules need
- a declared `primaryResultType`, plus cohort attributes where they apply
- metadata with a `completeThrough` date that leaves the current day incomplete and at least one date inside the maturity delay

### Fixed evaluation date

Every calculation that depends on "today" takes an injected `evaluationDate`, never `new Date()` inline. Seeded tests pin it to a fixed value.

Without this, "complete day", provisional status and the 3v3 / 7v7 windows all shift depending on when the suite runs, and tests pass on Monday and fail on Thursday for no reason anyone can find.

```ts
interface EvaluationContext {
  evaluationDate: string;      // injected, never derived inside a pure function
  metadata: DataSourceMetadata;
}
```

Seed the daily rows relative to that fixed date so the intended shapes land in the intended windows.

**Test:** delete every hardcoded recommendation string from the codebase and reload. If three sensible cards still appear, the pipeline is real.

---

## 3. Maturity and completeness (maturity.ts)

Recent Meta results may still be attributing. Mike must not call fatigue because yesterday's results have not finished arriving.

- Use the ad account's configured timezone for all date bucketing.
- Exclude the current, incomplete day by default from every calculation.
- Mark any date inside `maturityDelayHours` as **provisional**.
- Provisional lower-funnel results cannot support a definitive REPLACE or ITERATE conclusion.
- Provisional data may raise a monitoring signal or a COLLECT proposal.
- Data freshness and completeness appear in evidence where relevant.

Mike narrates this in his own words. He receives the completeness metadata and may say something like "yesterday is still settling, I'm watching it not calling it." The validator confirms any claim about provisional data matches the supplied metadata.

---

## 4. Signals and trend windows (signals.ts)

Never compare 3 days against 7. Windows must be equal and complete.

```ts
interface TrendWindow {
  current: number;
  previous: number;
  percentChange: number | null;
  complete: boolean;
}

interface CreativeTrends {
  ctr3v3: TrendWindow;   // last 3 complete days vs previous 3
  cpr3v3: TrendWindow;   // cost per result, same windows
  ctr7v7: TrendWindow;   // last 7 complete days vs previous 7
  cpr7v7: TrendWindow;
}
```

**Rapid trend (3v3):** early fatigue detection and sudden change.
**Confirmation trend (7v7):** whether the short-term movement persists.

A window with insufficient delivery in the previous period returns `percentChange: null` and `complete: false`. Never invent a trend. Null is a valid, honest state and the rules and evidence strength must handle it.

Also compute per creative: cost per result over each window, `completeDays`, `totalPrimaryResults`, `totalSpend`, daily stability (variance across complete days), and `costPerResultVsBaseline` from the resolved cohort.

This layer describes. It does not judge. No thresholds live here.

---

## 5. Contextual baselines (baselines.ts)

A single broad account median is no longer the primary comparison.

```ts
interface BaselineKey {
  offerType?: string;
  primaryResultType: PrimaryResultType;
  audienceTemperature?: 'cold' | 'warm' | 'retargeting';
  market?: string;
  campaignObjective?: string;
}

interface PerformanceBaseline {
  key: BaselineKey;
  medianCostPerResult: number;
  medianCtr: number;
  creativeCount: number;
  resultCount: number;
  from: string;
  to: string;
  fallbackLevel:
    | 'exact_cohort' | 'result_and_offer' | 'result_type' | 'account';
}
```

**Resolver behaviour**

- Use the most specific cohort that has sufficient evidence.
- Fall back progressively when a cohort is too small.
- Carry `fallbackLevel` into proposal evidence.
- A broad fallback reduces evidence strength.
- Never compare cold prospecting against retargeting as equivalent cohorts.
- Never compare across different primary result types.

The resolved baseline goes into the narration payload so Mike can reference the comparison naturally. Structured evidence carries the honest label, for example a cost per booked call against the median for cold Strategy Call campaigns.

---

## 6. Evidence strength (strength.ts)

Internally this replaces `confidence`. The UI keeps the familiar labels.

```ts
type EvidenceStrengthTier = 'EARLY_SIGNAL' | 'MODERATE' | 'STRONG';

interface EvidenceStrength {
  tier: EvidenceStrengthTier;
  reasons: string[];
  primaryResults: number;
  completeDays: number;
  stability: 'low' | 'mixed' | 'high';
  cohortQuality: 'weak' | 'acceptable' | 'strong';
}
```

Inputs to the tiering:

- primary result count
- spend relative to target cost per result
- number of complete delivery days
- daily performance stability
- consistency between rapid and confirmation windows
- number of comparable creatives
- similarity of comparison cohorts
- primary result type consistency

**Never derived from win rate.**

Hard floors, enforced in code:

- A single test always stays `EARLY_SIGNAL`. Never display "1/1 wins · 100% confidence".
- An EXPLORE proposal backed by fewer than 3 compatible creatives is capped at `EARLY_SIGNAL`.
- A broad `account` fallback baseline caps the tier below `STRONG`.
- A null confirmation trend cannot support `STRONG`.

UI labels:

- `EARLY_SIGNAL` → `Early signal · Low confidence`
- `MODERATE` → `Moderate confidence`
- `STRONG` → `Strong confidence`

Hover explanation is built from structured values, not prose. For example: based on 12 booked calls across 5 complete days, with daily performance still variable.

---

## 7. Rules (rules.ts)

Each rule is `(signals, baseline, strength, maturity, memory) => Proposal | null`. One file per rule.

**ITERATE** (winner)
- `costPerResultVsBaseline <= 0.8` against a resolved cohort
- `totalPrimaryResults >= 15`
- `ctr3v3.percentChange > -10%` or null-tolerant equivalent
- Blocked if the supporting results are provisional

**REPLACE / WATCH** (fatigue) — three distinct states, not one rigid shape

Gate for all three: `completeDays >= 7`. Blocked if the supporting results are provisional.

```ts
type FatigueState = 'CONFIRMED' | 'WATCH' | 'RECOVERING';
```

**CONFIRMED fatigue** → REPLACE proposal
- Deterioration present in both `3v3` and `7v7`, directionally consistent
- Plus at least one delivery signal: range frequency `>= 2.5` and rising across windows
- At least two of: CTR decline `<= -20%`, cost per result rise `>= +25%`, frequency signal

**WATCH** → REPLACE-family proposal, visually and behaviourally distinct from a replacement
- Rapid `3v3` deterioration present
- `7v7` has not confirmed it, or returns null for insufficient delivery
- Keeps the subject creative and the fatigue evidence attached, so a future replacement inherits the history
- Card header reads `WATCH — Possible fatigue`, with a distinct treatment from a REPLACE card. Use an existing glow colour at lower intensity rather than introducing a new one.
- Standing line under the header: short-term deterioration detected, the confirmation window is not strong enough to replace it yet. Mike's own reasoning sits below and he narrates the distinction in his words, since he has the state and both windows in the payload.
- Primary action is **Keep watching**, never Create successor. Keep watching sets a check-back and does not create a draft.
- Optional secondary action: **Prepare successor anyway**, which creates the draft as a normal REPLACE approval would. This exists for the user who trusts the rapid window more than Mike does.
- Scored below CONFIRMED so it never outranks a real replacement
- Evidence strength capped below `STRONG` while in WATCH

**RECOVERING** → no proposal
- `7v7` is poor but `3v3` has stabilised or improved
- Suppresses only the **specific creative plus the specific fatigue signal** that recovered, for 3 days. Never the whole REPLACE category for that creative. A frequency recovery must not suppress a legitimate replacement driven by a cost-per-result collapse.
- Suppression key: `hash(creativeId + fatigueSignal)` where `fatigueSignal` is one of `frequency` | `ctr_decline` | `cost_rise`
- Surfaces only if Mike chooses to mention it in the opening remark

The `FatigueState` is passed to narration so the distinction is his to voice, not a template string.

**EXPLORE** (pattern)
- Tag or `hookType` shared by 3 or more creatives **of compatible primary result type**
- Group mean `costPerResultVsBaseline <= 0.85`
- Never fires on a single creative

**COLLECT** (fallback)
- Only when nothing else fires at all
- Must state what specifically is missing and roughly when the data will be sufficient
- Not a catch-all. A rapid trend without confirmation is a WATCH, not a COLLECT. If COLLECT is firing often, the thresholds are wrong or the data is too thin, and that is a bug to investigate rather than a state to narrate around.

```ts
interface Proposal {
  id: string;                    // deterministic fingerprint, section 8
  type: 'ITERATE' | 'REPLACE' | 'EXPLORE' | 'COLLECT';
  subjectIds: string[];
  score: number;                 // 0-100, ranking only
  strength: EvidenceStrength;
  evidence: Evidence[];
  params: ProposalParams;
  createdAt: string;
}
```

---

## 8. Evidence items (evidence.ts)

Every evidence item has a stable ID. This is what narration references.

```ts
interface Evidence {
  id: string;
  label: string;
  rawValue: number | string;
  displayValue: string;
  comparisonValue?: string;
  direction: 'good' | 'bad' | 'neutral';
  source: {
    creativeIds: string[];
    dateRange: { from: string; to: string };
    baselineKey?: BaselineKey;
    provisional?: boolean;
  };
}
```

**The UI renders all numerical evidence directly from this structure.** Mike is never responsible for writing an evidence-row number.

---

## 9. Deduplication and cooldowns

**Fingerprint.** `id = hash(type + sorted(subjectIds) + weekBucket)`.

**Cooldowns.**
- Dismissed: suppressed 14 days
- Dismissed twice with the same reason code: suppressed 60 days
- Approved: subject excluded from same-type proposals for 7 days
- Snoozed: hidden until date, returns with a "returning" marker

Maximum 3 active proposals. Maximum 1 REPLACE per run.

---

## 10. Learning loop

```ts
interface Decision {
  proposalId: string;
  type: ProposalType;
  subjectTags: string[];
  strengthTier: EvidenceStrengthTier;
  action: 'approved' | 'edited' | 'dismissed' | 'snoozed';
  edits?: Partial<ProposalParams>;
  reasonCode?: DismissReason;
  decidedAt: string;
}
```

Dismissal reasons are a fixed list. Optional free-text note alongside, but the code feeds the weights.

```
'already-doing-it' | 'wrong-read-of-data' | 'not-a-priority-now'
| 'budget-constrained' | 'brand-mismatch' | 'other'
```

**Weights.** `Record<string, number>`, keys `${type}` or `tag:${tag}`, clamped 0.5 to 1.5. Approved +0.05, dismissed with `wrong-read-of-data` -0.10, other dismissals -0.03, snooze neutral.

Weights multiply `score` during ranking only. They never touch evidence strength and never change whether a rule fires.

**Edit patterns.** After 3 consistent edits to the same param, change the default and surface it on the card.

---

## 11. UI

### Header
```
MIKE DELIGHT · ACTIVE · 3 APPROVALS
```
Click scrolls to Your Next Moves. Pause/Resume control. Paused reads `MIKE DELIGHT · OFF THE CLOCK`, generates no new proposals, existing ones stay actionable. No separate page, no drawer, no avatar, no chatbot.

### Opening remark strip
Single strip above Your Next Moves. No bubble, no avatar, no chrome. Left rule in an existing glow colour, small caps label, line in Mike's voice slightly larger than card body.

Optional by design. When `openingRemark` is null the strip does not render. No empty state, no placeholder.

Label states: `JUST NOW` with accent glow when new, `THIS MORNING` muted when seen, `FOLLOWING UP` when he is referencing user history.

No animation. No typewriter, no staged fade.

### Cards
Existing design. Action type, priority, recommendation, reasoning, evidence rows rendered from structured evidence, evidence strength label, primary action, and Edit / Ask Mike / Approve / Dismiss / Snooze.

**MIKE'S PICK** tag when `leadProposalId` is not the highest-scoring proposal.

### Actions
- **Approve** — status Approved, creates a draft task via the existing Campaign Reactor workflow. Nothing publishes. Toast: `Approved — draft created`.
- **Edit** — modal: variations, hook direction, format, additional instructions. Saving approves the edited proposal and logs the diff.
- **Dismiss** — requires a reason code, optional note.
- **Snooze** — Tomorrow / 3 days / 7 days.

### Ask Mike
Link on the card next to Edit. Same modal shell, one text field, answer inline underneath. The proposal is the subject.

- Three exchanges per card maximum
- No account-level chat, no persistent thread, no push
- Runs through `validate.ts` with the same evidence-reference system. Do not build a second handler.
- He can only speak to what is in the payload

Log every question with proposal type and strength tier.

### Catch-up briefing
Past 48 hours away, the opening remark strip is replaced with an away label and a `Catch me up` action. Does not auto-generate.

Payload is a diff, not a summary:

```ts
interface CatchupContext {
  awayDays: number;
  lastSeenAt: string;
  since: {
    spend: number;
    primaryResultsByType: Record<PrimaryResultType, number>;
    creativesChanged: CreativeDelta[];
    proposalsExpired: Proposal[];
    proposalsSuperseded: Proposal[];
    newSignals: Proposal[];
  };
  metadata: DataSourceMetadata;
  mikesNotes: string;
  relationship: RelationshipSummary;
}
```

Briefing, not a thread. No reply field. Same evidence-reference system, same validator. Add away-briefing openings to `recentOpenings` so he varies the entry.

### Counts
Actions Required, header count and visible proposals all read from one derived selector.

---

## 12. Persistence

Existing project storage pattern, or localStorage under `reactor.operator.v1`.

Persist: proposal states, decision log, weights, paused flag, `mikesNotes`, `recentOpenings` (last 10), `lastSeenAt`.

Version with `schemaVersion` and a migration guard.

Never persist computed signals, evidence or proposals. They recompute on every load.

---

## 13. Safety

- Read functions plus a single `submitDecision()` write path.
- No network calls from `/lib/operator/` other than narration.
- Capability allowlist in code: propose, draft. No publish, no budget change, no campaign pause, no permanent brand knowledge edit, no code changes.
- Approve creates a draft only. An assertion in the approve handler throws if any external publish path is reachable.

---

## 14. Narration (narrate.ts)

System prompt is `mike-delight-constitution.md`. Personality is unconstrained. Facts are not.

One call per session, all cards together, so he can vary himself deliberately and reference across cards.

```ts
interface NarrationContext {
  proposals: Proposal[];          // ALL candidates, not just top
  ranking: string[];
  account: {
    recentDaily: DailyMetric[];
    baselines: PerformanceBaseline[];
    activeCreatives: CreativeSummary[];
  };
  metadata: DataSourceMetadata;
  relationship: {
    daysWorkingTogether: number;
    approved: number;
    dismissed: number;
    dismissalReasons: Record<DismissReason, number>;
    editPatterns: string[];
    openHistory: string[];
  };
  mikesNotes: string;
  recentOpenings: string[];
}
```

Output:

```ts
interface NarratedCard {
  proposalId: string;
  recommendation: string;
  reasoning: string;
  evidenceIds: string[];        // which evidence supports his interpretation
}

interface NarrationOutput {
  leadProposalId: string;
  leadReason: string;           // debug panel only
  cards: NarratedCard[];
  openingRemark: string | null;
  sessionNote: string;          // persisted as mikesNotes
}
```

Mike selects which evidence supports his read. He does not write the numbers in the evidence rows.

Log `leadReason` to a debug panel so his judgement can be observed over time.

---

## 15. Validation (validate.ts)

Checks facts only. Never voice. No length caps, no banned words, no tone rules.

1. **Evidence references.** Every ID in `evidenceIds` exists and belongs to that proposal.
2. **Support.** Every factual performance claim in the reasoning is supported by at least one referenced evidence item.
3. **Numerical claims resolve to an authorised source.** Every numerical claim must resolve to an authorised structured field. Not necessarily an evidence row. Mike legitimately mentions numbers that are not performance evidence: a variation count, how many times something was snoozed, a rank, a review interval.

   Authorised sources:
   - referenced evidence (`displayValue` / `rawValue`)
   - proposal parameters (`params`)
   - relationship history (`relationship`, `mikesNotes`)
   - date and time context (`metadata`, `ranking`, window definitions)
   - catch-up diff (`CatchupContext.since`)

   Normalise before comparison: currency symbols, percentage signs, thousands separators, written number forms, and approved rounding. A numeral that resolves to none of the authorised sources fails.

   Build the resolver as one shared function used by cards, opening remarks, Ask Mike and catch-up briefings. Divergence here is how a valid figure gets rejected in one path and passes in another.

   The resolver returns the authorised source for every accepted numeral, not just a pass or fail:

   ```ts
   interface NumeralResolution {
     numeral: string;
     normalised: number;
     resolved: boolean;
     source?: {
       kind: 'evidence' | 'params' | 'relationship' | 'dateContext' | 'catchupDiff';
       ref: string;              // evidence id, param key, field path
       matchedValue: string;
     };
   }
   ```

   Feed these into the debug view alongside `leadReason`, so any passing claim can be traced to the field that authorised it. When something fails, the same structure shows which numerals resolved and which did not, which is the difference between a five-minute fix and an afternoon.
4. **Certainty ceiling.** Stated certainty must not exceed the computed evidence strength tier. At `EARLY_SIGNAL` he cannot claim something is proven, established, confirmed or reliable. He can hold a hunch and say so however he likes.
5. **Provisional claims.** Any statement about data completeness or settling must match the supplied metadata.
6. **Capabilities.** No claim or implication of an action he cannot perform.
7. **History.** No invented relationship history absent from `relationship` or `mikesNotes`.

One regeneration with the failure reason appended. Second failure falls back to a template card. The dashboard never depends on a model call to display.

**Ask Mike and catch-up briefings run through this same validator and the same evidence-reference system.**

---

## 16. Required tests

1. Current incomplete day is excluded
2. Provisional attribution data cannot trigger a definitive REPLACE
3. 3v3 and 7v7 trends use equal complete windows
4. Missing comparison data returns null, not an invented trend
5. Frequency is never summed or averaged from daily values
6. Different primary result types are never blended
7. Cold and retargeting cohorts are not treated as equivalent
8. Baseline fallback level is correctly labelled
9. Broad fallback reduces evidence strength
10. A single creative or single result never produces Strong
11. Narrated evidence IDs must exist on the proposal
12. Numerical evidence renders from structured data
13. Unsupported numerical prose fails validation
14. Mike cannot overstate certainty
15. Narration, opening remarks, Ask Mike and catch-up all pass through the same validator
16. Non-evidence numerals from proposal params, relationship history, date context and catch-up diff all pass validation
17. Currency symbols, percentages, separators, written forms and approved rounding normalise correctly before comparison
18. A numeral resolving to no authorised source fails
19. Rapid deterioration without confirmation produces WATCH, not REPLACE
20. Deterioration across both windows plus a delivery signal produces CONFIRMED REPLACE
21. Poor 7v7 with stabilised 3v3 produces RECOVERING and suppresses REPLACE
22. WATCH state caps evidence strength below Strong
23. All time-dependent calculations use the injected evaluationDate; no pure function calls new Date() internally
24. WATCH renders its own header and primary action, and Keep watching creates no draft
25. Prepare successor anyway on a WATCH card creates a draft identical to a REPLACE approval
26. WATCH never outranks a CONFIRMED replacement
27. Recovery on one fatigue signal does not suppress a replacement driven by a different signal
28. The resolver returns an authorised source for every accepted numeral

Plus the acceptance checks:

29. `MIKE DELIGHT · ACTIVE` in header with live count
30. Up to 3 recommendations, computed from data, not hardcoded
31. Approve, Edit, Dismiss, Snooze all work
32. Decisions survive refresh, including after a schema version bump
33. Counts derived from one source
34. Approve creates a draft only, assertion proves no publish path is reachable
35. Pausing stops new proposals, existing stay actionable
36. Dismissed proposals do not reappear inside cooldown
37. After 3 consistent edits to a param, the default changes and the card says so
38. Opening remark renders nothing when null
39. MIKE'S PICK appears only when lead differs from top-ranked
40. Existing dashboard styling unchanged
41. Changing the data source import from `seeded` to `meta` requires no edits outside that one line

---

## 17. Build order

1. Types, DataSource interface, DataSourceMetadata
2. Seeded data: 14 days of daily rows per creative, range-level frequency per window, declared result types and cohort attributes, a completeThrough date and a provisional date
3. maturity.ts with tests
4. signals.ts, equal-window trends, null handling, with tests
5. baselines.ts, cohort resolution and fallback, with tests
6. strength.ts with tests, including all hard floors
7. evidence.ts, stable IDs
8. rules.ts, one rule at a time, ITERATE first
9. operator.ts: dedupe, cooldowns, rank, top 3
10. Wire to existing cards, read-only, evidence rendered from structure
11. Four actions plus persistence
12. Decision log and weights
13. Edit-defaults learning
14. narrate.ts and validate.ts, behind a flag
15. Opening remark strip and MIKE'S PICK
16. Ask Mike
17. Catch-up briefing

Ship after step 11 if you need something working. Steps 12 to 17 are what make it Mike rather than a list.

Voice input and output are out of scope for v1.
