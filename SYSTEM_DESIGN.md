# System Design — Creative Reactor

**Engineered For Performance.**

A Creative Intelligence Command Center for a performance marketing operator. It
turns a connected website, uploaded assets, proven ads that are live in the
market, and measured performance data into the next winning campaign. It answers
one question:

> "What should we create next, based on everything that has already worked?"

The platform is white-labelled and ships blank — it names no business, and the
tenant resolves at runtime from the connected website (`lib/tenant.ts`).

This document is the build spec. Living draft (v0.2 — reflects the agentic
Campaign Reactor).

---

## 1. The big picture (plain English)

Think of the platform as three layers:

1. **The Vault (memory)** — everything the account knows: winning ads, hooks,
   frameworks, member transformations, research, documented learnings. This is
   stored so it can be *searched by meaning*, not just keywords.
2. **The Orchestrator (the agent / "strategist")** — an AI that, when you fire a
   campaign, goes and *reads* the relevant parts of the Vault, reasons over
   them, and drafts grounded concepts. It is not one big prompt — it works in
   steps, pulling exactly what it needs.
3. **The Command Center (the UI)** — the nine intelligence dashboards plus the
   Campaign Reactor page where you watch the agent work and collect its output.

The loop closes when a generated concept actually runs: you mark winners, and
those winners go *back into the Vault* — so the next campaign is built on an
even larger base of proof. That is what "gets smarter over time" means here.

---

## 2. What the Orchestrator actually does

When you hit **Fire Reactor** on the Campaign Reactor page, this runs:

```
You: angle = "Profit", outputs = [Hook, Founder Concept, Campaign Concept]
        │
        ▼
┌──────────────────────────── Orchestrator (Claude Opus 4.8) ───────────────────────────┐
│ 1. Plans what evidence it needs.                                                       │
│ 2. Calls search_knowledge(...) — repeatedly — across the intelligence systems:         │
│       research pains/desires · member transformations · winning creatives ·            │
│       top-performing copy · repeatable patterns                                         │
│ 3. Calls get_learnings() — pulls the Creative Learnings rubric                          │
│ 4. Drafts concepts grounded in what it retrieved                                        │
│ 5. Self-scores each concept 1–10 against the rubric; drops anything below 7             │
│ 6. Calls submit_concepts(...) — final, with a basis + rubric note + score per concept   │
└────────────────────────────────────────────────────────────────────────────────────────┘
        │  (every step is streamed to the UI as a live telemetry feed)
        ▼
Concepts appear in the Reactor, each citing the winning asset/pattern it drew from.
```

The agent has exactly **three tools**:

| Tool | What it does |
|---|---|
| `search_knowledge(query, system?)` | Semantic search over the Vault, optionally scoped to one intelligence system |
| `get_learnings()` | Returns the Creative Learnings rubric so the agent can self-grade |
| `submit_concepts(concepts[])` | Ends the run with the final, scored, evidence-cited concepts |

The SDK's tool-use loop lets the agent decide *when* and *what* to retrieve —
that's the difference between "an agent walking the frameworks" and a single
canned prompt.

---

## 3. How it's connected to the whole system

```
   Knowledge Vault (uploads)
        │  /api/vault/ingest  → chunk → Voyage embeddings → pgvector
        ▼
   knowledge_chunks  ◄───────────────┐  match_knowledge() cosine search
        ▲                            │
        │ winners re-ingested        │  search_knowledge tool
        │ /api/.../outcome           │
        │                     ┌──────┴───────┐
   campaign_outcomes ◄────────┤ Orchestrator │  /api/campaign-reactor (SSE stream)
                              └──────┬───────┘
                                     │  streams steps + concepts
                                     ▼
                          Campaign Reactor UI (telemetry feed + concept cards)
```

- **Retrieval, not a bigger prompt.** Vault content is chunked, embedded with
  Voyage `voyage-3`, and stored in Supabase `pgvector`. The agent pulls only the
  most relevant chunks per query — so it scales as the library grows.
