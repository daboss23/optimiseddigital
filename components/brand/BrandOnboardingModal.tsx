'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles } from 'lucide-react'
import { MikeOrb } from '@/components/reactor/operator/mike/orb/MikeOrb'
import { MikeSpeech } from '@/components/reactor/operator/mike/MikeSpeech'
import {
  brandOnboardingPending,
  clearBrandOnboarding,
} from '@/lib/operator/onboarding'
import { MIKE_BRAND_ONBOARDING, MIKE_BRAND_ONBOARDING_CTA } from '@/lib/operator/welcome'
import { WEBSITE_URL_INPUT_ID } from '@/components/brand/WebsiteIntelligence'

/* ----------------------------------------------------------------------------
   Mike's second transmission.

   The welcome on the dashboard hands straight to this screen, so the operator
   arrives mid-conversation rather than in front of an unexplained form. This
   says what the screen is for and drops them into the one field that matters.

   It is the same Mike, presented the same way as the first meeting — the same
   orb, the same three-word cadence, the same light. Two consecutive screens of
   one conversation cannot look like two different products, which is exactly
   what happened while one was a rendered presence and the other was a dialog
   with his initials in a rounded square.

   Shown only when the dashboard armed it — landing on /brand any other way
   (the sidebar, a bookmark, a returning operator) shows nothing at all.

   The flag is read in an effect rather than during render because it lives in
   localStorage: reading it while rendering makes the server and the first
   client pass disagree, which React resolves by throwing a hydration error.
---------------------------------------------------------------------------- */

/** He fades up before he speaks, the same as the first meeting. */
const ARRIVAL_MS = 1600

export function BrandOnboardingModal() {
  const [open, setOpen] = useState(false)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    if (brandOnboardingPending()) setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // `close` only routes focus; it is stable for the life of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = () => {
    clearBrandOnboarding()
    setOpen(false)
    // Put them IN the field, not just near it. Deferred a frame so the focus
    // lands after the portal has torn down.
    window.requestAnimationFrame(() => {
      const input = document.getElementById(WEBSITE_URL_INPUT_ID)
      if (!(input instanceof HTMLInputElement)) return
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input.focus()
    })
  }

  if (!open) return null

  return createPortal(
    <div className="mike-first fixed inset-0 z-[120] flex flex-col items-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[42vh] sm:pt-[44vh]">
      <MikeOrb
        state="focus"
        target={() => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.22 })}
        radius={92}
        className="mike-arrive pointer-events-none fixed inset-0"
      />

      <div className="flex w-full max-w-2xl flex-col items-center gap-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-amber-300/60">
          Step one · brand intelligence
        </p>

        <MikeSpeech
          text={MIKE_BRAND_ONBOARDING}
          cadence="coalesce"
          delayMs={ARRIVAL_MS}
          onComplete={() => setFinished(true)}
          className="items-center text-center text-[17px] leading-relaxed text-white/85 sm:text-[19px]"
        />

        {finished && (
          <button
            type="button"
            onClick={close}
            className="mike-cta fire-btn tap-target inline-flex items-center gap-2 px-5 py-3 font-display text-[13px] font-bold uppercase tracking-wide text-white"
          >
            <Sparkles size={15} />
            {MIKE_BRAND_ONBOARDING_CTA}
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
