'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { readOperatorNameCookie } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { anchorPoint } from '@/components/reactor/operator/mike/anchor'
import { MikeOrb, type OrbState } from '@/components/reactor/operator/mike/orb/MikeOrb'
import { WordStream } from '@/components/reactor/operator/mike/WordStream'
import { useMikeStream } from '@/components/reactor/operator/mike/useMikeStream'

/* ----------------------------------------------------------------------------
   Mike, resident.

   He is not a panel and he is not a chat window. He is an object that lives on
   the dashboard, in the corner, always on — and when you want him he leaves
   the corner and comes to the middle of the screen. That single continuity is
   the whole design: one canvas spans the viewport for his entire life, so the
   thing that was idling in the corner is provably the same thing now floating
   in front of you. Fading one component out and another in would say the
   opposite.

   The phases are the honest states of the loop underneath:

     resting    — corner, slow burn, hover lifts him
     greeting   — arrived, saying hello
     composing  — the energy cloud is open and taking words
     working    — the cloud has evaporated; he is off reading the account
     speaking   — back, delivering, three words at a time

   Nothing is decorative. `working` is on screen if and only if tools are
   actually resolving, and the sparks crossing his shell are counted from reads
   genuinely in flight. The moment the light stops meaning something it stops
   being presence and starts being a screensaver.
---------------------------------------------------------------------------- */

type Phase = 'resting' | 'greeting' | 'composing' | 'working' | 'speaking'

/**
 * The fallback perch, for pages where his anchor is not rendered. Clear of the
 * mobile nav and the window edges.
 */
const CORNER_INSET = { x: 112, y: 128 }
// Small enough that his corona does not wash over the supporting line under
// the headline — he sits beside the words, he does not sit on them.
const RESTING_RADIUS = 27
const HOVER_RADIUS = 32

