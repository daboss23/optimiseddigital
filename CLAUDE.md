# CLAUDE.md — Optimised Digital (TPB Creative Reactor)
## Claude Code Project Rules — Read This First Every Session

---

> **Repository identity:** This is **Optimised Digital** — the standalone
> repository behind `optimiseddigital.vercel.app`. It was branched from the
> **TPB Creative Reactor** project to run as its own independent product, and
> it deploys from this repo's `main`. The platform architecture, rules, and
> module names below are inherited from TPB Creative Reactor and still apply
> verbatim; "TPB Creative Reactor" throughout this document refers to that
> shared platform. The default branch here is `main` (not a `claude/*` working
> branch), so open PRs into `main` from your session branch.

---

## PROJECT OVERVIEW

This is a Next.js app: **TPB Creative Reactor** (running as **Optimised
Digital**) — a premium AI-powered Creative
Intelligence Command Center for The Professional Builder. It turns 20+ years of
winning creative assets, member wins, frameworks, SOPs, research, and
performance data into the next winning campaign, answering one question:
"What should TPB create next, based on everything that has already worked?"

It is built around nine intelligence systems (Reactor Dashboard, Knowledge
Vault, Research, Creative, Copy, Strategic Memory (ORACLE), Campaign Reactor,
Creative Learnings, Recommendations). The Campaign Reactor runs an **agentic
orchestrator** (a Claude tool-use loop) over a RAG knowledge layer. See
`SYSTEM_DESIGN.md` for the full architecture.

Tagline: **Engineered For Performance.**

---

## ABSOLUTE RULES — NEVER BREAK THESE

- **Work on the branch the session gives you, then PR into `main`.** `main` is the single source of truth, but Claude Code on the web starts every session on a generated working branch (e.g. `claude/...`) and the GitHub proxy *only allows pushes to that current working branch* — pushing straight to `main` is blocked at the network layer, so do not try. Commit and push to the session branch, then open (or merge) a pull request into `main`. In a local/terminal session with no branch override, committing directly to `main` is fine.
  - **"Push updates to main" = open a PR from the session branch and merge it.** This is the *only* way to get changes onto `main` from a web session — it is expected and correct, not a workaround. Do not tell the user direct pushes are impossible and stop there; go ahead and open the PR (and merge it if they asked to push to main), then report the merge. Never treat "push to main" as blocked — treat it as "PR + merge."
- **Always provide complete, ready-to-use files. Never provide partial edits or snippets.**
- **Never use inline styles. Tailwind classes only.**
- **Never use any UI component other than shadcn/ui.**
- **TypeScript only. No plain JavaScript files.**
- **Never leave TODO comments or placeholder code in final files.**
- **If a file already exists, provide the full updated version — not just the changed section.**

---

## TECH STACK

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS |
| Components | shadcn/ui exclusively |
| Database | Supabase |
| Copy AI | Anthropic Claude API — orchestrator `claude-fable-5` (Opus 4.8 fallback), bulk `claude-sonnet-5` (see `lib/models.ts`) |
| Embeddings | Voyage AI `voyage-3` (RAG retrieval) |
| Vector store | Supabase `pgvector` (`knowledge_chunks`) |
| Image AI | fal.ai (FLUX) + Higgsfield Soul — direct Gemini/OpenAI image removed (fal + Kie only) |
| Deployment | Vercel |

---

## PROJECT STRUCTURE

```
summit-build-creative/
├── CLAUDE.md                        ← you are here (Claude Code rules)
├── brand/
│   └── BRAND_MEMORY.md              ← Summit Build Co brand intelligence
├── skills/
│   ├── meta-frameworks.md           ← Meta ad frameworks and knowledge
│   └── hooks-library.md             ← Proven hooks swipe file
├── app/
│   ├── layout.tsx
│   ├── page.tsx                     ← main dashboard
│   ├── globals.css
│   └── api/
│       ├── generate-copy/route.ts   ← Claude API call
│       ├── generate-image/route.ts  ← Higgsfield API call
│       └── save-output/route.ts     ← Supabase save
├── components/
│   ├── BriefForm.tsx
│   ├── CopyOutput.tsx
│   ├── ImageOutput.tsx
│   └── AdPreview.tsx
├── lib/
│   ├── brand-memory.ts              ← reads brand/BRAND_MEMORY.md
│   ├── skills.ts                    ← reads skills/ folder
│   └── supabase.ts
└── types/
    └── index.ts
```

---

## ENVIRONMENT VARIABLES

These live in `.env.local` — never commit this file.

