'use client'

import { useState } from 'react'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { MikeQueueSummary } from '@/components/reactor/operator/queue/MikeQueueSummary'
import { MikeQueueRow } from '@/components/reactor/operator/queue/MikeQueueRow'
import { MikeEvidenceDrawer } from '@/components/reactor/operator/queue/MikeEvidenceDrawer'
import { MikeDecisionHistory } from '@/components/reactor/operator/queue/MikeDecisionHistory'
import { MikeEmptyState } from '@/components/reactor/operator/queue/MikeEmptyState'
import type { MikeQueueItem } from '@/lib/operator/queue'

/* ----------------------------------------------------------------------------
   Mike's decision queue.

   Four regions and nothing else: the summary, the queue, the history, and the
   drawer that opens over the top of them. No charts, no KPI tiles, no
   diagnostics — those all live one page over, and the reason this surface works
   is that it does one job.
---------------------------------------------------------------------------- */

/** Three row skeletons. A full-page spinner tells you nothing is happening. */
function QueueSkeleton() {
  return (
    <ul aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="border-b border-border/70 px-4 py-4 last:border-b-0">
          <div className="flex animate-pulse items-center gap-4 motion-reduce:animate-none">
            <div className="h-3 w-6 rounded bg-white/[0.06]" />
            <div className="h-6 w-20 rounded-md bg-white/[0.06]" />
            <div className="h-3.5 w-40 rounded bg-white/[0.05]" />
            <div className="hidden h-3.5 flex-1 rounded bg-white/[0.035] xl:block" />
            <div className="hidden h-6 w-32 rounded bg-white/[0.04] xl:block" />
            <div className="ml-auto h-9 w-24 rounded-lg bg-white/[0.05]" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function MikeQueue() {
  const { ready, queue, filter, history, paused, metadata } = useOperator()
  const [openEvidence, setOpenEvidence] = useState<MikeQueueItem | null>(null)

  const body = () => {
    if (!ready) return <QueueSkeleton />

    // Done and Dismissed are read from the decision log, which the history
    // section already renders — the filter scrolls attention there rather than
    // building a second, subtly different list of the same records.
    if (filter !== 'open') {
      return history.length === 0 ? (
        <MikeEmptyState variant="filtered" />
      ) : (
        <div className="px-5 py-6 text-[13px] leading-relaxed text-white/55">
          {filter === 'done' ? 'Approved and snoozed' : 'Dismissed'} decisions are listed under
          Completed and dismissed below.
        </div>
      )
    }

    if (queue.length === 0) {
      if (!metadata) return <MikeEmptyState variant="disconnected" />
      return <MikeEmptyState variant={paused ? 'paused' : 'clear'} />
    }

    return (
      <ul>
        {queue.map((item) => (
          <MikeQueueRow
            key={item.id}
            item={item}
            onOpenEvidence={() => setOpenEvidence(item)}
          />
        ))}
      </ul>
    )
  }

  return (
    <>
      <MikeQueueSummary />
      {body()}
      <MikeDecisionHistory />
      <MikeEvidenceDrawer item={openEvidence} onClose={() => setOpenEvidence(null)} />
    </>
  )
}
