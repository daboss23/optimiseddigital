'use client'

import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { WordStream } from '@/components/reactor/operator/mike/WordStream'

/* ----------------------------------------------------------------------------
   Several paragraphs, spoken in order.

   `WordStream` delivers one block three words at a time. This is what you need
   when he says more than one thing: the second paragraph does not begin until
   the first has finished, because a person pauses between thoughts and two
   paragraphs racing each other reads as a page loading rather than as someone
   talking.

   Shared by the dashboard and the first meeting so the two cannot drift into
   different ideas of how Mike speaks.
---------------------------------------------------------------------------- */

export interface MikeSpeechProps {
  text: string
  /** Fires when the last paragraph lands — used to reveal what comes next. */
  onComplete?: () => void
  className?: string
}

export function MikeSpeech({ text, onComplete, className }: MikeSpeechProps) {
  const paragraphs = useMemo(
    () =>
      text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    [text],
  )
  const [spoken, setSpoken] = useState(0)

  const advance = useCallback(() => {
    setSpoken((n) => {
      const next = n + 1
      if (next >= paragraphs.length) onComplete?.()
      return next
    })
  }, [paragraphs.length, onComplete])

  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {paragraphs.slice(0, spoken + 1).map((paragraph, i) => (
        <WordStream
          key={`${i}-${paragraph.slice(0, 24)}`}
          text={paragraph}
          onComplete={i === spoken ? advance : undefined}
        />
      ))}
    </div>
  )
}
