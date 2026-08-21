'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { MikePresence } from '@/components/reactor/operator/mike/MikePresence'
import { useMikeStream, type MikeMessage } from '@/components/reactor/operator/mike/useMikeStream'

/* ----------------------------------------------------------------------------
   The console — Mike, talking.

   The queue is where he tells you what he thinks. This is where you get to
   argue with him about it, and the difference in the room is that here he has
   to go and look things up in front of you.

   The design carries one idea: SHOW THE READING. A chat bubble that appears
   after nine seconds of spinner is a black box, and a black box full of
   numbers is exactly the thing nobody should trust. So the middle of this
   surface is not the answer — it is the trace of him pulling thirty days on
   one creative, finding its cohort, checking the Vault, and only then
   speaking. By the time the words arrive you have already watched them be
   earned.

   Portaled to the body, like the Creative Canvas, because the dashboard's
   glass panels set `backdrop-filter` and `isolation: isolate` — both create
   containing blocks that trap a fixed overlay inside the card that opened it.
---------------------------------------------------------------------------- */

/** Reveal cadence for an answer that has already passed every factual check. */
const REVEAL_MS_PER_WORD = 26

export function MikeConsole({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { proposals, metadata, queue } = useOperator()
  const mike = useMikeStream(proposals)
  const [draft, setDraft] = useState('')
  const [mounted, setMounted] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => setMounted(true), [])

  // Escape closes, and it closes ONLY this — layered so a nested drawer
  // elsewhere on the page is not also torn down by the same key.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Follow the conversation down as it grows, but never yank the view while
  // the operator is reading back through the trace.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [mike.messages, mike.trace])

  const send = useCallback(() => {
    const question = draft.trim()
    if (!question || mike.busy) return
    setDraft('')
    void mike.ask(question)
  }, [draft, mike])

  /**
   * Openers built from the board he is actually holding.
   *
   * A fixed list of example questions is a list of questions about somebody
   * else's account. These name the operator's own creatives, so the first
   * thing anyone asks is already about their own money.
   */
  const openers = useMemo(() => {
    const rows = queue.slice(0, 2).map((item) => `Why is "${item.creativeName}" on the board?`)
    return [...rows, 'How is the account doing over the last 7 days?', 'What should I be watching that you have not flagged?'].slice(0, 3)
  }, [queue])

  if (!mounted || !open) return null

  const idle = mike.messages.length === 0 && !mike.busy

  return createPortal(
    <div className="mike-stage fixed inset-0 z-[100] flex flex-col">
      {/* Header — the presence, always visible, always telling the truth about
          what he is doing right now. It aligns to the same column the
          conversation runs in, so his name sits over his own words rather than
          off in the corner of the window. */}
      <header
        className={cn(
          'mike-stage-header shrink-0 px-4 sm:px-8',
          mike.busy && 'mike-stage-header--live',
        )}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3.5 py-4">
          <MikePresence
            state={mike.presence}
            activity={mike.activity}
            size={52}
            className="-my-2 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold tracking-tight text-white">
                Mike Delight
              </h2>
              {metadata?.origin === 'seeded' && (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
                  Demo data
                </span>
              )}
            </div>
            <p className="truncate text-[13px] text-white/45">
              {statusLine(mike.presence, mike.activity)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* The conversation. */}
      <div
        ref={scrollRef}
        className={cn(
          'flex-1 overflow-y-auto overscroll-contain px-4 sm:px-8',
          idle ? 'flex items-center py-8' : 'py-8',
        )}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* At rest he steps forward — full size, centred, breathing. The
              moment there is work he steps back into the header and the
              conversation takes the room. */}
          {idle && (
            <div className="mike-arrival flex flex-col items-center gap-7 text-center">
              <MikePresence state="dormant" size={208} className="-my-10" />
              <div className="flex flex-col gap-2.5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-300/70">
                  Smooth Operator
                </p>
                <p className="mx-auto max-w-md text-[15px] leading-relaxed text-white/65">
                  Ask him anything about the account. He reads it live — the creatives, his own
                  queue, the Vault, what has been graded before — and you watch him do it.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {openers.map((opener) => (
                  <button
                    key={opener}
                    type="button"
                    onClick={() => {
                      setDraft('')
                      void mike.ask(opener)
                    }}
                    className="min-h-[44px] rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[13px] text-white/70 transition-all hover:-translate-y-px hover:border-amber-500/40 hover:bg-amber-500/[0.07] hover:text-white active:translate-y-0"
                  >
                    {opener}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mike.messages.map((message, i) => (
            <Message
              key={message.id}
              message={message}
              // The newest answer shows its working expanded; older ones fold
              // away. Reading how he got there matters most while the answer
              // is still the thing on your mind.
              latest={i === mike.messages.length - 1}
            />
          ))}

          {/* The live trace — the current turn, still in flight. */}
          {mike.busy && <LiveTrace trace={mike.trace} thoughts={mike.thoughts} />}

          {mike.error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-[13px] text-red-200">
              {mike.error}
            </p>
          )}
        </div>
      </div>

      {/* The input. */}
      <div className="mike-stage-footer shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8">
        <div className="mike-input mx-auto flex w-full max-w-3xl items-end gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
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
            placeholder="Ask Mike about the account…"
            className="max-h-32 flex-1 resize-none bg-transparent text-[15px] text-white placeholder:text-white/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={mike.busy ? mike.stop : send}
            disabled={!mike.busy && !draft.trim()}
            aria-label={mike.busy ? 'Stop' : 'Send'}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all',
              mike.busy
                ? 'border border-white/15 bg-white/[0.04] text-white/70 hover:text-white'
                : draft.trim()
                  ? 'bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.97]'
                  : 'border border-white/10 bg-white/[0.02] text-white/25',
            )}
          >
            {mike.busy ? <Square size={15} /> : <ArrowUp size={18} />}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-[11px] text-white/30">
          Every figure he states is checked against what he actually read. He proposes and drafts —
          he cannot change the account.
        </p>
      </div>
    </div>,
    document.body,
  )
}

