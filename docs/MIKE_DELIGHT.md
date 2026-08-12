# Mike Delight — the Reactor's performance operator

> Maths decides what is true. Mike decides what matters. The human decides what happens.

Mike Delight reads the ad account and puts up to three decisions in front of one
person every morning. He lives entirely inside the existing **Your Next Moves**
section of the Reactor Dashboard as a **decision queue**: a summary, an ordered
list of rows, a collapsed history, and an evidence drawer that opens on demand.
There is no separate page, no avatar and no chatbot — he is a colleague doing a
job, not a feature that needs showing off.

> **Mike thinks deeply backstage and speaks briefly onstage.**

The full analysis runs on every load. What reaches the screen is the decision.

Built from `docs/mike-delight-build-spec-v2.md` (the engine),
`docs/mike-decision-queue-brief.md` (the surface) and
`operator/mike-delight-constitution.md` (the character).

---

## The split that everything else serves

Three layers, separately replaceable, and the boundaries are the whole design:

| Layer | Owns | Never does |
|---|---|---|
| `lib/operator/` (pure) | what is true — signals, baselines, strength, rules, evidence | judge tone, call the clock, call the network |
| `lib/operator/queue.ts` | what reaches the row — condensing, chips, summary copy | change a figure, or decide what is true |
| `lib/operator/narrate.ts` | what matters — the lead, the language, the running note | write a single number the UI renders |
| The operator (a human) | what happens — approve, edit, dismiss, snooze | — |

A model touches exactly one file. Everything a card displays as a figure comes
from a structured `Evidence` item, so Mike can *misread* the evidence — a
judgement, and his job — but cannot mistype it, because he never types it.

---

## Architecture

```
lib/operator/
  types.ts          shared contract — no generic `conversions`, frequency only at range level
  dates.ts          pure date maths + `todayIn()`, THE one clock read
  maturity.ts       excluded / provisional / settled
  signals.ts        equal-window trends, null when unresolvable
  baselines.ts      cohort resolution with progressive fallback
  strength.ts       EARLY_SIGNAL / MODERATE / STRONG, with hard floors
  evidence.ts       structured items with stable ids
  fingerprint.ts    proposal identity (weekly) + memory identity (permanent)
  queue.ts          presentation adapter — proposals → queue rows, all copy rules
  rules/            one file per rule: iterate · fatigue · explore · collect
  memory.ts         decision log, cooldowns, weights, learned defaults
  operator.ts       the pipeline: dedupe → suppress → rank → cap
  narrate.ts        Mike's language, evidence-id referencing, one call per session
  validate.ts       post-generation factual checks, shared by ALL narration paths
  safety.ts         capability allowlist, enforced with a throwing assertion
  draft.ts          Approve → a staged brief for the Campaign Reactor
  persistence.ts    localStorage `reactor.operator.v1`, with a migration guard
  adapters/
    seeded.ts       24 days of shaped delivery per creative
    meta.ts         stub — throws, and documents exactly which Graph calls it needs
    index.ts        THE ONE LINE that swaps them
```

```
components/reactor/operator/
  OperatorProvider.tsx     runs the pipeline, owns every action
  ActionsRequiredTile.tsx  the pulse tile, on the same selector as the queue
  OperatorToast.tsx        decision confirmation
  modals.tsx               Edit · Dismiss · Snooze
  shell.tsx                shared modal + form primitives
  queue/
    MikeQueueSummary.tsx   count, one supporting line, controls, filter
    MikeQueue.tsx          the list and its states
    MikeQueueRow.tsx       one decision
    MikeQueueActions.tsx   primary · Edit · overflow · undo
    MikeEvidenceDrawer.tsx everything, on demand
    MikeDecisionHistory.tsx completed and dismissed
    MikeEmptyState.tsx     clear · paused · disconnected · filtered
```

**Swapping data sources is one line** in `adapters/index.ts`. The self-test
asserts that nothing outside that file needs to change with it.

---

## The surface

Four regions and nothing else. No charts, no KPI grids, no agent telemetry —
those belong on Meta Intelligence, and the reason this screen works is that it
does one job.

