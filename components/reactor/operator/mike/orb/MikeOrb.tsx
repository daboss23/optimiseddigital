'use client'

import { useEffect, useRef } from 'react'
import { Spring } from '@/components/reactor/operator/mike/presence'
import {
  fibonacciSphere,
  greatCircle,
  rotate,
  rgba,
  shellColour,
  GOLD,
  VIOLET,
  WHITE,
  type Vec3,
} from '@/components/reactor/operator/mike/orb/field'

/* ----------------------------------------------------------------------------
   Mike.

   One fixed, full-viewport canvas. He is drawn into it wherever he currently
   is, which is what lets him leave the corner and travel to the middle of the
   dashboard as one continuous object — a component that lived inside a corner
   box could only ever fade out there and fade in somewhere else, and a thing
   that teleports is a thing nobody believes is alive.

   Everything is additive (`globalCompositeOperation = 'lighter'`), so
   overlapping filaments accumulate into white-hot light exactly the way real
   emission does. Painting him with normal blending gives flat coloured plastic.

   His position, size and arousal are springs, so any change — hover, click,
   an answer arriving — is caught mid-motion and redirected rather than queued.
---------------------------------------------------------------------------- */

export type OrbState = 'ambient' | 'focus' | 'working' | 'speaking'

export interface MikeOrbProps {
  state: OrbState
  /** Where he should be, in viewport pixels. */
  target: { x: number; y: number }
  /** How big he should be, in viewport pixels. */
  radius: number
  /** Extra life on top of the state — hover, mostly. 0–1. */
  arousal?: number
  /** Reads in flight. Each one throws sparks across the shell. */
  activity?: number
  /** Increment to evaporate the cloud into particles. */
  burst?: number
  className?: string
}

/* --------------------------------- tuning --------------------------------- */

const SHELL_POINTS = 1900
const SHELL_POINTS_MOBILE = 620
const FILAMENTS = 6
const FILAMENT_POINTS = 110

/** How hard he burns per state, before arousal is added. */
const HEAT: Record<OrbState, number> = {
  ambient: 0.6,
  focus: 0.95,
  working: 1.15,
  speaking: 1.02,
}

/** Seconds between emitted frequency rings. */
const RING_PERIOD: Record<OrbState, number> = {
  ambient: 2.4,
  focus: 1.7,
  working: 0.55,
  speaking: 1.1,
}

interface Ring {
  age: number
  life: number
}

interface Spark {
  from: Vec3
  to: Vec3
  age: number
  life: number
}

interface Mote {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  colour: readonly [number, number, number]
}

