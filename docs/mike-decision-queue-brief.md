# CLAUDE CODE DESIGN BRIEF

## Mike — Simplified Creative Decision Queue

### Objective

Redesign the existing Mike dashboard so it reduces the media buyer's workload instead of exposing Mike's entire reasoning process.

Mike should still perform the same rigorous analysis behind the scenes. The interface should reveal only the decisions that deserve attention now. The user must be able to understand the situation and act within a few seconds.

The governing principle is:

> **Mike thinks deeply backstage and speaks briefly onstage.**

This is a focused front-end redesign. Do not weaken, remove or rewrite the underlying evidence, scoring, maturity, baseline, confidence, normalization, fatigue or proposal-generation logic unless a display change makes a small adapter necessary.

---

## The problem with the current screen

The current three-column proposal layout makes each recommendation feel like a report. It presents long paragraphs, multiple evidence panels, repeated labels and too many metrics before the user has decided whether the recommendation matters.

This creates the wrong experience:

- Mike appears to be assigning work rather than removing it.
- Recommendations compete horizontally and are difficult to scan.
- Important actions and lower-priority observations receive similar visual weight.
- Internal reasoning is shown before the user requests it.
- The media buyer has to interpret Mike instead of simply approving, editing or dismissing his recommendation.

The new screen must feel like an intelligent inbox or approval queue—not an analytics dashboard inside another analytics dashboard.

---

## Desired experience

On arrival, the user should immediately know:

1. How many decisions need attention today.
2. Which decision is most important.
3. What Mike recommends doing.
4. The few numbers supporting that recommendation.
5. What button to press next.

The default view should take no more than 10–15 seconds to understand.

Mike's detailed evidence remains available on demand through a progressive disclosure drawer or modal. Nothing is deleted from the evidence model; it is simply removed from the default reading path.

---

## Page structure

Keep the platform's current high-tech luxury visual system: dark navy background, cyan/blue/violet accents, restrained glass panels, subtle glow, thin borders, existing typefaces, icon treatment and spacing language.

Do not redesign the global navigation, header, sidebar or overall brand. Redesign only Mike's primary content area.

The page should contain four simple regions:

1. Mike summary
2. Decision queue
3. Completed/dismissed decisions
4. Optional activity note

Do not add extra charts, KPI grids, agent diagnostics or system telemetry to this page.

---

## 1. Mike summary

Use one compact summary panel at the top of the page.

### Required content

**Eyebrow**

MIKE'S QUEUE

**Primary headline — generated from the current queue**

> Mike found 2 actions worth taking today.

**Supporting sentence**

> One creative needs replacing. One winner deserves new variations.

Use natural singular/plural variants for different queue states.

Examples:

- `Nothing needs your attention today.`
- `Mike found 1 action worth taking today.`
- `Mike found 3 actions worth taking today.`

### Optional utility content

- `Updated 4 min ago`
- A small `Refresh analysis` control
- A compact filter: `Open`, `Done`, `Dismissed`

### Remove

- The long “This morning” monologue
- Commentary about Mike remembering the account
- Descriptions of Mike's internal thought process
- Any large introductory paragraph

If Mike has a genuinely useful contextual remark, limit it to one short sentence beneath the summary. Never display a paragraph.

---

## 2. Decision queue

Replace the three large side-by-side cards with one vertically ordered queue.

Each row represents one decision. Sort by urgency first and evidence strength second. The most important action is always first.

### Desktop column structure

| Column | Purpose | Example |
|---|---|---|
| Priority | Rank and urgency | `01` / high urgency accent |
| Action | Mike's recommended move | `REPLACE` |
| Creative | The asset affected | `Systems Before Scale` |
| Why | One plain-English sentence | `CPL is rising while CTR falls and frequency climbs.` |
| Evidence | Up to three metrics | `CPL +26%` · `CTR −24%` · `Freq 3.4` |
| Confidence | Strength of the recommendation | `Strong` |
| Decision | User controls | `Approve` · `Edit` · overflow |

Use a compact table/list hybrid rather than a spreadsheet aesthetic. Rows should remain visually distinct, comfortable to scan and consistent with the Reactor design language.

### Example rows

| Priority | Action | Creative | Why | Evidence | Confidence |
|---|---|---|---|---|---|
| 01 | Replace | Systems Before Scale | CPL is rising while CTR falls and frequency climbs. | CPL +26% · CTR −24% · Freq 3.4 | Strong |
| 02 | Iterate | The Profit Leak — Founder Cut | This is the cheapest confirmed source of leads and still has room to scale. | $28 CPL · 30% below cohort · 827 leads | Strong |
| 03 | Watch | Dollar-figure hooks | The pattern looks promising, but there is not enough evidence to act yet. | 19% below cohort · 3 creatives · 1,729 leads | Moderate |

