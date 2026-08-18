'use client'

import { Loader2, Pause, Play, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DemoBadge } from '@/components/reactor/Explain'
import { useOperator, type QueueFilter } from '@/components/reactor/operator/OperatorProvider'

/* ----------------------------------------------------------------------------
   The summary.

   A count, a sentence describing the count, and the controls. That is the whole
   of Mike's presence above the queue.

   The headline is generated from the queue itself rather than written by Mike —
   it is arithmetic, and a model asked to phrase arithmetic will eventually
   phrase it wrongly. His judgement goes into the rows. If he has a genuine view
   on the account it appears as ONE sentence underneath, and most mornings it
   does not appear at all, which is correct.
---------------------------------------------------------------------------- */

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'dismissed', label: 'Dismissed' },
]

function updatedLabel(at: number | null): string {
  if (!at) return ''
  const mins = Math.floor((Date.now() - at) / 60_000)
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `Updated ${mins} min ago`
  const hrs = Math.round(mins / 60)
  return `Updated ${hrs}h ago`
}

export function MikeQueueSummary() {
  const {
    ready,
    paused,
    queue,
    summary,
    remark,
    filter,
    setFilter,
    lastUpdated,
    refresh,
    refreshing,
    togglePause,
    metadata,
    awayDays,
    needsCatchup,
    catchup,
    catchingUp,
    runCatchup,
  } = useOperator()

  const demanding = ready && !paused && queue.length > 0

  return (
    <div
      className={cn(
        'mike-summary px-5 py-5 sm:py-6',
        demanding && 'mike-summary--live',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-glow/70">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                paused ? 'bg-white/30' : 'animate-pulse-glow bg-success motion-reduce:animate-none',
              )}
              aria-hidden="true"
            />
            Mike&rsquo;s queue
            {paused && <span className="text-white/40">· off the clock</span>}
          </p>

          <h2 className="mt-2.5 font-display text-[26px] font-bold leading-[1.12] tracking-tight text-white sm:text-[30px] md:text-[34px]">
            {ready ? summary.headline : 'Reading the account…'}
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-white/70">
            {ready ? summary.supporting : 'Mike is working through the last complete delivery window.'}
          </p>

          {/* Mike's own line. One sentence, or nothing at all. */}
          {remark && (
            <p className="mt-3 border-l-2 border-[color:rgb(var(--lg-cyan)/0.55)] pl-3 text-[13.5px] leading-relaxed text-white/75">
              {remark}
            </p>
          )}

          {catchup && (
            <p className="mt-3 border-l-2 border-[color:rgb(var(--lg-violet)/0.6)] pl-3 text-[13.5px] leading-relaxed text-white/75">
              {catchup.briefing}
            </p>
          )}
        </div>

        {/* Wraps rather than holding its width: on a phone this row sits under
            the headline, and `shrink-0` pushed the pause control off the panel. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {metadata?.origin === 'seeded' && <DemoBadge />}

          {needsCatchup && !catchup && (
            <button
              type="button"
              onClick={() => void runCatchup()}
              disabled={catchingUp}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/10 px-3 text-[12.5px] font-medium text-glow transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 disabled:opacity-50 motion-reduce:transition-none"
            >
              {catchingUp ? <Loader2 size={12} className="animate-spin" /> : null}
              Catch me up · {awayDays}d away
            </button>
          )}

          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || !ready}
            className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-background/40 px-3 text-[12.5px] font-medium text-white/65 transition-colors hover:border-primary/40 hover:text-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 disabled:opacity-50 motion-reduce:transition-none"
          >
            <RefreshCw
              size={12}
              className={cn(refreshing && 'animate-spin motion-reduce:animate-none')}
            />
            <span className="hidden sm:inline">Refresh analysis</span>
            <span className="sm:hidden">Refresh</span>
          </button>

          <button
            type="button"
            onClick={togglePause}
            aria-pressed={paused}
            title={paused ? 'Put Mike back on the clock' : 'Stop Mike raising new decisions'}
            className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-background/40 text-white/45 transition-colors hover:border-primary/40 hover:text-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter decisions"
          className="flex items-center gap-1 rounded-lg border border-border bg-background/40 p-1"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'min-h-[32px] rounded-md px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none',
                filter === f.id
                  ? 'bg-primary/[0.14] text-glow'
                  : 'text-white/50 hover:text-white/80',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {lastUpdated && (
          <span className="text-[12px] tabular text-white/35">{updatedLabel(lastUpdated)}</span>
        )}
      </div>
    </div>
  )
}
