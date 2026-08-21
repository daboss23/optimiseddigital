import { PageHeader } from '@/components/reactor/ui'
import { BrandIntelligence } from '@/components/brand/BrandIntelligence'
import { BrandOnboardingModal } from '@/components/brand/BrandOnboardingModal'

export const dynamic = 'force-dynamic'

export default function BrandIntelligencePage() {
  return (
    <>
      <PageHeader
        system="09"
        title="Brand Intelligence"
        subtitle="Your brand, extracted. Connect your website and ATLAS reads your offer, audience, positioning, voice and proof — plus your colours and logo — into one profile the reactor builds every campaign from."
        tagline="Engineered For Performance."
      />
      <BrandIntelligence />
      <BrandOnboardingModal />
    </>
  )
}
