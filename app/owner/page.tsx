import { redirect } from 'next/navigation'
import { BookLock } from 'lucide-react'
import { ownerAccess } from '@/lib/owner'
import { isOwnerRequest } from '@/lib/owner-session'
import { OwnerLogin } from '@/components/owner/OwnerLogin'

/* ----------------------------------------------------------------------------
   The owner's sign-in.

   Outside the (platform) group and outside the brand middleware: no sidebar,
   no brand session, nothing a brand can navigate to. Not linked from anywhere
   in the brand shell either — the owner bookmarks /owner.
---------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Platform Library — Owner',
  robots: { index: false, follow: false },
}

export default async function OwnerPage() {
  const access = ownerAccess()
  if (access.enabled && (await isOwnerRequest())) redirect('/owner/library')

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0a0a0a] px-4 py-10">
      <div className="w-full max-w-[420px] animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
            <BookLock size={26} className="text-amber-400" aria-hidden="true" />
          </span>
          <span className="command-eyebrow command-eyebrow--bare mt-4">Owner Access</span>
          <h1 className="mt-3 font-display text-[28px] font-bold leading-[1.1] tracking-tight text-white">
            Platform Library
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            Your method — SOPs, frameworks, playbooks — used by every brand&apos;s agents and seen by none of them.
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:p-7">
          <OwnerLogin enabled={access.enabled} reason={access.reason} />
        </div>
      </div>
    </main>
  )
}