These are presentation examples. Bind the interface to the existing live/seeded proposal data rather than hard-coding these values.

### Copy rules

Every queue item must obey these limits:

- Recommendation title: no more than 8 words.
- Explanation: one sentence, ideally 12–20 words; maximum 25 words.
- Evidence: maximum three metrics in the collapsed row.
- Confidence: one short label.
- One primary action.

Do not expose raw multi-window analysis, cohort methodology or long reasoning in the collapsed row.

Avoid language such as:

- “Worth noting but not acting on today...”
- “The thing is...”
- “I would draft five...” followed by another paragraph
- Internal debate, caveats repeated in prose or conversational throat-clearing

Mike should sound decisive, calm and human:

- `Replace this creative before increasing spend.`
- `Create three new hooks while this winner is healthy.`
- `Keep watching—there is not enough evidence yet.`

### Action colour system

Reuse existing semantic colours, but keep them restrained:

- `REPLACE`: magenta/red accent
- `ITERATE`: cyan/green accent
- `EXPLORE`: violet/blue accent
- `WATCH`: amber accent
- `COLLECT`: neutral blue/grey accent

Colour should help scanning; it must not turn every row into a glowing alarm.

### User controls

Each actionable row needs:

- **Approve** — primary button; approves Mike's proposed action.
- **Edit** — lets the user adjust quantity, format, angle or instruction before approval.
- **Dismiss** — place inside a restrained overflow menu to avoid making three buttons equally prominent.
- **View evidence** — text link or chevron; expands the evidence drawer.

For a `WATCH` or `COLLECT` row, replace `Approve` with **Acknowledge** or **Keep watching**. Do not pretend that a non-action is a production task.

After approval:

- Show immediate feedback in the row.
- Change status to `Approved`.
- Move it into the completed section or leave it briefly in place with an undo option.
- Route the approved instruction into the existing campaign/creative workflow.

Do not build a new production workflow if one already exists.

---

## 3. Evidence drawer

Detailed evidence must be available, but hidden by default.

Selecting `View evidence` should open a right-side drawer on desktop and a full-width bottom sheet or page on mobile.

### Drawer hierarchy

1. Recommendation and creative name
2. One-sentence reasoning summary
3. The exact evidence Mike used
4. Comparison window and cohort definition
5. Confidence explanation
6. Optional link to the full Meta Intelligence record

### Evidence presentation

Detailed evidence may include:

- Rapid and confirmation windows
- Raw and normalized values
- Cohort median and sample size
- Spend and result volume
- Frequency and fatigue conditions
- Data completeness or provisional-day warnings
- Evidence IDs/source references
- Mike's longer reasoning, if retained

Use short labeled rows or compact evidence blocks. Do not recreate the existing giant proposal card inside the drawer.

The drawer exists for verification, not for restating the recommendation five different ways.

### Evidence trust requirements

Preserve all current evidence safeguards:

- Every displayed claim must resolve through the shared normalization/evidence resolver.
- Do not introduce unsupported numerical claims in generated prose.
- Preserve maturity, comparison-window and cohort logic.
- Clearly identify provisional or incomplete data.
- Keep range-level frequency logic intact.
- Keep `RECOVERING` suppression behaviour intact.
- Keep `WATCH` specific to the subject creative rather than collapsing it into generic collection advice.

This redesign changes information hierarchy only. It must not loosen the rules that keep Mike honest.

---

## 4. Completed and dismissed decisions

Below the active queue, add a collapsed secondary section:

`Completed and dismissed (6)`

Opening it shows a lightweight history with:

- Decision
- Creative
- User action
- Date/time
- Outcome/status where available

This section should be visually quieter than the active queue.

Do not display a full activity feed by default. If an activity note is useful, show only the latest meaningful event in one compact line.

---

## Queue states

Design the following states deliberately.

### Loading

Use three compact row skeletons. Do not show a full-page spinner.

### No actions

Headline:

> Nothing needs your attention today.

Supporting copy:

> Mike is watching the account and will surface a decision when the evidence earns one.

Do not manufacture recommendations to make the page look busy.

### One or more actions

Show the count and a short natural-language summary. Queue is ordered by priority.

### Provisional data

Keep the recommendation visible if appropriate, but show a subtle `Provisional data` label. Reduce confidence according to the existing logic.

