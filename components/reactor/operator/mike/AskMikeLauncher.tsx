'use client'

import { useState } from 'react'
import { MikePresence } from '@/components/reactor/operator/mike/MikePresence'
import { MikeConsole } from '@/components/reactor/operator/mike/MikeConsole'

/* ----------------------------------------------------------------------------
   The way in.

   Deliberately a strip under the queue rather than a floating bubble in the
   corner. The bubble is the convention and the convention is wrong here: it
   says "support chat", it covers content, and it detaches Mike from the board
   he is talking about. Sitting directly beneath his own decisions, it reads as
   what it is — the same colleague, still on the same account, available for
   the questions the three cards did not answer.

   The presence is live in the strip too, breathing at rest. That is the point
   of a presence rather than an avatar: he is on before anybody clicks, because
   he is already reading.
---------------------------------------------------------------------------- */

export function AskMikeLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left transition-all hover:border-amber-500/30 hover:bg-amber-500/[0.04] active:scale-[0.995]"
      >
        <MikePresence state={open ? 'listening' : 'dormant'} size={44} className="-my-1 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-white/85">Ask Mike anything</span>
          <span className="block truncate text-[12px] text-white/45">
            He reads the account live and shows you what he looked at
          </span>
        </span>
        <span className="hidden shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/40 transition-colors group-hover:border-amber-500/30 group-hover:text-amber-300/80 sm:block">
          Open
        </span>
      </button>
      <MikeConsole open={open} onClose={() => setOpen(false)} />
    </>
  )
}