export function MikeStage() {
  const { proposals, metadata, queue } = useOperator()
  const mike = useMikeStream(proposals)

  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<Phase>('resting')
  const [hovered, setHovered] = useState(false)
  const [draft, setDraft] = useState('')
  const [burst, setBurst] = useState(0)
  const [viewport, setViewport] = useState({ w: 1440, h: 900 })
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const perchRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef(false)

  useEffect(() => {
    setMounted(true)
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const open = phase !== 'resting'
  const compact = viewport.w < 768

  /* The stream drives the phase, never the other way round. He is "working"
     because reads are in flight, not because a timer said so. */
  useEffect(() => {
    if (!open) return
    if (mike.busy) {
      setPhase('working')
      return
    }
    if (mike.messages.length > 0 && mike.messages[mike.messages.length - 1].role === 'mike') {
      setPhase('speaking')
    }
  }, [mike.busy, mike.messages, open])

  const name = useMemo(() => readOperatorNameCookie() ?? 'there', [])
  const greeting = `What's up ${name}! Mike Delight is at your service. Ask me anything about this account — I'll go and read it while you watch.`

  const latest = mike.messages[mike.messages.length - 1]
  const spoken = latest?.role === 'mike' ? latest.text : ''

  /* -------------------------------- actions -------------------------------- */

  const wake = useCallback(() => {
    if (open) return
    setPhase('greeting')
    setHovered(false)
    // A beat before the cursor lands, so the arrival is his and the input
    // does not snatch attention out from under it.
    window.setTimeout(() => inputRef.current?.focus(), 620)
  }, [open])

  const rest = useCallback(() => {
    setPhase('resting')
    setDraft('')
    mike.reset()
  }, [mike])

  const send = useCallback(() => {
    const question = draft.trim()
    if (!question || mike.busy) return
    setDraft('')
    // The cloud evaporates into particles at the moment the question leaves.
    setBurst((n) => n + 1)
    setPhase('working')
    void mike.ask(question)
  }, [draft, mike])

  /* Escape returns him to the corner, and only him — layered so a drawer
     elsewhere on the page is not torn down by the same key. */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        rest()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, rest])

  /* Typing takes the floor: whatever he was saying fades down and away. */
  const dissolving = draft.length > 0

  /* -------------------------------- geometry ------------------------------- */

  // High enough that his corona — which reaches roughly twice his radius —
  // clears the first line of text. Light bleeding through his own words is
  // the one thing that would make him read as a background image.
  openRef.current = open

  /**
   * Where he should be, resolved once per FRAME rather than per render.
   *
   * At rest he rides his anchor in the queue headline, so he scrolls with the
   * card he belongs to instead of hanging in a fixed corner while the page
   * slides past underneath him. Reading the rect every frame rather than
   * listening for scroll is both simpler and smoother: there is no event to
   * miss, no throttle to tune, and no React render per scroll tick.
   */
  const resolveTarget = useCallback(() => {
    if (openRef.current) {
      return { x: window.innerWidth / 2, y: window.innerHeight * (compact ? 0.19 : 0.22) }
    }
    return (
      anchorPoint() ?? {
        x: window.innerWidth - CORNER_INSET.x,
        y: window.innerHeight - CORNER_INSET.y,
      }
    )
  }, [compact])

  /** The hit target rides along, moved by transform only. */
  const onFrame = useCallback((x: number, y: number) => {
    const perch = perchRef.current
    if (perch) perch.style.transform = `translate3d(${x - 44}px, ${y - 44}px, 0)`
  }, [])

  const radius = open
    ? compact
      ? 58
      : 88
    : hovered
      ? HOVER_RADIUS
      : RESTING_RADIUS

  const orbState: OrbState =
    phase === 'working' ? 'working' : phase === 'speaking' ? 'speaking' : open ? 'focus' : 'ambient'

  /* Openers drawn from his own board, so the first question anybody asks is
     already about their own money rather than a sample account's. */
  const openers = useMemo(
    () =>
      [
        queue[0] ? `Why is "${queue[0].creativeName}" on the board?` : null,
        'How is the account doing this week?',
      ].filter((v): v is string => Boolean(v)),
    [queue],
  )

  if (!mounted) return null

  return createPortal(
    <>
      {/* The stage he dims when he steps forward. Never mounted at rest, so
          the dashboard is fully interactive while he idles. */}
      {open && (
        <button
          type="button"
          aria-label="Send Mike back"
          onClick={rest}
          className="mike-veil fixed inset-0 z-[90] cursor-default"
        />
      )}

      {/* Mike himself. One canvas for his whole life, corner to centre and
          back, never unmounted — which is what makes it the same object. */}
      <MikeOrb
        state={orbState}
        target={resolveTarget}
        radius={radius}
        carried={!open}
        onFrame={onFrame}
        arousal={hovered && !open ? 1 : 0}
        activity={mike.activity}
        burst={burst}
        className="pointer-events-none fixed inset-0 z-[91]"
      />

      {/* At rest: the only thing you can touch is him. */}
      {!open && (
        <div ref={perchRef} className="mike-perch fixed left-0 top-0 z-[92]">
          <button
            type="button"
            onClick={wake}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            aria-label="Talk with Mike"
            className="h-[88px] w-[88px] rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/50"
          />
          <span
            aria-hidden
            className={cn('mike-tag', hovered && 'mike-tag--shown')}
          >
            Talk with Mike
          </span>
        </div>
      )}

      {/* Open: everything he says and everything you type, hung below him. */}
      {open && (
        <div className="mike-room pointer-events-none fixed inset-0 z-[93] flex flex-col items-center justify-start px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[42vh] sm:pt-[44vh]">
          <div className="flex w-full max-w-2xl flex-col items-center gap-7">
            {/* What he is saying. */}
            {phase !== 'working' && (
              <WordStream
                key={phase === 'speaking' ? latest?.id : 'greeting'}
                text={phase === 'speaking' ? spoken : greeting}
                dissolving={phase !== 'speaking' && dissolving}
                className={cn(
                  'pointer-events-auto text-center leading-relaxed text-white/85',
                  compact ? 'text-[17px]' : 'text-[20px]',
                )}
              />
            )}

            {/* What he is doing. Only while he is doing it. */}
            {phase === 'working' && (
              <div className="flex flex-col items-center gap-2.5">
                {mike.trace.map((row) => (
                  <p key={row.id} className="mike-read text-center text-[13px] text-white/45">
                    {row.label}
                    {row.receipt && <span className="text-white/25"> · {row.receipt}</span>}
                  </p>
                ))}
                {mike.trace.length === 0 && (
                  <p className="mike-read text-center text-[13px] text-white/35">
                    Working out where to look…
                  </p>
                )}
              </div>
            )}

            {mike.error && (
              <p className="max-w-md text-center text-[13px] leading-relaxed text-amber-200/70">
                {mike.error}
              </p>
            )}

            {/* The cloud. Not a text field — a region of light you speak into.
                It is gone entirely while he is away reading, because there is
                nothing to type into a man who is not in the room. */}
            {phase !== 'working' && (
              <div className="pointer-events-auto flex w-full flex-col items-center gap-5">
                <div className="mike-cloud w-full">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        send()
                      }
                    }}
                    placeholder="Just start typing…"
                    className="mike-cloud-input"
                  />
                </div>

                {/* The go. A pill with the arrow in its own well.
                    Unmounted rather than hidden when there is nothing to send:
                    an invisible button still occupies its row, and the hole it
                    leaves under the cloud is visible as a gap nobody can
                    explain. */}
                {draft.trim() && (
                  <button type="button" onClick={send} className="mike-go">
                    <span>Let&rsquo;s Go</span>
                    <span className="mike-go-well">
                      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden>
                        <path
                          d="M3 13L13 3M13 3H5.5M13 3v7.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </button>
                )}

                {/* Somewhere to start, on the very first turn only. */}
                {phase === 'greeting' && !draft && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {openers.map((opener) => (
                      <button
                        key={opener}
                        type="button"
                        onClick={() => {
                          setBurst((n) => n + 1)
                          setPhase('working')
                          void mike.ask(opener)
                        }}
                        className="mike-opener"
                      >
                        {opener}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The quiet truth about where the numbers came from. */}
          <p className="mike-footnote pointer-events-none mt-auto text-center text-[11px] text-white/25">
            {metadata?.origin === 'seeded' ? 'Demo data · ' : ''}
            Every figure he says is checked against what he actually read
          </p>
        </div>
      )}
    </>,
    document.body,
  )
}
