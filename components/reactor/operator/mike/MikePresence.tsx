'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  ORBITS,
  PRESENCE_PALETTE,
  PRESENCE_TARGETS,
  Spring,
  rgba,
  type PresenceState,
} from '@/components/reactor/operator/mike/presence'

/* ----------------------------------------------------------------------------
   Mike, rendered.

   Canvas rather than DOM for one reason: the thing that sells presence is
   dozens of elements moving at slightly different speeds, and dozens of
   animated DOM nodes on a dashboard that is already running an aurora is how a
   phone starts dropping frames. A canvas is one composited layer regardless of
   how much is happening inside it.

   Everything visible is driven by four springs, and the springs are driven by
   the state of the actual agent loop. When he is reading, the shell breaks into
   orbiting arcs and particles stream inward — because he genuinely is in four
   places at once. When he answers, it pulls back into one object. The motion is
   a readout, not decoration, which is the whole difference between presence and
   a spinner.

   Two things it refuses to do: run when the operator has asked for reduced
   motion (it renders one honest static frame instead), and run while off
   screen or in a background tab.
---------------------------------------------------------------------------- */

export interface MikePresenceProps {
  state: PresenceState
  /** How many tools are resolving right now — each one adds a satellite. */
  activity?: number
  /** Rendered size in CSS pixels. */
  size?: number
  className?: string
}

