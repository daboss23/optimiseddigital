# Creative Canvas — Product Specification

**TPB Creative Reactor · the structured creative operating layer**
Engineered For Performance.

This document defines the Creative Canvas: what it is, how it behaves, its
node system, its per-mode adaptations, its signature semantic-reassignment
interaction, and how it connects the Campaign Reactor to the Studio. The
implementation lives in `components/creative-canvas/CreativeCanvas.tsx` +
`lib/creative-canvas/graph.ts` + `/api/canvas/regenerate` +
`lib/model-menu.ts`. Sections marked **(planned)** describe designed-but-not-yet-built
increments; everything else is live and browser-verified.

---

## 1. The role of Creative Canvas in the product

TPB's core flow is a three-stage production line:

| Stage | Surface | Job | Output |
|---|---|---|---|
| 1 | **Campaign Reactor** | Strategic concept generation — retrieval, reasoning, scoring | Scored, evidence-cited concepts with ad packages |
| 2 | **Creative Canvas** | Structured creative **direction** — shape, branch, sequence, reassign, regenerate | A directed, approved creative structure |
| 3 | **Studio** | Production **finishing** — one real Meta ad unit, pre-test, publish | A launch-ready ad pushed to Meta |

The Canvas exists because there is a real gap between "the agent drafted five
good concepts" and "this exact ad is ready to spend money on." The Reactor is
autonomous — you watch it. The Studio is singular — one ad, one preview, one
push button. The middle is where a creative director actually works: choosing
between hooks, tightening a scene order, spinning a controlled alternate,
locking what's proven, reassigning what a card even IS, and killing what's
weak — **without re-briefing and without losing the strategy**. That is the
Canvas.

It is explicitly NOT:

- a whiteboard (nothing starts blank),
- a generic node editor (nodes are typed ad-anatomy, not free boxes),
- a second Studio (it directs; it does not finish or publish),
- a panel inside the dashboard (it is a full-screen mode you enter and exit).

---

## 2. The landing experience (full-screen, mandatory)

**Full-screen immersive mode is a hard rule.** The instant the Canvas mounts
it takes over the entire viewport — portaled to `document.body`
(`createPortal`), sitting above the platform sidebar, topbar, and every
dashboard surface (`z-[100]`), with body scroll locked. Nothing from the
surrounding app remains visible. This isn't a panel you scroll past — it is a
mode you *enter* (via "Launch in Creative Canvas" or the Reactor·Canvas·Studio
toggle) and *exit* (the header's X, or Escape, which is layered — see §9).

**Arriving with a run — the campaign shell:**

1. **Campaign bar** — pinned, always visible: campaign name · **format tabs**
   (see below) · **Re-brief** · **Exit**.
2. **Shared strategy chip row** — Angle · Awareness · **Sophistication** ·
   Audience · Offer. Campaign-level, shown once, powering every format tab
   identically — every regeneration in every tab carries these as hard
   constraints.
3. **The pre-built structure** — inside each tab, one **lane per concept**
   (max 4), each lane a left-to-right message spine. The viewport opens on
   the first lane's opening at readable zoom.
4. **Direction Deck** (right panel, nothing selected) — teaches Edit /
   Regenerate / Branch / **Drag to reassign** / Render / Send to Studio, plus
   a one-line shortcuts hint, plus the primary **Send to Studio** CTA.
5. **Reactor-seeded media** — any image/video the Reactor already
   auto-generated shows up immediately, tagged "⚡ From your run."

**Multi-format campaigns — 1 campaign = shared strategy, N formats = N tabs.**
When the brief selects more than one creative format (e.g. Image + Video +
Montage), the system organizes it as ONE campaign with ONE shared strategy
layer and **one tab per selected format family** in the campaign bar:

```
Off The Tools — Q3   [ IMAGE | VIDEO | MONTAGE ]
```

- Deliverables map to tabs: Static/Carousel → **Image**, Video/UGC →
  **Video**, Montage / Scene Flow → **Montage**.
- Variations are NOT a tab. Each format carries its own variation count and
  lever (set on the Formats step), so a format's versions all land inside that
  format's own tab — three static hook variations are three cards in **Image**,
  never a separate track.
- Every tab inherits the same strategy chips and the same brief intelligence;
  only the creative flow inside differs (per-mode node structures, §4).
  Formats are never mixed into one graph — no mixed-node chaos, ever.
- Each tab pulls the run's concepts matching its medium (image tabs build
  from static/campaign concepts, video tabs from video/founder/testimonial
  concepts, montage tabs from concepts carrying scene briefs), falling back
  to all visual concepts so a tab is never empty.
