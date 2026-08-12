'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  BarChart3,
  Check,
  Clock,
  Eye,
  Lightbulb,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pill, accentClass } from '@/components/reactor/ui'
import { InfoTip } from '@/components/reactor/Explain'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import {
  accentFor,
  EvidenceRows,
  isWatch,
  proposalLabel,
  SecondaryButton,
  StrengthChip,
} from '@/components/reactor/operator/shell'
import { AskMikeModal, DismissModal, EditModal, SnoozeModal } from '@/components/reactor/operator/modals'
import type { Proposal, ProposalType } from '@/lib/operator/types'

/* ----------------------------------------------------------------------------
   One proposal, as a card.

   The existing dashboard card, unchanged in shape: action type, priority, the
   recommendation, the reasoning, evidence rows, a strength label, one primary
   action and the controls that let a decision actually be made.

   What changed underneath it is that none of it is written by hand any more.
   The numbers come from structured evidence. The words come from Mike, or from
   the computed template when he is not available. And WATCH gets its own header
   and its own primary action, because "keep watching" and "replace this" are
   different instructions and a card that blurs them is worse than no card.
---------------------------------------------------------------------------- */

const TYPE_ICON: Record<ProposalType, LucideIcon> = {
  ITERATE: RefreshCw,
  REPLACE: Sparkles,
  EXPLORE: Lightbulb,
  COLLECT: Clock,
}

