import { cn } from '@/lib/utils'
import { InfoTip } from '@/components/reactor/InfoTip'
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
   The chips and lines are CSS-only and stay inside server components; the
   tooltip they hang off is a client island (see `InfoTip`), which server
   components may render freely.
---------------------------------------------------------------------------- */

/**
 * A definition attached to a label — re-exported so the dozen call sites that
 * already import it from here keep working. It lives in its own module because
 * it is the one piece of this file that needs the browser: a tooltip has to be
 * measured against the viewport before it can be trusted not to fall off it.
 */
export { InfoTip }

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