- Tabs are **lazy-mounted on first visit and kept alive after** — switching
  formats never loses in-progress edits, branches, alternates, or renders.
- Entry lands in campaign context on the first selected format's tab; the
  montage "Launch in Creative Canvas" CTA lands directly on the Montage tab.
  With a single format selected the tab bar collapses to a mode badge.
- **(planned)** cross-format adaptation: promote a strong concept from one
  tab into another (image → video, video → montage, montage → image) with a
  structure-conversion pass.

**Arriving without a run**: one headline, one paragraph, three capability
cards (Pre-structured · Branch · Regenerate), one CTA into the brief. Still
full-screen — the empty state is not an excuse to show dashboard chrome.

---

## 3. The node system

Nodes are the anatomy of an ad, not generic boxes. Every node carries:
`kind · title · text · sub (supporting line) · score · locked · approved ·
lane · branchIdx`.

| Node | Accent | Purpose | Key content | Actions | Reassignable target? |
|---|---|---|---|---|---|
| **Hook** | emerald | The scroll-stopper; first line before the fold | one line, ≤125 chars | edit · regenerate · branch · lock · approve · drag | ✔ |
| **Message** | cyan | The argument (titled *Script / VO* in video/montage modes) | 2–4 short paragraphs | edit · regenerate · branch · lock · approve · drag | ✔ |
| **Proof** | blue | What grounds the concept — retrieved Vault evidence | basis citation | edit · regenerate (unlocked only) · lock (locked **by default**) · drag | ✔ |
| **Visual Direction** | violet | What the creative shows (non-montage lanes) | frame-by-frame beats | edit · regenerate · branch · render still · animate · drag | ✔ |
| **Scene** | violet | One beat of a montage | direction + caption/VO line | edit · regenerate · add-scene-after · remove · render still · animate · drag | ✔ |
| **CTA** | amber | The ask — headline + Meta button type | ≤40-char headline | edit · regenerate · branch · lock · approve · drag | ✔ |
| **Output** | pink | The assembled ad unit for the lane; shows the Reactor's auto-render in montage mode | type, rubric score, media preview | send to Studio | ✘ — fixed slot, never draggable |

**Connections** are a fixed spine, never free-wired:
`hook → message → proof → (scenes… | visual) → cta → output`. Branch
alternates hang off the same upstream/downstream pair with dashed edges.

**Every card is movable, every card can be reassigned** (structured
freedom — see §15): every content card — Hook, Message, Proof, Visual,
Scene, CTA — is a valid drag source AND a valid target role. Proof can
become the Hook; a Hook can become the CTA; a Scene can become the opener.
The single exception is Output, which is the lane's assembled unit, not a
creative role. Retrieved-evidence Proof nodes arrive locked, which protects
their content from regeneration until deliberately unlocked — but never
blocks moving or reassigning them.

**(planned)** Audience/Offer/Mechanism as first-class nodes — today they are
strategy-bar chips (constraints on every node), graduating to nodes only when
per-lane audience/offer swaps ship.

---

## 4. Behavior per output mode

The mode is derived from the brief's deliverables (`canvasMode()`); the badge
in the strategy bar names it.

**A. Static Image** — lanes are compact: hook → message → proof → visual →
CTA → output. The visual node renders a still at the brief's chosen ratio via
the chosen image model. Scene machinery never appears.

**B. Short-Form Video** — the message node is retitled **Script / VO**; the
visual node holds the frame-by-frame production brief. Render = still first
(cheap look-check), then animate.

**C. Montage / Multi-Scene** — the signature mode. The Formats step gives the
montage deliverable **two real model pickers** — a **Still Model** (renders
every scene) and a **Motion Model** (animates every scene) — with OpenMontage
shown as what it actually is: the scene-*planning* engine, never a render
model itself (see §14). The orchestrator writes production briefs as ordered,
specifically-labelled scene sequences (4–6 scenes: hook scene →
tension/proof → payoff → CTA scene); each frame becomes a **Scene node**.
Users reorder by shaping (add-scene-after, remove — the spine heals), rewrite
a single scene, regenerate a single scene, and render/animate scene by scene.
The Output node shows the Reactor's single combined preview render (when one
exists) as a passive thumbnail — a look-check, not a substitute for the
per-scene renders.

