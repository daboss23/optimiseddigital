'use client'

import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'

/* ----------------------------------------------------------------------------
   MIKE DELIGHT · ACTIVE · 3 APPROVALS

   The whole of his presence in the interface. No separate page, no drawer, no
   avatar, no chatbot — he is a status line and a set of cards, because he is a
   colleague doing a job rather than a product feature that needs showing off.

   Clicking the count scrolls to the queue. The pause control stops NEW
   proposals and leaves everything already raised fully actionable: pausing him
   is not the same as retracting his work.
---------------------------------------------------------------------------- */

export const OPERATOR_QUEUE_ANCHOR = 'your-next-moves'

export function MikeHeader() {
  const { ready, paused, actionsRequired, togglePause } = useOperator()

  const scrollToQueue = () => {
    document
      .getElementById(OPERATOR_QUEUE_ANCHOR)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const status = !ready ? 'READING' : paused ? 'OFF THE CLOCK' : 'ACTIVE'

  return (
    <span className="reactor-pill inline-flex items-center gap-0 rounded-full border border-border bg-surface/60 py-0 pl-0 pr-0 text-[12px] font-medium">
      <button
        type="button"
        onClick={scrollToQueue}
        className="flex min-h-[34px] items-center gap-2 rounded-l-full px-3 py-1 transition-colors hover:bg-white/[0.04]"
        title="Jump to the approval queue"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            paused ? 'bg-white/30' : 'animate-pulse-glow bg-success',
          )}
        />
        <span className="font-display text-[11.5px] font-bold uppercase tracking-[0.16em] text-white/85">
          Mike Delight
        </span>
        <span className="text-white/20">·</span>
        <span
          className={cn(
            'text-[11.5px] font-semibold uppercase tracking-[0.14em]',
            paused ? 'text-white/45' : 'text-success',
          )}
        >
          {status}
        </span>
        {!paused && ready && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-glow">
              {actionsRequired} {actionsRequired === 1 ? 'approval' : 'approvals'}
            </span>
          </>
        )}
      </button>
      <button
        type="button"
        onClick={togglePause}
        aria-pressed={paused}
        title={paused ? 'Put Mike back on the clock' : 'Stop Mike raising new proposals'}
        className="grid h-[34px] w-9 place-items-center rounded-r-full border-l border-border text-white/45 transition-colors hover:text-glow"
      >
        {paused ? <Play size={12} /> : <Pause size={12} />}
      </button>
    </span>
  )
}
