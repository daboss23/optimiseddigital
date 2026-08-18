# Standing up a second instance (friend / customer test deploy)

A separate live URL, a separate Supabase project, a separate Vercel project.
It shares nothing with the TPB production deployment except the source code —
no data, no keys, no vault, no ad account. `main` is not touched at any point.

---

## 0. What she is deploying

Branch: **`claude/reactor-testing-setup-z1hskt`**

That branch — not `main` — carries the work that makes a second instance
possible at all:

- `lib/tenant.ts` — identity resolves from the connected website, then env
  overrides, then a neutral fallback. Without it every deployment still thinks
  it is The Professional Builder and NOVA profiles builders no matter whose
  site is connected.
- Empty states everywhere real data is absent — no seeded copy on a fresh deploy.
- White-labelled shell — branding comes from the connected website's own logo.
- Tenant-aware agent network; strategy options derived from ATLAS.
- `scripts/vault-copy.ts` — optional craft-knowledge transfer (step 6).

Running her instance off `main` would give her a TPB-branded app pre-loaded
with TPB's framing. Running it off this branch gives her the blank-slate
product.

---

## 1. Fresh Supabase project

New project (not a new schema in the TPB project — separate project, so a
mistake in hers can never touch TPB's data).

Run these in the SQL editor **in this order**:

| # | File | Why |
|---|---|---|
| 1 | `supabase/schema.sql` | base `creative_outputs` |
| 2 | `supabase/schema.platform.sql` | multi-tenant tables (adds `builder_id`) |
| 3 | `supabase/schema.reactor.sql` | pgvector + `knowledge_chunks` + `match_knowledge()` |
| 4 | `supabase/schema.settings.sql` | `platform_settings` (logo, curated sources) |
| 5 | `supabase/schema.media.sql` | render ledger |
| 6 | `supabase/schema.faces.sql` | UGC face roster |

Optional, skip for a test: `schema.taxonomy.sql` (analytics views only — the app
already writes taxonomy into existing jsonb), `schema.p2.sql` (seeds starter
global frameworks — only if you want her to start non-empty).

Then collect: project URL, anon key, service role key.

---

## Live test instance

| | |
|---|---|
| Vercel project | `optimiseddigital` |
| URL | https://optimiseddigital.vercel.app |
| Branch | `claude/friend-test-deployment-am9gpk` |
| Supabase | its own project, schema applied |

Meta credentials are deliberately unset on this project. Connecting Meta means
generating a System User token on HER OWN Business Manager — never reusing
TPB's, which carries `ads_management` write access to TPB's ad account.

---

## 2. New Vercel project

- Import the same GitHub repo.
- **Settings → Git → Production Branch = `claude/reactor-testing-setup-z1hskt`.**
  This is the one setting that makes it a branch deploy instead of a `main`
  deploy. Her production URL then builds from that branch.
- Framework preset: Next.js. No build command overrides.
- Her URL: `<project-name>.vercel.app`, or attach a subdomain you own.
- The production-branch setting lives under **Settings → Build and Deployment →
  Branch Tracking**, not on the Git page.
- A branch Vercel has never built has nothing to "Redeploy" from — the first
  build on it comes from a push to that branch, or from Create Deployment.

---

## 3. Environment variables (her project only)

Minimum for a working instance:

```
ANTHROPIC_API_KEY            # the agent
VOYAGE_API_KEY               # embeddings — without it retrieval is demo-only
NEXT_PUBLIC_SUPABASE_URL     # HER project
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Add for creative rendering (any one gives her images; without all of them copy
still works and image generation degrades quietly):

```
KIE_API_KEY        # flagship stills — preferred by the oven when set
FAL_KEY            # FLUX stills + Seedance/Kling/Veo/Wan video
HF_CREDENTIALS     # Higgsfield Soul stills + DoP video
```

**Do not set on her project:** `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`,
`META_PAGE_ID`, `PIPEBOARD_API_TOKEN`. Those point at TPB's ad account. Left
unset, the Meta surfaces simply run without live data — which is the correct
blank-slate behaviour for her.

Optional, only if she wants the app to know who she is *before* connecting a
site: `TENANT_COMPANY_NAME`, `TENANT_INDUSTRY`, `TENANT_AUDIENCE`. Normally
skip these — the website scan is meant to be the source of truth.

Use separate API keys from TPB's where you can, so her testing spend is visible
on its own bill.

---

## 4. Deploy and verify

Deploy, then on her URL:

1. Every dashboard should read as **empty with a helpful message** — not
   populated with TPB numbers. If you see TPB copy anywhere, the Vercel project
   is building the wrong branch.
2. Vault → connect her website → it scans and the shell re-brands to her logo.
3. Campaign Reactor → pick an angle → Fire. Watch Reactor Telemetry stream real
   tool calls.

---

## 5. The onboarding path she is actually testing

This is the flow you will ship to paying customers, so watch where she stalls:

connect website → ATLAS reads it → vault fills with her brand read → she
uploads her own winning ads / frameworks / SOPs → Reactor runs against her
knowledge, not yours.

---

## 6. Optional: give her the craft knowledge

The direct-response *craft* (frameworks, hooks, headline patterns, winning ad
structure, design DNA) is not business-specific and is worth seeding so she
isn't cold on day one:

```bash
SOURCE_SUPABASE_URL=... SOURCE_SUPABASE_SERVICE_ROLE_KEY=... \
TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... \
npx tsx scripts/vault-copy.ts --dry-run
```

Dry-run first, then drop the flag. It deliberately holds back TPB member wins
and the TPB website read, and never copies `campaign_outcomes` — grading her
creative against TPB's cohort medians would produce confident, wrong verdicts.

Skip this entirely if what you want to test is the true cold-start experience.

---

## 7. When this stops being a branch deploy

A branch deploy is right for a test and wrong for customer #5 — it drifts and
stops receiving fixes. Once her instance has proven out, merge
`claude/reactor-testing-setup-z1hskt` into `main`, point her Vercel project's
production branch back at `main`, and every future customer deploys from one
baseline.

Before that merge, check what the TPB production deployment looks like on the
new empty-state code — those commits remove seeded copy, which is correct for a
fresh tenant and a visible change for TPB. Fix by connecting/keeping TPB's own
website read and vault populated, not by keeping the branch forked.
