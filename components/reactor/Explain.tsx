import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pill, accentClass } from '@/components/reactor/ui'
import {
  CONFIDENCE_DEFS,
  STATUS_DEFS,
  confidenceTone,
  type Confidence,
  type CreativeStatus,
} from '@/lib/creative-status'

/* ----------------------------------------------------------------------------
   Explainability primitives shared by the Reactor and Meta dashboards.

   Nothing on either dashboard is allowed to be a number without a definition or
   a colour without a word. These are the pieces that enforce it: a hover/focus
   tooltip, a status chip that always carries its reason, and an evidence line.
   All CSS-driven (no client JS) so they stay inside server components.
---------------------------------------------------------------------------- */

/**
 * A definition attached to a label. Opens on hover AND keyboard focus, so the
 * threshold behind a metric is reachable without a mouse.
 */
export function InfoTip({
  children,
  label,
  className,
  align = 'left',
}: {
  children: ReactNode
  label?: string
  className?: string
  align?: 'left' | 'right'
}) {
  return (
    <span className={cn('group/tip relative inline-flex items-center', className)}>
      <button
        type="button"
        aria-label={label ? `What ${label} means` : 'Definition'}
        className="inline-grid h-4 w-4 place-items-center rounded-full text-white/30 transition-colors hover:text-glow focus:outline-none focus-visible:text-glow focus-visible:ring-1 focus-visible:ring-primary/60"
      >
        <Info size={11} />
      </button>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full z-30 mb-2 w-64 rounded-lg border border-border bg-background/95 p-3 text-[12.5px] leading-relaxed text-white/80 opacity-0 shadow-panel backdrop-blur-md transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        {label && (
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
            {label}
          </span>
        )}
        {children}
      </span>
    </span>
  )
}

/** Text plus colour, never colour alone — with the evidence one hover away. */
export function StatusChip({
  status,
  reason,
  align = 'left',
}: {
  status: CreativeStatus
  reason?: string
  align?: 'left' | 'right'
}) {
  const def = STATUS_DEFS[status]
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={def.tone}>
        <span className={cn('h-1.5 w-1.5 rounded-full bg-current', accentClass[def.accent])} />
        {def.label}
      </Pill>
      <InfoTip label={def.label} align={align}>
        <span className="block text-white/60">{def.meaning}</span>
        {reason && <span className="mt-1.5 block text-white/80">{reason}</span>}
      </InfoTip>
    </span>
  )
}

/** Low / Medium / High, with its accessible definition attached. */
export function ConfidenceChip({ level }: { level: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Pill tone={confidenceTone[level]}>{level} confidence</Pill>
      <InfoTip label={`${level} confidence`}>{CONFIDENCE_DEFS[level]}</InfoTip>
    </span>
  )
}

/**
 * The evidence line that must sit under every score, index or claim: the
 * comparison, the sample and the window it was measured over.
 */
export function EvidenceLine({ items }: { items: (string | null | undefined)[] }) {
  const shown = items.filter(Boolean) as string[]
  if (shown.length === 0) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] tabular text-white/60">
      {shown.map((item, i) => (
        <span key={item + i} className="flex items-center gap-2">
          {i > 0 && <span className="text-white/15">·</span>}
          {item}
        </span>
      ))}
    </p>
  )
}

/** "DEMO DATA" — kept on every seeded value, exactly as the brief requires. */
export function DemoBadge() {
  return (
    <Pill tone="warning">
      <span className="font-semibold uppercase tracking-[0.16em]">Demo data</span>
    </Pill>
  )
}

/** Not applicable — for a metric that does not fit the creative format. */
export function NotApplicable({ why }: { why: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-white/30">
      <span className="text-[12px]">N/A</span>
      <InfoTip label="Not applicable">{why}</InfoTip>
    </span>
  )
}
