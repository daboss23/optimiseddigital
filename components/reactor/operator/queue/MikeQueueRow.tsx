'use client'

import { cn } from '@/lib/utils'
import { InfoTip } from '@/components/reactor/Explain'
import { MikeQueueActions } from '@/components/reactor/operator/queue/MikeQueueActions'
import { CONFIDENCE_LABEL, FAMILY_LABEL, type MikeQueueItem, type QueueFamily } from '@/lib/operator/queue'
import type { Accent } from '@/components/reactor/ui'

/* ----------------------------------------------------------------------------
   One decision, one row.

   Reads left to right on a desktop — rank, what to do, which creative, why, the
   numbers, how sure, and the button. On a phone it stacks into the same order
   top to bottom. It never scrolls sideways.

   Everything here is already condensed by `lib/operator/queue.ts`. The row does
   no truncation of its own, which is why the sentence always ends where Mike
   ended it rather than wherever the column happened to run out.
---------------------------------------------------------------------------- */

const FAMILY_ACCENT: Record<QueueFamily, Accent> = {
  REPLACE: 'pink',
  ITERATE: 'emerald',
  EXPLORE: 'violet',
  WATCH: 'amber',
  COLLECT: 'blue',
}

/**
 * Colour helps scanning; it never carries the meaning on its own. Every row
 * states its action and its confidence in words, so the queue reads identically
 * to somebody who cannot separate the magenta from the amber.
 */
function ActionBadge({ family }: { family: QueueFamily }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
        'border-[color:rgb(var(--acc)/0.35)] bg-[color:rgb(var(--acc)/0.08)] text-[color:rgb(var(--acc-hi))]',
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[color:rgb(var(--acc))]" aria-hidden="true" />
      {FAMILY_LABEL[family]}
    </span>
  )
}

const CONFIDENCE_CLASS: Record<MikeQueueItem['confidence'], string> = {
  strong: 'text-success',
  moderate: 'text-warning',
  low: 'text-white/55',
}

function ConfidenceLabel({ item }: { item: MikeQueueItem }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('text-[12.5px] font-medium', CONFIDENCE_CLASS[item.confidence])}>
        {CONFIDENCE_LABEL[item.confidence]}
      </span>
      <InfoTip label="Evidence strength" align="right">
        Based on {item.proposal.strength.primaryResults} results across{' '}
        {item.proposal.strength.completeDays} complete days, with{' '}
        {item.proposal.strength.stability} day-to-day stability. Open the evidence for the full
        comparison.
      </InfoTip>
    </span>
  )
}

function MetricChips({ item }: { item: MikeQueueItem }) {
  if (item.keyMetrics.length === 0) return null
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {item.keyMetrics.map((m) => (
        <li
          key={m.evidenceId}
          className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-md border border-border bg-background/40 px-1.5 py-0.5"
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.09em] text-white/45">
            {m.label}
          </span>
          <span
            className={cn(
              'font-display text-[12px] font-bold tabular',
              m.direction === 'good'
                ? 'text-success'
                : m.direction === 'bad'
                  ? 'text-danger'
                  : 'text-white/80',
            )}
          >
            {m.displayValue}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function MikeQueueRow({
  item,
  onOpenEvidence,
}: {
  item: MikeQueueItem
  onOpenEvidence: () => void
}) {
  return (
    <li
      className={cn(
        'group relative border-b border-border/70 px-4 py-3.5 transition-colors last:border-b-0 motion-reduce:transition-none',
        'hover:bg-white/[0.02] focus-within:bg-white/[0.02]',
        `acc-${FAMILY_ACCENT[item.family]}`,
      )}
    >
      {/* Priority hairline — the accent, at the intensity of a rule rather than a glow. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-3 left-0 w-px bg-[color:rgb(var(--acc)/0.55)]"
      />

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 xl:grid-cols-[2rem_6.25rem_minmax(9rem,1.1fr)_minmax(11rem,1.5fr)_minmax(12rem,0.95fr)_5rem_auto] xl:items-center xl:gap-y-0">
        {/* 1 · priority + action + confidence (mobile header row) */}
        <div className="flex items-center gap-2.5 xl:contents">
          <span className="font-display text-[12.5px] font-bold tabular text-white/55 xl:text-right">
            {String(item.priority).padStart(2, '0')}
          </span>
          <span className="xl:block">
            <ActionBadge family={item.family} />
          </span>
          <span className="ml-auto xl:hidden">
            <ConfidenceLabel item={item} />
          </span>
        </div>

        {/* 2 · creative — two lines rather than an ellipsis. A media buyer
            recognises an ad by its name, and "Systems Befo…" is not a name. */}
        <p
          className="min-w-0 text-[13.5px] font-semibold leading-snug text-white [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
          title={item.creativeName}
        >
          {item.creativeName}
        </p>

        {/* 3 · why */}
        <p className="min-w-0 text-[13px] leading-relaxed text-white/65">
          {item.shortReason}
          {item.isProvisional && (
            <span className="ml-1.5 whitespace-nowrap rounded border border-warning/30 bg-warning/[0.07] px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-warning/90">
              Provisional data
            </span>
          )}
          {item.returning && (
            <span className="ml-1.5 whitespace-nowrap rounded border border-border bg-background/40 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/50">
              Returning
            </span>
          )}
        </p>

        {/* 4 · evidence */}
        <MetricChips item={item} />

        {/* 5 · confidence (desktop column) */}
        <div className="hidden xl:block">
          <ConfidenceLabel item={item} />
        </div>

        {/* 6 · decision */}
        <MikeQueueActions item={item} onOpenEvidence={onOpenEvidence} />
      </div>
    </li>
  )
}