```
ANTHROPIC_API_KEY            # Campaign Reactor agent + copy generation
VOYAGE_API_KEY               # Embeddings for the RAG knowledge layer
OPENAI_API_KEY               # Comparison copy / image (GPT Image)
GEMINI_API_KEY               # Nano Banana 2 image model (Gemini) — or GOOGLE_API_KEY
HF_CREDENTIALS               # Higgsfield image + video ("KEY_ID:KEY_SECRET")
FAL_KEY                      # fal.ai gateway → Seedance/Kling/Veo/Wan video models
MUAPIAPP_API_KEY             # Muapi unified image + video gateway — CURRENT DEFAULT for both
                             #   ovens (on trial). Sandbox keys return mock data instantly and
                             #   spend no credits — use one for integration testing. Remove the
                             #   key and both ovens fall back to Kie/fal/Higgsfield automatically.
                             #   Endpoint slugs come VERBATIM from muapi.ai/llms.txt — there is no
                             #   derivable convention. They previously carried an invented "-image"
                             #   suffix, so every frontier model 404'd and the oven fell through to
                             #   FLUX.1 Dev — the weakest text renderer — which is what shipped ads
                             #   with misspelled headlines. `npm run muapi:slugs` probes your key
                             #   and prints the override to set if one drifts again.
                             #   Optional overrides (vendor slugs drift; no code change needed):
                             #   MUAPI_API_BASE, MUAPI_POLL_TIMEOUT_MS,
                             #   MUAPI_IMAGE_RESOLUTION (1k/2k/4k, default 2k — 1k is where
                             #     headline letterforms go soft; unsupported by a model = auto-retry
                             #     without it),
                             #   MUAPI_MODEL_NANO_BANANA_PRO / _GPT_IMAGE_2 / _IMAGEN4_ULTRA /
                             #   _NANO_BANANA_2 / _SEEDREAM / _FLUX_3 / _FLUX_KONTEXT_MAX /
                             #   _MIDJOURNEY / _FLUX_DEV (images — slugs are taken verbatim from
                             #   muapi.ai/llms.txt and follow NO single convention: bare
                             #   (nano-banana-pro), mode-suffixed (gpt-image-2-text-to-image),
                             #   versioned (midjourney-v8), vendor-prefixed
                             #   (bytedance-seedream-5.0-pro). Never "tidy" one into a pattern —
                             #   guessing is what caused the misspelled-headline bug),
                             #   MUAPI_VIDEO_VEO31_T2V / _I2V / _R2V, _VEO4_T2V / _I2V,
                             #   _SEEDANCE2_T2V / _I2V / _R2V, _SEEDANCE2_FAST_T2V / _I2V / _R2V,
                             #   _KLING3_T2V / _I2V, _WAN27_T2V / _I2V / _R2V (video — the SAME
                             #     verbatim-slug rule as images, and it bit here too: invented
                             #     `veo3` / `kling-pro` / `seedance-pro` / `wan2.2` 404'd, so a
                             #     UGC ad ordered on Veo 3 came back as a GPT Image 2 STILL.
                             #     Slugs follow no convention — veo3.1-text-to-video and
                             #     wan2.7-text-to-video spell the mode out, while
                             #     kling-v3.0-pro-image-to-video, seedance-2-omni-reference and
                             #     veo-4-text-to-video each do it differently. Take them
                             #     verbatim; `npm run muapi:slugs -- --video` re-probes when a
                             #     vendor renames one)
PIPEBOARD_API_TOKEN          # Meta Ads MCP (live ad performance) — optional
META_ACCESS_TOKEN            # Meta Marketing API (System User token) — /meta dashboard + performance ingest + creative publish
META_AD_ACCOUNT_ID           # Ad account for "Push Creative to Meta" (with or without act_ prefix)
META_PAGE_ID                 # Facebook Page the pushed creatives run under
META_LINK_URL                # Optional — destination link on pushed creatives (default https://theprobuilder.com)
META_APP_SECRET              # Optional — adds appsecret_proof request signing
META_INGEST_MIN_SPEND        # Optional — spend floor to grade an ad (default 50)
META_INGEST_DATE_PRESET      # Optional — Graph date_preset for the sync (default last_30d)
REACTOR_ORCHESTRATOR         # Optional — which tier drives the Reactor's tool-use loop.
                             #   Default Opus 4.8: it keeps the FULL arc (consult → refine →
                             #   submit, revision pass included) but turns over 2-3x faster than
                             #   Fable 5, whose always-on thinking pushed a full run to ~4m09s
                             #   against a 300s host kill. Set to `fable` for the deeper
                             #   reasoning tier and compare the ads — the run names its
                             #   orchestrator in the telemetry so an A/B is judged on output.
                             #   Note this is the ORCHESTRATOR only; Fable 5 stays the
                             #   ORCHESTRATOR_MODEL in lib/models.ts.
REACTOR_BUDGET_MS            # Optional — wall-clock budget for one Reactor run (default 280000)
                             #   MUST sit under the host's function ceiling. With Fluid compute
                             #   (on by default) Vercel serves 300s on EVERY plan, Hobby included,
                             #   so the default fits a stock deployment and needs no env var.
                             #   Set it LOWER only on a host that really does cut sooner —
                             #   a legacy 60s plan or a self-hosted runner → 50000
                             #   Under 90000 the run takes the FAST PATH: orchestrates on
                             #   Opus 4.8 (Fable 5's always-on thinking is too slow to land
                             #   inside a minute), submits straight from the preflight
                             #   briefing, and skips the NEURO revision pass.
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Always check these exist before building any API route. For the Reactor agent
and retrieval specifically, **do not throw on missing keys** — fall back to the
curated demo intelligence / demo agent mode so the platform always works end to
end. For destructive writes (Supabase inserts), surface errors clearly.

---

## API CONVENTIONS

### Claude API calls
- **Orchestrator (Campaign Reactor tool-use loop): `claude-fable-5`** — long-horizon multi-step reasoning over retrieved evidence. Defined once as `ORCHESTRATOR_MODEL` in `lib/models.ts`. Fable 5 rules: never send `thinking` or sampling params (`temperature`/`top_p`/`top_k`) — both 400; safety classifiers can decline with `stop_reason: "refusal"`, so the reactor opts into the server-side fallback (`SERVER_SIDE_FALLBACK_BETA` + `fallbacks: [{model: ORCHESTRATOR_FALLBACK_MODEL}]`) and also falls back client-side when the org can't run Fable 5 at all (30-day data-retention requirement → 400 on every request).
- **Single-shot strategy calls (suggest / intelligence): `ORCHESTRATOR_FALLBACK_MODEL` (Opus 4.8)** — latency-sensitive picks fired while the user types; Fable's always-on thinking isn't worth the wait there.
- **High-volume / single-shot copy + intelligence layers: `claude-sonnet-5`** — cheaper and faster for bulk drafting, the NEURO pre-test, and the legacy generate-copy route. Defined once as `INTELLIGENCE_MODEL` in `lib/models.ts` (same list price as the prior `claude-sonnet-4-6`, higher quality).
- Max tokens: 2000–4000 for copy/concept generation
- Always wrap in try/catch
- Always strip markdown fences before JSON.parse (use `lib/parse.ts`)
- System prompt must always inject brand memory + skills/frameworks content

### Embeddings (RAG knowledge layer)
- Provider: **Voyage AI**, model `voyage-3` (1024-dim) — Anthropic has no embeddings model. See `lib/embeddings.ts`.
- Stored in Supabase `pgvector` (`knowledge_chunks`); retrieved via `match_knowledge()`. See `lib/knowledge.ts` and `supabase/schema.reactor.sql`.
- All retrieval degrades gracefully to a curated demo corpus when keys/DB are absent.

### Higgsfield (image + video)
- Use the official SDK **`@higgsfield/client`** (v2) via `lib/higgsfield.ts` — never shell out to the CLI (it needs a browser login + long-running process and can't run in a Vercel serverless route). Auth is `HF_CREDENTIALS` ("KEY_ID:KEY_SECRET").
- `generateImage()` blocks until the still is ready (returns the URL inline). `startVideo()` is fire-and-forget — video renders take minutes, so the client polls `getVideoStatus()` via `/api/generate-video`.
- Exposed to the Campaign Reactor agent as the `generate_image` / `generate_video` tools (only when `HF_CREDENTIALS` is set). Results stream to the Reactor as `media` SSE events and render on the concept cards.
- Never throw on missing keys or failed renders — return null/`unknown` so the copy stays usable.

### Image models (multi-provider "oven")
- The image layer lives in `lib/image/` and mirrors the video layer. `lib/image/registry.ts` is the menu: **fal-flux** (FLUX via fal, `lib/image/fal.ts`), **higgsfield-soul** (Higgsfield SDK). Direct Gemini/OpenAI image providers were removed — the platform uses fal (and Kie when wired) plus Higgsfield only. One provider key each.
- `lib/image/index.ts` dispatches `generateImageWith(modelId, prompt, aspectRatio)` → `{ imageUrl, modelId, provider }`, picking the best configured model when none/an unconfigured one is requested, with automatic fallback to any other configured provider. Never throws — returns null.
- Exposed to the agent as `generate_image` with a `model` selector; `lib/image/recommend.ts` suggests a model from the requested output types (Higgsfield Soul for photographic founder/testimonial, FLUX/fal for everything else).
- API: `GET /api/image/models` lists the menu + configured status; `POST /api/generate-image` is model-aware and returns `{ model, provider }` (backward compatible — prompt only renders on the default/best model).
- **4:5 is a first-class still ratio** — Meta's tall feed unit, the largest footprint a static ad gets in the mobile feed, and the default for Static Creative. It is deliberately IMAGE-ONLY: `lib/video/types.ts` keeps its own ratio union, and the reactor's `generate_video` narrows 4:5 → 9:16 rather than handing a video model a ratio it cannot render. A still model that doesn't declare 4:5 (GPT Image 2) snaps to its nearest portrait via `supportedRatio()`.
- Every model carries a **`textFidelity`** (`strong` / `moderate` / `weak`) alongside its tier — a separate axis, because quality is not spelling: Midjourney is flagship-grade and cannot set a headline; FLUX.1 Dev mangles anything past two words. When a prompt carries literal copy (`promptCarriesCopy()`), the fallback chain is re-ordered so text-strong models come first, on BOTH the sync and async paths.
- A render that does not run on the model it was asked for is **reported, never silent**: `generateImageDetailed` / `startImageJob` return `requestedModelId`, `fellBack` and a builder-facing `note`, `/api/generate-image` passes them through, and the concept card shows a warning under the still. A silent downgrade to a weak-text model is exactly how an ad ships with a misspelled headline.

### On-image text (why ads used to render as gibberish)
- **`lib/render-prompt.ts` is the ONE prompt path for stills.** It compiles a `ProductionBrief` into a prompt instead of concatenating it. The old `briefToPrompt` (removed from `lib/reactor-inputs.ts`) flattened every frame into one paragraph, handing the model 4–5 quoted strings buried in prose plus a contradictory "room for text overlay" — which is what produced "NOT DISORGARUSED" headlines and noise-band fine print.
- The compiler: separates SCENE from COPY (a copy-carrying frame never also appears as a scene beat — describing the headline slot twice causes doubled lettering), lists the literal strings under an `ON-IMAGE TEXT` header marked "reproduce exactly", enforces **`MAX_RENDERED_TEXT_BLOCKS` (2)** inside **`MAX_RENDERED_TEXT_CHARS` (95)**, folds an emphasised word quoted inside a headline into a treatment note rather than a second block, and DROPS fine print / compliance strips / logo lettering entirely (unrenderable at ad resolution). Everything dropped comes back in `omitted` with a reason — the full compliant copy still ships in the concept's `adPackage` for the caption, the Studio overlay and the Meta push.
- A brief with no on-image copy gets the opposite instruction: render no lettering at all, leave clean space for the overlay.
- OPUS declares on-image copy in **`productionBrief.onImageText`** (role / text / placement), constrained by `ON_IMAGE_TEXT_RULE` in the orchestrator prompt. Absent that, the compiler recovers the copy from quoted strings in the frames — both paths are covered.
- Guarded by `npm run selftest:render` (`scripts/render-prompt-selftest.ts`), which asserts the discipline against the exact brief that rendered wrong.

### Video models (multi-provider "oven")
- The video layer lives in `lib/video/` and is provider-agnostic. `lib/video/registry.ts` is the model menu (Seedance 2.0, Kling 2.5, Veo 3, Wan 2.5, Higgsfield DoP) with capabilities (modes, max duration, aspect ratios, native audio). Endpoints are env-overridable since vendor model paths drift.
- **fal.ai** is the single gateway for the frontier models — one key (`FAL_KEY`) unlocks Seedance/Kling/Veo/Wan via the async queue API (`lib/video/fal.ts`). Higgsfield stays wired through its own SDK.
- `lib/video/index.ts` dispatches start/poll into one `VideoJob` shape: `startVideoJob(modelId, input)` and `getVideoJob(modelId, requestId)`. Supports both `text-to-video` (full scene, e.g. a builder on-site or a person speaking) and `image-to-video` (animate a still). Use **veo-3** for spoken/UGC (native audio), **seedance-2.0**/**kling-2.5** for cinematic realism, **wan-2.5** for high-volume/budget.
- Exposed to the agent as the `generate_video` tool with a `model` + `mode` selector; renders stream as `media` SSE events. Every render is logged to `media_generations` (`lib/video/persistence.ts`, `supabase/schema.media.sql`) when Supabase is configured.
- API: `GET /api/video/models` lists the menu + which are configured; `POST/GET /api/generate-video` starts/polls a render (model-aware, backward compatible). Never throw on missing keys — return null/`unknown`.

### Meta Ads (MCP connector)
- Attach Pipeboard's hosted Meta Ads MCP to the orchestrator with Anthropic's **MCP connector** (`mcp_servers` + `mcp_toolset` on `anthropic.beta.messages.create`, beta header `mcp-client-2025-11-20`). Token auth via `PIPEBOARD_API_TOKEN` (`?token=` on the server URL).
- Only attached when configured; the agent runs normally without it. MCP tool calls execute server-side and surface in the telemetry feed.

### Meta ad units (launch-ready output)
- Every Reactor concept ships with an **`adPackage`** — a complete Meta ad unit (primary text with the hook inside the 125-char "See more" fold, ≤40-char headline, ≤30-char description, CTA button type). The contract lives in `lib/meta-ads.ts` — the type, Meta's limits, the validator (including the hard compliance phrases), the Ads-Manager clipboard format, the orchestrator prompt block, and the `submit_concepts` schema fragment all come from that one module. Never re-declare these limits elsewhere.
- On submit, packages are validated server-side; compliance errors share the single bounded revision pass with the NEURO pre-test. The concept card renders the ad unit with the fold made visible, live char counts, and a "Copy for Ads Manager" action.

### Meta performance ingest (learning loop)
- `POST /api/meta/ingest` (engine: `lib/meta-ingest.ts`) pulls ad-level CTR/CPL/ROAS from the Marketing API, grades each ad **against its account cohort medians** (absolute benchmarks under 3 eligible ads), and writes verdicts into `campaign_outcomes` — ORACLE memory. Winners auto re-ingest into the Vault via `recordOutcome`.
- Idempotent by `attributes.metaAdId`: re-syncs update changed verdicts, skip unchanged ones. Never throws — returns a summary. Trigger from the /meta dashboard ("Sync Meta → ORACLE").

### Supabase calls
- Use `supabaseAdmin` (service role) for all write operations
- Use `supabase` (anon key) for all read operations
- Always handle errors explicitly — never swallow them silently

---

## DESIGN RULES

- Dark theme always — background `#0a0a0a`, not default Tailwind dark classes
- Accent colour: amber (`amber-500`) for primary actions and highlights
- Success states: emerald
- Error states: red
- All cards: `rounded-xl border border-white/10 bg-white/[0.02]`
- Typography: tight, clean, no decorative fonts
- Loading states: always show a spinner or pulse animation — never leave the UI frozen
- Empty states: always show a helpful message — never a blank white box

