'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pill, accentClass } from '@/components/reactor/ui'
import {
  STATUS_DEFS,
  thresholdSummary,
  type CreativeStatus,
  type StatusThresholds,
} from '@/lib/creative-status'

/* ----------------------------------------------------------------------------
   Click a status, get the whole story: what the word means, the thresholds it
   was assigned under, the comparison period, and the evidence sentence from
   this creative's own numbers. A colour is never the explanation.
---------------------------------------------------------------------------- */

export function StatusExplainer({
  status,
  reason,
  thresholds,
  creativeName,
  comparisonPeriod = 'last 7 days vs the previous 7 days',
}: {
  status: CreativeStatus
  reason: string
  thresholds: StatusThresholds
  creativeName: string
  comparisonPeriod?: string
}) {
  const [open, setOpen] = useState(false)
  const def = STATUS_DEFS[status]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
        title={`Why this creative is ${def.label.toLowerCase()}`}
      >
        <Pill tone={def.tone}>
          <span className={cn('h-1.5 w-1.5 rounded-full bg-current', accentClass[def.accent])} />
          {def.label}
        </Pill>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${def.label} — why`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass reactor-panel shadow-panel w-full max-w-lg overflow-hidden rounded-t-2xl text-left sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <Pill tone={def.tone}>{def.label}</Pill>
                </div>
                <p className="font-display text-[15px] font-semibold text-white">{creativeName}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg border border-border text-white/50 transition-colors hover:text-white"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 p-5">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  What it means
                </p>
                <p className="text-sm leading-relaxed text-white/70">{def.meaning}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface/40 p-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  Evidence
                </p>
                <p className="text-sm leading-relaxed text-white/80">{reason}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    Thresholds
                  </p>
                  <p className="text-[13px] leading-relaxed text-white/75">
                    {thresholdSummary(thresholds)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
                    Comparison period
                  </p>
                  <p className="text-[13px] leading-relaxed text-white/75">{comparisonPeriod}</p>
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-white/50">
                Thresholds are configurable per brand and campaign. No creative is called a winner
                or a loser until minimum spend, time live and result count have all cleared.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
