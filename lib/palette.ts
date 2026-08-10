// Palette measurement — the TRUE colours of an ad, sampled from its pixels.
//
// Why this exists: a vision model is excellent at reading layout, hierarchy and
// intent, and unreliable at naming exact hex values. Asked for a palette it
// reports plausible colours rather than the ones on the ad, and a small block of
// vivid colour — the red band behind a headline, a yellow CTA pill — is the
// thing it most often drops, because it occupies little of the frame while doing
// most of the scroll-stopping work.
//
// So SPARK measures the palette instead of asking for it. The browser already
// draws every upload to a canvas to downscale it, so the pixels are right there:
// quantise them, cluster the buckets, and select on TWO axes — area (the fields
// the design is built on) and vividness (the accents that make it pop). The
// measured hexes are handed to the model as ground truth; it assigns each one
// the JOB it does in the design, and `reconcilePalette` snaps anything it
// invented back onto a colour that is genuinely there.
//
// PURE and dependency-free — it runs in the browser (canvas pixels) and on the
// server (reconciliation), so it must never import anything with a runtime.

/** One colour actually present in the creative, with how much of it there is. */
export interface MeasuredSwatch {
  /** `#rrggbb`. */
  hex: string
  /** Share of sampled pixels this colour covers, 0–1. */
  share: number
  /** HSL saturation, 0–1. High + small share = an accent doing real work. */
  saturation: number
  /** HSL lightness, 0–1. */
  lightness: number
}

interface Rgb {
  r: number
  g: number
  b: number
}

/* --------------------------------- Colour ---------------------------------- */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const body = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  }
}

/** HSL saturation + lightness for a colour, both 0–1. */
function saturationLightness({ r, g, b }: Rgb): { saturation: number; lightness: number } {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation =
    delta === 0 ? 0 : delta / (lightness > 0.5 ? 2 - max - min : max + min || 1)
  return { saturation: Math.min(1, saturation), lightness }
}

/**
 * Perceptual-ish distance between two colours (the "redmean" approximation).
 * Cheap, no colour-space conversion, and far closer to how an eye judges
 * sameness than plain RGB euclidean — which would happily call a dark red and a
 * dark brown the same colour. Range is roughly 0–765.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rm = (a.r + b.r) / 2
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}

/** Two colours a designer would call the same swatch. */
const MERGE_DISTANCE = 46
/** Two colours a designer would call different swatches. */
const DISTINCT_DISTANCE = 64
/** Below this share a colour is antialiasing or JPEG noise, not a design choice. */
const MIN_ACCENT_SHARE = 0.004
/** Most pixels we look at — plenty for a stable histogram, cheap on a phone. */
const MAX_SAMPLES = 60_000

/* ------------------------------- Measurement ------------------------------- */

interface Cluster extends Rgb {
  count: number
}

/**
 * Measure the palette of an image from its raw RGBA pixels.
 *
 * Returns up to `max` swatches ordered by how much of the frame they cover,
 * chosen so BOTH the structural fields and the vivid accents survive: taking
 * the top colours by area alone loses the red band that occupies 5% of the ad
 * and 100% of the attention.
 */
export function measurePalette(
  pixels: Uint8ClampedArray | number[],
  max = 6,
): MeasuredSwatch[] {
  const pixelCount = Math.floor(pixels.length / 4)
  if (pixelCount === 0) return []

  const stride = Math.max(1, Math.floor(pixelCount / MAX_SAMPLES))
  const buckets = new Map<number, Cluster>()
  let sampled = 0

  for (let p = 0; p < pixelCount; p += stride) {
    const i = p * 4
    // Skip anything meaningfully transparent — a PNG's empty corners are not a
    // colour the ad uses.
    if ((pixels[i + 3] ?? 255) < 125) continue
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    // 5 bits per channel: fine enough to keep two related reds apart, coarse
    // enough that gradients and JPEG ringing collapse into one bucket.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.count += 1
    } else {
      buckets.set(key, { r, g, b, count: 1 })
    }
    sampled += 1
  }

  if (!sampled) return []

  // Bucket → average colour, biggest first. Only the top buckets can matter:
  // everything past this is a fraction of a percent of the frame.
  const candidates = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 96)
    .map((c) => ({
      r: c.r / c.count,
      g: c.g / c.count,
      b: c.b / c.count,
      count: c.count,
    }))

  // Greedy merge: fold each candidate into the first cluster it is
  // indistinguishable from, so one flat colour spread across neighbouring
  // buckets is reported once with its real combined share.
  const clusters: Cluster[] = []
  for (const c of candidates) {
    const near = clusters.find((k) => colorDistance(k, c) < MERGE_DISTANCE)
    if (near) {
      const total = near.count + c.count
      near.r = (near.r * near.count + c.r * c.count) / total
      near.g = (near.g * near.count + c.g * c.count) / total
      near.b = (near.b * near.count + c.b * c.count) / total
      near.count = total
    } else {
      clusters.push({ ...c })
    }
  }

  const swatches: MeasuredSwatch[] = clusters.map((c) => ({
    hex: rgbToHex(c),
    share: c.count / sampled,
    ...saturationLightness(c),
  }))

  // Two passes over the same list. Area first — the fields the design sits on.
  const byArea = [...swatches].sort((a, b) => b.share - a.share)
  // Then vividness — share weighted hard by saturation, so a small saturated
  // block outranks a large muddy one. This is the pass that catches the accent.
  const byVividness = swatches
    .filter((s) => s.share >= MIN_ACCENT_SHARE && s.saturation > 0.35)
    .sort((a, b) => b.share * b.saturation ** 2 - a.share * a.saturation ** 2)

  const picked: MeasuredSwatch[] = []
  const isNew = (s: MeasuredSwatch) =>
    picked.every((p) => {
      const a = hexToRgb(p.hex)
      const b = hexToRgb(s.hex)
      return !a || !b || colorDistance(a, b) >= DISTINCT_DISTANCE
    })

  // Reserve room for accents rather than letting five shades of background fill
  // the whole palette.
  const areaSlots = Math.max(2, max - 3)
  for (const s of byArea) {
    if (picked.length >= areaSlots) break
    if (isNew(s)) picked.push(s)
  }
  for (const s of byVividness) {
    if (picked.length >= max) break
    if (isNew(s)) picked.push(s)
  }
  for (const s of byArea) {
    if (picked.length >= max) break
    if (isNew(s)) picked.push(s)
  }

  return picked.sort((a, b) => b.share - a.share)
}

