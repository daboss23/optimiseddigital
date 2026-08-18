'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  BarChart3,
  Check,
  Lightbulb,
  RefreshCw,
  Rocket,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pill, accentClass } from '@/components/reactor/ui'
import { ConfidenceChip } from '@/components/reactor/Explain'
import type { MoveType, NextMove } from '@/lib/creative-ops'

/* ----------------------------------------------------------------------------
   Your Next Moves — the primary feature of the dashboard.

   Three ranked recommendations, each with the evidence that produced it, a
   confidence level, one primary action and the secondary controls that let a
   decision actually be made: open the evidence, approve it, or dismiss it.
   Approve/dismiss is local state — the move leaves the surface immediately so
   the three cards always show live priorities rather than a stale backlog.
---------------------------------------------------------------------------- */

const MOVE_ICONS: Record<MoveType, LucideIcon> = {
  Scale: Rocket,
  Iterate: RefreshCw,
  Replace: Sparkles,
  Explore: Lightbulb,
}

type MoveState = 'open' | 'approved' | 'dismissed'

export function NextMoves({ moves }: { moves: NextMove[] }) {
  const [state, setState] = useState<Record<string, MoveState>>({})

  const visible = moves.filter((m) => state[m.title] !== 'dismissed')

  if (visible.length === 0) {
    // "Every move is actioned" is only true if there were moves to action. On a
    // platform with nothing connected the honest message is that there is not
    // yet enough evidence to rank anything.
    const neverHadAny = moves.length === 0
    return (
      <div className="grid place-items-center px-6 py-14 text-center">
        {neverHadAny ? (
          <Lightbulb size={30} className="mb-3 text-white/25" />
        ) : (
          <Check size={30} className="mb-3 text-success/40" />
        )}
        <p className="max-w-sm text-[14px] text-white/60">
          {neverHadAny
            ? 'No moves to rank yet. Connect your Meta ad account so the reactor can read what is running, or fire a campaign to create the first concepts.'
            : 'Every move is actioned. New priorities appear as the next results land — or fire the Reactor to generate fresh concepts now.'}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
      {visible.map((m, i) => {
        const Icon = MOVE_ICONS[m.type]
        const approved = state[m.title] === 'approved'
        return (
          <article
            key={m.title}
            className={cn(
              'recommendation-card glass-hover flex flex-col rounded-xl border border-border bg-surface/40 p-4',
              accentClass[m.accent],
              approved && 'border-success/40',
            )}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="angle-tile h-7 w-7">
                  <Icon size={13} />
                </span>
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-white/85">
                  {m.type}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="font-display text-[12px] font-bold tabular text-white/50">
                  #{i + 1}
                </span>
                <ConfidenceChip level={m.confidence} />
              </span>
            </div>

            <h3 className="font-display text-[17px] font-semibold leading-snug text-white">
              {m.title}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-white/65">{m.rationale}</p>

            <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">
                <BarChart3 size={11} />
                Evidence
              </p>
              <ul className="space-y-1">
                {m.evidence.map((e) => (
                  <li key={e} className="flex gap-2 text-[12.5px] leading-relaxed text-white/80">
                    <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-[color:rgb(var(--acc))]" />
                    {e}
                  </li>
                ))}
              </ul>
            </div>

            <Link href={m.primaryCta.href} className="brief-cta mt-4">
              {m.primaryCta.label}
              <ArrowUpRight size={14} />
            </Link>

            <div className="mt-2 flex items-center gap-2">
              <Link
                href={m.evidenceHref}
                hidden={m.primaryCta.href === m.evidenceHref}
                className="flex-1 rounded-lg border border-border bg-background/40 px-2 py-2.5 text-center text-[12.5px] font-medium text-white/75 transition-colors hover:border-primary/40 hover:text-glow"
              >
                Open evidence
              </Link>
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, [m.title]: 'approved' }))}
                aria-pressed={approved}
                className={cn(
                  'grid h-[34px] w-[34px] place-items-center rounded-lg border transition-colors',
                  approved
                    ? 'border-success/50 bg-success/15 text-success'
                    : 'border-border bg-background/40 text-white/45 hover:border-success/40 hover:text-success',
                )}
                title="Approve this move"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, [m.title]: 'dismissed' }))}
                className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-border bg-background/40 text-white/45 transition-colors hover:border-danger/40 hover:text-danger"
                title="Dismiss this move"
              >
                <X size={14} />
              </button>
            </div>

            {approved && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-success">
                <Check size={12} /> Approved — queued for the next run
              </p>
            )}
          </article>
        )
      })}
      {visible.length < 3 && (
        <div className="grid place-items-center rounded-xl border border-dashed border-border p-6 text-center">
          <Pill tone="default">Slot open</Pill>
          <p className="mt-2 max-w-[15rem] text-[12px] leading-relaxed text-white/50">
            A new priority takes this slot as soon as the next evaluation window closes.
          </p>
        </div>
      )}
    </div>
  )
}
