import { PageHeader } from '@/components/reactor/ui'
import { BrandIntelligence } from '@/components/brand/BrandIntelligence'
import { ProductCatalog } from '@/components/brand/ProductCatalog'
import { BrandOnboardingModal } from '@/components/brand/BrandOnboardingModal'

export const dynamic = 'force-dynamic'

export default function BrandIntelligencePage() {
  return (
    <>
      <PageHeader
        system="09"
        title="Brand Intelligence"
        subtitle="Your brand, extracted. Connect your store and ATLAS reads your products, offers, audience, positioning, voice and proof — plus your colours and logo — into one profile the reactor builds every campaign from."
        tagline="Engineered For Performance."
      />
      <BrandIntelligence />
      {/* The store's own products — the only source of a price, a sale or a
          rating on a creative. */}
      <ProductCatalog />
      <BrandOnboardingModal />
    </>
  )
}
