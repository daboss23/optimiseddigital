# Handoff — Functionality Polish Pass

**For:** an agent doing a bug-fix and polish sweep before a demo.
**Written:** 2026-09-22, at `main` = `c7e4c07`.
**Read `CLAUDE.md` first.** This document does not replace it; it says what
state the repo is in right now and where the landmines are.

---

## 1. The job

Sweep the platform for **functional** defects and polish. Broken states,
dead controls, mislabelled data, unhandled errors, layout that breaks on a
phone, loading states that never resolve, empty states that render blank.

**Not** a redesign. Not new features. Not refactors that touch a working
subsystem to make it prettier. If a change cannot be explained as "this was
broken and now it isn't", it is out of scope for this pass.

---

## 2. Non-negotiables

From `CLAUDE.md`, and the build enforces most of them:

- **TypeScript only**, strict. No `.js` files.
- **Tailwind only. No inline styles** — see §6 for the nine exceptions that
  currently exist and which one is a real violation.
- **shadcn/ui only** for components.
- **No TODOs or placeholder code** in a final file. The repo is currently
  clean of them — keep it that way.
- **Complete files.** When changing an existing file, produce the whole
  updated file, not a fragment.
- Dark theme, background `#0a0a0a`, amber accent, emerald success, red error.
  Cards are `rounded-xl border border-white/10 bg-white/[0.02]`.

**The platform is white-labelled.** Nothing in `lib/`, `app/`, `brand/` or
`seeds/` may name a specific company, industry or audience. Two selftests
enforce this and they will fail the build:

```
npm run selftest:blank-slate    # no tenant business leaks into the code
npm run selftest:tenant         # one account cannot read another's
```

---

## 3. Branch and merge

`main` is the deploy branch — Vercel builds from it.

If you are working through Claude Code on the web or a similar hosted
session, pushing directly to `main` is blocked at the network layer. Commit
to your session branch, open a PR into `main`, merge it. That is the normal
path here, not a workaround.

Locally with no branch override, committing to `main` directly is fine.

---

## 4. How to verify anything

Run these before every push. All are in-process, none touch the network,
none cost money:

```
npm run selftest:gethookd       # 186 checks — proven-ad source
npm run selftest:render         # on-image text discipline
npm run selftest:operator       # 50 checks — Mike's decision engine
npm run selftest:mike-ask       # 36 checks — Ask Mike instruments
npm run selftest:blank-slate    # white-label discipline
npm run selftest:tenant         # account isolation
npm run build                   # must compile clean
npx next lint                   # one known pre-existing warning, see §6
```

**All of the above pass at `c7e4c07`.** If one fails after your change, you
caused it — read the assertion text before changing the test. Several of
these tests encode a bug that actually shipped, and the message explains
which. A test that looks wrong is usually describing a failure mode you
haven't hit yet.

`npm run selftest` (the reactor suite) is different — it needs the app
running at `localhost:3000`. Start `npm run dev` first or skip it.

---

## 5. What just changed (so you don't re-break it)

Four PRs landed today, all in the proven-ad library:

- **#19** — the Ad Library gained a **Best built / Your market** pool toggle
  and a **Newest first** sort. Best built is the default: it drops the niche
  filter for the whole library, narrows on six static-ad archetypes, and
  requires an on-ad headline.
- **#20** — the country filter's real name is `location`, not `geo`.
- **#21** — `/api/health` was reporting a default it wasn't sending. It now
  reads `geoParam()` from the source.
- **#22** — the endpoint has **no format filter and no run-time filter**
  under any name. Both bars are now enforced on the returned rows in
  `lib/gethookd/index.ts`, and the feed reports how many rows it discarded.

**Expect the Ad Library to show fewer ads per page than it used to.** That is
correct behaviour, not a bug. Rows that are video, or that haven't run 90
days, are filtered out after the search. The note under the filters says how
many. Do not "fix" this by removing the filters.

---

## 6. Concrete targets found in a scan

Verified, not speculative:

**A real inline-style violation** — `components/campaign-reactor/ReactorModal.tsx`
has `style={{ width: '100%' }}`. That is a static value and belongs in
Tailwind as `w-full`. Fix it.

**Eight inline styles that are legitimate** and should be left alone:

| File | Value |
|---|---|
| `app/(platform)/network/page.tsx` | `backgroundColor: agent.accent` |
| `components/reactor/meta/MetaIntelligenceView.tsx` | computed bar height |
| `components/reactor/ui.tsx` | `width: ${pct}%` |
| `components/reactor/charts/WinRateDonut.tsx` | `background`/`boxShadow` from data |
| `components/brand/WebsiteIntelligence.tsx` | brand hex ×2 |
| `components/creative-canvas/CreativeCanvas.tsx` | context-menu x/y |
| `components/campaign-reactor/ReactorModal.tsx` | `width: ${progress}%` |