export function MikeOrb({
  state,
  target,
  radius,
  arousal = 0,
  activity = 0,
  burst = 0,
  className,
}: MikeOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const props = useRef({ state, target, radius, arousal, activity, burst })
  // Read through a ref so a prop change never restarts the loop — a restart
  // would reset every spring to rest, which is the jump the springs exist to
  // prevent.
  props.current = { state, target, radius, arousal, activity, burst }

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
      // The element is sized in CSS pixels and the buffer in device pixels.
      // Setting only one of the two is what makes a canvas look like it was
      // scaled up in an image editor.
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    /* The body, built once. */
    const shell = fibonacciSphere(mobile ? SHELL_POINTS_MOBILE : SHELL_POINTS)
    const shellColours = shell.map((p, i) => shellColour(p.y, i))

    /* Per-point radius and brightness, fixed at build time.
       A perfectly smooth shell of identical dots reads as a wireframe globe —
       the thing that makes it read as ENERGY is that the surface is fibrous:
       most points sit near the skin, a few stray well outside it, and they do
       not all burn equally. Deterministic per point rather than per frame, so
       the texture is stable and only the rotation moves. */
    const shellRadius = shell.map((_, i) => {
      const n = Math.sin(i * 12.9898) * 43758.5453
      const f = n - Math.floor(n)
      // A long tail outward: the sparse motes drifting off him in every
      // direction, which is most of what makes a sphere look like it is
      // emitting rather than merely existing.
      return f > 0.93 ? 1.06 + (f - 0.93) * 5.6 : 0.9 + f * 0.16
    })
    const shellHeat = shell.map((_, i) => {
      const n = Math.sin(i * 78.233) * 12345.6789
      return 0.45 + (n - Math.floor(n)) * 0.95
    })
    const filaments: Vec3[][] = []
    for (let i = 0; i < FILAMENTS; i += 1) {
      const angle = (i / FILAMENTS) * Math.PI * 2
      filaments.push(
        greatCircle(
          { x: Math.cos(angle) * 0.9, y: Math.sin(angle * 1.7) * 0.8, z: Math.sin(angle) },
          mobile ? Math.round(FILAMENT_POINTS * 0.6) : FILAMENT_POINTS,
          0.06,
        ),
      )
    }

    /* State that lives across frames. */
    const px = new Spring(props.current.target.x, 0.62)
    const py = new Spring(props.current.target.y, 0.62)
    const pr = new Spring(props.current.radius, 0.55)
    const heat = new Spring(HEAT[props.current.state], 0.5)

    const rings: Ring[] = []
    const sparks: Spark[] = []
    const motes: Mote[] = []
    let lastBurst = props.current.burst
    let sinceRing = 0
    let yaw = 0
    let pitch = 0

    const spawnBurst = (cx: number, cy: number, r: number) => {
      const count = mobile ? 260 : 620
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const speed = 40 + Math.random() * 320
        const spread = r * (0.4 + Math.random() * 1.5)
        motes.push({
          x: cx + Math.cos(angle) * spread,
          y: cy + Math.sin(angle) * spread * 0.55,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          age: 0,
          life: 0.9 + Math.random() * 1.1,
          colour: i % 3 === 0 ? WHITE : i % 3 === 1 ? GOLD : VIOLET,
        })
      }
    }

    const draw = (dt: number, time: number) => {
      const { state: s, target, radius: wanted, arousal: a, activity: act, burst: b } = props.current

      px.setTarget(target.x)
      py.setTarget(target.y)
      pr.setTarget(wanted)
      heat.setTarget(Math.min(1.15, HEAT[s] + a * 0.28))
      px.step(dt)
      py.step(dt)
      pr.step(dt)
      heat.step(dt)

      const cx = px.value
      const cy = py.value
      const r = pr.value
      const e = heat.value

      if (b !== lastBurst) {
        lastBurst = b
        spawnBurst(cx, cy + r * 1.5, r)
      }

      // He turns faster when he is working, because he is.
      yaw += dt * (0.16 + e * 0.42)
      pitch = Math.sin(time * 0.00021) * 0.45

      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      /* Frequency rings — the emission. Spawned on a clock rather than every
         frame, so they read as discrete pulses leaving him. */
      sinceRing += dt
      if (sinceRing > RING_PERIOD[s]) {
        sinceRing = 0
        rings.push({ age: 0, life: 2.6 })
      }
      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const ring = rings[i]
        ring.age += dt
        if (ring.age > ring.life) {
          rings.splice(i, 1)
          continue
        }
        const t = ring.age / ring.life
        const rr = r * (1.05 + t * 2.1)
        ctx.beginPath()
        ctx.ellipse(cx, cy, rr, rr * 0.94, 0, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(GOLD, (1 - t) * 0.13 * e)
        ctx.lineWidth = 1
        ctx.stroke()
      }

      /* Core bloom — the light inside the shell. */
      const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.1)
      bloom.addColorStop(0, rgba(WHITE, 0.72 * e))
      bloom.addColorStop(0.1, rgba(GOLD, 0.5 * e))
      bloom.addColorStop(0.3, rgba(GOLD, 0.2 * e))
      bloom.addColorStop(0.55, rgba(VIOLET, 0.15 * e))
      bloom.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = bloom
      ctx.beginPath()
      ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2)
      ctx.fill()

      /* The shell. Far-side points are dimmer and smaller, which is the whole
         reason he reads as a sphere rather than a disc. */
      for (let i = 0; i < shell.length; i += 1) {
        const p = rotate(shell[i], yaw, pitch)
        const depth = (p.z + 1) / 2
        const rr = r * shellRadius[i]
        const size = 0.55 + depth * 1.15
        // Strays fade with distance, so the corona thins out into nothing
        // rather than ending at a visible boundary.
        const reach = shellRadius[i] > 1.06 ? Math.max(0, 1 - (shellRadius[i] - 1.06) * 1.5) : 1
        const alpha = (0.07 + depth * 0.55) * e * shellHeat[i] * reach
        ctx.fillStyle = rgba(shellColours[i], alpha)
        ctx.fillRect(cx + p.x * rr - size / 2, cy + p.y * rr - size / 2, size, size)
      }

      /* The filaments — great circles wrapping the shell. Brighter than the
         mist, so the eye reads structure inside the cloud. */
      for (let f = 0; f < filaments.length; f += 1) {
        const band = filaments[f]
        const colour = f % 3 === 0 ? WHITE : f % 3 === 1 ? GOLD : VIOLET
        for (let i = 0; i < band.length; i += 1) {
          const p = rotate(band[i], yaw * (1 + f * 0.07), pitch + f * 0.22)
          const depth = (p.z + 1) / 2
          const size = 0.85 + depth * 1.5
          ctx.fillStyle = rgba(colour, (0.12 + depth * 0.8) * e)
          ctx.fillRect(cx + p.x * r - size / 2, cy + p.y * r - size / 2, size, size)
        }
      }

      /* Sparks — one per read in flight, arcing across the surface. This is
         the only part of him that counts something, and it is worth counting:
         four arcs firing at once means four things being read at once. */
      const wanted_sparks = Math.min(act, 6)
      if (wanted_sparks > 0 && Math.random() < dt * 14) {
        const a1 = shell[Math.floor(Math.random() * shell.length)]
        const a2 = shell[Math.floor(Math.random() * shell.length)]
        sparks.push({ from: a1, to: a2, age: 0, life: 0.16 + Math.random() * 0.16 })
      }
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i]
        spark.age += dt
        if (spark.age > spark.life) {
          sparks.splice(i, 1)
          continue
        }
        const t = spark.age / spark.life
        const from = rotate(spark.from, yaw, pitch)
        const to = rotate(spark.to, yaw, pitch)
        ctx.beginPath()
        ctx.moveTo(cx + from.x * r, cy + from.y * r)
        // Bowed outward, so it arcs over the surface instead of cutting
        // through the middle of him like a chord.
        ctx.quadraticCurveTo(
          cx + ((from.x + to.x) / 2) * r * 1.32,
          cy + ((from.y + to.y) / 2) * r * 1.32,
          cx + to.x * r,
          cy + to.y * r,
        )
        ctx.strokeStyle = rgba(WHITE, (1 - t) * 0.75)
        ctx.lineWidth = 1.1
        ctx.stroke()
      }

      /* Motes — the cloud, evaporated. */
      for (let i = motes.length - 1; i >= 0; i -= 1) {
        const mote = motes[i]
        mote.age += dt
        if (mote.age > mote.life) {
          motes.splice(i, 1)
          continue
        }
        const t = mote.age / mote.life
        // Drag, so they burst out and settle rather than flying off screen at
        // a constant rate — the difference between an explosion and confetti.
        mote.vx *= 1 - dt * 1.8
        mote.vy *= 1 - dt * 1.8
        mote.x += mote.vx * dt
        mote.y += mote.vy * dt
        const size = 1.4 * (1 - t) + 0.3
        ctx.fillStyle = rgba(mote.colour, (1 - t) * 0.65)
        ctx.fillRect(mote.x, mote.y, size, size)
      }

      ctx.globalCompositeOperation = 'source-over'
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduced.matches) {
      // One honest frame. He is still there and still legible; he simply does
      // not move for someone who asked the machine to stop moving.
      draw(0.016, 0)
      return () => window.removeEventListener('resize', resize)
    }

    let frame = 0
    let last = performance.now()
    let running = true

    const tick = (now: number) => {
      if (!running) return
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      draw(dt, now)
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

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