/**
 * Measure straight off a canvas. Returns [] when the context is unavailable or
 * the canvas is tainted — the read simply falls back to the model's own reading.
 */
export function measureCanvasPalette(canvas: HTMLCanvasElement, max = 6): MeasuredSwatch[] {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return measurePalette(data, max)
  } catch {
    return []
  }
}

/* -------------------------------- Reporting -------------------------------- */

/** The job a colour is doing, inferred from how much there is and how vivid. */
export function swatchRole(s: MeasuredSwatch): string {
  if (s.saturation >= 0.45 && s.share < 0.3) return 'Accent'
  if (s.share >= 0.3) return s.lightness < 0.35 ? 'Dark field' : 'Dominant field'
  if (s.lightness >= 0.82) return 'Light type / negative space'
  if (s.lightness <= 0.16) return 'Deep shadow / type'
  return 'Secondary'
}

/** The measured palette written for a prompt — hexes plus how much of each. */
export function describeMeasuredPalette(swatches: MeasuredSwatch[]): string {
  return swatches
    .map(
      (s) =>
        `${s.hex} — ${(s.share * 100).toFixed(1)}% of the frame, ${
          s.saturation >= 0.45 ? 'vivid' : s.saturation >= 0.18 ? 'muted' : 'neutral'
        } (${swatchRole(s).toLowerCase()})`,
    )
    .join('\n')
}

/* ------------------------------ Reconciliation ----------------------------- */

/** The minimum shape a reported swatch needs: a hex and the job it does. */
interface RoledSwatch {
  hex: string
  role: string
}

/** How far a reported hex can drift before it is snapped onto a measured one. */
const SNAP_DISTANCE = 72

/**
 * Correct a model-reported palette against what is actually in the pixels.
 *
 * - Every reported hex within snapping distance of a measured colour is moved
 *   ONTO that colour, keeping the role the model assigned. The model is right
 *   about "this is the CTA colour" and approximate about which red it is.
 * - Reported colours nowhere near anything measured are dropped — they are not
 *   on the ad.
 * - When `fill` is set, measured colours the model never mentioned are appended
 *   with an inferred role, so a vivid accent can never go missing again.
 *
 * `fill` is only safe for a single-ad read: on a multi-ad board the measured
 * palette spans every ad on the sheet, so a colour from a neighbouring creative
 * must not be forced onto this one.
 */
export function reconcilePalette<T extends RoledSwatch>(
  reported: T[],
  measured: MeasuredSwatch[],
  opts: { fill?: boolean; max?: number } = {},
): RoledSwatch[] {
  if (!measured.length) return reported
  const max = opts.max ?? 8

  const measuredRgb = measured
    .map((m) => ({ swatch: m, rgb: hexToRgb(m.hex) }))
    .filter((m): m is { swatch: MeasuredSwatch; rgb: Rgb } => Boolean(m.rgb))
  if (!measuredRgb.length) return reported

  const out: RoledSwatch[] = []
  const used = new Set<string>()

  for (const swatch of reported) {
    const rgb = hexToRgb(swatch.hex)
    if (!rgb) continue
    let best = measuredRgb[0]!
    let bestDistance = colorDistance(best.rgb, rgb)
    for (const m of measuredRgb.slice(1)) {
      const d = colorDistance(m.rgb, rgb)
      if (d < bestDistance) {
        best = m
        bestDistance = d
      }
    }
    if (bestDistance > SNAP_DISTANCE) continue
    if (used.has(best.swatch.hex)) continue
    used.add(best.swatch.hex)
    out.push({ ...swatch, hex: best.swatch.hex })
  }

  if (opts.fill) {
    for (const m of measured) {
      if (out.length >= max) break
      if (used.has(m.hex)) continue
      const rgb = hexToRgb(m.hex)
      if (rgb && out.some((o) => {
        const a = hexToRgb(o.hex)
        return a ? colorDistance(a, rgb) < DISTINCT_DISTANCE : false
      })) {
        continue
      }
      used.add(m.hex)
      out.push({ hex: m.hex, role: `${swatchRole(m)} (measured)` })
    }
  }

  return out.length ? out.slice(0, max) : reported
}
