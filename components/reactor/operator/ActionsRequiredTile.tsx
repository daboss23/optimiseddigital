'use client'

import Link from 'next/link'
import { Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TrendBadge, accentClass } from '@/components/reactor/ui'
import { InfoTip } from '@/components/reactor/Explain'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { OPERATOR_QUEUE_ANCHOR } from '@/components/reactor/operator/MikeHeader'

/* ----------------------------------------------------------------------------
   The Actions Required pulse tile.

   Same tile as its five neighbours, with one difference that matters: its count
   comes from the SAME derived selector the header count and the visible cards
   read from. When those were three independent numbers they disagreed inside a
   week, and a dashboard that contradicts itself in one viewport is worse than
   one that says nothing at all.
---------------------------------------------------------------------------- */

export function ActionsRequiredTile({ className }: { className?: string }) {
  const { ready, actionsRequired, paused } = useOperator()

  const state = !ready
    ? 'Reading the account'
    : paused
      ? 'Mike is off the clock'
      : actionsRequired > 0
        ? 'Awaiting your call'
        : 'All clear'

  return (
    <Link
      href={`#${OPERATOR_QUEUE_ANCHOR}`}
      className={cn('kpi-card group animate-fade-up block p-5', accentClass.violet, className)}
    >
      <span className="kpi-bloom" aria-hidden="true" />
      <span className="kpi-grid" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="kpi-icon">
          <Target size={19} />
        </span>
        <TrendBadge trend="flat" value={ready ? `${actionsRequired}` : '—'} />
      </div>
      <p className="relative mt-3.5 flex min-h-[2.2em] items-start gap-1 text-[11.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-white/85">
        Actions required
      </p>
      <span
        className={cn(
          'count-up relative mt-1 block font-display text-[2.35rem] font-bold leading-none tracking-tight tabular text-white',
          !ready && 'animate-pulse text-white/30',
        )}
      >
        {ready ? actionsRequired : '—'}
      </span>
      <p className="relative mt-2 flex items-center gap-1.5 text-[12.5px] text-white/60">
        {state}
        <InfoTip label="Actions required" align="right">
          Proposals on the board that have not been approved, dismissed or snoozed. The same number
          the Mike Delight status line shows, from the same selector — there is only one count.
        </InfoTip>
      </p>
    </Link>
  )
}