### Error or disconnected Meta account

Use one concise status panel explaining what is unavailable and the single next step. Do not fill the queue with demo recommendations unless the product is explicitly in demo mode.

### Demo mode

Retain the visible `DEMO DATA` badge wherever seeded data is being used.

---

## Responsive behaviour

### Desktop

- One full-width vertical queue.
- Use the table/list column structure above.
- Keep action controls aligned on the right.
- Evidence opens in a right-side drawer.

### Tablet

- Keep each item as one horizontal card where space allows.
- Allow evidence metrics to wrap beneath the reason.

### Mobile

Each queue row becomes a compact stacked card in this order:

1. Priority + action label + confidence
2. Creative name
3. One-sentence reason
4. Metric chips
5. Primary action + Edit
6. View evidence

Never use horizontal scrolling for the decision queue.

---

## Accessibility and usability

- All controls must be keyboard accessible.
- Provide visible focus states consistent with the neon visual system.
- Do not rely on colour alone for action or confidence.
- Buttons and mobile controls must meet reasonable touch-target sizing.
- Tooltips should explain unfamiliar metrics, not repeat visible labels.
- Preserve readable contrast; secondary text in the current interface is occasionally too faint.
- Respect reduced-motion preferences.

---

## Data and component guidance

Reuse the current proposal objects and evidence records. Add a presentation adapter if needed rather than rewriting the decision engine.

A queue item should be able to render from a shape conceptually similar to:

```ts
type MikeQueueItem = {
  id: string
  priority: number
  family: 'REPLACE' | 'ITERATE' | 'EXPLORE' | 'WATCH' | 'COLLECT'
  creativeId?: string
  creativeName: string
  shortReason: string
  keyMetrics: Array<{
    label: string
    displayValue: string
    evidenceId: string
  }>
  confidence: 'strong' | 'moderate' | 'low'
  state: 'open' | 'approved' | 'dismissed' | 'completed'
  isProvisional: boolean
  primaryAction: {
    label: string
    intent: string
  }
  evidenceIds: string[]
}
```

This is guidance, not a demand to duplicate an existing type. Prefer adapting the current domain model.

Recommended component separation:

- `MikeQueueSummary`
- `MikeQueue`
- `MikeQueueRow`
- `MikeQueueActions`
- `MikeEvidenceDrawer`
- `MikeDecisionHistory`
- `MikeEmptyState`

Keep queue copy generation separate from rendering. Do not scatter truncation and numerical-validation logic across components.

---

## What must remain unchanged

- Mike's underlying constitution and decision rules
- Maturity and baseline calculations
- Equal comparison-window behaviour
- Range-level frequency implementation
- Cohort and result-type comparability
- Evidence IDs and shared normalization resolver
- Confidence floors
- Provisional-data handling
- Recovery suppression
- Existing Meta connection and date logic
- Existing campaign creation/approval routing
- Global Reactor visual identity

---

## Explicitly out of scope

Do not add:

- Another analytics dashboard
- New charts
- Agent thought streams
- Chain-of-thought or hidden reasoning displays
- A chatbot conversation as the primary interface
- Autonomous ad publishing
- New decision rules
- New Meta metrics
- A redesigned sidebar or global header
- Large system-health or telemetry sections

---

## Acceptance criteria

The redesign is complete when:

1. The default screen shows a concise summary and one vertical decision queue.
2. Each collapsed recommendation contains one sentence and no more than three metrics.
3. The user can approve, edit or dismiss an action without opening detailed evidence.
4. Detailed evidence remains accessible on demand.
5. `WATCH` and `COLLECT` items do not masquerade as production actions.
6. Existing evidence and confidence safeguards still pass their tests.
7. Loading, empty, provisional, disconnected and demo states are implemented.
8. The queue works cleanly on desktop, tablet and mobile.
9. No global styling or unrelated dashboard sections are changed.
10. A media buyer can identify the most important next move within five seconds.

---

## Final direction to Claude Code

Inspect the existing Mike implementation before editing. Reuse its data flow, proposal rules, evidence resolver, action handlers and design tokens. Make the smallest coherent set of changes necessary to replace the oversized recommendation cards with the summary, queue and evidence drawer described above.

Do not rewrite the decision engine. Do not add features because there is available space. Do not preserve verbose copy merely because the backend generated it; move it into the evidence drawer or condense it through the presentation layer.

The final experience should feel like Mike has already done the difficult analysis and is handing the media buyer a short, ordered list of decisions.

> **Two things need attention. Here is why. What do you want me to do?**

That is Mike.