---

## SUPABASE SCHEMA

```sql
CREATE TABLE creative_outputs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  campaign_angle TEXT NOT NULL,
  campaign_goal TEXT NOT NULL,
  hooks JSONB NOT NULL,
  body_copy JSONB NOT NULL,
  ctas JSONB NOT NULL,
  final_hook TEXT,
  final_body TEXT,
  final_cta TEXT,
  image_prompt TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'draft',
  approved BOOLEAN DEFAULT FALSE
);
```

---

## GIT WORKFLOW

```bash
# After every meaningful change:
git add .
git commit -m "descriptive message"
git push origin main
```

Commit messages should describe what changed, not just say "update". Examples:
- `Add Higgsfield image generation route`
- `Fix JSON parsing in copy generation API`
- `Update BriefForm with angle presets`

---

## IMPORTANT FILE NOTE

`CLAUDE.md` (this file) = Claude Code rules only.
`brand/BRAND_MEMORY.md` = Summit Build Co brand intelligence injected into the copy agent at runtime.

Do not confuse them. Do not inject CLAUDE.md into API calls. Do not treat BRAND_MEMORY.md as project rules.

---

## SESSION START CHECKLIST

At the start of every session:
1. Read this file
2. Check which files already exist before creating new ones
3. Ask for clarification if a task is ambiguous before writing code
4. Confirm the task before starting — do not assume

