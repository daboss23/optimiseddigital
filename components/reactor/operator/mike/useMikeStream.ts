'use client'

import { useCallback, useRef, useState } from 'react'
import type { Proposal } from '@/lib/operator/types'

/* ----------------------------------------------------------------------------
   The client half of the open ask.

   Reads the SSE stream and keeps exactly the state the surface renders. Two
   decisions worth naming:

   **The trace is kept, not replaced.** Every tool call stays on screen after it
   resolves, with its receipt. A trace that clears itself is a loading state; a
   trace that accumulates is a record of how the answer was reached, and that
   record is most of why the answer is worth believing.

   **The answer reveals at reading pace.** The server sends it in one piece —
   it has to, because it is validated as a whole before it is allowed out. So
   the reveal here is presentation, not fake typing: nothing is shown that has
   not already passed the factual checks, and the operator can skip it.
---------------------------------------------------------------------------- */

export interface TraceEntry {
  id: string
  name: string
  label: string
  receipt?: string
}

export interface MikeMessage {
  id: string
  role: 'user' | 'mike'
  text: string
  /** Mike's messages carry the reads behind them. */
  trace?: TraceEntry[]
  thoughts?: string[]
  blocked?: boolean
}

export interface MikeStreamState {
  messages: MikeMessage[]
  /** The live turn's trace, before it is attached to a message. */
  trace: TraceEntry[]
  thoughts: string[]
  busy: boolean
  error: string | null
  /** Tools resolving right now — drives the satellites. */
  activity: number
}

const EMPTY: MikeStreamState = {
  messages: [],
  trace: [],
  thoughts: [],
  busy: false,
  error: null,
  activity: 0,
}

let messageSeq = 0
const nextId = (): string => `m${(messageSeq += 1)}`

export function useMikeStream(board: Proposal[]) {
  const [state, setState] = useState<MikeStreamState>(EMPTY)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    messageSeq = 0
    setState(EMPTY)
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState((s) => ({ ...s, busy: false, activity: 0 }))
  }, [])

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      // The thread Mike is given: the exchange so far, answers only. Tool
      // traffic is not replayed — he re-reads whatever he needs, which is both
      // cheaper and more honest than handing him a transcript of figures and
      // trusting him to remember which were which.
      const history = state.messages
        .filter((m) => !m.blocked && m.text)
        .map((m) => ({ role: m.role === 'mike' ? ('assistant' as const) : ('user' as const), text: m.text }))

      setState((s) => ({
        ...s,
        messages: [...s.messages, { id: nextId(), role: 'user', text: trimmed }],
        trace: [],
        thoughts: [],
        busy: true,
        error: null,
        // He is on it before the first status event lands — a beat of dead
        // orb between pressing enter and the stream opening reads as a miss.
        activity: 0,
      }))

      try {
        const response = await fetch('/api/operator/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed, history, board }),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          throw new Error(`Mike could not be reached (${response.status}).`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // Trace rows are keyed by tool_use id so the second `tool` event —
        // the one carrying the real label once the tool has resolved its
        // arguments — updates the row in place instead of adding a duplicate.
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() ?? ''

          for (const chunk of chunks) {
            const line = chunk.trim()
            if (!line.startsWith('data:')) continue
            let event: Record<string, unknown>
            try {
              event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>
            } catch {
              continue
            }

            setState((s) => {
              switch (event.type) {
                case 'status':
                  // The phase on screen is derived from what is actually in
                  // flight, not from a label the server chose. Kept as a
                  // no-op so the event stays part of the contract.
                  return s
                case 'thought':
                  return { ...s, thoughts: [...s.thoughts, String(event.text)] }
                case 'tool': {
                  const id = String(event.id)
                  const exists = s.trace.some((t) => t.id === id)
                  const row: TraceEntry = {
                    id,
                    name: String(event.name),
                    label: String(event.label),
                  }
                  return {
                    ...s,
                    activity: s.activity + (exists ? 0 : 1),
                    trace: exists
                      ? s.trace.map((t) => (t.id === id ? { ...t, ...row, receipt: t.receipt } : t))
                      : [...s.trace, row],
                  }
                }
                case 'result':
                  return {
                    ...s,
                    activity: Math.max(0, s.activity - 1),
                    trace: s.trace.map((t) =>
                      t.id === String(event.id) ? { ...t, receipt: String(event.receipt) } : t,
                    ),
                  }
                case 'answer':
                  return {
                    ...s,
                    activity: 0,
                    messages: [
                      ...s.messages,
                      {
                        id: nextId(),
                        role: 'mike',
                        text: String(event.text),
                        trace: s.trace,
                        thoughts: s.thoughts,
                      },
                    ],
                  }
                case 'blocked':
                  return {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        id: nextId(),
                        role: 'mike',
                        text:
                          'I had that answer twice and both times it leaned on a figure I had not actually read. Not going to hand you a number I cannot stand behind — ask me again and I will go and get it properly.',
                        trace: s.trace,
                        blocked: true,
                      },
                    ],
                  }
                case 'error':
                  return { ...s, error: String(event.message), busy: false, activity: 0 }
                case 'done':
                  return { ...s, busy: false, activity: 0 }
                default:
                  return s
              }
            })
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setState((s) => ({
          ...s,
          busy: false,
          activity: 0,
          error: error instanceof Error ? error.message : 'Mike could not be reached.',
        }))
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setState((s) => (s.busy ? { ...s, busy: false, activity: 0 } : s))
      }
    },
    [board, state.messages],
  )

  return { ...state, ask, stop, reset }
}
