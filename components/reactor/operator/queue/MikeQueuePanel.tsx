'use client'

import type { CSSProperties } from 'react'
import { Panel } from '@/components/reactor/ui'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { MikeQueue } from '@/components/reactor/operator/queue/MikeQueue'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   The queue's containment cell.

   When Mike is holding open decisions the whole card comes alive — a slow,
   asymmetric breath of aurora light behind the glass plus a current that drifts
   around the rim (see `.mike-charge` in globals.css). It rests completely when
   the queue is clear, off the clock, or still loading, so the light always
   MEANS "there is something here to decide" rather than idling as decoration.

   The glow lives on THIS wrapper, not inside <Panel>: the panel clips its own
   rounded overflow, so a halo can only spill from a layer wrapped around it.
   `--mike-load` (0–1) hands the CSS the weight of the queue, so three pending
   actions read a touch hotter than one.
---------------------------------------------------------------------------- */

export function MikeQueuePanel() {
  const { ready, paused, queue } = useOperator()
  const charged = ready && !paused && queue.length > 0

  return (
    <div
      className={cn('mike-charge', charged && 'mike-charge--on')}
      style={charged ? ({ '--mike-load': Math.min(queue.length, 4) / 4 } as CSSProperties) : undefined}
    >
      <Panel>
        <MikeQueue />
      </Panel>
    </div>
  )
}
