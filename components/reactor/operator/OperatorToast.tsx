'use client'

import Link from 'next/link'
import { ArrowUpRight, Check, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'

/* ----------------------------------------------------------------------------
   Decision confirmation.

   Every action gets one, and the approve toast carries the follow-through with
   it: "Approved — draft created" plus a link straight into the brief. Telling
   somebody a draft exists and making them go and find it is how a draft ends up
   never being opened.
---------------------------------------------------------------------------- */

export function OperatorToast() {
  const { toast, dismissToast } = useOperator()
  if (!toast) return null

  const Icon = toast.tone === 'success' ? Check : Info

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[130] flex justify-center px-4"
    >
      <div
        className={cn(
          'glass shadow-panel pointer-events-auto flex max-w-[min(92vw,30rem)] items-center gap-3 rounded-xl border px-4 py-3',
          toast.tone === 'success' ? 'border-success/35' : 'border-border',
        )}
      >
        <Icon
          size={15}
          className={cn('shrink-0', toast.tone === 'success' ? 'text-success' : 'text-glow')}
        />
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/85">{toast.message}</p>
        {toast.action && (
          <Link
            href={toast.action.href}
            className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-glow hover:underline"
          >
            {toast.action.label}
            <ArrowUpRight size={12} />
          </Link>
        )}
        <button
          type="button"
          onClick={dismissToast}
          aria-label="Dismiss"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/35 transition-colors hover:text-white"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
