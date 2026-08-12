'use client'

import { Check, Loader2, PauseCircle } from 'lucide-react'
import { Pill } from '@/components/reactor/ui'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { ProposalCard } from '@/components/reactor/operator/ProposalCard'
import { OpeningRemark } from '@/components/reactor/operator/OpeningRemark'

/* ----------------------------------------------------------------------------
   The approval queue.

   Up to three cards, in the order Mike wants them read — which is not
   necessarily the order the maths ranked them, and the MIKE'S PICK tag says so
   when the two disagree.

   Every state here is a real one with something useful in it. Loading is a
   pulse, not a frozen panel. Empty means everything is actioned and says so.
   Paused says he is off the clock and leaves whatever is already on the board
   fully actionable, because pausing him is not the same as retracting his work.
---------------------------------------------------------------------------- */

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-border bg-surface/30 p-4"
          aria-hidden="true"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-6 w-24 rounded-full bg-white/[0.06]" />
            <div className="h-5 w-16 rounded-full bg-white/[0.04]" />
          </div>
          <div className="h-5 w-4/5 rounded bg-white/[0.07]" />
          <div className="mt-2.5 h-3.5 w-full rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-3.5 w-2/3 rounded bg-white/[0.04]" />
          <div className="mt-3 h-24 rounded-lg bg-white/[0.03]" />
          <div className="mt-4 h-9 rounded-lg bg-white/[0.05]" />
        </div>
      ))}
    </div>
  )
}

/**
 * The panel-header count. Same selector as the status line and the tile — the
 * three cannot disagree because there is only one number.
 */
export function QueueCountPill() {
  const { ready, actionsRequired, paused } = useOperator()
  if (!ready) return <Pill tone="default">Reading…</Pill>
  if (paused) return <Pill tone="warning">Off the clock</Pill>
  return (
    <Pill tone="primary">
      {actionsRequired} {actionsRequired === 1 ? 'approval' : 'approvals'}
    </Pill>
  )
}

export function ProposalQueue() {
  const { ready, proposals, mikesPickId, paused, narrating } = useOperator()

  if (!ready) return <Skeleton />

  return (
    <>
      <OpeningRemark />

      {proposals.length === 0 ? (
        <div className="grid place-items-center px-6 py-14 text-center">
          {paused ? (
            <>
              <PauseCircle size={30} className="mb-3 text-white/25" />
              <p className="max-w-sm text-[14px] text-white/60">
                Mike is off the clock. Nothing new is being raised — anything already on the board
                stays actionable, and resuming brings him straight back.
              </p>
            </>
          ) : (
            <>
              <Check size={30} className="mb-3 text-success/40" />
              <p className="max-w-sm text-[14px] text-white/60">
                Every move is actioned. The next one appears as soon as a rule clears against a
                complete delivery window.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {narrating && (
            <p className="flex items-center gap-2 px-5 pt-4 text-[12.5px] text-glow/60">
              <Loader2 size={12} className="animate-spin" />
              Mike is reading the account — the numbers below are already final.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
            {proposals.map((p, i) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                rank={i + 1}
                isMikesPick={p.id === mikesPickId}
              />
            ))}
            {proposals.length < 3 && (
              <div className="grid place-items-center rounded-xl border border-dashed border-border p-6 text-center">
                <Pill tone="default">Slot open</Pill>
                <p className="mt-2 max-w-[15rem] text-[12px] leading-relaxed text-white/50">
                  Nothing else cleared a rule against a complete window. An empty slot is a real
                  answer, not a gap to be filled.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