- **Graceful degradation.** With no Voyage/Supabase/Anthropic keys, retrieval
  falls back to a corpus built from the curated demo intelligence and the agent
  runs in demo mode. The platform always works end to end.

---

## 4. Data model (RAG + learning loop)

See `supabase/schema.reactor.sql` (plus the earlier `schema.platform.sql` /
`schema.p2.sql` for builders and frameworks).

| Table | Purpose |
|---|---|
| `knowledge_chunks` | Embedded Vault content (1024-dim vectors); the retrieval substrate |
| `match_knowledge()` | SQL function: cosine-similarity search, scoped by system/builder |
| `campaign_outcomes` | How generated concepts performed; winners feed back into the Vault |

---

## 5. The learning loop (why it compounds)

1. **Knowledge grows** — every Vault upload becomes retrievable. More proof →
   better concepts. Automatic.
2. **Learnings as a live rubric** — the Creative Learnings page is the agent's
   scoring guide. Add a learning and the bar rises immediately.
3. **Outcome memory** — mark a concept a winner and it is re-ingested as a new
   `pattern` chunk. Future runs retrieve it as proven evidence.

"Gets smarter" = a richer, better-labelled **memory + retrieval layer** — not
the base model retraining itself.

---

## 6. Models

| Role | Model | Why |
|---|---|---|
| Orchestrator (tool-use loop) | `claude-fable-5` | Long-horizon multi-step reasoning over retrieved evidence |
| Orchestrator fallback | `claude-opus-4-8` | Server-side safety fallback for classifier declines + client-side switch when the org can't run Fable 5; also serves the single-shot suggest/intelligence strategy calls |
| High-volume copy + intelligence layers | `claude-sonnet-5` | Cheaper/faster for bulk drafting and structured passes |
| Embeddings | Voyage `voyage-3` | Anthropic doesn't make an embeddings model |

Models are single constants (`ORCHESTRATOR_MODEL`, `ORCHESTRATOR_FALLBACK_MODEL`,
`INTELLIGENCE_MODEL` in `lib/models.ts`).

---

## 7. How to test it

See the "Testing the agent" section in `CLAUDE.md`. Short version: open
`/campaign-reactor`, pick an angle, hit **Fire Reactor**, and watch the
**Reactor Telemetry** feed. With no keys it runs in demo mode (still shows the
step-by-step flow). With `ANTHROPIC_API_KEY` (+ optionally `VOYAGE_API_KEY` and
Supabase) it runs the real agent and the telemetry shows its actual searches.

---

## 8. Roadmap

- ✅ **RAG foundation** — pgvector + Voyage embeddings + embed-on-upload.
- ✅ **Agentic Campaign Reactor** — orchestrator + tool-use loop, streamed.
- ✅ **Self-critique** — learnings-as-rubric scoring before submit.
- ✅ **Learning loop** — outcome logging + winner re-ingest.
- ⏭️ **Specialist sub-agents** — split into Research/Creative/Copy/Pattern
  analysts under a coordinator (Anthropic Managed Agents multi-agent), once the
  single-agent version is validated with real keys.
- ⏭️ **Wire the Vault uploads** to `/api/vault/ingest`, and the dashboards to
  live `knowledge_chunks` counts.
- ✅ **Performance ingest** (Meta API) auto-populates `campaign_outcomes`:
  ad-level CTR/CPL/ROAS graded against the account cohort, winners re-ingested
  into the Vault (`lib/meta-ingest.ts`, `POST /api/meta/ingest`).
- ✅ **Launch-ready Meta ad units** — every concept ships with a validated
  `adPackage` (fold-safe primary text, headline/description limits, CTA type);
  contract in `lib/meta-ads.ts`, enforced at the submit gate.

---

## 9. Honest constraints

- The loop only truly "learns" once **outcome data** flows in — without winners
  marked, it is a (very good) retrieval system, not a feedback loop yet.
- A handful of outcomes is **not a pattern** — treat early learnings as
  guidance until volume builds.
- **Curation beats volume** — tag and prune the Vault; a tight library
  outperforms a dumping ground.
