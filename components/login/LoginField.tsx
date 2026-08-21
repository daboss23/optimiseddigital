'use client'

import { useEffect, useRef } from 'react'

/* ----------------------------------------------------------------------------
   The field behind the door.

   Loose motes of light that surface somewhere at random, drift a little, flare
   once, and go. It is the same idea as Mike's shell — the platform runs on
   energy, and the sign-in should already feel like that — held down to a
   fraction of the intensity, because this sits BEHIND a form somebody has to
   read and type into.

   Kept honest in three ways: nothing here is on a grid or a shared clock, so
   it never falls into the visible loop that gives ambient motion away; every
   mote is drawn additively so overlaps accumulate as light rather than paint;
   and the whole thing stops for `prefers-reduced-motion` and for a
   backgrounded tab.
---------------------------------------------------------------------------- */

/** Sparse on purpose. This is atmosphere, not weather. */
const MOTES = 46
const MOTES_MOBILE = 22

/** Cyan, azure, violet — the command centre's own light — and a little gold. */
const HUES: readonly (readonly [number, number, number])[] = [
  [94, 168, 255],
  [56, 232, 255],
  [178, 132, 255],
  [255, 205, 130],
]

interface Mote {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  peak: number
  hue: readonly [number, number, number]
  /** When in its life it flares. Never the same moment twice. */
  flareAt: number
  flared: number
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

    const spawn = (mote: Partial<Mote> = {}): Mote => ({
      x: Math.random() * width,
      y: Math.random() * height,
      // Slow enough to read as suspended rather than as falling.
      vx: (Math.random() - 0.5) * 9,
      vy: (Math.random() - 0.5) * 9,
      age: 0,
      life: 3.5 + Math.random() * 5.5,
      size: 0.7 + Math.random() * 1.5,
      peak: 0.16 + Math.random() * 0.3,
      hue: HUES[Math.floor(Math.random() * HUES.length)],
      flareAt: 0.25 + Math.random() * 0.5,
      flared: 0,
      ...mote,
    })

    const count = mobile ? MOTES_MOBILE : MOTES
    const motes: Mote[] = Array.from({ length: count }, () =>
      // Staggered ages, so they do not all arrive and leave together on the
      // first pass — a synchronised field is the tell that it is a loop.
      spawn({ age: Math.random() * 6 }),
    )

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      for (let i = 0; i < motes.length; i += 1) {
        const m = motes[i]
        m.age += dt
        if (m.age > m.life) {
          motes[i] = spawn()
          continue
        }
        m.x += m.vx * dt
        m.y += m.vy * dt

        const t = m.age / m.life
        // Up and down over its whole life, so nothing ever pops in or cuts out.
        const envelope = Math.sin(t * Math.PI)

        // The flare: one short bloom somewhere in the middle of its life.
        const since = Math.abs(t - m.flareAt)
        const flare = since < 0.06 ? (1 - since / 0.06) ** 2 : 0
        m.flared = flare

        const alpha = m.peak * envelope * (1 + flare * 2.2)
        const radius = m.size * (1 + flare * 1.6)

        const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, radius * 6)
        glow.addColorStop(0, `rgba(${m.hue[0]}, ${m.hue[1]}, ${m.hue[2]}, ${alpha})`)
        glow.addColorStop(0.4, `rgba(${m.hue[0]}, ${m.hue[1]}, ${m.hue[2]}, ${alpha * 0.28})`)
        glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(m.x, m.y, radius * 6, 0, Math.PI * 2)
        ctx.fill()

        // A hard core only while it is flaring — that is what reads as a
        // flash rather than as a lamp being turned up.
        if (flare > 0.05) {
          ctx.fillStyle = `rgba(255, 255, 255, ${flare * 0.5})`
          ctx.beginPath()
          ctx.arc(m.x, m.y, radius * 0.5, 0, Math.PI * 2)
          ctx.fill()
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
