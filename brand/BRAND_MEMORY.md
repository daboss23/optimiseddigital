# BRAND_MEMORY.md — template

> The last-resort brand brief, used only when NOTHING else is available: no
> builder profile selected, and no website connected. It is deliberately EMPTY.
>
> This is not project rules — do not confuse it with CLAUDE.md.

---

## HOW THIS FILE IS USED

`resolveBrandMemory()` (`lib/brand-memory.ts`) resolves the brand a copy call
writes for, in order of how explicit the choice was:

1. **A selected builder profile** — the user named it.
2. **The connected website** — ATLAS read this business's real identity, voice,
   offer, audience and proof from their own site. This is the path a working
   deployment takes, and the one worth optimising for.
3. **This file** — nothing is connected yet.

Because the platform is white-labelled, whatever sits here is injected into the
copy agent for **every** business using this deployment. It therefore ships
blank. It previously held one specific company's brand intelligence — a
residential builder: their region, their guarantees, their proof points, their
voice — which meant a customer who connected their own website still had that
builder's brand memory underneath their brief. Copy written against the wrong
brand memory does not look broken. It looks like the platform simply
misunderstood the business, which is harder to notice and harder to fix.

**Connect a website instead of filling this in.** Brand Intelligence reads far
more than this file can hold, and it stays current.

---

## IF YOU DO FILL IT IN

Only for a single-tenant deployment that will never serve another business.
Replace each heading below with real, substantiable content, and delete any
heading you cannot answer honestly — an empty section is fine, an invented one
reaches the ads.

The whole file is injected into the copy agent verbatim, so anything written
under a heading is read as this brand's own material. Notes to yourself belong
here, above the line, not down there. Three rules for filling it in:

- **Proof points** must be attributable and substantiable. A figure that cannot
  be attributed to a named individual as their result cannot be used in an ad.
- **Who we sell to** is the buyer this business sells to — never that buyer's
  own end customer, which is a layer down and the wrong audience.
- **Non-negotiable:** every line of copy must be specific enough that the brand
  name could not be swapped out and the ad reused by a competitor.

---

## WHO WE ARE

## WHAT MAKES US DIFFERENT (PROOF POINTS)

## WHO WE SELL TO

## WHAT THEY FEAR AND WHAT THEY WANT

## VOICE AND TONE
