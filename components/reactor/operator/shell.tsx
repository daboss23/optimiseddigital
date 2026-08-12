'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pill, accentClass, type Accent } from '@/components/reactor/ui'
import { InfoTip } from '@/components/reactor/Explain'
import { RESULT_LABELS } from '@/lib/creative-status'
import { STRENGTH_LABELS, STRENGTH_TONE, strengthExplanation } from '@/lib/operator/strength'
import type {
  Evidence,
  EvidenceStrength,
  FatigueState,
  PrimaryResultType,
  Proposal,
  ProposalType,
} from '@/lib/operator/types'

/* ----------------------------------------------------------------------------
   Shared operator UI primitives.

   Nothing here introduces a colour, a radius or a shadow the command centre did
   not already have. WATCH in particular reuses the REPLACE accent at lower
   intensity rather than arriving with a new one — the point is that it reads as
   a quieter member of the same family, which is exactly what it is.
---------------------------------------------------------------------------- */

export const PROPOSAL_ACCENT: Record<ProposalType, Accent> = {
  ITERATE: 'emerald',
  REPLACE: 'pink',
  EXPLORE: 'violet',
  COLLECT: 'blue',
}

/** The word on the card. WATCH is its own state, never "replace, but softer". */
export function proposalLabel(p: Proposal): string {
  if (p.type === 'REPLACE') {
    return p.fatigueState === 'WATCH' ? 'WATCH — Possible fatigue' : 'REPLACE'
  }
  return p.type
}

export function accentFor(p: Proposal): Accent {
  return PROPOSAL_ACCENT[p.type]
}

export const isWatch = (p: Proposal): boolean =>
  p.type === 'REPLACE' && p.fatigueState === ('WATCH' satisfies FatigueState)

/* ------------------------------ strength chip ------------------------------ */

/**
 * The evidence-strength label, with its explanation built from the STRUCTURED
 * values rather than from prose. It says what it counted, so the operator can
 * disagree with the count instead of arguing with an adjective.
 */
export function StrengthChip({
  strength,
  resultType,
}: {
  strength: EvidenceStrength
  resultType: PrimaryResultType
}) {
  const word =
    strength.primaryResults === 1
      ? RESULT_LABELS[resultType].one.toLowerCase()
      : RESULT_LABELS[resultType].many
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={STRENGTH_TONE[strength.tier]}>{STRENGTH_LABELS[strength.tier]}</Pill>
      <InfoTip label={STRENGTH_LABELS[strength.tier]} align="right">
        <span className="block text-white/80">{strengthExplanation(strength, word)}</span>
        {strength.reasons.length > 0 && (
          <span className="mt-1.5 block text-white/55">{strength.reasons.join(' · ')}</span>
        )}
      </InfoTip>
    </span>
  )
}

/* ------------------------------ evidence rows ------------------------------ */

const DIRECTION_CLASS: Record<Evidence['direction'], string> = {
  good: 'text-success',
  bad: 'text-danger',
  neutral: 'text-white/80',
}

/**
 * How many rows show before the rest fold away.
 *
 * A confirmed fatigue call carries ten evidence items and a pattern card
 * carries three. Rendering both in full makes the tall one stretch the whole
 * grid row, and a card that is three screens long is a card nobody finishes.
 * Nothing is hidden that Mike leaned on — cited rows are always visible — and
 * the rest are one click away rather than gone.
 */
const DEFAULT_VISIBLE_ROWS = 5

/**
 * Every number on a card comes from here — the structured evidence item, not
 * from a sentence somebody wrote. Mike can misread the evidence, which is a
 * judgement and his job. He cannot mistype it, because he never types it.
 */