**1 · Summary.** `MIKE'S QUEUE`, a generated headline (*"Mike found 2 actions
worth taking today."*), one supporting sentence describing the mix, and the
controls: Refresh analysis, pause, and an Open / Done / Dismissed filter. The
headline is arithmetic and is generated from the queue rather than written by
Mike — a model asked to phrase a count will eventually phrase it wrongly.

If Mike has a genuine view on the account it appears as ONE sentence beneath.
Most mornings it does not appear at all, and that absence is in character.

**2 · Queue.** One vertical row per decision, ordered by urgency then evidence
strength. Priority · Action · Creative · Why · Evidence · Confidence · Decision.
Copy limits are enforced in `queue.ts`, not in components: title ≤ 8 words,
reason one sentence ≤ 25 words, ≤ 3 metric chips, one confidence word, one
primary action.

The chips carry the figures so the sentence does not have to. Each rule supplies
a **plain-English one-liner** for the row (*"Cost per result is rising, CTR is
falling and frequency is climbing."*) alongside the full read for the drawer —
two lengths, because a long sentence cut at a column edge reads as a bug rather
than as brevity.

**3 · Evidence drawer.** Right-side panel on desktop, bottom sheet on a phone.
The recommendation once, then the numbers: every evidence item with its window
and comparison, the cohort definition, the confidence explanation, Ask Mike, and
a link to the full performance record. For verification — not a second copy of
the recommendation with more adjectives.

**4 · Completed and dismissed.** Collapsed, quieter than the queue, and read
from the decision log rather than from a second list that could disagree with it.

### Actions

**Approve** stages a brief and confirms in place with an **Undo** before the row
leaves. **Edit** adjusts variations, angle, format and instructions, then
approves and logs the diff. **Dismiss** (reason code required) and **Snooze** sit
in a restrained overflow — three equally prominent buttons is three decisions to
make about a decision.

WATCH and COLLECT never get "Approve". Their primary control is **Keep watching**
or **Acknowledge**, it sets a check-back, and it creates nothing. Labelling a
non-action as an approval is how an interface teaches somebody that approving
here does not mean very much.

---

## The disciplines worth knowing about

**The current day never enters a calculation, and recent results are
provisional.** Meta keeps attributing after the day closes. Reading yesterday as
finished makes every creative look like it fell off a cliff overnight, and the
system drafts a replacement for a healthy ad. Provisional results may raise a
monitoring signal; they may not support a definitive REPLACE or ITERATE.

**Windows are equal and complete.** 3 days against the 3 before it, 7 against
the 7 before it, cut by calendar date rather than by available rows. When the
prior window has too little delivery, `percentChange` is `null` and `complete`
is `false` — never a zero, never an assumed flat.

**Frequency comes only from range-level delivery.** Reach deduplicates people
across days, so a weekly frequency cannot be summed or averaged out of daily
rows. There is no code path that can produce one from `DailyMetric.reach`; a
creative with no range gets `null`, and the fatigue rule loses its delivery
signal, which is the correct outcome.

**Result types are never blended.** A lead and a booked call are not the same
outcome. Cohorts, roll-ups and group means all stay inside one
`PrimaryResultType`, including at the broadest fallback level.

**Cold is never compared against retargeting.** Broadening a cohort *drops* the
temperature attribute; it never substitutes a different one.

**Strength is never derived from win rate.** That is how a dashboard ends up
printing `1/1 wins · 100% confidence`. Four floors are enforced in code: a
single test stays EARLY_SIGNAL; an EXPLORE under three creatives stays there
too; an account-wide fallback caps below STRONG; a null confirmation window caps
below STRONG.

---

## Fatigue is three states, not one

| State | Condition | Card |
|---|---|---|
| **CONFIRMED** | both windows deteriorating, directionally consistent, frequency ≥ 2.5 and rising, ≥ 2 signals | `REPLACE` — the only state that drafts a successor |
| **WATCH** | rapid deterioration present, CONFIRMED did not fire | `WATCH — Possible fatigue`, primary action **Keep watching** (creates nothing), optional **Prepare successor anyway** |
| **RECOVERING** | 7v7 poor, 3v3 already turned | no card; suppresses that creative **and that signal** for 3 days |

Recovery suppression is keyed on `hash(creativeId + fatigueSignal)`. A frequency
that has come back down says nothing about a cost per result still climbing, and
suppressing the whole category on that basis would hide a real replacement
behind unrelated good news.

WATCH is scored in a band whose ceiling sits below CONFIRMED's floor, so
short-term nerves can never push a real replacement off the board.

---

## Two identities, on purpose

- `proposal.id` — `hash(type + subjects + weekBucket)`. Stable for a week, so a
  card does not re-mint a fresh number every morning.
- `proposal.subjectKey` — `hash(type + subjects)`. Stable forever, and what every
  decision, cooldown and snooze is recorded against.

Keying cooldowns on the weekly id would expire every one of them at the week
boundary, and the card somebody said no to on Friday would be back on Monday
wearing a new number.

---

## Validation

`validate.ts` checks facts only — never voice. No length caps, no banned words,
no tone rules. Mike's personality is completely unconstrained.

Every numeral resolves against a set of authorised sources, and the resolver
returns **which** source authorised it:

`evidence` · `params` · `relationship` · `dateContext` · `catchupDiff` ·
`account`

That last one is the single deliberate addition to the spec's five: Mike is
handed the whole account picture precisely so he notices things, and every
figure in it is still a computed field. A numeral resolving to nothing fails.

Also checked: evidence ids exist on the proposal; a performance claim cites
evidence; stated certainty stays inside the strength tier; claims about data
completeness match the metadata; no claim of an action he cannot take; no
invented shared history.

On failure: **one** regeneration with the reasons appended. On a second failure,
the computed template cards. **The dashboard never depends on a model call to
display** — no API key, a refusal, a timeout, two failed validations, and the
board still renders with real numbers, fully actionable.

Cards, opening remarks, Ask Mike and the catch-up briefing all run through the
same validator and the same evidence-reference system. There is no second
handler.

---

## Safety

Capabilities are `propose` and `draft`. That is the entire list.

Approve stages a brief into the Campaign Reactor over the same sessionStorage
rail the Ad Library's clone hand-off uses; a human still has to read it and fire
it. `stageDraft` runs `assertDraftOnly`, which **throws** if the destination
resolves to anything that could mutate the ad account — publish, pause, budget,
the Graph API. The assertion is the boundary; the comment is the explanation.

No network calls anywhere in `lib/operator/` other than narration.

---

## Persistence

`localStorage` under `reactor.operator.v1`, versioned with `schemaVersion` and a
migration guard that discards a payload written by a newer build rather than
guessing at it.

Persisted: decisions, weights, paused flag, `mikesNotes`, `recentOpenings`
(last 10), `lastSeenAt`, proposal states, recovery holds.

**Never persisted:** signals, evidence or proposals. They recompute on every load
from the source plus the decision log, which is what makes a stale card
impossible.

---

## Testing

```bash
npm run selftest:operator
```

Runs the whole pipeline in-process against the seeded source with the evaluation
date pinned to `2026-08-12`. No server, no network, no model call. **50 checks**:
all 41 from the engine spec, plus seven covering the queue's presentation
contract — word limits, chip caps and deduplication, WATCH's own verb, generated
summary copy at 0/1/n, condensing that never splits a decimal, and undo.

The date is pinned deliberately: without it, "the last 3 complete days" moves
with the calendar and the suite passes on Monday and fails on Thursday for no
reason anybody can find.

The seeded account carries a shape for every state:

| Creative | Shape | Expected |
|---|---|---|
| The Profit Leak — Founder Cut | 30% inside its cohort, delivery healthy | ITERATE |
| Systems Before Scale | both windows down, frequency 2.7 → 3.4 | REPLACE (CONFIRMED) |
| 45-Hour Owner — UGC | last 3 days off a cliff, no delivery signal | WATCH |
| Margin Math | a bad week that has already turned | RECOVERING (no card) |
| Member Win — Jason | booked calls, thin cohort | falls back to `result_type`, no card |
| Stop Scaling — VSL Opener | five days old, no ranges at all | nothing knowable, frequency `null` |

---

## Wiring the live account

`lib/operator/adapters/meta.ts` documents exactly what the Graph API has to be
asked for, and why each call is not optional — in particular the **separate
range-level insights call per evaluation window**, because frequency cannot be
reconstructed from daily reach at any level of effort. Implement the three
methods, change the one line in `adapters/index.ts`, and nothing else moves.
