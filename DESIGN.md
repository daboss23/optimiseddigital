# Creative Reactor — Liquid Glass Design System

> The implementation contract for the platform's visual layer. Every color, blur,
> and glow used in `app/globals.css`, `tailwind.config.ts`, and the components
> traces back to a token named here. If a value isn't in this file, add it here
> first, then use it.

## 1. Atmosphere & Identity

A command center rendered in **liquid glass**. Every surface is a slab of frosted,
translucent glass floating over a slow-moving neon aurora — you can see colored
light bending and bleeding _through_ the panels rather than sitting on a flat black
page. The signature is **living light through glass**: a cyan→violet→magenta aurora
drifts endlessly behind the whole app, so the same glass reads cool-cyan in one
corner and warm-magenta in another. Panels are lighter and more see-through than a
typical dark dashboard — the brief was "it's too dark, use the see-through glassy
look." Nothing is a flat fill; nothing is fully opaque. Tagline energy: _Engineered
For Performance._

## 2. Color

The old system used six loud, competing per-card accents (blue / emerald / violet /
cyan / pink / amber) each driving a whole card's color — that is what made the cards
read as a rainbow. The liquid system collapses that into **one cohesive neon ramp**.
Accents still exist as _channels_ (`--acc`) but only tint small details (icon, spark,
gauge); the card body itself is always the same neutral glass, so the grid reads as
one material catching different light — not eight different colored cards.

### Aurora ramp (the perceptual neon ramp — the story color)

| Stop | Token | RGB | Hex | Role |
|------|-------|-----|-----|------|
| Cyan | `--lg-cyan` | `56 232 255` | `#38E8FF` | Aurora leading edge, primary neon |
| Azure | `--lg-azure` | `77 141 255` | `#4D8DFF` | Aurora mid, links/focus |
| Violet | `--lg-violet` | `168 130 255` | `#A882FF` | Aurora core |
| Magenta | `--lg-magenta` | `255 106 214` | `#FF6AD6` | Aurora trailing edge, warm bleed |

### Surfaces & glass

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Base atmosphere | `--bg-base` | `#080B1A` | Deepest page color (lifted off near-black `#03070d`) |
| Base atmosphere 2 | `--bg-base-2` | `#0B1024` | Gradient partner for the base |
| Glass tint | `--glass-tint` | `rgba(255,255,255,0.06)` | Translucent body fill of every panel |
| Glass tint strong | `--glass-tint-2` | `rgba(255,255,255,0.10)` | KPI / interactive glass, slightly milkier |
| Glass rim | `--glass-rim` | `rgba(255,255,255,0.55)` | Bright 1px top/left refraction edge |
| Glass sheen | `--glass-sheen` | `rgba(255,255,255,0.14)` | Diagonal gloss sweep on the surface |
| Glass shadow | `--glass-shadow` | `rgba(2,4,14,0.55)` | Ambient drop under floating glass |

### Text

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Text primary | `--text-primary` | `#EEF3FF` | Headlines, values |
| Text secondary | `--text-secondary` | `rgba(233,239,255,0.62)` | Body, subtitles |
| Text tertiary | `--text-tertiary` | `rgba(233,239,255,0.40)` | Captions, muted metadata |

### Status (kept, retuned toward the neon family)

| Role | Token | Value |
|------|-------|-------|
| Success | `--status-success` | `#2FE6B0` |
| Warning | `--status-warning` | `#FFC24B` |
| Danger | `--status-danger` | `#FF6A8B` |

### Rules
- The aurora ramp is the ONLY decorative color. Cards do not each pick their own hue.
- `--acc` channels tint details only (≤ an icon / sparkline / gauge), never the panel body.
- Never a single flat fill on a surface. Every surface is tint + rim + sheen + glow.
- Color comes from the ramp stops, not one hex reused at varied opacity.

## 3. Typography

Unchanged from the platform: **Space Grotesk** (display) + **Inter** (body) + system mono.

| Level | Size | Weight | Tracking | Usage |
|-------|------|--------|----------|-------|
| Display | clamp 2.2–2.6rem | 700 | -0.02em | Page title |
| H2 | 0.875rem | 600 | -0.01em | Panel titles |
| KPI value | 2.45rem | 700 | -0.01em | Metric numbers (tabular) |
| Body | 0.875rem | 400 | 0 | Default |
| Caption | 0.75rem | 500 | 0.02em | Metadata |
| Overline | 0.625rem | 600 | 0.2em | Uppercase labels |

## 4. Spacing & Layout
4px base unit (Tailwind default scale). Max content width `1480px`. Existing grid
gaps (`gap-3`, `p-4`, `p-5`) are kept — this redesign changes material, not layout.

## 5. Components (primitives that carry the material)

### Glass Panel (`.glass`, `.reactor-panel`)
- **Structure**: rounded slab, `.panel-sheen` gloss child, content on `z-1`.
- **Recipe**: `--glass-tint` body + `backdrop-blur(30px) saturate(180%)` + `--glass-rim` inset top edge + aurora edge-glow + `--glass-shadow` drop. See-through enough that the aurora shifts its hue.
- **States**: rest / hover (lift `-2px`, rim brightens, glow intensifies).

### KPI Glass Tile (`.kpi-card`)
- **Structure**: floating glass tile, `.kpi-bloom` + `.kpi-grid` decoration, icon, value, sparkline.
- **Recipe**: `--glass-tint-2` body (uniform across all tiles) + rim + diagonal sheen (`::before`) + soft reflection pool below (`::after`) + a _subtle_ `--acc` under-glow only.
- **States**: rest / hover (`translateY(-5px)`, brightness+saturate lift, reflection pool grows).

### Aurora Background (`.reactor-bg`, `.reactor-aurora`)
- Fixed full-viewport. 4 large blurred blobs (cyan/azure/violet/magenta) drifting on
  GPU `transform` loops (28–46s), over `--bg-base`→`--bg-base-2`. Faint grid retained.
- The signature moment. Respects `prefers-reduced-motion` (blobs hold still).

### Pointer Gloss (`.lg-gloss`, JS-driven `--mx/--my`)
- A radial highlight that tracks the cursor across the hero + cards — "pointer-tracked gloss."

### Chips / Pills / Nav / Inputs
- All inherit the glass material: translucent tint, rim, aurora-tinted active state.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 120ms | ease-out | hover rim/glow |
| Standard | 220–320ms | cubic-bezier(0.2,0.7,0.2,1) | card lift, panel hover |
| Ambient | 28–46s | ease-in-out / linear | aurora drift, node drift |

- GPU-composited only (`transform`, `opacity`, `filter`).
- Every interactive element has hover + active/focus.
- `prefers-reduced-motion`: aurora + node drift freeze; hovers stay.

## 7. Depth & Surface

**Strategy: mixed — translucent glass elevation.** Depth comes from _layered light_,
not opaque tonal steps: a bright rim (top-left refraction), a diagonal sheen, an
aurora edge-glow, and an ambient drop shadow. Because panels are see-through, the
moving aurora behind them is the true background of every card — that is what makes
the glass read as glass.
