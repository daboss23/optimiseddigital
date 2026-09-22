# Optimised Digital — Creative Reactor

> Standalone repository behind **`optimiseddigital.vercel.app`**, deployed from
> this repo's `main`.

**Engineered For Performance.**

An AI creative system that turns a campaign brief into launch-ready Meta ads —
grounded in the operator's own knowledge, in ads that are already winning in the
market, and in measured performance rather than in the model's priors.

The platform ships **blank**. It carries no business inside it: a company
connects its website and the Reactor becomes theirs. `npm run selftest:blank-slate`
fails the build if a named company, industry or audience ever leaks into the
source tree, and `npm run selftest:tenant` proves one account cannot read
another's.

## What it does

1. **Reads the brief.** Campaign name, offer, audience, awareness, market
   sophistication, formats and sizes — with the strategic settings recommended
   while you type, and anything you override preserved.
2. **Researches the market before writing a word.** The brief constructs its own
   searches against the proven-ad library and pulls back static Meta ads that are
   still running after 90+ days of live spend. Those ads reach SPARK (creative)
   and ECHO (copy) *before* they report to the orchestrator.
3. **Briefs the intelligence network in parallel.** ATLAS (the Vault and the
   connected website), NOVA (the market), SPARK (creative DNA), ECHO (copy DNA)
   and ORACLE (what has already won) all report before OPUS drafts anything.
4. **Writes the campaign.** OPUS produces concepts with a frame-by-frame
   production brief and a complete Meta ad unit — primary text inside the
   125-character fold, headline, description, CTA — validated server-side.
5. **Renders the creative** through a multi-provider image oven, from a prompt
   compiler that keeps on-image text legible instead of gibberish.
6. **Closes the loop.** Meta performance is ingested, graded against the
   account's own cohort, and written back into ORACLE, so the next brief starts
   from what actually worked.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real keys
npm run dev
```

Open http://localhost:3000.

### Environment variables

See `.env.example` and the annotated list in `CLAUDE.md`. Every integration
degrades honestly: the app compiles and every dashboard renders without keys,
and each route says what is missing rather than inventing a result.

### Database

Run `supabase/schema.reactor.sql` (the RAG knowledge layer) in the Supabase SQL
editor, then `supabase/schema.media.sql` and `supabase/schema.taxonomy.sql` if
you want the media ledger and taxonomy analytics.

## Checks

```bash
npm run selftest             # the Reactor end to end (needs the app running)
npm run selftest:gethookd    # the proven-ad source + automatic research (stubbed, free)
npm run selftest:blank-slate # the platform names no business
npm run selftest:tenant      # one account cannot read another's
npm run selftest:operator    # the performance operator on the dashboard
npm run selftest:render      # on-image text discipline
npm run gethookd:research    # the one LIVE probe — needs a real key, spends credits
```

## Deploy

Deploy to Vercel: import the repo, keep the **Root Directory** at the repo
root, add the environment variables, and deploy.

## Architecture

`SYSTEM_DESIGN.md` for the full build spec, `CLAUDE.md` for the project rules
and every environment variable, `docs/` for the Creative Canvas and the
performance operator.
