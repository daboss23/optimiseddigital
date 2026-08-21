/**
 * The physics behind Mike's presence.
 *
 * Kept out of the component because it is the part with opinions in it. Three
 * of them:
 *
 * **Springs, not transitions.** A CSS transition animates from a start value to
 * an end value over a fixed duration, which means a state change mid-flight
 * either jumps or queues. Mike changes state constantly — a question lands
 * while he is still settling from the last one, four tools resolve inside a
 * second — so every value here is a spring, animating from wherever it
 * currently is toward wherever it now needs to be. Interruption is the normal
 * case, not the edge case.
 *
 * **Critically damped by default.** `damping: 1` — no overshoot. A presence
 * that bounces every time a tool returns reads as a toy. The one place bounce
 * is allowed is the arrival of an answer, because that motion follows a real
 * event with momentum behind it.
 *
 * **The state means something.** Each state is a genuine phase of the loop, not
 * a decorative mood: `reading` is on screen if and only if tools are actually
 * resolving. When the light stops meaning something it stops being presence and
 * becomes a screensaver.
 */

export type PresenceState = 'dormant' | 'listening' | 'reading' | 'writing' | 'settled'

export interface PresenceTargets {
  /** Overall brightness and core size. */
  energy: number
  /** How far the shell breaks apart into orbiting arcs. */
  scatter: number
  /** Orbital speed multiplier. */
  spin: number
  /** Inward particle flow — data arriving. */
  intake: number
}

/**
 * Where each state pulls to.
 *
 * `reading` scatters hardest because that is the honest picture of what is
 * happening: he is in several places at once. `writing` pulls back together —
 * a formed thought is a single object.
 */
export const PRESENCE_TARGETS: Record<PresenceState, PresenceTargets> = {
  dormant: { energy: 0.46, scatter: 0.07, spin: 0.28, intake: 0 },
  listening: { energy: 0.68, scatter: 0.16, spin: 0.55, intake: 0 },
  reading: { energy: 0.86, scatter: 0.78, spin: 1.6, intake: 1 },
  writing: { energy: 1, scatter: 0.2, spin: 0.9, intake: 0.25 },
  settled: { energy: 0.58, scatter: 0.11, spin: 0.38, intake: 0 },
}

/**
 * One scalar with a spring on it.
 *
 * `response` is seconds to reach the target, not a duration — a spring has no
 * fixed end. `damping` at 1 settles without overshoot; below 1 it oscillates.
 */
export class Spring {
  value: number
  private velocity = 0
  private target: number

  constructor(
    initial: number,
    private response = 0.4,
    private damping = 1,
  ) {
    this.value = initial
    this.target = initial
  }

  setTarget(target: number): void {
    this.target = target
  }

  /** Nudge the value directly — a keystroke, a tool landing. Carries velocity. */
  impulse(amount: number): void {
    this.velocity += amount
  }

  /**
   * Advance by `dt` seconds.
   *
   * Clamped at 50ms because a backgrounded tab hands back a dt of several
   * seconds, and integrating that in one step throws the spring across the
   * screen. Losing a frame of accuracy is invisible; a visible snap is not.
   */
  step(dt: number): number {
    const step = Math.min(dt, 0.05)
    const stiffness = (2 * Math.PI) / this.response
    const acceleration =
      stiffness * stiffness * (this.target - this.value) -
      2 * this.damping * stiffness * this.velocity
    this.velocity += acceleration * step
    this.value += this.velocity * step
    return this.value
  }
}

/* --------------------------------- palette --------------------------------- */

/**
 * The command centre's own light, reused rather than reinvented.
 *
 * Amber is the platform's action colour and it stays the core, so Mike reads as
 * part of this product rather than as a chat widget bolted onto it. The aurora
 * hues are the same three the dashboard's background already runs on.
 */
export const PRESENCE_PALETTE = {
  core: [255, 214, 148] as const,
  amber: [245, 158, 11] as const,
  cyan: [56, 232, 255] as const,
  azure: [77, 141, 255] as const,
  violet: [168, 130, 255] as const,
}

export const rgba = (rgb: readonly [number, number, number], alpha: number): string =>
  `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`

/* --------------------------------- orbits ---------------------------------- */

export interface Orbit {
  /** Radius as a fraction of the orb's radius. */
  radius: number
  tilt: number
  speed: number
  arc: number
  phase: number
  colour: readonly [number, number, number]
}

/**
 * Three rings, deliberately not evenly spaced or evenly timed.
 *
 * Even spacing and a common divisor in the speeds makes the whole thing beat in
 * lockstep every few seconds, and lockstep is the single clearest tell that
 * something is a loop rather than alive.
 */
export const ORBITS: Orbit[] = [
  { radius: 0.72, tilt: -0.35, speed: 1, arc: 2.1, phase: 0, colour: PRESENCE_PALETTE.cyan },
  { radius: 0.92, tilt: 0.62, speed: -0.63, arc: 1.4, phase: 2.2, colour: PRESENCE_PALETTE.violet },
  { radius: 1.14, tilt: 0.18, speed: 0.41, arc: 0.9, phase: 4.1, colour: PRESENCE_PALETTE.azure },
]
