'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { MikeOrb } from '@/components/reactor/operator/mike/orb/MikeOrb'
import { MikeSpeech } from '@/components/reactor/operator/mike/MikeSpeech'
import { armBrandOnboarding } from '@/lib/operator/onboarding'

/* ----------------------------------------------------------------------------
   The first meeting.

   Mike introduces himself once, the first time an operator arrives. After that
   it never appears again — `welcomedAt` in the operator's own memory is what
   "once" means, and dismissing is what sets it.

   It is the SAME Mike the dashboard has: the same orb, the same three-word
   cadence, the same gold-and-violet light. It used to be a titled dialog with
   his initials in a rounded square, which introduced a product feature. This
   introduces a person, and the difference matters most here — this is the only
   time anybody meets him for the first time.

   The copy is NOT written here and is not generated: it lives in
   lib/operator/welcome.ts, fixed, and reaches this component through the
   provider already filled in with whoever signed in. A greeting has to be
   instant and exact; a model call would make it neither.

   Dismissing does not just close: it routes to Brand Intelligence and arms
   Mike's second transmission there. A first-run operator has nothing in the
   Vault, so every number on this dashboard is empty and every campaign the
   reactor could write would be ungrounded — reading their website is the one
   move that makes the rest of the platform mean anything. Escape goes the same
   way as the button on purpose: the destination is the point, not a reward for
   clicking the right control.
---------------------------------------------------------------------------- */

/** How long he takes to fade up before the first word. */
const ARRIVAL_MS = 1600

export function WelcomeModal() {
  const { welcome, dismissWelcome } = useOperator()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [finished, setFinished] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!welcome) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        begin()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // `begin` is stable for the life of this mount — it only routes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcome])

  if (!welcome || !mounted) return null

  const begin = () => {
    dismissWelcome()
    armBrandOnboarding()
    router.push('/brand')
  }

  return createPortal(
    <div className="mike-first mike-first--sheer fixed inset-0 z-[120] flex flex-col items-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[42vh] sm:pt-[44vh]">
      {/* He arrives in the middle rather than travelling, because there is no
          corner to travel from yet — this is the first time anyone has seen
          him. */}
      {/* He arrives before he speaks. A person who materialises mid-sentence
          has not arrived, he has been switched on. */}
      <MikeOrb
        state="focus"
        target={() => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.22 })}
        radius={92}
        className="mike-arrive pointer-events-none fixed inset-0"
      />

      <div className="flex w-full max-w-2xl flex-col items-center gap-8">
        <MikeSpeech
          text={welcome}
          cadence="coalesce"
          delayMs={ARRIVAL_MS}
          onComplete={() => setFinished(true)}
          className="items-center text-center text-[17px] leading-relaxed text-white/85 sm:text-[19px]"
        />

        {/* The way on, once he has finished saying hello. Interrupting a man
            mid-introduction with a button is how you tell someone their time
            is not worth the four seconds. */}
        {/* The platform's one primary button — `.fire-btn`, the same class the
            topbar and every ignition control use. An onboarding CTA with its
            own look tells a first-run operator that this screen belongs to a
            different product than the one behind it. */}
        {finished && (
          <button
            type="button"
            onClick={begin}
            className="mike-cta fire-btn tap-target inline-flex items-center gap-2 px-5 py-3 font-display text-[13px] font-bold uppercase tracking-wide text-white"
          >
            <Sparkles size={15} />
            Let&rsquo;s begin
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