All carry values computed at runtime — a brand's measured hex, a percentage,
a cursor position. Tailwind cannot express those without generating classes
that don't exist. The rule is about hardcoded styling, not arbitrary values.
**Converting these to Tailwind will break them.**

**One known lint warning** — `app/layout.tsx:62`, `@next/next/no-page-custom-font`.
Pre-existing, App Router, not actually applicable. Leave it or suppress it
deliberately; don't restructure the font loading to chase it.

**Muapi is the primary provider for BOTH ovens — images and video.** It is
configured (`/api/health` reports `muapi: true`). `higgsfield`, `fal`,
`openai` and `gemini` reporting `false` is **deliberate**: they are fallbacks
behind Muapi, not a gap to fill. Do not treat their absence as a defect and
do not add keys for them.

What that makes worth testing is **slug drift**, not missing keys. Muapi
endpoint slugs are taken verbatim from `muapi.ai/llms.txt` and follow no
single convention — bare (`nano-banana-pro`), mode-suffixed
(`gpt-image-2-text-to-image`), versioned (`midjourney-v8`), vendor-prefixed
(`bytedance-seedream-5.0-pro`). This has failed twice in production and both
failures were SILENT:

- Invented `-image` suffixes made every frontier model 404, so the oven fell
  through to FLUX.1 Dev — the weakest text renderer in the menu — and shipped
  ads with misspelled headlines.
- Invented video slugs (`veo3`, `kling-pro`) 404'd, so a UGC ad ordered on
  Veo 3 came back as a GPT Image 2 **still**.

Check it with `npm run muapi:slugs` (probes the key, prints any override to
set). Then confirm the visible guard still works: a render that does not run
on the model it was asked for must show the warning under the still —
`requestedModelId` / `fellBack` / `note` flow from `generateImageDetailed`
through `/api/generate-image` to the concept card. **A silent downgrade is
the bug; the warning is the feature.**

`meta: false` is separate and real — it means "Push Creative to Meta" and the
performance ingest are unavailable. Confirm that path reports itself honestly
rather than hanging, but do not chase a key for it.

**`REACTOR_STATIC_ONLY` defaults ON**, so the system recommends static formats
only. Video is still selectable by hand. A missing video recommendation is
correct behaviour, not a bug.

---

## 7. Landmines — read before touching

**Cost.** GetHookd bills per returned row. Never put a search in a loop,
never raise `per_page`, never run `npm run gethookd:research` repeatedly —
it is the one command that hits the live library. `gethookd:params` is
cheap (<0.1 credits) because it asks for one row. The account has ~63
credits and a demo depends on them.

**Never lower an eligibility bar to make a feed look fuller.** The 90-day
run-time rule and the static-only rule are the platform's definition of
*proven*. When too few ads qualify, the search widens and says so. A fuller
feed of unqualified ads is the failure this system was built to avoid.

**`lib/render-prompt.ts` is the only prompt path for stills.** It is why ads
stopped rendering with misspelled headlines. Do not concatenate a brief into
a prompt anywhere else. `npm run selftest:render` guards it.

**Model slugs and vendor parameter names are taken verbatim.** Muapi slugs
and GetHookd parameter names follow no convention. Never "tidy" one into a
pattern — guessing is what produced misspelled headlines and a video order
that came back as a still. Use `npm run muapi:slugs` and
`npm run gethookd:params` to confirm.

**`lib/tenant.ts` and `lib/gethookd/icp.ts` are different questions.**
Tenant = who the deployment *is*. ICP = who it *researches*. Collapsing them
makes the library research the operator instead of the market.

**Mike's dashboard must never depend on a model call to display.**
`lib/operator/validate.ts` rejects a narration whose numerals don't resolve
to real fields; the fallback is computed template cards. Keep that path.

---

## 8. Still open (from `CLAUDE.md`)

Not this pass's job unless one is actually broken:

- SPARK URL-only ingestion for JS-rendered sources (Meta Ad Library, TikTok).
  Uploads, pasted screenshots and direct image links all work today.
- Scheduled auto-sync for the Meta performance ingest — manual sync works.
- Research / Copy / Pattern dashboards still read curated data rather than
  live `knowledge_chunks` counts. Agent Network reads live.

---

## 9. Suggested order

1. Run the full suite in §4 and confirm the green baseline before changing
   anything. If something is already red, that is the first finding.
2. Walk every page with the dev server: `/`, `/campaign-reactor`,
   `/creative` (plus `#ad-library`), `/knowledge-vault`, `/meta`,
   `/network`, `/research`, `/playbook`, `/recommendations`.
3. Walk them again at 375px wide. The mobile layer is real work —
   portaled drawers, `dvh` sheets, 44px targets — and regressions there are
   easy to miss on a desktop.
4. Exercise the unconfigured-provider paths from §6.
5. Fix the `width: '100%'` violation.
6. Re-run the suite, build, push.

Report what you changed and what you deliberately left alone. The second
list matters as much as the first.