---

## TESTING THE AGENT

You can't "see" the agent as a person — you see it work through the **Reactor
Telemetry** feed on the Campaign Reactor page. How to verify it's there:

**A. In the UI (easiest)**
1. Run `npm run dev`, open `/campaign-reactor`.
2. Pick a Campaign Angle, choose output types, hit **Fire Reactor**.
3. Watch the **Reactor Telemetry** panel stream the agent's steps:
   "Searching pattern: …", "└▸ pattern · Profit Pattern", "Loading Creative
   Learnings rubric…", "Scoring concepts…". Each concept shows a rubric score
   and a "Grounded in" basis.
   - **No `ANTHROPIC_API_KEY`** → demo mode: the feed shows the same step-by-step
     flow using the curated demo intelligence. Proves the wiring/UX.
   - **With `ANTHROPIC_API_KEY`** (+ optional `VOYAGE_API_KEY` + Supabase) → the
     feed shows the agent's *real* tool calls and retrievals.

**B. Hit the endpoint directly (proves the agent loop)**
```bash
curl -N -X POST http://localhost:3000/api/campaign-reactor \
  -H 'Content-Type: application/json' \
  -d '{"angle":"Profit","outputs":["Hook","Founder Concept"]}'
```
You'll see the SSE stream of `step` / `retrieval` / `concept` / `done` events —
that *is* the agent thinking out loud.

