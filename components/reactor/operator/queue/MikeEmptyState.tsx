'use client'

import { Check, PauseCircle, PlugZap } from 'lucide-react'

/* ----------------------------------------------------------------------------
   The states where there is nothing to decide.

   Each one says what is true and what happens next. None of them manufactures a
   recommendation to make the page look busy — an empty queue on a healthy
   account is the system working, and dressing it up as a problem is how a
   dashboard teaches people to ignore it.
---------------------------------------------------------------------------- */

export function MikeEmptyState({
  variant,
}: {
  variant: 'clear' | 'paused' | 'disconnected' | 'filtered'
}) {
  if (variant === 'disconnected') {
    return (
      <div className="grid place-items-center px-6 py-14 text-center">
        <PlugZap size={28} className="mb-3 text-warning/50" />
        <p className="max-w-md text-[14px] leading-relaxed text-white/70">
          The account could not be read, so there is nothing to decide on.
        </p>
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/45">
          Connect the Meta Marketing API and run the sync — Mike will not show recommendations
          built on data he could not fetch.
        </p>
      </div>
    )
  }

  if (variant === 'paused') {
    return (
      <div className="grid place-items-center px-6 py-14 text-center">
        <PauseCircle size={28} className="mb-3 text-white/25" />
        <p className="max-w-md text-[14px] leading-relaxed text-white/70">
          Mike is off the clock.
        </p>
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/45">
          Nothing new is being raised. Anything already on the queue stays actionable.
        </p>
      </div>
    )
  }

  if (variant === 'filtered') {
    return (
      <div className="grid place-items-center px-6 py-12 text-center">
        <p className="max-w-md text-[13.5px] leading-relaxed text-white/50">
          Nothing here yet. Decisions appear in this list once you have made them.
        </p>
      </div>
    )
  }

  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <Check size={28} className="mb-3 text-success/40" />
      <p className="max-w-md text-[14px] leading-relaxed text-white/70">
        Nothing needs your attention today.
      </p>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-white/45">
        Mike is watching the account and will surface a decision when the evidence earns one.
      </p>
    </div>
  )
}
