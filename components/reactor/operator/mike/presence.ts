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