**C. Prove the learning loop**
- Mark a concept a **winner** in the UI (or POST `/api/campaign-reactor/outcome`).
  With Supabase + Voyage configured, it's re-ingested as a new `pattern` chunk and
  the next run can retrieve it.

To run the *real* agent end to end: set `ANTHROPIC_API_KEY` (agent),
`VOYAGE_API_KEY` (embeddings), and the Supabase keys (vector store), then run
`supabase/schema.reactor.sql` in Supabase.

---

## TESTING MIKE DELIGHT

The operator on the dashboard is a pure pipeline, so it is tested in-process
rather than against a running server:

```bash
npm run selftest:operator
```

43 assertions against the seeded account with the evaluation date **pinned** to
`2026-08-12`. The pin is load-bearing: without it "the last 3 complete days"
moves with the calendar and the suite passes on Monday and fails on Thursday.

**In the UI:** open `/` and look at Your Next Moves. The summary reads
`Mike found N actions worth taking today.` over one row per decision. Without
`ANTHROPIC_API_KEY` every row renders its own computed line with real numbers on
it — the dashboard never depends on a model call to display. With the key set,
Mike narrates all the rows in one call, picks which one leads, and may or may
not leave a single opening sentence.

**The honest test:** delete every hardcoded recommendation string from the
codebase and reload. The queue still fills, because there are none —
`lib/creative-ops.ts` no longer composes "Your Next Moves" at all.

Full architecture: `docs/MIKE_DELIGHT.md`.

---

## CURRENT BUILD STATUS

**Core platform**
- [x] Platform redesigned as TPB Creative Reactor (9 intelligence systems)
- [x] Dark glass command-center UI + logo + sidebar/topbar shell
- [x] RAG knowledge layer: pgvector schema + Voyage embeddings + ingest route
- [x] Agentic Campaign Reactor (Claude Opus 4.8 tool-use loop, streamed)
- [x] Learnings-as-rubric self-critique
- [x] Higgsfield image + video creatives as agent tools (`@higgsfield/client`)
- [x] Meta Ads MCP wired into the orchestrator (Anthropic MCP connector)

**Campaign Reactor V3 — the Creative Operating System**
- [x] Six-agent intelligence network (`lib/agents.ts`): OPUS · ATLAS · NOVA · SPARK · ECHO · ORACLE — replaces the old specialist coordinator
- [x] Strategic Intelligence Panel before Fire (`/api/campaign-reactor/intelligence`) — pain/desire/pattern/structures/positioning/consulted-assets/confidence
- [x] Intelligence-based telemetry (Market/Creative/Copy/Knowledge/Pattern updates + confidence); "Agent's pick" language removed
- [x] SPARK Winning Creative Intelligence — Creative DNA extraction + store (`lib/spark.ts`, `/api/spark/analyze`, SparkAnalyzer UI)
- [x] SPARK **measured palette** — the browser samples an upload's real pixels before it leaves the page (`lib/palette.ts`), selecting on BOTH area and vividness so a small saturated block (the red band behind one word) can never be dropped. The measured hexes ride into the vision prompt as ground truth, and `reconcilePalette` snaps anything the model invents back onto a colour that is genuinely on the ad. A read that didn't happen is never dressed up as one: `extractVisualDNA` reports `live` + `reason`, the UI shows a sample banner, and nothing fabricated is written to the Vault
- [x] SPARK **instant clone** — `POST /api/spark/clone` rebuilds a read design as a finished Meta ad for your own offer: fresh copy written into the reference's element slots, a render prompt that reproduces layout / palette roles / contrast device, rendered through the image oven. Structure cloned, words never
- [x] **`design` — the Vault's visual knowledge section** — a first-class `KnowledgeSystem` sitting alongside vault/creative/copy/research: `creative` is how a winning ad is WRITTEN, `design` is how it LOOKS. Visual reads file here (palette, layout archetype, per-element zone + treatment, on-ad copy), SPARK consults it (`lib/agents.ts` → `['creative','design','website']`), it is browsable/filterable in the Vault Manager as "Ad Design DNA", and the Agent Network counts it automatically
- [x] **Visual ingest lives in the Knowledge Vault too** — one component (`components/spark/AdIngest.tsx`) serves both surfaces. The Vault is ingest-only (drop box → "Ingest Visual Creative DNA" → a receipt of what was banked); the teardown, clone and Reactor hand-off stay on the Creative page. Every design is banked with its full `VisualDNA` in chunk metadata, and `lib/visual-library.ts` ranks banked designs against a brief so the Reactor auto-pulls the best-fitting proven design when no reference is attached (`designOnly` — direction, not a clone order)
- [x] SPARK **visual ad ingest** — drag / drop / paste / upload a winning ad (or a direct image link) and a vision model reads the DESIGN: palette hexes, layout archetype, every element's zone + placement + treatment, on-ad copy transcribed verbatim, eye flow, contrast device, scroll-stop mechanism (`VisualDNA` in `lib/spark.ts`, intake in `lib/ad-image.ts`). Stored as a retrievable `creative` chunk alongside the written DNA, and carried into OPUS via `visualDirectionBlock()` (`lib/taxonomy.ts`) so the design reaches the **production brief the image models render from** — OPUS may override it when the angle calls for a better design, stating why in the concept basis. "Build a campaign from this ad" hands the reference to the Reactor over the existing clone rail
- [x] SPARK **multi-ad dissection** — a swipe-board / ad-library / contact-sheet screenshot is separated into its individual creatives and each one is dissected on its own (never averaged into a blended pattern), up to `MAX_ADS_PER_READ` (12). Every ad is classified and stored as its own retrievable pattern, so one board screenshot fills the Vault with N winners; the analyzer shows an ad picker and sends the selected ad's structure + design to the Reactor. Uploads are downscaled to 1568px (Claude's native vision ceiling) to keep headline copy legible in dense grids
- [x] Production Brief system — frame-by-frame briefs drive image/video generation
- [x] Performance Intelligence (ORACLE): expanded outcome verdicts, strategic attributes, pattern confidence, strategic memory page
- [x] Agent Network page (`/network`) — living visibility dashboard grounded in live vault + outcome data

