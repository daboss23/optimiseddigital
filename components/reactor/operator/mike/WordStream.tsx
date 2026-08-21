'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   How Mike speaks.

   Three words at a time, each group floating out of nothing and resolving into
   focus. Not a typewriter — a typewriter reveals characters, which reads as a
   machine printing. Groups of three read as phrasing, because three words is
   roughly what a person says between breaths, and the eye lands on a phrase
   rather than chasing a cursor.

   Nothing here is faking generation. The whole answer has already arrived and
   already passed the factual checks before this component sees a word of it.
   The pacing is delivery, and it is skippable — click anywhere in the stream
   and he finishes the thought at once.
---------------------------------------------------------------------------- */

const WORDS_PER_GROUP = 3
/** Milliseconds between groups. Around the pace of unhurried speech. */
const GROUP_MS = 230

export interface WordStreamProps {
  text: string
  /** Fade the whole thing down and away — he stops talking because you started. */
  dissolving?: boolean
  onComplete?: () => void
  className?: string
}

export function WordStream({ text, dissolving, onComplete, className }: WordStreamProps) {
  const groups = useMemo(() => {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const out: string[] = []
    for (let i = 0; i < words.length; i += WORDS_PER_GROUP) {
      out.push(words.slice(i, i + WORDS_PER_GROUP).join(' '))
    }
    return out
  }, [text])

  const [shown, setShown] = useState(0)
  const done = useRef(false)

  useEffect(() => {
    setShown(0)
    done.current = false
    if (groups.length === 0) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(groups.length)
      onComplete?.()
      done.current = true
      return
    }

    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= groups.length) return n
        return n + 1
      })
    }, GROUP_MS)
    return () => clearInterval(timer)
  }, [groups, onComplete])

  useEffect(() => {
    if (!done.current && groups.length > 0 && shown >= groups.length) {
      done.current = true
      onComplete?.()
    }
  }, [shown, groups.length, onComplete])

  if (groups.length === 0) return null

  return (
    <p
      onClick={() => setShown(groups.length)}
      className={cn(
        'mike-words',
        dissolving && 'mike-words--dissolve',
        'cursor-default text-balance',
        className,
      )}
    >
      {groups.slice(0, shown).map((group, i) => (
        <span key={`${i}-${group}`} className="mike-word">
          {group}{' '}
        </span>
      ))}
    </p>
  )
}