/* --------------------------------- pieces ---------------------------------- */

function statusLine(presence: string, activity: number): string {
  if (presence === 'reading') {
    return activity > 1 ? `Reading ${activity} things at once` : 'Reading the account'
  }
  if (presence === 'writing') return 'Working out what that means'
  if (presence === 'listening') return 'Listening'
  return 'Smooth Operator · reads the account live'
}

function Message({ message, latest }: { message: MikeMessage; latest: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[15px] leading-relaxed text-white/90">
          {message.text}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* What he said to himself on the way. Kept rather than discarded: the
          aside before he goes and looks is often the most useful sentence in
          the whole exchange, and it is the one place his actual reasoning —
          rather than his conclusion — is visible. */}
      {message.thoughts?.map((thought, i) => (
        <p
          key={`${message.id}-thought-${i}`}
          className="border-l-2 border-amber-500/25 pl-3.5 text-[14px] italic leading-relaxed text-white/45"
        >
          {thought}
        </p>
      ))}
      {message.trace && message.trace.length > 0 && (
        <SettledTrace trace={message.trace} defaultOpen={latest} />
      )}
      <Answer text={message.text} blocked={message.blocked} />
    </div>
  )
}

/**
 * The reveal.
 *
 * Word by word at reading pace, and skippable on click. It is not simulating
 * generation — the whole answer arrived at once and had already passed the
 * factual checks before this component ever saw it. What the pacing does is
 * give the eye somewhere to land after the trace, so the answer reads as the
 * conclusion of the reading rather than as a block of text that replaced it.
 */
function Answer({ text, blocked }: { text: string; blocked?: boolean }) {
  const words = useMemo(() => text.split(/(\s+)/), [text])
  const [shown, setShown] = useState(0)

  useEffect(() => {
    setShown(0)
    if (!text) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setShown(words.length)
      return
    }
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= words.length) {
          clearInterval(timer)
          return n
        }
        return n + 2
      })
    }, REVEAL_MS_PER_WORD)
    return () => clearInterval(timer)
  }, [text, words.length])

  const complete = shown >= words.length

  return (
    <div
      role={complete ? undefined : 'button'}
      tabIndex={complete ? undefined : 0}
      onClick={() => setShown(words.length)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') setShown(words.length)
      }}
      className={cn(
        'whitespace-pre-wrap text-[15px] leading-relaxed',
        blocked ? 'text-amber-200/80' : 'text-white/85',
        !complete && 'cursor-pointer',
      )}
    >
      {words.slice(0, shown).join('')}
      {!complete && <span className="mike-caret" aria-hidden />}
    </div>
  )
}

/** The reads behind an answer, kept after the fact. */
function SettledTrace({
  trace,
  defaultOpen,
}: {
  trace: { id: string; label: string; receipt?: string }[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.015]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-[12px] text-white/45 transition-colors hover:text-white/70"
      >
        <span className="mike-trace-dot mike-trace-dot--done" aria-hidden />
        <span className="flex-1 truncate">
          {open ? 'What he read' : `Read ${trace.length} thing${trace.length === 1 ? '' : 's'} first`}
        </span>
        <span className="text-white/30">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-white/[0.06] px-3.5 py-3">
          {trace.map((row) => (
            <li key={row.id} className="flex items-baseline gap-2.5 text-[12px]">
              <span className="flex-1 text-white/60">{row.label}</span>
              {row.receipt && <span className="shrink-0 text-white/35">{row.receipt}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The current turn — every read appearing as it happens. */
function LiveTrace({ trace, thoughts }: { trace: { id: string; label: string; receipt?: string }[]; thoughts: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      {thoughts.map((thought, i) => (
        <p key={`${thought.slice(0, 12)}-${i}`} className="text-[14px] italic leading-relaxed text-white/45">
          {thought}
        </p>
      ))}
      {trace.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.015] px-3.5 py-3">
          {trace.map((row) => (
            <li key={row.id} className="mike-trace-row flex items-baseline gap-2.5 text-[12px]">
              <span
                className={cn('mike-trace-dot', row.receipt ? 'mike-trace-dot--done' : 'mike-trace-dot--live')}
                aria-hidden
              />
              <span className="flex-1 text-white/65">{row.label}</span>
              {row.receipt && <span className="shrink-0 text-white/35">{row.receipt}</span>}
            </li>
          ))}
        </ul>
      )}
      {trace.length === 0 && thoughts.length === 0 && (
        <p className="text-[13px] text-white/35">Working out where to look…</p>
      )}
    </div>
  )
}