**Creative Canvas — the structured creative operating layer**
- [x] Brief upgrades: Market Sophistication dropdown (Schwartz stages with per-option descriptions, system-recommended) under Awareness; Campaign Offer + Offer Name moved under Campaign Name on step 1; new deliverable (Montage / Scene Flow)
- [x] **Per-creative variation system** (`lib/variations.ts` — the single source of truth). Variations are not a deliverable and not a global knob: every selected format carries its OWN count (×1–×4) and its OWN lever (Smart Mix / Hooks / Angles / Visuals / Copy) under its size cards, so "3 hook variations of the video, 1 static" is expressible. The ladder stops at 4 because every concept costs a brief + ad package + NEURO pass + a real render inside one `REACTOR_BUDGET_MS` function — raise it when the host allows longer functions. Lever language is format-aware (a static has no "first three seconds", a carousel no "spoken opening"), the counts are enforced server-side (surplus trimmed always; a shortfall re-asked once, only on runs of ≤6 concepts, since that costs a whole turn), and every version is stamped with the run's `testId`, its own `variantId` and the lever + concrete difference it carries — which is what lets the Meta ingest grade a controlled test instead of a pile of one-offs (`variationPerformance()` in `lib/outcomes.ts`). Guarded by `npm run selftest`. The old `Creative Variations` and `Recommend Format` deliverables are removed — the first double-counted against the global knob, the second carried no model or size choice
- [x] Per-deliverable render-model menus on the Formats step (`lib/model-menu.ts`) — system recommends, user overrides; dimension options adapt to the chosen model's registry ratios. Montage gets two REAL pickers (Still Model + Motion Model) — OpenMontage is shown as the scene-planning engine only, never a selectable render model
- [x] Creative Canvas view (`components/creative-canvas/`, `lib/creative-canvas/graph.ts`): **full-screen immersive mode** (portaled to `document.body`, sidebar/topbar fully hidden, layered Escape), pre-structured node lanes (hook → message → proof → scenes/visual → CTA → output) seeded live with the Reactor's already-generated media, branch/approve/lock, precise per-node regeneration (`/api/canvas/regenerate`, strategy-coherent, demo fallback), **universal drag-to-reassign** (every content card — hook/message/proof/visual/scene/CTA — can take any content role; only Output is fixed) with a confirmation modal (Reassign & regenerate / Reassign, keep words / Visual move only / Cancel), right-click context menu, ⌘/Ctrl+D duplicate + Delete shortcuts, scene render + animate, Send-to-Studio composition; "Launch in Creative Canvas" CTA on montage runs; full spec in `docs/CREATIVE_CANVAS.md`
- [x] **Multi-format campaigns**: selecting several formats in the brief yields ONE campaign → ONE shared strategy layer (campaign bar + chips shown once) → one Creative Canvas tab per format family (Image / Video / Montage / Variations / Recommended, `canvasTracks()` + `conceptsForTrack()`); tabs are lazy-mounted and kept alive so switching never loses edits; formats are never mixed into one graph
- [x] Reactor view toggle is Reactor · Canvas · Studio (`components/campaign-reactor/canvas/AdStudio.tsx` is the renamed Studio; the old free-node Flow view is retired from the toggle)

**Mike Delight — the performance operator on the dashboard**
- [x] `lib/operator/` — separately replaceable layers behind the existing
      "Your Next Moves" section: pure maths (signals · baselines · strength ·
      rules · evidence), a presentation adapter (`queue.ts`), narration (one
      call per session, all cards together, so he can vary himself and CHOOSE
      THE LEAD), and a human who approves. Full architecture in
      `docs/MIKE_DELIGHT.md`; character in
      `operator/mike-delight-constitution.md`; engine spec in
      `docs/mike-delight-build-spec-v2.md`; surface spec in
      `docs/mike-decision-queue-brief.md`
- [x] **The surface is a DECISION QUEUE, not a report.** Mike thinks deeply
      backstage and speaks briefly onstage: a summary (generated headline + one
      supporting sentence + Refresh/pause/filter), one vertical row per decision
      (priority · action · creative · why · ≤3 metric chips · confidence ·
      controls), a collapsed history, and an evidence drawer holding everything
      else. Copy limits live in `lib/operator/queue.ts` and nowhere else —
      title ≤8 words, reason one sentence ≤25 words — so no component truncates
      and no two surfaces disagree about what Mike said
- [x] Every rule supplies TWO lengths: a plain-English one-liner for the row
      ("Cost per result is rising, CTR is falling and frequency is climbing.")
      and the full read for the drawer. The chips carry the figures so the
      sentence does not have to, and a long line cut at a column edge — which
      reads as a bug rather than as brevity — cannot happen
- [x] WATCH and COLLECT never show "Approve". Their primary control is *Keep
      watching* / *Acknowledge*, it sets a check-back and it creates nothing.
      Approve confirms in place with an **Undo** before the row leaves
- [x] Data disciplines enforced by the TYPES, not by convention: no generic
      `conversions` field (every result carries its `PrimaryResultType` and they
      are never blended); frequency exists only on `RangeDeliveryMetric`, so a
      range frequency can never be summed out of daily reach; the current
      incomplete day is excluded and results inside the attribution delay are
      provisional and cannot support a definitive REPLACE or ITERATE
