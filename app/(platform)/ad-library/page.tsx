import { getWinners } from '@/lib/clone-sources'
import { PageHeader } from '@/components/reactor/ui'
import { AdLibrary } from '@/components/ad-library/AdLibrary'

export const dynamic = 'force-dynamic'

/**
 * Ad Library — the clone dashboard. Browse proven ads (our winners from ORACLE)
 * or bring in an external ad, review/edit its extracted Creative DNA, then fire
 * the reactor locked to that structure. Winners are fetched server-side; the
 * external tab pastes-to-DNA client-side.
 */
export default async function AdLibraryPage() {
  const { winners, configured } = await getWinners()

  return (
    <>
      <PageHeader
        system="06"
        title="Ad Library"
        subtitle="Clone what works. Pull a proven winner from ORACLE or bring in an outside ad, edit its Creative DNA, and regenerate new on-brand creative locked to that structure — then iterate one thing to find the next winner."
        tagline="Engineered For Performance"
      />
      <AdLibrary initialWinners={winners} winnersLive={configured} />
    </>
  )
}
