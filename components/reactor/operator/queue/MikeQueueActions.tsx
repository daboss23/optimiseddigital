'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Clock,
  Eye,
  MoreHorizontal,
  Pencil,
  Undo2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { DismissModal, EditModal, SnoozeModal } from '@/components/reactor/operator/modals'
import type { MikeQueueItem } from '@/lib/operator/queue'

/* ----------------------------------------------------------------------------
   The controls on a row.

   One primary button, one Edit, and everything else behind an overflow. Three
   equally prominent buttons is three decisions to make about a decision, which
   is how a queue stops being faster than reading the account yourself.

   WATCH and COLLECT do not get "Approve". Their primary control acknowledges
   and creates nothing — labelling a non-action as an approval teaches people
   that approving here doesn't mean very much.
---------------------------------------------------------------------------- */

function Overflow({ item, onOpenEvidence }: { item: MikeQueueItem; onOpenEvidence: () => void }) {
  const [open, setOpen] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const entry =
    'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-white/75 transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:outline-none motion-reduce:transition-none'

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label={`More options for ${item.creativeName}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-background/40 text-white/45 transition-colors hover:border-primary/40 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
      >
        <MoreHorizontal size={15} />
      </button>

      {open && (
        <div
          role="menu"
          className="glass shadow-panel absolute right-0 z-30 mt-1.5 w-48 overflow-hidden rounded-xl border border-border py-1"
        >
          <button
            type="button"
            role="menuitem"
            className={entry}
            onClick={() => {
              setOpen(false)
              onOpenEvidence()
            }}
          >
            <Eye size={13} /> View evidence
          </button>
          <button
            type="button"
            role="menuitem"
            className={entry}
            onClick={() => {
              setOpen(false)
              setSnoozing(true)
            }}
          >
            <Clock size={13} /> Snooze
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn(entry, 'text-white/60 hover:text-danger')}
            onClick={() => {
              setOpen(false)
              setDismissing(true)
            }}
          >
            <X size={13} /> Dismiss
          </button>
        </div>
      )}

      <DismissModal
        open={dismissing}
        onClose={() => setDismissing(false)}
        proposal={item.proposal}
      />
      <SnoozeModal open={snoozing} onClose={() => setSnoozing(false)} proposal={item.proposal} />
    </div>
  )
}

export function MikeQueueActions({
  item,
  onOpenEvidence,
}: {
  item: MikeQueueItem
  onOpenEvidence: () => void
}) {
  const { approve, acknowledge, justDecided, undo } = useOperator()
  const [editing, setEditing] = useState(false)

  const decided = justDecided?.subjectKey === item.subjectKey

  // Confirmed in place, with the way back, before the row leaves the board.
  if (decided) {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-success">
          <Check size={13} />
          {justDecided.label}
        </span>
        <button
          type="button"
          onClick={undo}
          className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2.5 text-[12.5px] font-medium text-white/70 transition-colors hover:border-primary/40 hover:text-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
        >
          <Undo2 size={12} /> Undo
        </button>
      </div>
    )
  }

  const runPrimary = () => {
    if (item.primaryAction.intent === 'draft') approve(item.proposal)
    else acknowledge(item.proposal)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:flex-nowrap">
      <button
        type="button"
        onClick={runPrimary}
        className={cn(
          'flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none sm:min-h-[36px] xl:flex-none',
          item.primaryAction.intent === 'draft'
            ? 'border-primary/40 bg-primary/[0.12] text-glow hover:border-primary/70 hover:bg-primary/[0.18]'
            : 'border-border bg-background/40 text-white/75 hover:border-[color:rgb(var(--acc)/0.5)] hover:text-white',
        )}
      >
        {item.primaryAction.intent === 'draft' ? <Check size={13} /> : <Eye size={13} />}
        {item.primaryAction.label}
      </button>

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 text-[12.5px] font-medium text-white/70 transition-colors hover:border-primary/40 hover:text-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none sm:min-h-[36px]"
      >
        <Pencil size={12} /> Edit
      </button>

      <Overflow item={item} onOpenEvidence={onOpenEvidence} />

      {/* The evidence affordance stays visible on its own outside the overflow —
          verification should never be a thing you have to go looking for. */}
      <button
        type="button"
        onClick={onOpenEvidence}
        className="flex min-h-[44px] items-center gap-0.5 rounded-lg px-1 text-[12.5px] font-medium text-white/45 transition-colors hover:text-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none sm:min-h-[36px] xl:hidden"
      >
        View evidence
        <ChevronRight size={13} />
      </button>

      <EditModal open={editing} onClose={() => setEditing(false)} proposal={item.proposal} />
    </div>
  )
}
