'use client'

import { ArrowRight } from 'lucide-react'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { OperatorModal } from '@/components/reactor/operator/shell'

/* ----------------------------------------------------------------------------
   The first meeting.

   Mike introduces himself once, over the dashboard, the first time an operator
   arrives. After that it never appears again — `welcomedAt` in the operator's
   own memory is what "once" means, and dismissing is what sets it.

   The copy is NOT written here and is not generated: it lives in
   lib/operator/welcome.ts, fixed, and reaches this component through the
   provider already filled in with whoever signed in. A greeting needs to be
   instant and exact; a model call would make it neither.

   It reuses OperatorModal for the same reason every other operator dialog
   does — the portal escapes the dashboard's backdrop-filter containing block,
   and Escape, the scrim and the close control all behave identically to the
   rest of the surface.
---------------------------------------------------------------------------- */

export function WelcomeModal() {
  const { welcome, dismissWelcome } = useOperator()
  if (!welcome) return null

  return (
    <OperatorModal
      open
      onClose={dismissWelcome}
      accent="cyan"
      title="Mike Delight"
      subtitle="Smooth Operator · your daily Meta performance wingman"
      footer={
        <button type="button" onClick={dismissWelcome} className="brief-cta !w-auto !px-4">
          Let&rsquo;s get to work
          <ArrowRight size={13} />
        </button>
      }
    >
      <div className="flex gap-4">
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-cyan font-display text-[13px] font-bold text-white shadow-glow"
        >
          MD
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-glow/60">
            First transmission
          </p>
          <div className="mt-2.5 space-y-3 text-[14px] leading-relaxed text-white/80">
            {welcome.split('\n\n').map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </OperatorModal>
  )
}
