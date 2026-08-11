# CLAUDE.md — TPB Creative Reactor
## Claude Code Project Rules — Read This First Every Session

---

## PROJECT OVERVIEW

This is a Next.js app: **TPB Creative Reactor** — a premium AI-powered Creative
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
                             #   MUAPI_VIDEO_VEO3_T2V / _VEO3_I2V / _KLING_T2V / _KLING_I2V /
                             #   _SEEDANCE_T2V / _SEEDANCE_I2V / _WAN_T2V / _WAN_I2V (video —
                             #     the SAME verbatim-slug rule as images, and it bit here too:
                             #     invented `veo3` / `kling-pro` / `seedance-pro` / `wan2.2`
                             #     404'd, so a UGC ad ordered on Veo 3 came back as a GPT
                             #     Image 2 STILL. Confirmed paths are veo3-text-to-video /
                             #     veo3-image-to-video, kling-v2.5-turbo-pro-t2v / -i2v,
                             #     seedance-pro-t2v / -i2v, wan2.2-text-to-video /
                             #     wan2.2-image-to-video. `npm run muapi:slugs -- --video`
                             #     re-probes them when a vendor renames one)
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
- **4:5 is a first-class still ratio** — Meta's tall feed unit, the largest footprint a static ad gets in the mobile feed, and the default for Static Creative + Creative Variations. It is deliberately IMAGE-ONLY: `lib/video/types.ts` keeps its own ratio union, and the reactor's `generate_video` narrows 4:5 → 9:16 rather than handing a video model a ratio it cannot render. A still model that doesn't declare 4:5 (GPT Image 2) snaps to its nearest portrait via `supportedRatio()`.
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
- [x] Brief upgrades: Market Sophistication dropdown (Schwartz stages with per-option descriptions, system-recommended) under Awareness; Campaign Offer + Offer Name moved under Campaign Name on step 1; new deliverables (Montage / Scene Flow, Creative Variations, Recommend Format)
- [x] Per-deliverable render-model menus on the Formats step (`lib/model-menu.ts`) — system recommends, user overrides; dimension options adapt to the chosen model's registry ratios. Montage gets two REAL pickers (Still Model + Motion Model) — OpenMontage is shown as the scene-planning engine only, never a selectable render model
- [x] Creative Canvas view (`components/creative-canvas/`, `lib/creative-canvas/graph.ts`): **full-screen immersive mode** (portaled to `document.body`, sidebar/topbar fully hidden, layered Escape), pre-structured node lanes (hook → message → proof → scenes/visual → CTA → output) seeded live with the Reactor's already-generated media, branch/approve/lock, precise per-node regeneration (`/api/canvas/regenerate`, strategy-coherent, demo fallback), **universal drag-to-reassign** (every content card — hook/message/proof/visual/scene/CTA — can take any content role; only Output is fixed) with a confirmation modal (Reassign & regenerate / Reassign, keep words / Visual move only / Cancel), right-click context menu, ⌘/Ctrl+D duplicate + Delete shortcuts, scene render + animate, Send-to-Studio composition; "Launch in Creative Canvas" CTA on montage runs; full spec in `docs/CREATIVE_CANVAS.md`
- [x] **Multi-format campaigns**: selecting several formats in the brief yields ONE campaign → ONE shared strategy layer (campaign bar + chips shown once) → one Creative Canvas tab per format family (Image / Video / Montage / Variations / Recommended, `canvasTracks()` + `conceptsForTrack()`); tabs are lazy-mounted and kept alive so switching never loses edits; formats are never mixed into one graph
- [x] Reactor view toggle is Reactor · Canvas · Studio (`components/campaign-reactor/canvas/AdStudio.tsx` is the renamed Studio; the old free-node Flow view is retired from the toggle)

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

