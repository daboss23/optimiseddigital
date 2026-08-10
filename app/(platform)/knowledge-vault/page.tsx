import { Database } from 'lucide-react'
import { PageHeader, Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { vaultStats } from '@/lib/knowledge'
import { UploadGrid } from './UploadGrid'
import { VaultManager } from './VaultManager'

export const dynamic = 'force-dynamic'

export default async function KnowledgeVaultPage() {
  const stats = await vaultStats()

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          system="01"
          title="Knowledge Vault"
          subtitle="The heart of the platform. Ingest and store 20+ years of TPB's creative knowledge, frameworks, SOPs, and member wins."
        />
        <Pill tone={stats.live ? 'success' : 'primary'}>
          <Database size={12} /> {stats.total.toLocaleString()}{' '}
          {stats.live ? 'assets stored' : 'assets mapped'}
        </Pill>
      </div>

      <Panel>
        <PanelHeader
          icon={<Database size={16} />}
          title="Ingest New Intelligence"
          subtitle="Drop a file or click to upload into the vault"
        />
        <div className="p-5">
          <UploadGrid />
        </div>
      </Panel>

      <VaultManager
        initialStats={{ live: stats.live, total: stats.total, groups: stats.groups }}
      />
    </>
  )
}
