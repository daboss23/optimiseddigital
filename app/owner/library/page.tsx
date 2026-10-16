import { redirect } from 'next/navigation'
import { ownerAccess } from '@/lib/owner'
import { isOwnerRequest } from '@/lib/owner-session'
import { PageHeader } from '@/components/reactor/ui'
import { LibraryManager } from '@/components/owner/LibraryManager'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Platform Library — Owner',
  robots: { index: false, follow: false },
}

export default async function OwnerLibraryPage() {
  // Checked on the server before anything renders. The API routes check again
  // on every call — this page is a convenience, not the lock.
  if (!ownerAccess().enabled || !(await isOwnerRequest())) redirect('/owner')

  return (
    <main className="min-h-[100dvh] bg-[#0a0a0a] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader
          title="Platform Library"
          subtitle="The method every brand's agents work from. Upload once, tag by niche, and the Reactor applies it to every campaign in that niche — as method only, never as a claim, and never shown to the brand."
          tagline="Owner only"
        />
        <LibraryManager />
      </div>
    </main>
  )
}