**D. Multi-Variation Pack** — the orchestrator anchors ONE core concept and
produces variants that change exactly one lever each (hook, proof, or visual
construction), naming the changed lever in each concept's basis. Each variant
is a lane — visually parallel, so the "one lever changed" discipline is
scannable.

**E. Recommend Best Format** — the reactor picks the single best-fit format
and says why; the canvas shows that one direction as the primary lane with
the recommendation named on the output node. Never four hedged directions
side by side.

---

## 5. Branching & variation logic

Branching is **controlled variation**, not canvas sprawl:

- **Branch a node** → a dashed *Alt n* card stacked directly under the
  original, wired to the same upstream and downstream nodes.
- **Approve** an alternate → it becomes the lane's *active take* for that
  kind (siblings auto-unapprove). The active take composes into the output
  and travels to the Studio.
- **Alternate hooks** = branch the hook node.
- **Swap offers / change audience level (planned)** = lane-level strategy
  override: duplicate the lane with a new offer/audience chip.
- **Alternate scene flows** = add/remove/rewrite scenes on the spine; branch
  the first scene and approve per-slot winners for a competing sequence.
- **Spin a winner into variations** = lock the winning lane's nodes, then
  branch one node at a time.

No free-form edge creation, no unbounded fan-out: alternates stack in place —
the deliberate anti-spiderweb decision.

---

## 6. Regeneration — precise, never random

Regeneration is per-node and strategy-coherent (`POST /api/canvas/regenerate`):

- The request carries: node kind + title, current text, the **strategy
  snapshot** (angle, awareness, sophistication, audience, offer, offer name),
  the lane's **kept context** (locked + approved + primary neighbours), and
  an optional one-line **user steer**.
- The system prompt is the TPB copy chief: brand voice rules, compliance
  hard-nos, "produce a genuinely different take, not a paraphrase."
- Locked nodes cannot regenerate. Proof nodes never regenerate.
- A card that just changed role via reassignment (§15) regenerates **into
  its new kind explicitly** — the request never waits on a stale state
  read-back; kind, title, and current text are passed directly.
- Zero-key mode serves curated TPB alternates so the loop always works.

---

## 7. The strategic intelligence layer

- **Always visible**: the chip row (angle · awareness · sophistication ·
  audience · offer).
- **On selection**: the node's hint, the lane's rubric score, the proof
  node's Vault citation.
- **Inside every action**: regeneration, reassignment-regeneration, and
  rendering all inject the strategy — the intelligence layer does its
  strongest work invisibly.
- **(planned)**: mechanism + likely-objection chips from the Strategic
  Intelligence read; NEURO predicted-response on the output node.

---

## 8. UX hierarchy

- **Visible by default**: strategy bar, chip row, the node structure, the
  Direction Deck.
- **One click away**: the editor, steer input, action grid, production
  controls, evidence.
- **One right-click away**: the full action set (Regenerate / Branch-Duplicate
  / Lock / Approve / Send to Studio / Delete) via the context menu — no need
  to select-then-scroll-to-panel for a quick action.
- **Deliberately absent**: minimaps, toolbars of shapes, free-edge handles,
  layer panels.
- **Cognitive-load ceiling**: max 4 lanes; alternates stack under their slot;
  node bodies clamp to 4 lines; the viewport opens on one lane's opening.

---

## 9. Key user actions

| Action | Where | What it does |
|---|---|---|
| Edit | detail panel textarea | Direct rewrite; user words always win |
| Regenerate | panel · right-click | One node, strategy-coherent, optional steer |
| Branch / Duplicate | panel · right-click · ⌘/Ctrl+D | Controlled alternate under the original |
| **Drag to reassign** | canvas | Drop a card on a different-kind slot → position swaps immediately, a modal asks whether the ROLE follows (§15) |
| Approve | panel · right-click | Marks the active take for its slot |
| Lock / Unlock | panel · right-click | Freezes a node against regeneration; feeds "kept context" |
| Add scene after / Remove | panel (scenes, alts) · Delete key | Shapes the montage spine; the spine self-heals |
| Render still / Animate | node + panel | Scene/visual → still → clip on the pinned models |
| Send to Studio | header · panel · right-click | Composes the lane's active takes into a Meta ad package |
| Re-brief | header | Back to the campaign wizard |
| Exit Canvas | header · Escape | Leaves full-screen mode (layered — see below) |
| Compare / Clone / Convert format | **(planned)** | Bottom compare tray; lane duplication; static↔video↔montage conversion |

