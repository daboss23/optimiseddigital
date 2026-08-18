'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { FAMILY_LABEL } from '@/lib/operator/queue'
import { DISMISS_REASONS, type DecisionAction } from '@/lib/operator/types'
import type { DecisionRecord } from '@/lib/operator/memory'

/* ----------------------------------------------------------------------------
   Completed and dismissed.

   Deliberately quieter than the queue above it: no accents, no badges, smaller
   type. It is a record, not a second board — the only reason to look at it is
   to check what you already decided.
---------------------------------------------------------------------------- */

const ACTION_LABEL: Record<DecisionAction, string> = {
  approved: 'Approved',
  edited: 'Approved with edits',
  dismissed: 'Dismissed',
  snoozed: 'Snoozed',
}

const reasonLabel = (id?: string) =>
  DISMISS_REASONS.find((r) => r.id === id)?.label ?? null

function when(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function HistoryRow({ record }: { record: DecisionRecord }) {
  const { decision, creativeNames } = record
  const family = FAMILY_LABEL[decision.type as keyof typeof FAMILY_LABEL] ?? decision.type
  const reason = reasonLabel(decision.reasonCode)

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/50 px-4 py-2.5 last:border-b-0">
      <span className="w-[4.5rem] shrink-0 text-[11.5px] font-medium uppercase tracking-[0.1em] text-white/35">
        {family}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-white/70">
        {creativeNames.join(', ')}
      </span>
      <span className="text-[12.5px] text-white/55">
        {ACTION_LABEL[decision.action]}
        {reason && <span className="text-white/35"> · {reason}</span>}
        {decision.snoozedUntil && <span className="text-white/35"> · until {decision.snoozedUntil}</span>}
      </span>
      <span className="w-[5.5rem] shrink-0 text-right text-[12px] tabular text-white/30">
        {when(decision.decidedAt)}
      </span>
    </li>
  )
}

export function MikeDecisionHistory() {
  const { history } = useOperator()
  const [open, setOpen] = useState(false)

  if (history.length === 0) return null

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
      >
        <span className="text-[12px] font-medium text-white/45">
          Completed and dismissed ({history.length})
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-white/30 transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul className="border-t border-border/60 bg-background/20">
          {history.map((record, i) => (
            <HistoryRow key={`${record.decision.proposalId}-${i}`} record={record} />
          ))}
        </ul>
      )}
    </div>
  )
}
