'use client'

import { useState } from 'react'
import { ChevronDown, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'

/* ----------------------------------------------------------------------------
   Mike's reasoning, observable over time.

   `leadReason` is logged here and nowhere else — it is his answer to "why did
   you put that one first", and it is deliberately not shown on the card,
   because a card that explains its own ordering is arguing with the reader.
   Kept in one place, over weeks, it is the only way to tell whether his
   judgement is any good.

   Alongside it: what the pipeline held back and why, what recovered, and how
   many numerals the validator resolved on each attempt. A rejected card is then
   a five-minute fix rather than an afternoon of guessing which figure it
   objected to.

   Collapsed by default. This is instrumentation, not interface.
---------------------------------------------------------------------------- */

export function DebugPanel() {
  const { debug, output, paused } = useOperator()
  const [open, setOpen] = useState(false)

  if (!debug && !output) return null
  const suppressed = debug?.suppressed ?? []
  const notes = debug?.notes ?? output?.notes ?? []

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/40">
          <Terminal size={12} />
          Operator trace
          {debug?.degraded && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10.5px] normal-case tracking-normal text-warning">
              running on computed cards
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={cn('shrink-0 text-white/30 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-5 py-4 text-[12.5px] leading-relaxed">
          {debug?.leadReason && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                Why he led with that one
              </p>
              <p className="text-white/70">{debug.leadReason}</p>
            </div>
          )}

          {debug?.degradedReason && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-warning/80">
                Narration unavailable
              </p>
              <p className="text-white/70">{debug.degradedReason}</p>
            </div>
          )}

          {(debug?.attempts.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                Validation
              </p>
              <ul className="space-y-1.5">
                {debug!.attempts.map((a, i) => (
                  <li key={i} className="text-white/65">
                    Attempt {i + 1}: {a.resolutionCount} numerals resolved,{' '}
                    {a.failures.length === 0 ? (
                      <span className="text-success">no failures</span>
                    ) : (
                      <span className="text-danger">{a.failures.length} failed</span>
                    )}
                    {a.failures.length > 0 && (
                      <ul className="mt-1 space-y-1 pl-4 text-[12px] text-white/50">
                        {a.failures.map((f, j) => (
                          <li key={j}>
                            <span className="font-mono text-[11px] text-white/40">{f.code}</span> —{' '}
                            {f.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                Not proposals
              </p>
              <ul className="space-y-1 text-white/65">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {suppressed.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                Held back
              </p>
              <ul className="space-y-1 text-white/65">
                {suppressed.map((s, i) => (
                  <li key={i}>
                    <span className="text-white/85">{s.label}</span> — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-[11.5px] text-white/40">
            <span>Evaluated {output?.evaluated.length ?? 0} creatives</span>
            <span>Complete through {output?.maturity.completeThrough ?? '—'}</span>
            <span>
              {output?.maturity.provisionalDates.length ?? 0} provisional{' '}
              {(output?.maturity.provisionalDates.length ?? 0) === 1 ? 'date' : 'dates'}
            </span>
            {paused && <span className="text-warning/80">Paused</span>}
            {debug?.model && <span>Narration: {debug.model}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