- [x] Equal, complete trend windows (3v3 rapid, 7v7 confirmation) cut by
      calendar date. An unresolvable window returns `null`, never an invented
      trend. Every time-dependent calculation takes an injected `evaluationDate`
      — `todayIn()` in `lib/operator/dates.ts` is the ONE deliberate clock read
- [x] Contextual baselines with progressive fallback (`exact_cohort` →
      `result_and_offer` → `result_type` → `account`), never across result types
      and never cold-vs-retargeting. How far it walked rides into the evidence
      and reduces the strength tier
- [x] Evidence strength replaces "confidence" internally (UI labels unchanged)
      and is NEVER derived from win rate — no more "1/1 wins · 100% confidence".
      Four floors enforced in code: single test, thin EXPLORE, account-wide
      fallback, null confirmation window
- [x] Fatigue is three states: **CONFIRMED** (both windows + a delivery signal →
      REPLACE), **WATCH** (rapid movement unconfirmed → its own card, primary
      action *Keep watching*, creates nothing, scored below any CONFIRMED), and
      **RECOVERING** (no card; suppresses that creative AND that signal for 3
      days, keyed `hash(creativeId + fatigueSignal)`)
- [x] Approve / Edit / Dismiss (reason code required) / Snooze, with cooldowns,
      ranking weights (ranking ONLY — they never touch evidence strength or
      whether a rule fires) and learned param defaults after 3 consistent edits
- [x] `validate.ts` — facts only, never voice. Every numeral resolves to an
      authorised structured field and the resolver returns WHICH one, so a
      rejected card is traceable. One regeneration, then computed template
      cards: **the dashboard never depends on a model call to display**
- [x] Capability allowlist enforced by a throwing assertion — Approve stages a
      brief into the Campaign Reactor and nothing else is reachable
- [x] **Mike Delight's live Meta adapter is built** — `lib/operator/adapters/`
      now holds the real thing: `meta-server.ts` does all the Graph work
      server-side (ad-level insights at `time_increment=1` for 30 days of daily
      rows, PLUS a separate range-level call per 7-day evaluation window for
      deduplicated reach and frequency — frequency cannot be reconstructed from
      daily reach at any level of effort — plus `/act_<id>/ads` for identity,
      format, objective and audience temperature), `meta.ts` is a thin client
      shell over `/api/operator/source` so the token never reaches the browser,
      and `meta-credentials.ts` resolves the stored `meta.connection` setting
      first and the `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID` env second. The
      seam holds: the switch is `NEXT_PUBLIC_OPERATOR_SOURCE=meta` in
      `adapters/index.ts` and nothing above `adapters/` changed. Both sources
      throw rather than degrade — a partial account is never rendered as a whole
      one. Connect from the /meta dashboard (Connect Meta panel →
      `/api/operator/meta-connection`, token validated against the Graph API
      before it persists); verify with `npm run selftest:operator-meta`, which
      imports the server builder directly so it asserts byte-for-byte what the
      route serves
- [x] **Ask Mike — the open, agentic surface** (`lib/operator/ask/`,
      `/api/operator/ask`, `components/reactor/operator/mike/`). The queue's
      `askMike` answers about ONE proposal; this answers about the account,
      because he goes and reads it. A bounded tool-use loop (6 turns) over
      seven READ-ONLY instruments — `list_creatives`, `creative_performance`,
      `compare_to_baseline`, `account_summary`, `todays_board`,
      `search_knowledge`, `past_outcomes` — enforced by `assertReadOnly`, which
      THROWS on any name off the allowlist, so nothing that mutates the ad
      account is reachable even by accident. Every figure is computed by the
      same `computeSignals` / `resolveBaseline` / `assessMaturity` the rules
      run on: there is no second implementation for him to be handed a wrong
      number from
