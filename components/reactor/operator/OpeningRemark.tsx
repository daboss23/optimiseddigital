'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'

/* ----------------------------------------------------------------------------
   The opening remark strip.

   A left rule in an existing glow colour, a small-caps label, one line in his
   voice slightly larger than the card body. No bubble, no avatar, no chrome, no
   typewriter, no staged fade — those all say "a chatbot is talking to you",
   which is precisely what this is not.

   The strip is OPTIONAL by design. Some days he has a view on the account and
   some days he does not, and when `openingRemark` is null nothing renders at
   all: no empty state, no placeholder, no "Mike has no comment today". That
   absence is itself in character.
---------------------------------------------------------------------------- */

const LABEL_CLASS: Record<string, string> = {
  'JUST NOW': 'text-glow',
  'THIS MORNING': 'text-white/40',
  'FOLLOWING UP': 'text-[color:rgb(var(--lg-violet))]',
}

export function OpeningRemark() {
  const { narration, openingState, needsCatchup, awayDays, catchup, catchingUp, runCatchup } =
    useOperator()

  /* -- away: a briefing, offered, never auto-generated --------------------- */
  if (needsCatchup && !catchup) {
    return (
      <div className="border-b border-border px-5 py-4">
        <div className="border-l-2 border-[color:rgb(var(--lg-violet)/0.6)] pl-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            You have been away {awayDays} days
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <p className="text-[14.5px] leading-relaxed text-white/70">
              There is a diff waiting rather than a summary — what actually moved while you were
              gone.
            </p>
            <button
              type="button"
              onClick={() => void runCatchup()}
              disabled={catchingUp}
              className="min-h-[38px] shrink-0 rounded-lg border border-primary/35 bg-primary/10 px-3.5 text-[12.5px] font-medium text-glow transition-colors hover:border-primary/60 disabled:opacity-50"
            >
              {catchingUp ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  Catching you up…
                </span>
              ) : (
                'Catch me up'
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (catchup) {
    return (
      <div className="border-b border-border px-5 py-4">
        <div className="border-l-2 border-[color:rgb(var(--lg-violet)/0.6)] pl-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
            While you were away · {awayDays} days
          </p>
          <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-relaxed text-white/85">
            {catchup.briefing}
          </p>
        </div>
      </div>
    )
  }

  /* -- the ordinary opening ------------------------------------------------ */
  const remark = narration?.openingRemark
  if (!remark) return null

  return (
    <div className="border-b border-border px-5 py-4">
      <div className="border-l-2 border-[color:rgb(var(--lg-cyan)/0.55)] pl-3.5">
        <p
          className={cn(
            'text-[11px] font-semibold uppercase tracking-[0.16em]',
            LABEL_CLASS[openingState] ?? 'text-white/40',
          )}
        >
          {openingState}
        </p>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-white/85">{remark}</p>
      </div>
    </div>
  )
}