export function EvidenceRows({
  evidence,
  highlighted,
  collapsible = false,
}: {
  evidence: Evidence[]
  /** The ids Mike said his reading rests on — marked, not filtered. */
  highlighted?: string[]
  /** Fold the tail away past `DEFAULT_VISIBLE_ROWS`. */
  collapsible?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  if (evidence.length === 0) return null
  const marks = new Set(highlighted ?? [])

  const folded =
    collapsible && !expanded && evidence.length > DEFAULT_VISIBLE_ROWS
      ? evidence.filter((e, i) => i < DEFAULT_VISIBLE_ROWS || marks.has(e.id))
      : evidence
  const hidden = evidence.length - folded.length

  return (
    <>
    <ul className="space-y-2">
      {folded.map((e) => {
        const cited = marks.has(e.id)
        return (
          <li
            key={e.id}
            className={cn(
              'rounded-lg border px-2.5 py-2 transition-colors',
              cited
                ? 'border-primary/30 bg-primary/[0.05]'
                : 'border-transparent bg-background/30',
            )}
          >
            {/* Wraps rather than truncates. These cards sit three-up on a
                desktop grid, and a label like "Cost per Booked Call — last 7
                complete days vs prior 7" beside a value like "3 creatives, one
                result type" will not fit on one line at that width. Truncating
                either half loses the meaning; wrapping costs a line. */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="min-w-0 break-words text-[11.5px] font-medium uppercase tracking-[0.08em] text-white/50">
                {e.label}
              </span>
              <span
                className={cn(
                  'ml-auto break-words text-right font-display text-[13.5px] font-bold tabular',
                  DIRECTION_CLASS[e.direction],
                )}
              >
                {e.displayValue}
              </span>
            </div>
            {e.comparisonValue && (
              <p className="mt-1 text-[12px] leading-relaxed text-white/55">{e.comparisonValue}</p>
            )}
            {e.source.provisional && (
              <p className="mt-1 text-[11.5px] font-medium text-warning/80">
                Still inside the attribution window
              </p>
            )}
          </li>
        )
      })}
    </ul>
    {hidden > 0 && (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-2 w-full rounded-lg border border-dashed border-border px-2 py-2 text-[12px] font-medium text-white/50 transition-colors hover:border-primary/40 hover:text-glow"
      >
        Show {hidden} more evidence {hidden === 1 ? 'row' : 'rows'}
      </button>
    )}
    {collapsible && expanded && evidence.length > DEFAULT_VISIBLE_ROWS && (
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="mt-2 w-full rounded-lg border border-dashed border-border px-2 py-2 text-[12px] font-medium text-white/40 transition-colors hover:border-primary/40 hover:text-white/70"
      >
        Show less
      </button>
    )}
    </>
  )
}

/* --------------------------------- modal ----------------------------------- */

/**
 * One modal shell for Edit, Dismiss, Snooze and Ask Mike.
 *
 * Portaled to the body for the same reason the nav drawer is: the dashboard's
 * glass panels set `backdrop-filter`, which creates a containing block and
 * traps a fixed child inside the card it was declared in.
 */
export function OperatorModal({
  open,
  onClose,
  title,
  subtitle,
  accent = 'blue',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  accent?: Accent
  children: ReactNode
  footer?: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'glass reactor-panel shadow-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden sm:max-w-lg',
          accentClass[accent],
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold tracking-tight text-white">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-white/55">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background/40 text-white/50 transition-colors hover:border-primary/40 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------- controls --------------------------------- */

export function SecondaryButton({
  children,
  onClick,
  disabled,
  tone = 'default',
  className,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  tone?: 'default' | 'danger' | 'success'
  className?: string
}) {
  const tones = {
    default: 'border-border text-white/75 hover:border-primary/40 hover:text-glow',
    danger: 'border-border text-white/60 hover:border-danger/40 hover:text-danger',
    success: 'border-success/30 text-success hover:border-success/60',
  } as const
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-h-[44px] rounded-lg border bg-background/40 px-3.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[38px]',
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
      {children}
    </span>
  )
}

export const inputClass =
  'w-full rounded-lg border border-border bg-background/50 px-3 py-2.5 text-[13.5px] text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40'