- [x] **His facts are earned per turn** (`lib/operator/ask/facts.ts`). The
      narration validator resolves numerals against a payload fixed before the
      call; an open question has no such payload, so the ledger is built the
      other way round — every numeric leaf of every tool RESULT, keyed by path,
      becomes the permitted set. Shares `extractNumerals` and
      `isApprovedRounding` with `validate.ts` so honest rounding ("about forty
      quid a lead" off $41.20) passes on both surfaces and a restatement fails
      on both. One correction attempt carrying his own rejected answer back to
      him, then he says plainly that he will not stand behind the figure.
      Voice is never what fails
- [x] **His personality is loaded, not written.** The system prompt is
      `operator/mike-delight-constitution.md` unedited — the same file the
      narration path loads. The agent adds a machine contract (which
      instruments exist, the two hard rules) and NO tone instruction, no length
      cap, no worked example. An example would be copied, and a copied answer
      is the one thing the constitution cannot survive
- [x] **He is not a chat window — he is resident on the dashboard.** Mike lives
      in the corner of `/` as an orb (`orb/MikeOrb.tsx`): a real sphere of ~1900
      points and six great-circle filaments in gold / violet / white, rotated in
      3D and projected every frame, drawn with additive compositing so
      overlapping light accumulates instead of flattening into paint. Hovering
      raises his heat and floats a "Talk with Mike" card; clicking sends him to
      the middle of the dashboard, where he greets the operator by name (from
      the session cookie). ONE fixed full-viewport canvas carries him corner to
      centre and back, never unmounted — a component that faded out in one place
      and in at another would say he is two things
- [x] **He is anchored to his card, not to the corner.** An empty inline box at
      the end of the queue headline (`mike/anchor.ts`) reserves his room; the
      orb resolves that rect once per FRAME rather than listening for scroll,
      and movement of the anchor is CARRIED rigidly instead of chased by the
      spring — so he stays welded to the headline through a scroll instead of
      swimming after it half a second behind. The spring still resolves genuine
      moves (his flight to the middle and back), and the carry is skipped on
      the frame it begins so a handover never teleports him. No anchor on the
      page → he falls back to the viewport corner
- [x] **Clicking anywhere off him sends him home.** The room is
      `pointer-events-none` with only his words and the cloud taking events
      back, so every other click reaches the veil beneath. Escape does the
      same. A surface that can put an error on screen must always have a way
      off it
- [x] **Both onboarding transmissions are the same Mike** (`WelcomeModal`,
      `BrandOnboardingModal`): the same orb, the same three-word cadence via
      `MikeSpeech`, and the CTA held back until he has finished speaking.
      They were dialogs with his initials in a rounded square, which introduced
      a product feature — this introduces a person, and the first meeting is
      the one place that matters most. The copy is still the fixed,
      non-generated text in `lib/operator/welcome.ts`
- [x] **The energy cloud, not a text field.** No box, no rule, no visible edge:
      two counter-drifting blurred gradients at different periods (lockstep is
      the clearest tell that something is a loop) with the caret already inside
      it. Typing takes the floor — whatever he was saying drifts down and blurs
      away rather than being cut. Sending evaporates the cloud into hundreds of
      drag-damped particles, and he stays on screen throwing sparks across his
      shell, one per read genuinely in flight, with each tool's human label
      ("Pulling 14 days on The Profit Leak") and its receipt appearing as it
      happens
- [x] **He speaks three words at a time** (`WordStream.tsx`), each group
      resolving out of blur rather than fading in — a typewriter reveals
      characters and reads as a machine printing, three words reads as phrasing.
      Nothing is faked: the whole answer arrived and passed the factual checks
      before the component saw a word of it, and the reveal is skippable
- [x] Motion discipline throughout: `transform` and `opacity` only, custom
      cubic-beziers (never `linear` or `ease-in-out`), critically-damped springs
      for anything interruptible, `prefers-reduced-motion` renders one honest
      static frame, a backgrounded tab stops the loop entirely, and the phone
      layer halves the point count and drops a blur layer
- [x] The server reads the account itself (`lib/operator/ask/source.ts`) rather
      than trusting numbers posted in from a page, resolving the SAME
      seeded/meta switch the browser does — `loadOperatorContext()` resolves
      the account's own today FIRST, per origin, because building a source with
      a placeholder date to read its timezone off produces an account generated
      around an invalid date
- [x] `npm run selftest:mike-ask` — 36 in-process checks on a pinned date: the
      allowlist is a wall, every instrument returns computed figures, the
      ledger accepts what was read and rejects what was not, and the date
      bootstrap resolves a real account day
- [x] `npm run selftest:operator` — 50 in-process checks against a pinned
      evaluation date: all 41 from the engine spec, plus seven guarding the
      queue's presentation contract (word limits, chip caps and deduplication,
      WATCH's own verb, generated summary copy at 0/1/n, condensing that never
      splits a decimal, undo)

**Meta-native output + closed loop**
- [x] Launch-ready Meta ad units on every concept (`lib/meta-ads.ts`): primary text with 125-char fold discipline, headline/description limits, CTA button types, compliance validator wired into the submit gate + concept cards ("Copy for Ads Manager")
- [x] Meta craft block injected into every orchestrator run (fold/hook rules, placement ratios, safe zones, CTA-to-temperature mapping)
- [x] Performance ingest (Meta API) → `campaign_outcomes` auto-ingest of live CTR/CPL/ROAS with cohort-median grading; winners auto re-ingest into the Vault (`lib/meta-ingest.ts`, `/api/meta/ingest`, /meta sync control)

**Network integrity, speed + mobile**
- [x] ATLAS reconnected to the fallback knowledge layer — `foundationAssets` in
      `lib/reactor-data.ts` gives the `vault` + `website` systems real curated
      documents (frameworks, SOPs, positioning). ATLAS previously retrieved
      nothing whenever Supabase/Voyage were absent
- [x] Retrieval events carry their originating layer (`agent`/`id`); the
      workflow reducer attributes by id and tracks concurrently active layers,
      so batched parallel consults no longer pile every finding onto one card
- [x] Mandatory-layer activation is enforced in code, not prompt: ATLAS · NOVA ·
      ORACLE are briefed **in parallel before OPUS's first turn**
      (`preflightBriefing`) and their findings injected into its first message —
      guarantees the foundation layers run and removes 2–3 serial turns
- [x] Independent tools in a turn (consults, stills, renders, rubric) resolve
      concurrently; ORACLE's memory lookup runs alongside the briefing
- [x] Streaming client: context value memoized + SSE events folded per chunk
      (was one re-render of every consumer per event)
- [x] Reactor page code-split (Canvas/Studio dynamic): 167 kB → 102 kB
- [x] Mobile: safe-area viewport, portaled nav drawer + brief sheet (both were
      trapped by `backdrop-filter` / `isolation: isolate` containing blocks),
      `dvh` sheets, 44px touch targets, and a phone performance layer that
      freezes the aurora and drops backdrop blur under 768px
- [x] `npm run selftest` (`scripts/reactor-selftest.ts`) — asserts every
      mandatory layer activates with real evidence, evidence is attributable,
      and deliverable counts match the brief

**Still open**
- [ ] SPARK URL-only ingestion for JS-rendered sources (Meta Ad Library / TikTok / shared boards via oEmbed/transcript APIs or a headless render). Uploads, pasted screenshots, direct image links and YouTube transcripts all work today; a client-rendered page has no images in its served HTML, so `lib/ad-image.ts` scrapes og:image/`<img>`/inlined-JSON URLs and otherwise returns a note telling the user to screenshot it
- [ ] Scheduled auto-sync for the Meta performance ingest (manual one-click sync done; cron/Vercel scheduled function pending)
- [ ] More dashboards reading live `knowledge_chunks` counts (Agent Network does; Research/Copy/Pattern still curated)
- [ ] Deployed + tested end to end with real keys

