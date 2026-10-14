# Optimised Digital — Creative Reactor

> Standalone repository behind **`optimiseddigital.vercel.app`**, deployed from
> this repo's `main`.

**Engineered For Performance.**

An AI creative system for e-commerce Meta advertising. It turns a brief and a
product into finished, product-true Meta creative — grounded in the store's own
catalog, in ads that are already winning in the market, and in measured
performance rather than in the model's priors — and puts it straight into the
brand's own Meta media library.

It makes the creative, not the caption. For an e-commerce account the caption
is the cheap part; what is scarce is enough genuinely different creative to feed
delivery, so everything an ad must say is said by the creative itself.

The platform ships **blank**. It carries no business inside it: a company
connects its website and the Reactor becomes theirs. `npm run selftest:blank-slate`
fails the build if a named company, industry or audience ever leaks into the
source tree, and `npm run selftest:tenant` proves one account cannot read
another's.

## What it does

1. **Reads the brief and the product.** Campaign name, product, offer,
   audience, awareness, market sophistication, formats and sizes — with the
   strategic settings recommended while you type, and anything you override
   preserved. The product comes from the store's own catalog (Shopify,
   WooCommerce or schema.org markup, synced on the Brand page): its published
   price, sale, rating and photo are the only facts a creative may state.
2. **Researches the market before writing a word.** The brief constructs its own
   searches against the proven-ad library — inside the brand's own e-commerce
   vertical first — and pulls back static Meta ads that are still running after
   90+ days of live spend. Those ads reach SPARK (creative) and ECHO (copy)
   *before* they report to the orchestrator.
3. **Briefs the intelligence network in parallel.** ATLAS (the Vault and the
   connected website), NOVA (the market), SPARK (creative DNA), ECHO (copy DNA)
   and ORACLE (what has already won) all report before OPUS drafts anything.
4. **Writes the creative.** OPUS produces concepts with a frame-by-frame
   production brief and the words that go ON the creative — headline, offer
   line, CTA label — checked against Meta's claim rules before the render,
   because words burned into pixels cannot be edited afterwards.
5. **Renders the creative** through a multi-provider image oven, from a prompt
   compiler that keeps on-image text legible instead of gibberish.
6. **Launches it.** The Launch Bay reads each render back (placement fit, the
   on-image text spelled as written, the product legible at thumb size) and
   uploads one creative or a whole run into the brand's own Meta media library,
   each named with the test token that grades it later.
7. **Closes the loop.** Meta performance is ingested, graded on ROAS and cost
   per purchase against the account's own cohort, matched back to the uploaded
   creative it came from, and written into ORACLE, so the next brief starts from
   what actually sold.

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
editor, then `supabase/schema.tenancy.sql` and `supabase/schema.retrieval.sql`
(HNSW + hybrid keyword/vector search). Add `supabase/schema.documents.sql` for
long-document reading (PageIndex), and `supabase/schema.media.sql` and
`supabase/schema.taxonomy.sql` if you want the media ledger and taxonomy
analytics. `/api/health` → `retrieval` shows which search stages are live.

## Checks

```bash
npm run selftest             # the Reactor end to end (needs the app running)
npm run selftest:gethookd    # the proven-ad source + automatic research (stubbed, free)
npm run selftest:retrieval   # hybrid search SQL (real Postgres via PGlite), reranker, long documents
npm run selftest:blank-slate # the platform names no business
npm run selftest:tenant      # one account cannot read another's
npm run selftest:operator    # the performance operator on the dashboard
npm run selftest:render      # on-image text discipline
npm run selftest:ecom        # creative contract, catalog, upload naming, purchase grading
npm run gethookd:research    # the one LIVE probe — needs a real key, spends credits
```

## Deploy

Deploy to Vercel: import the repo, keep the **Root Directory** at the repo
root, add the environment variables, and deploy.

## Architecture

`SYSTEM_DESIGN.md` for the full build spec, `CLAUDE.md` for the project rules
and every environment variable, `docs/` for the Creative Canvas and the
performance operator.
