# CLAUDE.md — Optimised Digital
## Claude Code Project Rules — Read This First Every Session

---

> **Repository identity:** This is **Optimised Digital** — the standalone
> repository behind `optimiseddigital.vercel.app`, and it deploys from this
> repo's `main`. The default branch here is `main` (not a `claude/*` working
> branch), so open PRs into `main` from your session branch.
>
> **The platform carries no business inside it.** It is white-labelled: a
> company connects its website and the Reactor becomes theirs. Module names
> (`Creative Reactor`, `OPUS`, `ORACLE`) are the ARCHITECTURE's names, not a
> tenant's. Nothing in `lib/`, `app/`, `brand/` or `seeds/` may name a specific
> company, industry or audience — `npm run selftest:blank-slate` fails the
> build if it does, and `npm run selftest:tenant` proves one account cannot
> read another's. When you need to say who the deployment IS, resolve it at
> runtime through `lib/tenant.ts`; when you need to say who it RESEARCHES,
> that is `lib/gethookd/icp.ts`. They are different questions and must stay
> different files.

---

## PROJECT OVERVIEW

This is a Next.js app: the **Creative Reactor** — an AI-powered Creative
Intelligence Command Center for **e-commerce Meta advertising**. It turns a
connected store (its brand, its product catalog), uploaded assets, proven ads
that are live in the market, and measured Meta performance into the next
winning creative, answering one question: "What should we create next, based on
everything that has already worked?"

**The platform makes the creative, not the caption.** For an e-commerce account
the caption is the cheap part — a buyer runs a handful of proven primary texts
across dozens of creatives, and Advantage+ rewrites captions for free. What is
scarce is enough genuinely different, product-true creative to feed delivery,
so that is the whole job: everything an ad must SAY is said by the creative,
and finished creatives go straight into the brand's own Meta media library.

It is built around nine intelligence systems (Reactor Dashboard, Knowledge
Vault, Research, Creative, Copy, Strategic Memory (ORACLE), Campaign Reactor,
Creative Learnings, Recommendations). The Campaign Reactor runs an **agentic
orchestrator** (a Claude tool-use loop) over a RAG knowledge layer, and briefs
its intelligence network — including with live proven ads researched from the
brief and the product's own published facts — before a single concept is
written. See `SYSTEM_DESIGN.md` for the full architecture.

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
| Vector store | Supabase `pgvector` (`knowledge_chunks`) — HNSW + full-text, fused (`match_knowledge_hybrid`) |
| Reranker | Voyage AI `rerank-2.5` (`lib/rerank.ts`) |
| Long documents | PageIndex Cloud via `@pageindex/sdk` (`lib/documents/`) |
| Image AI | fal.ai (FLUX) + Higgsfield Soul — direct Gemini/OpenAI image removed (fal + Kie only) |
| Deployment | Vercel |

---

## PROJECT STRUCTURE