export function ProposalCard({
  proposal,
  rank,
  isMikesPick,
}: {
  proposal: Proposal
  rank: number
  isMikesPick: boolean
}) {
  const { cardFor, approve, keepWatching, learned, metadata } = useOperator()
  const [editing, setEditing] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [snoozing, setSnoozing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  const narrated = cardFor(proposal.id)
  const words = narrated ?? proposal.fallback
  const watch = isWatch(proposal)
  const Icon = watch ? Eye : TYPE_ICON[proposal.type]
  const accent = accentFor(proposal)
  const resultType = proposal.evidence[0]?.source.baselineKey?.primaryResultType ?? 'lead'

  // The default this operator's own editing history has moved, surfaced on the
  // card rather than applied silently.
  const learnedNote = learned.find((l) => l.param === 'variations')

  const runApprove = () => {
    setBusy(true)
    try {
      approve(proposal)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={cn(
        'recommendation-card glass-hover flex flex-col rounded-xl border p-4',
        accentClass[accent],
        // WATCH is the same colour family at lower intensity: a quieter member
        // of the fatigue family, not a new signal colour on the dashboard.
        watch ? 'border-dashed border-[color:rgb(var(--acc)/0.28)]' : 'border-border',
        'bg-surface/40',
      )}
      data-priority={proposal.type === 'REPLACE' && !watch ? 'Critical' : 'High'}
    >
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('angle-tile h-7 w-7 shrink-0', watch && 'opacity-70')}>
            <Icon size={13} />
          </span>
          <span
            className={cn(
              'truncate text-[11.5px] font-semibold uppercase tracking-[0.14em]',
              watch ? 'text-white/65' : 'text-white/85',
            )}
          >
            {proposalLabel(proposal)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {proposal.returning && (
            <Pill tone="default">
              <Clock size={11} /> Returning
            </Pill>
          )}
          {/* Read straight off `params`, so it always matches the brief Approve
              will actually stage — including after an edit. */}
          {proposal.type !== 'COLLECT' && (
            <span
              title={`${proposal.params.variations} variations in the draft`}
              className="rounded-full border border-border bg-background/40 px-2 py-0.5 font-display text-[11px] font-bold tabular text-white/60"
            >
              ×{proposal.params.variations}
            </span>
          )}
          <span className="font-display text-[12px] font-bold tabular text-white/50">#{rank}</span>
        </span>
      </div>

      {isMikesPick && (
        <span className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-glow">
          Mike&rsquo;s pick
          <InfoTip label="Mike's pick" align="right">
            The maths ranked another card first. Mike put this one at the top because he thinks it
            is what matters most today — that judgement is his to make.
          </InfoTip>
        </span>
      )}

      {/* ── the move ───────────────────────────────────────────────────────── */}
      <h3 className="font-display text-[17px] font-semibold leading-snug text-white">
        {words.recommendation}
      </h3>

      {watch && (
        <p className="mt-2 rounded-lg border border-[color:rgb(var(--acc)/0.2)] bg-[color:rgb(var(--acc)/0.05)] px-2.5 py-2 text-[12.5px] leading-relaxed text-white/70">
          Short-term deterioration detected. The confirmation window is not strong enough to replace
          it yet.
        </p>
      )}

      <p className="mt-2 text-[13px] leading-relaxed text-white/65">{words.reasoning}</p>

      {/* ── evidence ───────────────────────────────────────────────────────── */}
      <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">
          <span className="flex items-center gap-1.5">
            <BarChart3 size={11} />
            Evidence
          </span>
          <StrengthChip strength={proposal.strength} resultType={resultType} />
        </div>
        <EvidenceRows
          evidence={proposal.evidence}
          highlighted={narrated?.evidenceIds}
          collapsible
        />
        {metadata?.origin === 'seeded' && (
          <p className="mt-2 text-[11.5px] text-white/40">
            Seeded delivery — connect the live Meta adapter to replace these figures.
          </p>
        )}
      </div>

      {learnedNote && proposal.type !== 'COLLECT' && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-glow/75">
          <Pencil size={11} className="mt-0.5 shrink-0" />
          {learnedNote.note}
        </p>
      )}

      {/* ── primary action ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        {watch ? (
          <>
            <button type="button" onClick={() => keepWatching(proposal)} className="brief-cta !min-h-[44px] sm:!min-h-0">
              <Eye size={14} />
              Keep watching
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 w-full rounded-lg border border-border bg-background/40 px-2 py-2.5 text-center text-[12.5px] font-medium text-white/60 transition-colors hover:border-[color:rgb(var(--acc)/0.5)] hover:text-white/85"
            >
              Prepare successor anyway
            </button>
          </>
        ) : proposal.type === 'COLLECT' ? (
          <Link href="/meta" className="brief-cta !min-h-[44px] sm:!min-h-0">
            Open the performance record
            <ArrowUpRight size={14} />
          </Link>
        ) : (
          <button type="button" onClick={runApprove} disabled={busy} className="brief-cta !min-h-[44px] sm:!min-h-0">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve — create the draft
          </button>
        )}
      </div>

      {/* ── secondary controls ─────────────────────────────────────────────── */}
      <div className="mt-2 flex items-center gap-2">
        <SecondaryButton onClick={() => setEditing(true)} className="flex-1">
          <span className="flex items-center justify-center gap-1.5">
            <Pencil size={12} /> Edit
          </span>
        </SecondaryButton>
        <SecondaryButton onClick={() => setAsking(true)} className="flex-1">
          <span className="flex items-center justify-center gap-1.5">
            <MessageCircleQuestion size={12} /> Ask Mike
          </span>
        </SecondaryButton>
        <button
          type="button"
          onClick={() => setSnoozing(true)}
          title="Snooze"
          aria-label="Snooze this recommendation"
          className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-lg border border-border bg-background/40 text-white/45 transition-colors hover:border-warning/40 hover:text-warning sm:h-[38px] sm:w-[38px]"
        >
          <Clock size={14} />
        </button>
        <button
          type="button"
          onClick={() => setDismissing(true)}
          title="Dismiss"
          aria-label="Dismiss this recommendation"
          className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-lg border border-border bg-background/40 text-white/45 transition-colors hover:border-danger/40 hover:text-danger sm:h-[38px] sm:w-[38px]"
        >
          <X size={14} />
        </button>
      </div>

      <EditModal open={editing} onClose={() => setEditing(false)} proposal={proposal} />
      <DismissModal open={dismissing} onClose={() => setDismissing(false)} proposal={proposal} />
      <SnoozeModal open={snoozing} onClose={() => setSnoozing(false)} proposal={proposal} />
      <AskMikeModal open={asking} onClose={() => setAsking(false)} proposal={proposal} />
    </article>
  )
}
