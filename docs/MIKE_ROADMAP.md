# Mike — where things stand and what is queued

Written 2026-08-20, ahead of the first customer test (Saturday). Read this cold
and you can pick the work up without the chat that produced it.

---

## Shipped and live on `main`

- **Live Meta source** — `lib/operator/adapters/meta-server.ts` pulls the real
  account (daily rows, two range-level frequency windows, ad identity, cohort
  baselines). Client shell `meta.ts` → `/api/operator/source`. The seam is one
  env flag: `NEXT_PUBLIC_OPERATOR_SOURCE=meta`.
- **Connect Meta screen** — Meta Intelligence → Connect Meta validates a System
  User token against the Graph API before storing it in `platform_settings`
  (service-role only; the token never leaves the server, last-four display).
  Stored connection wins over `META_ACCESS_TOKEN` env.
- **Tenant-neutral Mike** — the constitution (`operator/mike-delight-constitution.md`)
  names no company. `narrate.ts` injects a `client` block (company, industry,
  audience, positioning, operator name) resolved from the connected website via
  `getTenant()` into all three narration modes (session / ask / catch-up).
- **First-login welcome** — fixed founder copy in `lib/operator/welcome.ts`,
  word for word, name-interpolated via `NEXT_PUBLIC_OPERATOR_NAME`, rendered by
  the UI (never model-generated), shown until dismissed once
  (`memory.welcomedAt`). Fresh per customer by construction: new deployment +
  new browser = new first meeting.
- **No spend floor** — `META_LIVE_MIN_SPEND` defaults to 0: a connected account
  is live from the first dollar. Mike's operator source was never gated; this
  was the /meta dashboard's demo→live switch.
- Verified: `npm run selftest:operator` 50/50, `tsc --noEmit` clean.
  Live contract check: `npm run selftest:operator-meta` (needs a token).

## Saturday checklist (user-side)

1. Vercel env: `NEXT_PUBLIC_OPERATOR_SOURCE=meta`, `NEXT_PUBLIC_OPERATOR_NAME`,
   `NEXT_PUBLIC_OPERATOR_TARGET_CPR` (her real target), confirm
   `ANTHROPIC_API_KEY` present. **Redeploy** — NEXT_PUBLIC_* bake at build time.
2. Optional rehearsal: own token into `.env.local` → `npm run selftest:operator-meta`.
3. Saturday: she opens the site → welcome greets her by name → connects her
   website (Vault) → Meta Intelligence → Connect Meta → pastes HER System User
   token (`ads_read`) → picks her ad account. Mike reads her ads from the first
   dollar. No token connected = honest empty state, never demo data.

## Queued iterations, in order

**1. Playbook knowledge system ("train Mike on my SOPs/frameworks") — ~1 session.**
- Add `playbook` to the `KnowledgeSystem` union in `lib/knowledge.ts` + Vault UI
  label/accent (declarative — ingest/search/browse flow through).
- Retrieve playbook chunks into the narration payload in `narrate.ts` so Mike
  speaks the client's methodology by name.
- The careful part: extend `validate.ts` with a `playbook` authorised-source
  kind so a number Mike quotes FROM an SOP resolves honestly. Tests in
  `scripts/operator-selftest.ts`.
- Storage already exists: Vault upload → `knowledge_chunks` (per-tenant
  Supabase, pgvector). Uploads feed the Campaign Reactor today; this makes them
  first-class for Mike.

**2. KPI targets panel + SOP extraction — ~1 session.**
- "Your targets" card beside Connect Meta: target CPL/CPR per result type,
  ROAS, CTR, hook rate → `platform_settings`.
- Mike reads them as CONTEXT first ("$31 CPL vs your $45 target" in evidence
  rows and narration). Unify `NEXT_PUBLIC_OPERATOR_TARGET_CPR` and
  `META_TARGET_COST_PER_RESULT` into the setting (envs become fallbacks).
- SOP upload → Mike extracts candidate targets → human confirms. A document
  proposes; it never silently changes a threshold.

**3. Custom rules from SOPs — later.**
- Needs hook rate in Mike's data contract first (`DailyMetric` has no video
  views; the /meta dashboard computes it from `video_3_sec_watched_actions`).
- Then a rule-builder. Not before the real-world trial shows how the
  cohort-relative engine behaves.

## The design rule that orders all of it

Documents change how Mike **talks**. Settings change his **targets**. Code
changes his **rules**. Never let a layer skip downward — a persuasive PDF must
not be able to move a threshold on its own.