```
summit-build-creative/
├── CLAUDE.md                        ← you are here (Claude Code rules)
├── brand/
│   └── BRAND_MEMORY.md              ← brand template; blank until a site connects
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
VOYAGE_API_KEY               # Embeddings for the RAG knowledge layer — and the reranker, same key
VOYAGE_RERANK_MODEL          # Optional — the reranker (default rerank-2.5; `off` disables it).
                             #   VOYAGE_RERANK_TIMEOUT_MS (default 4000): past it a search keeps its
                             #   fused order rather than wait — reranking improves retrieval, it is
                             #   never the reason retrieval returned nothing.
PAGEINDEX_API_KEY            # Optional — long-document reading (brand books, SOP manuals, offer docs)
                             #   by STRUCTURE via PageIndex Cloud. Unset, the Vault's Long Documents
                             #   panel says so and the Reactor never offers `read_document`.
                             #   Needs Supabase + supabase/schema.documents.sql (the ledger).
                             #   PAGEINDEX_API_BASE (default https://api.pageindex.ai),
                             #   PAGEINDEX_TIMEOUT_MS (default 40000 per question — it sits inside
                             #   the Reactor's run budget). The uploaded PDF LEAVES this deployment
                             #   for PageIndex Cloud; the panel says so before it is sent.
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
GETHOOKD_FORMAT_PARAM        # Optional — the endpoint's name for the creative-format
                             #   filter, IF it ever gains one. Probed dead under every
                             #   spelling (ad_format, format, ad_formats, formats,
                             #   asset_type, display_format, media_type, ad_type...) while
                             #   its own MCP wrapper takes `ad_format` happily. Unset, the
                             #   filter is not sent and the bar is enforced on the RETURNED
                             #   ROWS instead — authoritative, but the discarded rows were
                             #   still billed, and the feed says how many.
GETHOOKD_RUN_TIME_PARAM      # Optional — same story for the minimum-run-time bound (the
                             #   90-day half of "proven"). Probed dead under run_time,
                             #   min_days_active, days_active, min_days and more. Setting
                             #   either narrows the search server-side and stops the feed
                             #   paying for rows it is about to discard; run
                             #   `npm run gethookd:params` to find a working name.
GETHOOKD_API_KEY             # GetHookd proven-ad library — powers the Ad Library's
                             #   "Proven Ads" tab. Without it the tab falls back to Meta's
                             #   ads_archive, which outside the EU returns political/issue
                             #   ads or nothing — which is why the tab was a dead end before.
                             #   BILLS PER RETURNED ROW (~0.01 credits/ad), so page size is
                             #   capped at 24, one brand can never fill the feed, and the
                             #   credits a search spent ride back into the UI. Optional:
                             #   paste-to-clone works with no key.
                             #   Optional overrides: GETHOOKD_API_BASE (default
                             #   https://app.gethookd.ai/api/v1), GETHOOKD_TIMEOUT_MS,
                             #   GETHOOKD_GEO (default US,AU — the markets this
                             #   deployment sells into), GETHOOKD_GEO_PARAM (the endpoint's
                             #   name for the country filter, default `geo` — run
                             #   `npm run gethookd:params` to confirm it; a refused name is
                             #   now retried under its known aliases (`location`, `countries`,
                             #   `country`) BEFORE being dropped, so a vendor rename costs a
                             #   round trip rather than scoping the feed to the whole world),
                             #   GETHOOKD_LAUNCH_WINDOW_DAYS (default 540 — how far back an
                             #   ad may have LAUNCHED. Load-bearing: the source reports run
                             #   time from start date to last-seen, so a 2018 ad nobody
                             #   marked stopped reads ~3,200 days "live", and ordering by
                             #   duration without this bound returns the OLDEST ROWS IN THE
                             #   DATABASE — which is exactly what filled the Ad Library with
                             #   ripped-jeans dropshipping ads scored "Winning, 100"),
                             #   GETHOOKD_MIN_DAYS_ACTIVE (default 90 — still-running-since,
                             #     the other half of the proof, and the SAME bar the
                             #     automatic research uses so both surfaces mean one
                             #     thing by "proven")
                             #   Automatic campaign research (lib/gethookd/research.ts):
                             #   GETHOOKD_RESEARCH_MIN_DAYS (default 90 — the eligibility
                             #     bar. NEVER lowered inside a run: when too few ads
                             #     qualify the SEARCH widens and says so),
                             #   GETHOOKD_RESEARCH_LAUNCH_WINDOW_DAYS (default 1095 — there
                             #     is deliberately no maximum AGE on a reference, an ad
                             #     running two years is the best evidence this source has;
                             #     the bound only keeps out rows the source never closed,
                             #     which report ~3,200 days "live". Set 0 to remove it),
                             #   GETHOOKD_RESEARCH_SHORTLIST (default 5),
                             #   GETHOOKD_RESEARCH_TIMEOUT_MS (default 15000 — this step
                             #     sits AHEAD of the briefing, so it costs the run latency
                             #     directly; 8s on the fast path),
                             #   GETHOOKD_RESEARCH_DESIGN_READ (default on — the vision
                             #     read of the top reference, which also banks it),
                             #   GETHOOKD_DESIGN_READ_TIMEOUT_MS (default 45000)
REACTOR_STATIC_ONLY          # Optional — default ON. The system RECOMMENDS static formats
                             #   only (Static Creative, Carousel Creatives): the proven-ad
                             #   research is image-only, the design read needs a still, and
                             #   proposing a medium with no oven behind it ships a concept
                             #   with nothing under it. The operator can still select any
                             #   format by hand — this gates the recommendation, not the
                             #   choice. Set to `false` when the video ovens are wired.
PIPEBOARD_API_TOKEN          # Meta Ads MCP (live ad performance) — optional
META_ACCESS_TOKEN            # Meta Marketing API (System User token) — /meta dashboard + performance
                             #   ingest + Upload to Meta. The FALLBACK: a brand's own stored
                             #   connection (Connect Meta on /meta) always wins, so on a
                             #   multi-brand deployment each brand uploads into its own account.
                             #   Uploading needs `ads_management` on the token.
META_AD_ACCOUNT_ID           # Ad account the uploads land in (with or without act_ prefix).
                             #   Required when the token reaches more than one account — an
                             #   upload with no unambiguous destination is refused, never guessed.
                             #   No Page id and no link URL: the upload puts the creative in the
                             #   account's MEDIA LIBRARY (adimages / advideos), not into an ad.
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
PLATFORM_LOGIN_REQUIRED      # Optional — default OFF. While off, the login page is bypassed:
                             #   the middleware issues the operator session automatically and
                             #   every visitor lands on the dashboard (/login forwards to /).
                             #   Set to `true` to put the login page back in front — the
                             #   credential code is untouched behind the switch.
                             #   NOTE: while off, anyone with the URL is the operator — on a
                             #   single-brand deployment that includes the env Meta token's data.
PLATFORM_MULTI_TENANT        # Optional — `true` declares the deployment shared BEFORE the first
                             #   brand login exists (lib/tenancy-mode.ts). A deployment with any
                             #   row in `users` is multi-tenant whether or not this is set. In
                             #   multi-tenant mode deployment-wide credentials stop acting for
                             #   brands: META_ACCESS_TOKEN no longer stands in for an unconnected
                             #   brand (it reads "connect your account"), and the Meta Ads MCP
                             #   (PIPEBOARD_API_TOKEN / META_ADS_ACCESS_TOKEN) is not attached
                             #   to Reactor runs.
PLATFORM_OWNER_PASSWORD      # Optional — opens the owner-only Platform Library at /owner. Must be
                             #   12+ characters or the area stays closed (it is reachable from the
                             #   public URL and holds your own IP). Separate from every brand
                             #   login; owner sessions are signed with a key bound to this value,
                             #   so changing it signs every owner session out. AUTH_SECRET (also
                             #   used for brand sessions) is mixed into the key when set.
NEXT_PUBLIC_REACTOR_DEMO_DATA # Optional — the curated demo set, in two halves (lib/demo-mode.ts).
                             #   unset (default): DISPLAY on — empty dashboards render the
                             #     illustration, badged DEMO DATA, and a connected Meta account or
                             #     filled Vault always replaces it. RETRIEVAL off — the agents never
                             #     ground a campaign in the demo corpus.
                             #   `0`: both off — every panel renders its real, empty state.
                             #   `1`: both on — the agents may retrieve the demo corpus too.
                             #   Build-time inlined: changing it needs a redeploy.
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

### Retrieval pipeline (`searchKnowledge` in `lib/knowledge.ts`)
- **Three stages, each degrading on its own:** (1) `match_knowledge_hybrid` — vector + full-text, fused with Reciprocal Rank Fusion (scores are never added across scales); falls back to `match_knowledge` (vector-only) when `supabase/schema.retrieval.sql` has not been run, re-checked every 10 minutes so applying the migration needs no redeploy. (2) The fused pool (24) goes to Voyage's reranker. (3) Top k (8) returned.
- **Why hybrid:** ad craft lives in exact phrases ("free audit", a dollar figure, an offer name) that an embedding blurs. **Why rerank:** similarity is not relevance — a cross-encoder reads query and document together. **Why HNSW:** IVFFlat with `lists = 100` searched ~1% of the table at the default `probes = 1`, and the tenant filter applied after that, so a scoped query could come back short or empty.
- **`similarity` is always cosine**, on every row, whichever branch found it — anything reading it means what it meant before. The reranker's score rides separately as `relevance` and is never interchangeable with it.
- **The tenant predicate in both hybrid branches is `match_knowledge`'s, verbatim** — `npm run selftest:retrieval` compares the text and executes the SQL against real Postgres + pgvector (PGlite) to prove it: one account never sees another's rows, an unscoped row is seen by nobody, a null account sees global rows only.
- The scope predicate is repeated in each branch rather than shared in a CTE on purpose: a CTE referenced twice is materialised and cannot use the HNSW index.
- `/api/health` → `retrieval` reports which stages are live (`vector` / `hybrid` / `rerank` / `documents`), so "is the knowledge layer real or the keyword fallback?" is answered in one place.

### Long documents (PageIndex)
- **Not a replacement for the vector store — a second reader for one job.** The Vault's thousands of small, flat chunks stay on hybrid search. A long, structured PDF (brand book, SOP manual, offer document) loses the link between a rule and its heading when chunked, so it goes to PageIndex, which keeps a table-of-contents tree and answers by reasoning down it.
- `lib/documents/pageindex.ts` is the transport (the SDK's REST `PageIndexApi`, never its MCP client — no long-lived connection in a serverless function); `lib/documents/index.ts` is the account-scoped ledger over `long_documents` (`supabase/schema.documents.sql`). **Tenancy is enforced on our side:** every query is `(account_id, id)`, and the provider's document id is read off the row, never accepted from a request.
- Upload: `POST /api/vault/documents` (multipart PDF, ≤ 4 MB — Vercel's 4.5 MB body limit, and the key must never reach the browser, so the file passes through). Validated by name, size and `%PDF-` magic bytes before a byte is billed. A ledger insert that fails after the provider accepted the file deletes it there rather than orphaning it.
- The Reactor gets a **`read_document`** tool only when the account has an indexed document, with the ids as an enum. Answers quote the document and cite section + page; a rule the document states binds the concept. `POST /api/vault/documents/ask` makes the same call so the operator can see what the agents will be told.

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
- The compiler: separates SCENE from COPY (a copy-carrying frame never also appears as a scene beat — describing the headline slot twice causes doubled lettering), lists the literal strings under an `ON-IMAGE TEXT` header marked "reproduce exactly", enforces **`MAX_RENDERED_TEXT_BLOCKS` (2)** inside **`MAX_RENDERED_TEXT_CHARS` (95)**, folds an emphasised word quoted inside a headline into a treatment note rather than a second block, and DROPS fine print / compliance strips / logo lettering entirely (unrenderable at ad resolution). Everything dropped comes back in `omitted` with a reason — it is never silently lost: it is the copy the buyer adds as an overlay or writes into the caption in Ads Manager, since the platform ships the creative without one.
- A brief with no on-image copy gets the opposite instruction: render no lettering at all, leave clean space for the overlay.
- OPUS declares on-image copy in **`productionBrief.onImageText`** (role / text / placement), constrained by `ON_IMAGE_TEXT_RULE` in the orchestrator prompt. Absent that, the compiler recovers the copy from quoted strings in the frames — both paths are covered.
- Guarded by `npm run selftest:render` (`scripts/render-prompt-selftest.ts`), which asserts the discipline against the exact brief that rendered wrong.

### Video models (multi-provider "oven")
- The video layer lives in `lib/video/` and is provider-agnostic. `lib/video/registry.ts` is the model menu (Seedance 2.0, Kling 2.5, Veo 3, Wan 2.5, Higgsfield DoP) with capabilities (modes, max duration, aspect ratios, native audio). Endpoints are env-overridable since vendor model paths drift.
- **fal.ai** is the single gateway for the frontier models — one key (`FAL_KEY`) unlocks Seedance/Kling/Veo/Wan via the async queue API (`lib/video/fal.ts`). Higgsfield stays wired through its own SDK.
- `lib/video/index.ts` dispatches start/poll into one `VideoJob` shape: `startVideoJob(modelId, input)` and `getVideoJob(modelId, requestId)`. Supports both `text-to-video` (full scene, e.g. a builder on-site or a person speaking) and `image-to-video` (animate a still). Use **veo-3** for spoken/UGC (native audio), **seedance-2.0**/**kling-2.5** for cinematic realism, **wan-2.5** for high-volume/budget.
- Exposed to the agent as the `generate_video` tool with a `model` + `mode` selector; renders stream as `media` SSE events. Every render is logged to `media_generations` (`lib/video/persistence.ts`, `supabase/schema.media.sql`) when Supabase is configured.
- API: `GET /api/video/models` lists the menu + which are configured; `POST/GET /api/generate-video` starts/polls a render (model-aware, backward compatible). Never throw on missing keys — return null/`unknown`.

### Proven ads (GetHookd)
- `lib/gethookd/` is the external ad source, shaped exactly like `lib/image/` and `lib/video/`: a transport (`client.ts`), a normaliser (`index.ts`) and a provider-agnostic row type (`types.ts`). The Ad Library renders a `ProvenAd`, never a vendor row, so a second source normalises in and nothing above the folder changes.
- **`lib/gethookd/icp.ts` is the single source of truth for who this platform researches ads FOR**: e-commerce FIRST (the platform makes e-commerce creative, so every surface that lists focuses leads with it and nothing on an e-commerce surface defaults to another), with services and marketing kept as SEPARATE, still-addressable focuses. They are never blended into one feed — a service ad sells a conversation and an e-commerce ad sells a purchase, so an averaged feed teaches neither. GetHookd has no "e-commerce" category, so that focus is a set of DTC verticals, labelled once as `ECOMMERCE_VERTICALS` — the Ad Library's vertical chips and the catalog's vertical read (`inferNiches`) both speak in those ids, and the library opens on the brand's own vertical when its catalog has one. The file reads no env at import time (`defaultGeo()` is a function) so the Ad Library's client component can import `ICP_FOCUSES` and the ICP stays defined once.
- This is distinct from `lib/tenant.ts`, which resolves who the deployment IS. Collapsing the two makes the library research the operator rather than the market.
- **Cost is a design constraint, not an afterthought** — the source bills per returned row. Page size is capped (24), `ads_per_brand_limit` stops one advertiser owning the grid, filters refetch but typing does not, and the credits a query actually spent are shown to the operator.
- Every row carries a signed still, so **"Design" on a card posts it straight to `/api/spark/analyze`** — the same route the Vault drop box uses — which reads the layout/palette/on-ad copy and banks it as a `design` chunk. No second extractor.
- **The REST endpoint's parameter names are NOT its MCP wrapper's names.** The wrapper takes `geo` / `limit` / `compact`; the endpoint answers `Unrecognized parameter(s): geo, limit, compact`. It is `per_page`, there is no `compact`, and the country filter's name is env-overridable (`GETHOOKD_GEO_PARAM`). That mismatch shipped a tab that authenticated perfectly and returned nothing — the expensive kind of bug, because everything looks connected.
- **A refused filter costs the filter, not the feature.** `gethookdGet` reads the names out of the error, retries ONCE without them, and returns `droppedParams` so the surface can say the rows are wider than asked for. Exactly one retry: stripping our way down to an unfiltered, fully billed search would be worse than one honest failure. Never let this degrade silently — global ads shown to someone who picked their markets looks like success.
- `npm run gethookd:params` probes a live key for the endpoint's current filter names and prints the env var to set, the same way `muapi:slugs` does for model slugs. Costs under 0.1 credits.
- Guarded by `npm run selftest:gethookd` — in-process checks against a stubbed transport and a captured real response. It never touches the network, because a suite that hit the live library would bill the account on every run.

### Automatic campaign research (the agents' own evidence)
- `lib/gethookd/research.ts` is the AUTOMATIC half of the source; the Ad Library is the manual half. Nobody types a search: a submitted brief is read, terms are constructed from it, and the shortlist reaches **SPARK and ECHO before they report to OPUS**. Ordering is the whole point — evidence that lands after the concepts are written is a filing cabinet, not evidence.
- It exists because of one line in the orchestrator: when the Vault retrieves nothing, the layers are told to "reason from first principles". On a new account that is EVERY run, and first principles means the model's priors. This fills that gap with ads somebody is currently paying to keep running.
- **Eligibility is never lowered.** Static image, still listed active, running ≥ `GETHOOKD_RESEARCH_MIN_DAYS` (90). Re-checked on every row in `isEligible()` rather than trusted to the API, because `status` is matched against a lagging index and a filter the endpoint refuses is dropped by the transport — either can hand back a row that does not meet the bar. When too few qualify, the SEARCH widens (broader term → no term → every market) and each widening is named in the result and the telemetry.
- **The Reactor researches e-commerce, and the brand's own vertical first.** It passes `focus: 'ecommerce'` (a fitness-apparel brief that never says "shop" must not be read as a gym) and, when the catalog's vertical is known, `niches`. With a vertical the market ladder spends its rungs inside it — the sharpest term in this vertical → this vertical unqueried → all of e-commerce — and the last widening is named ("Widened to all of e-commerce — too few qualified in this brand's own vertical"). The same rung ceiling applies, so the cost bound below is unchanged.
- **A long query is what empties this feed, not the 90-day rule.** Measured against the live library: services + US/AU + static + active + 90 days holds ~355 brand-capped matches; add the phrase "service business lead generation" to that exact search and it returns ZERO. So the ladder searches SHORT (one or two words, matched literally) and falls back to the unqueried browse where the eligible corpus actually is. Never send a sentence.
- **TWO POOLS, because "should the search be broader?" has two answers.** Measured: the same filters scoped to the service niches hold ~355 eligible statics; unscoped, ~22,000 — and the craft gap shows on the first page. But breadth is only free for the DESIGN. A DTC ad sells a purchase in one line and a service ad sells a conversation over five, so a wider pool teaches a lead-gen campaign to say "Grab our BOGO deal". So:
  - **MARKET** — scoped to the brief's ICP focus, climbing the term ladder. Carries the ARGUMENT. **ECHO sees only this.** Widening it is the one widening that makes the ads worse.
  - **CRAFT** — the whole library, niche filter dropped and replaced by the static-ad ARCHETYPES (`CRAFT_ARCHETYPES`: Before/After, Testimonial, Us vs Them, Facts and Stats, Reasons Why, Features and Benefits). Carries the CONSTRUCTION. SPARK sees it labelled "construction only", and the design read that drives the production brief prefers it.
  - Breadth WITHOUT the archetypes is not an upgrade — it returns the market at large, most of it an untreated product photo. And the archetype tag alone is not enough: the library returned a headline-less phone photo of a watch filed under an archetype at the same performance tier as a properly built ad beside it. So a craft reference must also carry a HEADLINE.
  - Craft standing alone is a real state and is reported as one — ECHO gets nothing rather than the wrong market.
- **A third focus, because the operator IS a marketing agency.** `MARKETING_NICHE_IDS` (Info · App/Software · Business/Professional · Service Business, ~14k brands) is the agency's OWN category — other agencies, the martech they sell against (ClickFunnels, Kajabi, GoHighLevel) and the info offers that teach it. An agency runs two kinds of campaign, its clients' and its own, and they are not the same research problem: an ad selling roof repairs and an ad selling a funnel build share no buyer, no objection and no proof. `researchFocus()` checks marketing FIRST, since a brief naming funnels or martech is far more likely to be the agency's own — when the caller does not state a focus. The Reactor does (`ecommerce`, above), so this reading now serves the probe script and any caller that leaves it open.
- **Marketing vocabulary is stripped by PROVENANCE, not outright.** In a client brief "leads", "funnel" and "campaign" are noise — searching them bills per row for nothing. In an offer NAME or the connected website's industry they are the subject. So `TRADE_TERMS` is applied to the brief body and campaign name, skipped for the offer name / type / industry / audience — and even there weighted BELOW a plain noun, or "digital marketing agency" would supply the two best terms on every campaign that agency ever runs. Three-letter market acronyms (seo, ppc, crm, cro, b2b, b2c, dtc, ugc) are kept against the length floor.
- **Cost is bounded before the first request**: at most 4 searches × 6 rows = 24 billed rows per campaign (3 market rungs + 1 craft), the market track stopping the moment it has enough, and the craft search running last so a dead source is never paid for twice. Credits spent ride into the telemetry feed.
- **A competitor's results are never our claims.** Every evidence block carries that rule verbatim — the references are read for STRUCTURE (hook shape, proof placement, offer framing, CTA), and lifting their figures or testimonials is a compliance failure wearing a proven layout. External evidence can lift a layer's confidence off the floor but never to High: a live competitor ad is direction, a retrieved Vault asset is this account's own intelligence.
- **The loop closes itself.** The top reference's actual pixels are read once by SPARK (`extractVisualDNA`) and banked as a `design` chunk, which is exactly what `bestVisualReferenceFor` already reaches for at the top of a run — so the second campaign in an account gets that design for free and never pays for the read. The read is skipped entirely when a reference is already attached or the Vault already has one.
- `npm run gethookd:research "<brief>"` runs the real ladder against the live library once and prints what SPARK, ECHO and OPUS would be handed, plus credits spent. It is the ONE command that talks to the live source — everything else is stubbed, because a suite that hit the library would bill the account on every run.

### Meta Ads (MCP connector)
- Attach Pipeboard's hosted Meta Ads MCP to the orchestrator with Anthropic's **MCP connector** (`mcp_servers` + `mcp_toolset` on `anthropic.beta.messages.create`, beta header `mcp-client-2025-11-20`). Token auth via `PIPEBOARD_API_TOKEN` (`?token=` on the server URL).
- Only attached when configured; the agent runs normally without it. MCP tool calls execute server-side and surface in the telemetry feed.

### Meta creative contract (`lib/meta-ads.ts`)
- **The platform makes the creative, not the caption.** The caption layer — the per-concept `adPackage` (primary text, headline, description, CTA), its editor and the mock Facebook feed it was previewed in — was removed on purpose. Do not reintroduce it: the caption is written in Ads Manager, so everything an ad must say is said by the creative (`productionBrief.onImageText`, at most 2 blocks inside 95 chars — see "On-image text" above).
- What remains of the contract lives in this one module: the RXN test token (`metaAdName`, `metaAssetName`, `parseTestToken`, `TEST_ID_RE`), the **on-creative compliance gate** (`validateCreativeCopy` / `creativeCopyFeedback`), `META_CREATIVE_CRAFT_BLOCK` (injected into every orchestrator run) and the placement map (`PLACEMENTS`, `placementFor`). Never re-declare any of these elsewhere.
- **Words burned into pixels cannot be edited after the upload, so they are checked BEFORE the render.** The gate reads what ships — the on-image text of every creative, plus the frames of a motion concept — and names CLAIMS, not words (the old banned-word list bounced every legitimate "30-day money-back guarantee"). Hard errors (guaranteed outcomes, medical cure claims, weight-loss figures, miracle / overnight results, income claims, personal-attribute assertions such as "Do you have acne?") share the single bounded revision pass with the NEURO pre-test; claims that are legal only when substantiated ("cure for", FDA-approved, clinically proven, #1 / best-selling) are warnings. The upload route re-runs the same gate server-side, so a creative that skipped the run still cannot leave with a hard error on it.

### Upload to Meta + the Launch Bay
- **The Launch Bay** (`components/campaign-reactor/canvas/AdStudio.tsx`, the Reactor's third view) replaced the Ad Studio's caption editor and mock feed. It is about the PIXELS: which Meta placement the render fits (`placementFor`), a **pixel pre-test** (`POST /api/studio/pretest` → `pretestCreative` in `lib/neuro.ts`) that reads the actual render with vision — is the on-image text spelled the way it was written, does the product read at thumb size — and falls back to scoring the plan when there is no render or no key (`basis: 'plan' | 'creative'`, never dressed up as the other), plus download and upload.
- **Upload goes to the brand's MEDIA LIBRARY, not into an ad** (`lib/meta-publish.ts`): images to `act_X/adimages` (multipart; the source is fetched through `safeFetch` with every redirect re-validated, capped at Meta's 30 MB), clips to `act_X/advideos` via `file_url`. It needs a token with `ads_management` and an ad account — no Page id, no link URL, no caption. The buyer builds the ad in Ads Manager from the library, Advantage+ or manual alike.
- **Whose account:** `resolveMetaCredentials` — the brand's stored connection first, the deployment env second. An upload with no unambiguous destination is refused with a reason (`needsConnection`), never guessed into whichever account the token reaches first.
- `GET /api/meta/publish` reports where this brand's uploads go; `POST` takes one creative or `{ items }` for a whole run (≤ 24, 3 in parallel, `maxDuration` 300). Every asset is named with its RXN token and pre-seeded as a pending outcome carrying the returned **image hash / video id**, which is what lets the ingest grade an ad built under any name back to the variant it came from. Never throws: every failure is a 200 with a structured reason the Launch Bay renders inline.

### Product catalog (`lib/catalog/`)
- **The store's own products, read from what it already publishes** — no app install, no API key: Shopify's public `/products.json`, then the WooCommerce Store API, then schema.org `Product` JSON-LD on the homepage and the product pages it links to. Shopify/Woo products are enriched from their own pages, because review apps publish ratings as JSON-LD and the catalog APIs do not. Every fetch goes through `lib/safe-fetch.ts` (SSRF-checked on every redirect, size-capped).
- Kept per account in `platform_settings` (`catalog.products`, ≤ 250 products). With no settings store, the catalog a session synced is shown to that session only — the same rule `getConnectedWebsite` follows, so one brand's catalog never surfaces for another. `GET/POST /api/catalog` lists summaries / syncs; the panel lives on the Brand page, and the brief's product picker (guided step 1 and Quick Launch) appears once a catalog exists.
- **A product's published facts are the ONLY figures a creative may state about it.** A run with a `productId` resolves the product from THIS account's catalog server-side (never from the request body) and appends `productFactsBlock` to the system prompt: price, sale price and % off as the store publishes them today, rating + review count only when published, SOLD OUT stops any offer on it, and the product photo binds every production brief to the product as it is actually sold. The photo is also handed to OPUS as an image. A whole-brand run gets `catalogRangeBlock` (the range, for bundles and cross-sells); a run with no catalog gets a rule forbidding invented prices, discounts and ratings.
- `inferNiches` reads the catalog's vertical (product types, tags, titles → `ECOMMERCE_VERTICALS`, at most two, empty when the catalog is too mixed to say) for the research ladder and the Ad Library's default view.
- Guarded by `npm run selftest:ecom` — the parsers against captured Shopify / WooCommerce / JSON-LD payloads, the facts block, the vertical read, the compliance gate, the upload naming and the purchase-first grading. No network.

### Meta performance ingest (learning loop)
- `POST /api/meta/ingest` (engine: `lib/meta-ingest.ts`) pulls ad-level insights from the Marketing API, grades each ad **against its account cohort medians**, and writes verdicts into `campaign_outcomes` — ORACLE memory. Winners auto re-ingest into the Vault via `recordOutcome`, into the SAME account.
- **Purchase first.** Once ≥ 3 ads in the account have purchases, grading is on ROAS and cost per purchase against the account's medians — a winner needs ≥ 3 purchases and at least break-even ROAS; a loser spent twice the floor without a sale or returns well under the median. An account with no purchase signal yet is click-graded (CTR/CPL vs cohort, absolute benchmarks under 3 eligible ads), and the verdict's metric says which. An e-commerce ad that wins on clicks and loses on revenue is a loser with a good thumbnail.
- **Counted once.** `resultCount` takes the MAX across an event's synonyms (`purchase`, `offsite_conversion.fb_pixel_purchase`, `omni_purchase`…) rather than summing them — Meta reports the same purchase under several names, and summing them doubled every count.
- **Attributed three ways**, in order: the Meta ad id (a re-sync), the RXN token in the ad's name, and the uploaded ASSET (image hash / video id read off the ad's creative — single, carousel or flexible). The asset match is what claims the pending row the upload seeded.
- **Scoped to the account** on every read and write — the outcomes it matches, the rows it writes, the winners it banks. Idempotent by `attributes.metaAdId`: re-syncs update changed verdicts, skip unchanged ones. Never throws — returns a summary. Trigger from the /meta dashboard ("Sync Meta → ORACLE").

### Multi-tenant lock-down (one brand never reads another's data)
- **The account comes from the signed session, always** — `currentAccount()` (`lib/account.ts`). Never from a body, form field or query string; `selftest:tenant` greps for all three.
- **Every query against a tenant table carries the account IN THE QUERY CHAIN** — `.eq('builder_id', …)` / `.eq('account_id', …)` (or the key in an insert's row). A predicate elsewhere in the function does not count: that is how the second query in a function goes unscoped while the first passes review. Tenant tables: `knowledge_chunks`, `campaign_outcomes`, `faces`, `frameworks`, `creative_outputs`, `media_generations`, `long_documents`, `platform_settings`. Inserts of a pre-built row are allowlisted by name in `scripts/tenant-isolation-selftest.ts`, with the claim asserted.
- **Reads by id are scoped too** — an update or delete by id also filters on the account, and an id the account does not own reads as "Not found" (the same answer as an id that does not exist).
- **The Vault lists only what the account owns** — never global rows. `match_knowledge` widens a scoped search to global rows, so the semantic browse re-checks ownership. Vault counts use `knowledge_stats_scoped` (`supabase/schema.lockdown.sql`) with a per-system head-count fallback; the unscoped `knowledge_stats()` is never called.
- **Deployment-wide credentials only act on a single-brand deployment** (`lib/tenancy-mode.ts` → `deploymentCredentialsAllowed()`): the `META_ACCESS_TOKEN` fallback in `resolveMetaCredentials`, the Meta Ads MCP attached to Reactor runs, and the connection screen's report of the env token. `graphGet` has no env default — every token is resolved for an account. Multi-tenant = any `users` row, or `PLATFORM_MULTI_TENANT=true`.
- **Provider keys only go to the provider.** A caller-supplied fal `responseUrl` is followed only on fal's queue host (`isFalQueueUrl`) — it used to receive `FAL_KEY` for any host named. The image download proxy goes through `safeFetch`.
- **No account directory.** Accounts are read only where tenancy is resolved (`lib/account.ts`, `lib/tenancy-mode.ts`, `getBuilder` by id); the unauthenticated `/api/builders` route that listed and created accounts was removed. Account creation belongs to the future owner dashboard.
- Guarded by `npm run selftest:tenant`, verified by mutation: re-introducing each original bug (unscoped outcomes, null-scoped browse, ungated env token, fal key to any host, unscoped faces, ungated MCP) fails it.

### Platform Library (the owner's method, never a brand's to see)
- **What it is:** the owner's SOPs, frameworks and playbooks, uploaded once at `/owner/library`, tagged by niche, and applied by the Reactor to every brand in a matching niche — as METHOD only. Owner-only behind `PLATFORM_OWNER_PASSWORD` (`lib/owner.ts`, `lib/owner-session.ts`); `/owner` and `/api/owner/**` sit outside the brand middleware and every owner handler checks the owner cookie first, answering 404 without it.
- **Separate tables, not `knowledge_chunks`** (`supabase/schema.library.sql`): `library_documents` + `library_chunks`, HNSW + full-text, `match_library` (RRF hybrid, scoped by NICHE overlap, not by account). RLS on, no browser-role grants (EXECUTE revoked from `public` too — Postgres grants it by default). No brand-facing query can reach them; only `lib/library/index.ts` names them.
- **Upload:** Markdown, text, CSV, HTML, PDF, or a whole Notion export zip. Zips are unpacked IN THE BROWSER (`lib/library/unzip.ts`, fflate) so only text is sent — images are never decompressed, nested `Part-N.zip`s are followed, text capped at 25 MB per archive. PDFs go to `/api/owner/library/extract` (unpdf, full text). Documents are normalised (`lib/library/text.ts`: Notion ids stripped from titles, images dropped, links reduced to their text), chunked BY HEADING PATH (a rule keeps the heading that says what it is a rule about), embedded with the heading, and de-duplicated by content hash. Batches are sent under Vercel's body limit and matched back by position.
- **Niches** (`lib/library/niches.ts`): `all`, `ecommerce`, `ecom:<vertical id>` (the ad library's verticals), `services`, `marketing`. A brand's keys are read off its OWN catalog and website (`brandLibraryNiches`) — always `all` + `ecommerce`, plus its verticals. A brand never chooses, and a request cannot claim, a niche.
- **In a run:** `searchLibrary` runs in parallel with the preflight briefing, capped at 6 s (`LIBRARY_BUDGET_MS`), and `libraryMethodBlock` hands OPUS the sections with three rules that travel every time: METHOD ONLY (its examples and figures are other businesses' — never a claim, never on a creative), THE BRAND WINS a conflict, NEVER CITE IT. Telemetry says "Platform playbook applied · N sections" — a count, never a heading or a line.
- Guarded by `npm run selftest:library`: the SQL in Postgres + pgvector (niche filtering, no browser access, no surfacing through `match_knowledge`, cascade delete, scoped stats), Notion text + zip handling, the owner gate (short password closed, expiry, tamper, password change signs out), and the walls (only the library module names the tables, only owner routes + the Reactor import it, the Reactor can only search it, telemetry carries a count).

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
`brand/BRAND_MEMORY.md` = the brand template injected into the copy agents at runtime. It ships BLANK — the real brand intelligence comes from the connected website via `lib/brand-memory.ts` / `lib/brand-context.ts`.

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
2. Pick a Campaign Angle (and a product, once a catalog is synced on the Brand
   page), choose output types, hit **Fire Reactor**.
3. Watch the **Reactor Telemetry** panel stream the agent's steps:
   "Searching pattern: …", "└▸ pattern · Social Proof Pattern", "Loading Creative
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
  -d '{"angle":"Social Proof","outputs":["Static Creative","Carousel Creatives"]}'
```
You'll see the SSE stream of `step` / `retrieval` / `concept` / `done` events —
that *is* the agent thinking out loud.

**C. Prove the learning loop**
- Mark a concept a **winner** in the UI (or POST `/api/campaign-reactor/outcome`).
  With Supabase + Voyage configured, it's re-ingested as a new `pattern` chunk and
  the next run can retrieve it.

To run the *real* agent end to end: set `ANTHROPIC_API_KEY` (agent),
`VOYAGE_API_KEY` (embeddings + reranker), and the Supabase keys (vector store),
then run `supabase/schema.reactor.sql`, `schema.tenancy.sql`,
`schema.retrieval.sql` and `schema.lockdown.sql` in Supabase (plus
`schema.documents.sql` with `PAGEINDEX_API_KEY` for long documents, and
`schema.library.sql` for the Platform Library). `/api/health` → `retrieval`
confirms which stages are live.

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
- [x] Platform built as the Creative Reactor (9 intelligence systems)
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
- [x] **Per-creative variation system** (`lib/variations.ts` — the single source of truth). Variations are not a deliverable and not a global knob: every selected format carries its OWN count (×1–×4) and its OWN lever (Smart Mix / Hooks / Angles / Visuals / Copy) under its size cards, so "3 hook variations of the video, 1 static" is expressible. The ladder stops at 4 because every concept costs a brief + on-image copy + NEURO pass + a real render inside one `REACTOR_BUDGET_MS` function — raise it when the host allows longer functions. Lever language is format-aware (a static has no "first three seconds", a carousel no "spoken opening"), the counts are enforced server-side (surplus trimmed always; a shortfall re-asked once, only on runs of ≤6 concepts, since that costs a whole turn), and every version is stamped with the run's `testId`, its own `variantId` and the lever + concrete difference it carries — which is what lets the Meta ingest grade a controlled test instead of a pile of one-offs (`variationPerformance()` in `lib/outcomes.ts`). Guarded by `npm run selftest`. The old `Creative Variations` and `Recommend Format` deliverables are removed — the first double-counted against the global knob, the second carried no model or size choice
- [x] Per-deliverable render-model menus on the Formats step (`lib/model-menu.ts`) — system recommends, user overrides; dimension options adapt to the chosen model's registry ratios. Montage gets two REAL pickers (Still Model + Motion Model) — OpenMontage is shown as the scene-planning engine only, never a selectable render model
- [x] Creative Canvas view (`components/creative-canvas/`, `lib/creative-canvas/graph.ts`): **full-screen immersive mode** (portaled to `document.body`, sidebar/topbar fully hidden, layered Escape), pre-structured node lanes (hook → message → proof → scenes/visual → CTA → output) seeded live with the Reactor's already-generated media, branch/approve/lock, precise per-node regeneration (`/api/canvas/regenerate`, strategy-coherent, demo fallback), **universal drag-to-reassign** (every content card — hook/message/proof/visual/scene/CTA — can take any content role; only Output is fixed) with a confirmation modal (Reassign & regenerate / Reassign, keep words / Visual move only / Cancel), right-click context menu, ⌘/Ctrl+D duplicate + Delete shortcuts, scene render + animate, Send to Launch Bay (the lane's active hook and offer become the creative's on-image words, so a reshaped lane arrives unrendered and renders what the Canvas settled on); "Launch in Creative Canvas" CTA on montage runs; full spec in `docs/CREATIVE_CANVAS.md`
- [x] **Multi-format campaigns**: selecting several formats in the brief yields ONE campaign → ONE shared strategy layer (campaign bar + chips shown once) → one Creative Canvas tab per format family (Image / Video / Montage / Variations / Recommended, `canvasTracks()` + `conceptsForTrack()`); tabs are lazy-mounted and kept alive so switching never loses edits; formats are never mixed into one graph
- [x] Reactor view toggle is Reactor · Canvas · Launch Bay (`components/campaign-reactor/canvas/AdStudio.tsx` — the Studio rebuilt around the pixels and the upload; the caption editor, the mock feed preview (`AdPreviewCard`) and the retired free-node Flow view (`CreativeFlow`, `lib/campaign-reactor/flow.ts`, `canvas.ts`) are deleted)

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

**Proven-ad intelligence (GetHookd)**
- [x] `lib/gethookd/` — the proven-ad source: live Meta creative that is already running in the ICP's markets, with performance tier, run-time, transcripts and signed stills. Replaces the Meta `ads_archive` search that could never return commercial ads outside the EU (it is kept as the unkeyed fallback)
- [x] Ad Library "Proven Ads" tab — focus toggle (E-commerce first, then Service Businesses / Marketing & Agency / Everything), e-commerce vertical chips (opening on the brand's own vertical when its catalog has one), format and tier filters, longest-running-first ordering, credit accounting on screen
- [x] Two actions per ad: **Clone** (headline + body + transcript → Creative DNA → Reactor) and **Design** (signed still → SPARK's visual reader → banked as a `design` chunk in the Vault, with an honest receipt when nothing was stored)
- [x] The ICP is configuration, not prose: `lib/gethookd/icp.ts` defines e-commerce, services and marketing as separate niche sets (e-commerce leading, its verticals labelled once in `ECOMMERCE_VERTICALS`), and the curated demo winners were rewritten off one construction account onto the real ICP
- [x] **Automatic campaign research** (`lib/gethookd/research.ts`) — a submitted brief now searches the proven-ad library on its own and hands the result to SPARK and ECHO BEFORE they report to OPUS. Static image, active, 90+ days running, no maximum age; a bounded ladder (short literal term → broader term → unqueried browse → every market) with a hard ceiling of 24 billed rows; the shortlist deduplicated by ad id, by copy and by advertiser. Eligibility is re-checked per row and never lowered — a thin result is reported as thin and OPUS is told not to claim external validation
- [x] **Two reference pools, split by what each layer learns.** MARKET is scoped to the brief's ICP and carries the argument; CRAFT drops the niche filter for the whole library and narrows on the static-ad archetypes instead, carrying the construction. ECHO sees market only; SPARK sees both in labelled sets; the design read prefers craft. A craft reference must carry a headline, because the library files untreated product photos under an archetype too
- [x] **The agency's own category is a first-class focus** (`MARKETING_NICHE_IDS`) — martech, info offers and other agencies, so a campaign for the agency itself researches the right market instead of its clients'. Marketing vocabulary is stripped by provenance rather than outright, so "funnel" is noise in a brief body and the subject in an offer name
- [x] **The Campaign Offer ladder is the one an e-commerce brand actually runs** (`offerOptions`) — Full Price (value-led), New Launch / Drop, Limited Stock / Restock, Quiz / Product Finder, Free Shipping, Money-Back Guarantee / Risk-Free Trial, Subscribe & Save, Free Gift With Purchase, Spend Threshold / Amount Off, Bundle / Buy More Save More, BOGO, Percent Off and Sale Event / Seasonal — ordered by margin cost, each carrying its own proof burden and CTA frame. The guarantee directive carries its compliance constraint, and the discount and bundle directives forbid a rounded-up, manufactured or borrowed saving — a wrong number burned into a creative is a compliance problem shipped at scale
- [x] The reference set is banked as it is used — the top ad's design is read once and stored as a `design` chunk, so `bestVisualReferenceFor` serves it free on every later run in that account
- [x] `npm run gethookd:research` — the one live probe: runs the real ladder, prints what each agent is handed and what it cost
- [x] `npm run selftest:gethookd` — in-process checks: focus separation, the real payload shape, cost caps, the 90-day bar (including a 3,200-day zombie and an 89-day near-miss), the ladder's bounds, term extraction that never searches a marketing word, dedup by copy and by brand, the borrow rule on every block, and honest failure on an unkeyed / rejected / exhausted / dead source

**E-commerce Meta creative — the creative, not the caption**
- [x] **Caption layer removed** — the per-concept `adPackage` (primary text / headline / description / CTA), its editor, the mock Facebook feed preview and "Copy for Ads Manager" are gone. The creative carries the sale: `META_CREATIVE_CRAFT_BLOCK` (product as hero, one idea per creative, proof only from supplied facts, offers stated exactly as configured, placement safe zones) is injected into every run, and the on-creative compliance gate (`validateCreativeCopy`) checks the words burned into pixels before the render and again at upload
- [x] **Upload to Meta, rebuilt** (`lib/meta-publish.ts`, `/api/meta/publish`): into the brand's OWN ad account (per-account credentials — the old publisher read the deployment env, so every brand on a multi-brand deployment would have pushed into one account), into the media library rather than a half-built ad, one creative or a whole run, named with its RXN token and seeded as a pending outcome keyed by image hash / video id
- [x] **The Launch Bay** replaces the Studio: placement fit, a pixel pre-test that reads the render back (spelling of the on-image text, product legibility), download, single + bulk upload with per-creative status
- [x] **Product catalog** (`lib/catalog/`, Brand page panel, product picker in the brief): Shopify / WooCommerce / JSON-LD, read from what the store already publishes; the selected product's published facts are the only figures a creative may state, its photo is shown to OPUS and binds every production brief, and its vertical steers research
- [x] **Strategy vocabulary re-grounded in e-commerce** — angles, deliverables (creative formats only), awareness, audiences and the offer ladder (`lib/reactor-inputs.ts`), the curated foundation assets and learnings (`lib/reactor-data.ts`), the suggest heuristics, the demo pool and the orchestrator's compliance block all speak purchases, AOV and products. The curated learnings are labelled "Craft principle — not yet measured on this account." rather than passed off as results
- [x] **Research on the brand's own vertical** — `focus: 'ecommerce'` + catalog `niches` into the research ladder; the Ad Library gains vertical chips and opens on the brand's vertical
- [x] **Performance ingest graded on e-commerce economics** (`lib/meta-ingest.ts`) — ROAS and cost per purchase vs account medians once ≥ 3 ads have purchases, click grading otherwise and labelled as such; purchase counts de-duplicated across Meta's synonyms (they were being summed — double counting); ads attributed back by uploaded asset as well as ad id and RXN token; every read and write scoped to the account (it was not — one brand's ad could claim another brand's pending upload)
- [x] CSV joins the Vault's text formats (`lib/csv.ts`) — review exports and product feeds ingest as rows a model can read
- [x] `npm run selftest:ecom` — the contract, compliance gate, upload naming, catalog parsers, facts blocks, vertical read and purchase-first grading, in-process

**Multi-tenant lock-down + Platform Library**
- [x] **Cross-account reads closed** — Vault browse (listed every brand's chunks; its semantic half missed the brand's own), Vault stats, Vault update/delete by id, ORACLE outcomes + learnings rubric + winning configs, the "Our Winners" clone tab, banked ad designs, NOVA research (page, dedup, sweep), faces (whose upload took its tenant from the form), frameworks (tenant from the body, `builderScope=all`), taxonomy locks + backfill, dashboard KPIs/activity, render-status updates, Mike's Vault search + strategic memory, and the in-memory website scan / catalog for account-less sessions on a shared deployment
- [x] **Owner's credentials stop at the owner** — the `META_ACCESS_TOKEN` fallback, the Meta Ads MCP and the connection screen's env report are single-brand only (`lib/tenancy-mode.ts`); `graphGet` has no env default
- [x] **Two key/endpoint leaks fixed** — the fal video poll sent `FAL_KEY` to any caller-named URL; `/api/builders` listed (and created) every brand account without authentication. The download proxy now re-checks redirects
- [x] The NOVA sweep no longer spends model calls extracting research it cannot store (it ran with no account, and every write was refused)
- [x] `npm run selftest:tenant` — a general rule (every tenant query carries the account in its chain) plus credential and key checks, mutation-tested
- [x] **Platform Library** — `/owner/library`, `PLATFORM_OWNER_PASSWORD`, browser-side Notion zip unpacking, heading-chunked + niche-tagged + hybrid-searched, applied to runs as method only and never shown to a brand (`supabase/schema.library.sql`, `npm run selftest:library`)

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
- [x] Reactor page code-split (Canvas/Launch Bay dynamic): 167 kB → 102 kB
- [x] Mobile: safe-area viewport, portaled nav drawer + brief sheet (both were
      trapped by `backdrop-filter` / `isolation: isolate` containing blocks),
      `dvh` sheets, 44px touch targets, and a phone performance layer that
      freezes the aurora and drops backdrop blur under 768px
- [x] **Ad Library lives inside Creative Intelligence** — finding an ad that
      already works and tearing one down are the same job, so the library sits
      beside SPARK on `/creative` (anchor `#ad-library`) instead of a sidebar
      tab of its own. `/ad-library` stays as a redirect that preserves its
      query string, because the Meta Intelligence board deep-links into it
- [x] **The proven-ad feed is bounded by LAUNCH DATE, not by the vendor's tier**
      (`lib/gethookd/index.ts`). Three bugs shipped together and reinforced each
      other: ordering by `days_active` with no launch bound returned 2018
      records nobody ever marked stopped (~3,200 days "live"); the vendor's
      performance tier is largely derived from that same duration, so it rated
      those zombies "Winning, 100" instead of correcting the sort; and the tier
      is re-checked at display time, so a page asking for winning/optimized had
      most of its rows WITHHELD as stale — six found, five discarded, one
      rendered, which is why the grid also looked empty. Now: `started_after`
      bounds the launch date (`GETHOOKD_LAUNCH_WINDOW_DAYS`), `run_time` carries
      the proof (`GETHOOKD_MIN_DAYS_ACTIVE`), and the tier is opt-in rather than
      the default. Duration still orders the feed — that reasoning is only sound
      INSIDE the window
- [x] **A typed term is matched exactly** — `strict_query` is sent whenever a
      query is. Without it the source relaxes the term (partial words, dropped
      words, similar meanings), so "contractor" returned ads that merely said
      "contract" — car-loan claims and phone plans, billed per row like any
      other. A feed of confidently wrong ads is worse than an empty one
- [x] **A refused filter is renamed before it is dropped** (`lib/gethookd/client.ts`)
      — `PARAM_ALIASES` retries the endpoint's other spellings (`geo` →
      `location`) and only drops the filter when every one is refused, which is
      the single case that still shows the "all markets" banner. Bounded and
      named at every step, so it can never strip its way down to an unfiltered,
      fully billed search. Guarded by `npm run selftest:gethookd` (82 checks)
- [x] **Hybrid retrieval** (`supabase/schema.retrieval.sql`): HNSW replaces
      IVFFlat, a weighted full-text column joins the vector, and
      `match_knowledge_hybrid` fuses both with Reciprocal Rank Fusion under
      `match_knowledge`'s exact tenant predicate. Falls back to vector-only
      until the migration runs
- [x] **Voyage reranking** (`lib/rerank.ts`) — the fused pool of 24 is
      reranked by `rerank-2.5` to the top 8; a missing key, error or 4s timeout
      keeps the fused order, and a partial response can reorder but never
      shrink the result
- [x] **Long documents via PageIndex** (`lib/documents/`, Vault → Long
      Documents, `/api/vault/documents`) — PDFs read by structure, an
      account-scoped ledger, and a `read_document` tool for the Reactor
- [x] `npm run selftest:retrieval` — 41 in-process checks: the migration
      executed against Postgres + pgvector (PGlite), tenant isolation in the
      hybrid SQL, the reranker's documented REST shape and every degradation
      path, PDF validation, ledger scoping, and the SDK surface this code uses
- [x] `npm run selftest` (`scripts/reactor-selftest.ts`) — asserts every
      mandatory layer activates with real evidence, evidence is attributable,
      and deliverable counts match the brief

**Still open**
- [ ] SPARK URL-only ingestion for JS-rendered sources (Meta Ad Library / TikTok / shared boards via oEmbed/transcript APIs or a headless render). Uploads, pasted screenshots, direct image links and YouTube transcripts all work today; a client-rendered page has no images in its served HTML, so `lib/ad-image.ts` scrapes og:image/`<img>`/inlined-JSON URLs and otherwise returns a note telling the user to screenshot it
- [ ] Scheduled auto-sync for the Meta performance ingest (manual one-click sync done; cron/Vercel scheduled function pending)
- [ ] More dashboards reading live `knowledge_chunks` counts (Agent Network does; Research/Copy/Pattern still curated)
- [ ] Run `schema.lockdown.sql` and `schema.library.sql` in Supabase; set `PLATFORM_OWNER_PASSWORD`
- [ ] Deployed + tested end to end with real keys