**Right-click context menu**: appears anchored to the card, listing only the
actions valid for that node's kind (Regenerate/Branch hidden for Proof;
Delete only for alternates and scenes). Closes on outside click or Escape.

**Keyboard shortcuts**: `Delete`/`Backspace` removes the selected alternate
or scene; `⌘/Ctrl+D` duplicates (branches) the selected card if its kind
supports branching; both are ignored while typing in the detail panel.
`Escape` is **layered**, never a single blunt action: it closes an open
context menu first, else clears the node selection, else exits full-screen
Canvas — one press does the most local thing. While the reassignment modal is
open, Escape does nothing on purpose; that decision needs an explicit choice,
never an accidental dismiss.

---

## 10. Connection to the Studio

"Send to Studio" is a **composition**: the lane's active hook + message
become the primary text, the active CTA headline becomes the headline, and
the source concept's ad package supplies the button type and description.
Seeds the existing Studio editor exactly like "Configure in Studio" —
live Meta feed preview, fold discipline, compliance validation, NEURO
pre-test, *Push Creative to Meta*.

Montage handoff: scenes rendered/animated on the canvas surface their media
on the concept cards; **(planned)** a montage assembly step (clip ordering +
export) sits between canvas approval and Studio publish.

---

## 11. Post-generation iteration

- **Refine a fresh concept**: edit/regenerate/branch/reassign in place.
- **Iterate a winner**: fire a new run with the winner as reference (Ad
  Library → Clone & Iterate), or lock the winning lane and branch one lever
  at a time.
- **Controlled A/B**: the "Iterate one thing" isolation test lives in the
  brief's Ignition step; branch+approve is its hands-on counterpart on an
  existing run.
- **Convert formats (planned)**: static lane → video lane; video → montage;
  winner → variation pack.

---

