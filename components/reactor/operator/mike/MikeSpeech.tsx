'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { WordStream } from '@/components/reactor/operator/mike/WordStream'

/* ----------------------------------------------------------------------------
   Several paragraphs, spoken in order.

   Two cadences, because two situations:

   **`phrases`** — three words at a time, the way he answers a question on the
   dashboard. You are waiting on the answer, so it arrives in the order he
   thinks of it.

   **`coalesce`** — a whole paragraph resolving at once out of scattered light.
   This is the introduction, and an introduction is not an answer: nobody is
   waiting on it, nothing is being computed, and there is no reason to make a
   person's eye chase phrases across a line to read a sentence that was fully
   written before they arrived. Delivered in three-word bursts it reads as
   rushed and the words scramble; delivered as one settling block it reads as
   somebody speaking calmly.

   Either way the next paragraph does not begin until the last has landed, with
   a real pause between them — people breathe between thoughts, and two
   paragraphs racing each other reads as a page loading rather than as someone
   talking.
---------------------------------------------------------------------------- */

export type SpeechCadence = 'phrases' | 'coalesce'

/** Held between paragraphs. Long enough to read as a breath, not as a stall. */
const BREATH_MS = 1300
/** How long a paragraph takes to gather. Must match `mike-coalesce` in CSS. */
const COALESCE_MS = 1900

export interface MikeSpeechProps {
  text: string
  cadence?: SpeechCadence
  /** Held before he says anything at all — lets him arrive before he speaks. */
  delayMs?: number
  /** Fires when the last paragraph lands — used to reveal what comes next. */
  onComplete?: () => void
  className?: string
}

export function MikeSpeech({
  text,
  cadence = 'phrases',
  delayMs = 0,
  onComplete,
  className,
}: MikeSpeechProps) {
  const paragraphs = useMemo(
    () =>
      text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    [text],
  )

  /** How many paragraphs have STARTED. -1 while he has not begun. */
  const [started, setStarted] = useState(-1)

  /**
   * The callback, held in a ref rather than read as a dependency.
   *
   * Callers write `onComplete={() => setFinished(true)}`, which is a NEW
   * function on every render. As a dependency that makes the schedule restart
   * the instant the parent re-renders — including the re-render its own
   * completion causes — so the transmission resets to nothing and begins
   * again, and everything he just said disappears.
   */
  const complete = useRef(onComplete)
  complete.current = onComplete

  useEffect(() => {
    setStarted(-1)
    if (paragraphs.length === 0) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setStarted(paragraphs.length - 1)
      complete.current?.()
      return
    }

    if (cadence !== 'coalesce') {
      const opening = window.setTimeout(() => setStarted(0), delayMs)
      return () => window.clearTimeout(opening)
    }

    // Coalescing paragraphs are on a fixed clock — each one takes the same
    // time to gather, so the whole transmission can be scheduled up front
    // rather than chained through a callback per paragraph.
    const timers: number[] = []
    paragraphs.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => setStarted(i), delayMs + i * (COALESCE_MS + BREATH_MS)),
      )
    })
    timers.push(
      window.setTimeout(
        () => complete.current?.(),
        delayMs + paragraphs.length * COALESCE_MS + (paragraphs.length - 1) * BREATH_MS,
      ),
    )
    return () => timers.forEach(window.clearTimeout)
  }, [paragraphs, cadence, delayMs])

  /* Phrase cadence chains: paragraph n+1 begins when n has finished speaking. */
  const advance = () => {
    setStarted((n) => {
      const next = n + 1
      if (next >= paragraphs.length) {
        complete.current?.()
        return n
      }
      window.setTimeout(() => setStarted(next), BREATH_MS)
      return n
    })
  }

  if (started < 0) return <div className={cn('flex flex-col gap-6', className)} />

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {paragraphs.slice(0, started + 1).map((paragraph, i) =>
        cadence === 'coalesce' ? (
          <p key={`${i}-${paragraph.slice(0, 24)}`} className="mike-coalesce">
            {paragraph}
          </p>
        ) : (
          <WordStream
            key={`${i}-${paragraph.slice(0, 24)}`}
            text={paragraph}
            onComplete={i === started ? advance : undefined}
          />
        ),
      )}
    </div>
  )
}
