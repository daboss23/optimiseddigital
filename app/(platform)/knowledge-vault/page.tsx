import { Database } from 'lucide-react'
import { PageHeader, Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { vaultStats } from '@/lib/knowledge'
import { AdIngest } from '@/components/spark/AdIngest'
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
          subtitle="The heart of the platform. Ingest and store your creative knowledge, frameworks, SOPs, and client wins."
        />
        <Pill tone={stats.live ? 'success' : 'primary'}>
          <Database size={12} /> {stats.total.toLocaleString()}{' '}
          {stats.live ? 'assets stored' : 'assets mapped'}
        </Pill>
      </div>

      {/* Visual intelligence enters here, alongside documents: the design of a
          winning ad is Vault knowledge in exactly the same sense a framework is,
          and the Reactor pulls a banked design when a brief calls for one. */}
      <AdIngest variant="vault" />

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
