'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Database, Lock, Unlock, X, Volume2 } from 'lucide-react'

type DoorPhase = 'sealed' | 'unlocking' | 'opening'

/**
 * Immersive full-screen Knowledge Vault shell. Shows a sealed blast-door poster;
 * the user clicks to crack it open. That click is a real user gesture, so the
 * door clip plays WITH sound (browsers block autoplay audio otherwise). The
 * camera pushes inside, then the interior stays as a living, dimmed backdrop
 * while the vault knowledge lives on top of it. An "Exit Vault" control returns
 * to the app. Falls back to a CSS blast-door when the clip can't load, and
 * enters instantly (silently) under reduced-motion.
 */
export function VaultDoor({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [started, setStarted] = useState(false) // user clicked to enter
  const [entered, setEntered] = useState(false) // fully inside
  const [phase, setPhase] = useState<DoorPhase>('sealed')
  const [useVideo, setUseVideo] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Portal to <body> so the takeover escapes the platform layout's stacking
  // context and covers the sidebar/topbar.
  useEffect(() => setMounted(true), [])

  // Lock body scroll while the vault owns the screen.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Respect reduced-motion: drop straight into the interior, silently.
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setStarted(true)
      setEntered(true)
    }
  }, [])

  // CSS-fallback unlock sequence (only once started and the clip isn't used).
  useEffect(() => {
    if (useVideo || !started || entered) return
    const t = timers.current
    t.push(setTimeout(() => setPhase('unlocking'), 500))
    t.push(setTimeout(() => setPhase('opening'), 1200))
    t.push(setTimeout(() => setEntered(true), 2400))
    return () => t.forEach(clearTimeout)
  }, [useVideo, started, entered])

  // Crack the vault — the click gesture lets us play the clip with audio.
  const enter = () => {
    if (started) return
    setStarted(true)
    const v = videoRef.current
    if (useVideo && v) {
      v.muted = false
      v.volume = 1
      // If the browser still refuses audio, fall back to a muted play so the
      // door always opens rather than freezing on the poster.
      v.play().catch(() => {
        v.muted = true
        v.play().catch(() => setEntered(true))
      })
    }
  }

  // Clicking the playing door skips straight inside.
  const skip = () => {
    if (!started || entered) return
    timers.current.forEach(clearTimeout)
    const v = videoRef.current
    if (useVideo && v && v.duration) v.currentTime = Math.max(0, v.duration - 0.05)
    else setPhase('opening')
    setEntered(true)
  }

  const opening = phase === 'opening'

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[#04060c]">
      {/* ---- Living vault interior backdrop / door clip --------------------- */}
      {/* Once inside, the backdrop is purely decorative — it must NOT capture
          clicks, right-clicks, or paste, or the browser targets the dimmed
          <video> (showing its media context menu) instead of the UI on top. */}
      <div
        className={`absolute inset-0 ${entered ? 'pointer-events-none' : ''}`}
        onClick={started && !entered ? skip : undefined}
      >
        {useVideo && (
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full transition-opacity duration-1000 ease-out ${
              entered ? 'object-cover opacity-30' : 'object-contain opacity-100'
            } ${started ? 'opacity-100' : 'opacity-0'}`}
            src="/vault/vault-door.mp4"
            playsInline
            preload="auto"
            onEnded={() => setEntered(true)}
            onError={() => setUseVideo(false)}
          />
        )}

        {/* CSS blast-door fallback (only when there's no clip) */}
        {!useVideo && (
          <>
            <div
              className={`absolute inset-y-0 left-0 w-1/2 border-r border-glow/20 bg-gradient-to-br from-[#0b1322] via-[#070d18] to-[#04060c] transition-transform duration-[1200ms] ease-[cubic-bezier(0.7,0,0.2,1)] ${
                opening || entered ? '-translate-x-full' : 'translate-x-0'
              }`}
            >
              <div className="vault-door-plating absolute inset-0 opacity-70" />
            </div>
            <div
              className={`absolute inset-y-0 right-0 w-1/2 border-l border-glow/20 bg-gradient-to-bl from-[#0b1322] via-[#070d18] to-[#04060c] transition-transform duration-[1200ms] ease-[cubic-bezier(0.7,0,0.2,1)] ${
                opening || entered ? 'translate-x-full' : 'translate-x-0'
              }`}
            >
              <div className="vault-door-plating absolute inset-0 opacity-70" />
            </div>
          </>
        )}

        {/* Legibility scrim — fades in once you're inside */}
        <div
          className={`vault-interior-scrim pointer-events-none absolute inset-0 transition-opacity duration-1000 ${
            entered ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      {/* ---- Sealed-door poster (before the user clicks to enter) ----------- */}
      {!started && (
        <button
          type="button"
          onClick={enter}
          className="vault-seal-cover absolute inset-0 z-20 grid place-items-center"
          aria-label="Enter the Knowledge Vault"
        >
          <span className="flex flex-col items-center gap-5 text-center">
            <span className="vault-seal grid h-28 w-28 place-items-center rounded-full border border-glow/40">
              <Lock size={34} className="text-glow/80" />
            </span>
            <span className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.32em] text-glow">
              <Database size={15} /> Knowledge Vault
            </span>
            <span className="vault-enter-cta flex items-center gap-2 rounded-full border border-glow/40 bg-black/50 px-6 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.28em] text-white/80 backdrop-blur-sm">
              <Unlock size={14} /> Click to unlock
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.3em] text-white/30">
              <Volume2 size={11} /> Sound on
            </span>
          </span>
        </button>
      )}

      {/* ---- Exit control --------------------------------------------------- */}
      {entered && (
        <Link
          href="/"
          aria-label="Exit the Knowledge Vault"
          className="group absolute right-4 top-4 z-30 flex items-center gap-2 rounded-full border border-glow/30 bg-black/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70 backdrop-blur-sm transition-all hover:border-glow/60 hover:text-glow sm:right-6 sm:top-6"
        >
          <X size={14} className="transition-transform group-hover:rotate-90" />
          Exit Vault
        </Link>
      )}

      {/* ---- The knowledge, living inside the vault ------------------------- */}
      <div
        className={`relative z-10 h-full overflow-y-auto transition-all duration-1000 ease-out ${
          entered ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-8 sm:py-20">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
