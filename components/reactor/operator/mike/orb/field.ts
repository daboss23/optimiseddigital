/**
 * The geometry Mike is made of.
 *
 * He is not a sprite and not a gradient circle. He is a real sphere of a few
 * thousand points, rotated in three dimensions every frame and projected down
 * to two — which is why the filaments cross each other correctly, why the far
 * side reads as the far side, and why he keeps looking like a physical object
 * from any angle. A 2D fake gives itself away the moment it turns.
 *
 * Kept pure and separate from the renderer so the maths can be reasoned about
 * (and checked) without a canvas in the room.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Points spread evenly over a sphere.
 *
 * The golden-angle spiral rather than random placement or a lat/long grid:
 * random clumps and leaves bald patches, and a grid bunches hard at the poles,
 * which reads as a wireframe globe the instant it rotates. This is the one
 * distribution that looks like an even mist from every angle.
 */
export function fibonacciSphere(count: number): Vec3[] {
  const points: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
  }
  return points
}

/** A unit vector perpendicular to `v` — the start of a great circle's frame. */
function perpendicular(v: Vec3): Vec3 {
  // Cross with whichever axis `v` is least aligned to, so the result is never
  // near-zero and the circle never collapses into a line.
  const axis: Vec3 =
    Math.abs(v.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const c = {
    x: v.y * axis.z - v.z * axis.y,
    y: v.z * axis.x - v.x * axis.z,
    z: v.x * axis.y - v.y * axis.x,
  }
  const length = Math.hypot(c.x, c.y, c.z) || 1
  return { x: c.x / length, y: c.y / length, z: c.z / length }
}

/**
 * A great circle around `axis` — one of the bright bands wrapping the shell.
 *
 * These are what make him read as structured rather than as a cloud of dust:
 * a sphere of pure noise looks like static, and a sphere with a few clean
 * orbits through it looks like something built.
 */
export function greatCircle(axis: Vec3, count: number, wobble = 0): Vec3[] {
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1
  const n: Vec3 = { x: axis.x / length, y: axis.y / length, z: axis.z / length }
  const u = perpendicular(n)
  const v = {
    x: n.y * u.z - n.z * u.y,
    y: n.z * u.x - n.x * u.z,
    z: n.x * u.y - n.y * u.x,
  }

  const points: Vec3[] = []
  for (let i = 0; i < count; i += 1) {
    const t = (i / count) * Math.PI * 2
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    // A little radial wander so the band breathes instead of reading as a
    // drawn ring. Deterministic in `t`, so it does not shimmer frame to frame.
    const r = 1 + Math.sin(t * 5 + axis.x * 9) * wobble
    points.push({
      x: (u.x * cos + v.x * sin) * r,
      y: (u.y * cos + v.y * sin) * r,
      z: (u.z * cos + v.z * sin) * r,
    })
  }
  return points
}

/* -------------------------------- rotation -------------------------------- */

export function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const x1 = p.x * cosY - p.z * sinY
  const z1 = p.x * sinY + p.z * cosY

  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)
  const y1 = p.y * cosP - z1 * sinP
  const z2 = p.y * sinP + z1 * cosP

  return { x: x1, y: y1, z: z2 }
}

/* --------------------------------- palette -------------------------------- */

/**
 * Gold, violet and white.
 *
 * Gold is the platform's action colour and it carries the core, so he reads as
 * part of this product. Violet is the aurora already behind every panel on the
 * dashboard. White is what makes the whole thing look like light rather than
 * like paint — without it the sphere reads as a coloured ball, with it, it
 * reads as something emitting.
 */
export const GOLD = [255, 196, 92] as const
export const VIOLET = [178, 132, 255] as const
export const WHITE = [255, 248, 235] as const

export type Rgb = readonly [number, number, number]

export const rgba = (c: Rgb, a: number): string =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a < 0 ? 0 : a > 1 ? 1 : a})`

/**
 * Which of the three a given shell point burns.
 *
 * Banded by height rather than randomised: random colour per particle
 * averages out to a single muddy tint at distance, whereas bands keep the gold
 * and the violet legible as separate energies.
 */
export function shellColour(y: number, seed: number): Rgb {
  const band = (y + 1) / 2 + Math.sin(seed * 12.9898) * 0.12
  if (band > 0.62) return WHITE
  if (band > 0.3) return GOLD
  return VIOLET
}
