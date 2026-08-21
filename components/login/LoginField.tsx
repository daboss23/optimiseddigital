'use client'

import { useEffect, useRef } from 'react'

/* ----------------------------------------------------------------------------
   The field behind the door.

   Frequency, not stars. Points of light scattered on black are a night sky —
   they say nothing about signal, and nothing about this product. What reads as
   energy is OSCILLATION: a waveform that surfaces somewhere, holds a shape you
   can see repeating, carries a pulse of brightness down its length, and fades
   out. Plus the occasional ring propagating out of a point, which is what an
   emission actually looks like.

   Three rules keep it from becoming decoration:

   - Nothing shares a clock. Every trace has its own wavelength, speed, phase
     and lifetime, so the field never falls into the visible repeat that gives
     ambient motion away.
   - Everything is drawn additively, so where two traces cross they accumulate
     into brighter light rather than painting over each other.
   - It is held far below the intensity of Mike's own shell, because there is a
     form in front of it that somebody has to read and type into.
---------------------------------------------------------------------------- */

/** Concurrent traces. Sparse on purpose — this is atmosphere, not weather. */
const TRACES = 6
const TRACES_MOBILE = 3
const RINGS = 2

/** Cyan, azure, violet — the command centre's own light. */
const HUES: readonly (readonly [number, number, number])[] = [
  [94, 168, 255],
  [56, 232, 255],
  [178, 132, 255],
]

const rgba = (c: readonly [number, number, number], a: number) =>
  `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a < 0 ? 0 : a})`

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]
const between = (min: number, max: number) => min + Math.random() * (max - min)

interface Trace {
  x: number
  y: number
  width: number
  amplitude: number
  /** Radians per pixel — how tight the oscillation reads. */
  frequency: number
  /** Phase drift per second: the wave visibly travels along its own length. */
  speed: number
  phase: number
  tilt: number
  age: number
  life: number
  peak: number
  hue: readonly [number, number, number]
  /** 0–1 along the trace: where the bright pulse currently sits. */
  pulse: number
  pulseSpeed: number
}

interface Ring {
  x: number
  y: number
  age: number
  life: number
  radius: number
  peak: number
  hue: readonly [number, number, number]
}

export function LoginField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const mobile = window.matchMedia('(max-width: 767px)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2)
    let width = 0
    let height = 0

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const spawnTrace = (age = 0): Trace => {
      const w = between(220, 620) * (mobile ? 0.6 : 1)
      return {
        x: between(-80, width - w + 80),
        y: between(60, height - 60),
        width: w,
        amplitude: between(5, 20),
        // Short wavelengths read as high frequency, long ones as a slow
        // carrier. Both on screen at once is what makes it look like signal
        // rather than like one repeated ornament.
        frequency: between(0.012, 0.055),
        speed: between(-3.2, 3.2),
        phase: Math.random() * Math.PI * 2,
        tilt: between(-0.16, 0.16),
        age,
        life: between(4.5, 9),
        peak: between(0.1, 0.26),
        hue: pick(HUES),
        pulse: 0,
        pulseSpeed: between(0.22, 0.5),
      }
    }

    const spawnRing = (age = 0): Ring => ({
      x: between(0.1, 0.9) * width,
      y: between(0.1, 0.9) * height,
      age,
      life: between(5, 9),
      radius: between(120, 340),
      peak: between(0.06, 0.13),
      hue: pick(HUES),
    })

    const traces: Trace[] = Array.from({ length: mobile ? TRACES_MOBILE : TRACES }, () =>
      // Staggered ages so they do not all arrive and leave together on the
      // first pass — a synchronised field is the tell that it is a loop.
      spawnTrace(Math.random() * 6),
    )
    const rings: Ring[] = Array.from({ length: mobile ? 1 : RINGS }, () =>
      spawnRing(Math.random() * 7),
    )

    /** Where the wave sits at a given distance along its own length. */
    const pointAt = (t: Trace, along: number) => ({
      x: t.x + along,
      y: t.y + along * t.tilt + Math.sin(along * t.frequency + t.phase) * t.amplitude,
    })

    const strokeWave = (t: Trace, from: number, to: number, alpha: number, lineWidth: number) => {
      if (alpha <= 0.002 || to <= from) return
      ctx.beginPath()
      const step = 5
      for (let along = from; along <= to; along += step) {
        const p = pointAt(t, along)
        if (along === from) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      // Transparent at both ends: a trace that stops dead has an edge, and an
      // edge turns a signal back into a drawn line.
      const a = pointAt(t, from)
      const b = pointAt(t, to)
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      gradient.addColorStop(0, rgba(t.hue, 0))
      gradient.addColorStop(0.5, rgba(t.hue, alpha))
      gradient.addColorStop(1, rgba(t.hue, 0))
      ctx.strokeStyle = gradient
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      /* Rings — an emission propagating out of a point. */
      for (let i = 0; i < rings.length; i += 1) {
        const r = rings[i]
        r.age += dt
        if (r.age > r.life) {
          rings[i] = spawnRing()
          continue
        }
        const t = r.age / r.life
        const radius = r.radius * t
        ctx.beginPath()
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(r.hue, r.peak * Math.sin(t * Math.PI) * (1 - t))
        ctx.lineWidth = 1
        ctx.stroke()
      }

      /* Traces — the waveforms, and the pulse running down each one. */
      for (let i = 0; i < traces.length; i += 1) {
        const tr = traces[i]
        tr.age += dt
        if (tr.age > tr.life) {
          traces[i] = spawnTrace()
          continue
        }
        tr.phase += tr.speed * dt
        tr.pulse = (tr.pulse + tr.pulseSpeed * dt) % 1.3

        // Up and down across its whole life, so nothing pops in or cuts out.
        const envelope = Math.sin((tr.age / tr.life) * Math.PI)
        strokeWave(tr, 0, tr.width, tr.peak * envelope, 1)

        // The pulse: a short bright window of the SAME wave, travelling along
        // it. This is the part that reads as something being carried rather
        // than as a shape sitting there oscillating.
        if (tr.pulse <= 1) {
          const centre = tr.pulse * tr.width
          const span = Math.min(90, tr.width * 0.28)
          strokeWave(
            tr,
            Math.max(0, centre - span / 2),
            Math.min(tr.width, centre + span / 2),
            tr.peak * envelope * 3.1,
            1.5,
          )
        }
      }

      ctx.globalCompositeOperation = 'source-over'
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(0)
      return () => window.removeEventListener('resize', resize)
    }

    let frame = 0
    let last = performance.now()
    let running = true

    const tick = (now: number) => {
      if (!running) return
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      draw(dt)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

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
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-0" />
}