export function MikePresence({ state, activity = 0, size = 96, className }: MikePresenceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef(state)
  const activityRef = useRef(activity)

  // The loop reads these through refs so a state change never restarts it —
  // restarting would reset every spring to its resting value, which is exactly
  // the jump the springs exist to avoid.
  stateRef.current = state
  activityRef.current = activity

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // The backing buffer is sized in DEVICE pixels and the element in CSS
    // pixels — the two are different numbers on any retina screen, and setting
    // only the first is what makes a canvas orb look like it was resized in
    // Paint. Both are set on the DOM node rather than through a class because
    // the size is a prop: an arbitrary Tailwind value here would have to be
    // enumerated ahead of time for every size this is ever rendered at.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    const centre = size / 2
    const radius = size * 0.3

    const energy = new Spring(PRESENCE_TARGETS[stateRef.current].energy)
    const scatter = new Spring(PRESENCE_TARGETS[stateRef.current].scatter, 0.55)
    const spin = new Spring(PRESENCE_TARGETS[stateRef.current].spin, 0.7)
    const intake = new Spring(PRESENCE_TARGETS[stateRef.current].intake, 0.5)

    /* A frame drawn from wherever the springs currently sit. */
    const draw = (time: number) => {
      const targets = PRESENCE_TARGETS[stateRef.current]
      const e = energy.value
      const s = scatter.value

      ctx.clearRect(0, 0, size, size)

      // Halo — the light the orb casts, sized by energy.
      //
      // It must reach zero BEFORE the canvas edge. A gradient still carrying
      // alpha where the element stops gets cut off square, and a glowing orb
      // sitting inside a faintly visible box is the single most obvious tell
      // that it is a canvas rather than light.
      const halo = ctx.createRadialGradient(centre, centre, radius * 0.2, centre, centre, centre)
      halo.addColorStop(0, rgba(PRESENCE_PALETTE.amber, 0.4 * e))
      halo.addColorStop(0.3, rgba(PRESENCE_PALETTE.amber, 0.15 * e))
      halo.addColorStop(0.58, rgba(PRESENCE_PALETTE.azure, 0.11 * e))
      halo.addColorStop(0.85, rgba(PRESENCE_PALETTE.azure, 0.02 * e))
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(centre, centre, centre, 0, Math.PI * 2)
      ctx.fill()

      // Orbits — arcs on tilted ellipses. They widen as he scatters, so the
      // shell reads as coming apart rather than merely speeding up.
      ORBITS.forEach((orbit, i) => {
        const angle = time * 0.0004 * orbit.speed * spin.value + orbit.phase
        const rx = radius * orbit.radius * (1 + s * 0.55)
        const ry = rx * (0.32 + Math.abs(Math.sin(orbit.tilt)) * 0.5)
        ctx.save()
        ctx.translate(centre, centre)
        ctx.rotate(orbit.tilt + time * 0.00006 * orbit.speed)
        ctx.beginPath()
        ctx.ellipse(0, 0, rx, ry, 0, angle, angle + orbit.arc * (0.55 + s))
        ctx.strokeStyle = rgba(orbit.colour, (0.2 + 0.55 * e) * (0.6 + s * 0.4))
        ctx.lineWidth = 1.3 - i * 0.25
        ctx.lineCap = 'round'
        ctx.stroke()
        ctx.restore()
      })

      // Satellites — one per tool currently resolving. This is the only part of
      // the render that counts something, and it is the part worth counting:
      // four points circling means four reads in flight.
      const satellites = Math.min(activityRef.current, 6)
      for (let i = 0; i < satellites; i += 1) {
        const angle = time * 0.0016 + (i * Math.PI * 2) / Math.max(satellites, 1)
        const orbitR = radius * (1.5 + s * 0.5)
        const x = centre + Math.cos(angle) * orbitR
        const y = centre + Math.sin(angle) * orbitR * 0.55
        ctx.beginPath()
        ctx.arc(x, y, 1.9, 0, Math.PI * 2)
        ctx.fillStyle = rgba(PRESENCE_PALETTE.cyan, 0.85)
        ctx.fill()
      }

      // Intake — evidence arriving. Particles fall inward on a spiral while he
      // reads and stop the instant he does.
      const flow = intake.value
      if (flow > 0.02) {
        const count = Math.round(14 * flow)
        for (let i = 0; i < count; i += 1) {
          const seed = i * 137.5
          const progress = ((time * 0.0006 + i / count) % 1)
          const distance = radius * (2.6 - progress * 1.9)
          const angle = seed + time * 0.0009
          const x = centre + Math.cos(angle) * distance
          const y = centre + Math.sin(angle) * distance * 0.7
          ctx.beginPath()
          ctx.arc(x, y, 1.1 * (1 - progress) + 0.3, 0, Math.PI * 2)
          ctx.fillStyle = rgba(PRESENCE_PALETTE.cyan, 0.5 * flow * (1 - progress))
          ctx.fill()
        }
      }

      // The core. A slow breath rides on top of the spring so he is never
      // perfectly still — stillness on a dark screen reads as disconnected.
      const breath = 1 + Math.sin(time * 0.0014) * 0.045 * e
      const coreR = radius * (0.52 + e * 0.3) * breath * (1 - s * 0.18)
      const core = ctx.createRadialGradient(centre, centre, 0, centre, centre, coreR)
      core.addColorStop(0, rgba(PRESENCE_PALETTE.core, 0.62 + 0.38 * e))
      core.addColorStop(0.45, rgba(PRESENCE_PALETTE.amber, 0.72 * e))
      core.addColorStop(0.78, rgba(PRESENCE_PALETTE.amber, 0.22 * e))
      core.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.beginPath()
      ctx.arc(centre, centre, coreR, 0, Math.PI * 2)
      ctx.fillStyle = core
      ctx.fill()

      return targets
    }

    // Reduced motion: one frame, honestly rendered, never animated. The state
    // still reaches the operator through the label beside it.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches) {
      draw(0)
      return
    }

    let frame = 0
    let last = performance.now()
    let running = true

    const tick = (now: number) => {
      if (!running) return
      const dt = (now - last) / 1000
      last = now
      const targets = PRESENCE_TARGETS[stateRef.current]
      energy.setTarget(targets.energy)
      scatter.setTarget(targets.scatter)
      spin.setTarget(targets.spin)
      intake.setTarget(targets.intake)
      energy.step(dt)
      scatter.step(dt)
      spin.step(dt)
      intake.step(dt)
      draw(now)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    // A backgrounded tab is a tab nobody is watching. Pausing also means the
    // spring never integrates a multi-second dt on return.
    const onVisibility = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(frame)
      } else if (!running) {
        running = true
        last = performance.now()
        frame = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      running = false
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none select-none', className)}
    />
  )
}