## 12. Screen structure (full-screen, mandatory)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚙ CREATIVE CANVAS  Campaign name  [IMAGE|VIDEO|MONTAGE]  Re-brief ✕  │  campaign bar
│  Angle · Awareness · Sophistication · Audience · Offer                │  shared strategy
├──────────────────────────────────────────────────────┬───────────────┤
│  (active format tab — its own canvas + node flow)     │  Direction    │
│   lane 0:  HOOK → MESSAGE → PROOF → S1 → S2 → … → ⚡  │  Deck /       │
│   lane 1:  HOOK → MESSAGE → PROOF → …                 │  Node editor  │
│              └ Alt 1 (dashed)                         │  + SEND →     │
│   pan/zoom canvas · criss-cross ember grid            │  (right rail) │
│   [+ – ⤢] controls · right-click → context menu       │               │
└──────────────────────────────────────────────────────┴───────────────┘
```

One campaign bar, one shared strategy row, N format tabs — each tab is a
fully independent canvas pane (own graph, selection, media, alternates),
kept alive across switches.

This is the ENTIRE screen — no sidebar, no topbar, no dashboard cards. The
background is the same faded criss-cross engineering grid as the campaign
brief panel, so brief → canvas reads as one continuous system even though the
surrounding chrome has disappeared.

**Implementation note**: the persistent chrome (strategy bar, chip row, the
canvas+panel grid) is lifted above the background grid via a scoped
`.canvas-lift` class on those three wrappers specifically — never a blanket
"all direct children" rule, which would clobber `position: fixed/absolute` on
the modal and context menu that also live as direct children of the shell.

---

## 13. Empty state & first use

First entry with no run: headline, paragraph, three capability cards, one CTA
into the brief — full-screen from the first frame. First entry with a run:
the Direction Deck *is* the onboarding — five verbs in the order a user needs
them, plus the shortcuts hint. No tours, no tooltips-on-everything.

---

## 14. Automated vs. manual

**The system does automatically**: build the whole first structure from the
run; derive the mode from the brief; write scene sequences (montage block);
recommend the Still + Motion models for montage (OpenMontage sequences them,
never renders itself); pin the strategy to every regeneration; lock proof
nodes; heal the spine when scenes are removed; seed cards with whatever the
Reactor already rendered; compose the ad package on handoff; swap card
positions the instant a drag lands near a different slot.

**The user controls, always**: the words (edit beats everything); which take
is active (approve); what is frozen (lock); scene order and count; when to
spend on renders; **whether a position change becomes a role change**
(the reassignment modal never auto-confirms); when a lane is done. The system
proposes, the human directs.

---

## 15. Semantic card reassignment — interaction rules

This is a signature behavior: position can change meaning.

**Universal rule**: every card is movable, every card can be repositioned,
and every content card can be reassigned when dropped into a new semantic
role — this applies across the entire canvas, not to one or two special
kinds. Hook, Message, Proof, Visual, Scene, and CTA are all both sources and
targets (Proof → Hook, Hook → CTA, Scene → opener, …). Only Output is fixed.

**How it detects a reassignment**: on drag stop, the dragged card's landing
position is compared against every *other primary card in the same lane*.
If it lands within roughly two-thirds of a card-width of a **different-kind**
content card, that's treated as "dropped onto that slot."

**What happens immediately**: the two cards' positions swap — always, no
confirmation needed for the visual move itself. This is the "structured
freedom" the product spec calls for: dragging is never blocked or vetoed.

**What happens next**: a modal appears —

> *"This **Proof** card will now become the **Hook**. Lock it in?"*

with four choices, always in this order:

1. **Reassign & regenerate for the new role** — the card's kind and title
   change to the target's role, AND its content is regenerated into that
   role (the old Proof text is passed as context; the model writes an actual
   hook). This is the recommended, highlighted default.
2. **Reassign role, keep the current words** — kind and title change, the
   text stays exactly as written (the user will hand-edit it themselves).
3. **Keep visual move only — no role change** — the cards stay at their
   swapped positions, but neither's kind/title changes. Purely cosmetic
   rearrangement.
4. **Cancel — undo the move** — both cards snap back to their original
   positions, nothing changes.

**What changes on confirm**: both cards in the swap trade `kind` AND `title`
(a full round-trip — the target's original role also gets relabeled with
the dragged card's old kind, so nothing is orphaned). A role change always
**unlocks** both cards — the old lock guarded the old role's content, not the
new one. Downstream edges never need to be touched: they're attached to node
IDs, not kinds, so the message spine stays wired correctly regardless of
which role now sits at which position.

**How warnings stay non-annoying**: the modal only appears for a genuine
cross-kind drop near another primary card's slot. Dragging into empty space,
repositioning within the same kind (e.g. rearranging two scene cards), or
moving a branch alternate never triggers it — those are cosmetic by
definition. There is no "are you sure" on ordinary edits, locks, approvals,
or branches — only on an actual role change, which is the one action that
could silently break a hard-won piece of copy if it happened by accident.

---

## 16. Product-level recommendations

1. **The differentiator is the spine — and now the semantic reassignment.**
   Every competitor canvas (free-form node tools, Figma/Miro-style boards) is
   generic; TPB's is *ad anatomy with strategy-coherent regeneration and a
   card that knows what it's for*. Protect both: resist free-edge wiring
   forever, and never let reassignment silently auto-confirm.
2. **Make montage's two-model split the template for future modes.**
   Naming "Still Model" and "Motion Model" explicitly (instead of hiding them
   behind "OpenMontage") was the right call — apply the same instinct
   anywhere a pipeline name could obscure what's actually rendering.
3. **Wire every "the Reactor already did this" moment.** The media-seeding
   fix (cards showing "⚡ From your run" instead of an empty render button)
   is a small thing that compounds trust — a canvas that makes you redo work
   the system already did feels broken even when every button works.
4. **Full-screen is non-negotiable, but exits must be layered.** A single
   Escape key that always exits is hostile the moment a context menu or a
   modal is open — always dismiss the most local thing first.
5. **Simplify ruthlessly**: keep max lanes at 4; keep alternates capped;
   never add a toolbar.
6. **Hide the machinery**: model names, request IDs, and provider states
   stay in the panel's fine print. The canvas speaks creative, not
   infrastructure.
7. **Make the handoff the habit loop**: canvas → Studio → push → Meta ingest
   → ORACLE outcome → next run retrieves the winner. Every surface should
   show its neighbor, so the production line is felt, not documented.
