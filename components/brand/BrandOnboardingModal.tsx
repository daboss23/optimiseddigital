'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { OperatorModal } from '@/components/reactor/operator/shell'
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

   Shown only when the dashboard armed it — landing on /brand any other way
   (the sidebar, a bookmark, a returning operator) shows nothing at all.

   The flag is read in an effect rather than during render because it lives in
   localStorage: reading it while rendering makes the server and the first
   client pass disagree, which React resolves by throwing a hydration error.
---------------------------------------------------------------------------- */

export function BrandOnboardingModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (brandOnboardingPending()) setOpen(true)
  }, [])

  const close = () => {
    clearBrandOnboarding()
    setOpen(false)
    // Put them IN the field, not just near it. Deferred a frame so the focus
    // lands after the portal has torn down and released the modal's focus trap.
    window.requestAnimationFrame(() => {
      const input = document.getElementById(WEBSITE_URL_INPUT_ID)
      if (!(input instanceof HTMLInputElement)) return
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      input.focus()
    })
  }

  if (!open) return null

  return (
    <OperatorModal
      open
      onClose={close}
      accent="cyan"
      title="Mike Delight"
      subtitle="Smooth Operator · your daily Meta performance wingman"
      footer={
        <button type="button" onClick={close} className="brief-cta !w-auto !px-4">
          {MIKE_BRAND_ONBOARDING_CTA}
          <Sparkles size={13} />
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
            Step one · brand intelligence
          </p>
          <p className="mt-2.5 text-[14px] leading-relaxed text-white/80">
            {MIKE_BRAND_ONBOARDING}
          </p>
        </div>
      </div>
    </OperatorModal>
  )
}
