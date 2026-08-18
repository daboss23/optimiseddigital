import { Activity, Cpu, Database, Gauge } from 'lucide-react'
import { PageHeader, Panel, Pill, ProgressBar, RadialGauge, type Accent } from '@/components/reactor/ui'
import { AGENT_NETWORK, INTELLIGENCE, INTELLIGENCE_IDS, type AgentId, type IntelligenceId } from '@/lib/agents'
import { vaultStats } from '@/lib/knowledge'
import { listOutcomes } from '@/lib/outcomes'
import type { KnowledgeSystem } from '@/lib/knowledge'

export const dynamic = 'force-dynamic'

// Accent token per agent for the visibility surface.
const ACCENT: Record<AgentId, Accent> = {
  opus: 'amber',
  atlas: 'cyan',
  nova: 'violet',
  spark: 'amber',
  echo: 'emerald',
  oracle: 'pink',
}

// Curated baseline so the network looks alive before any live knowledge exists.
const DEMO_COUNTS: Record<IntelligenceId, number> = {
  atlas: 142,
  nova: 218,
  spark: 96,
  echo: 173,
  oracle: 64,
}

export default async function AgentNetworkPage() {
  const [stats, outcomes] = await Promise.all([vaultStats(), listOutcomes(50)])

  const systemCounts: Partial<Record<KnowledgeSystem, number>> = {}
  for (const g of stats.groups) {
    const sys = g.system as KnowledgeSystem
    systemCounts[sys] = (systemCounts[sys] ?? 0) + g.count
  }
  const useDemo = stats.total === 0

  const countForIntel = (id: IntelligenceId): number => {
    if (useDemo) return DEMO_COUNTS[id]
    return INTELLIGENCE[id].systems.reduce((s, sys) => s + (systemCounts[sys] ?? 0), 0)
  }
  const countFor = (id: AgentId): number =>
    id === 'opus'
      ? INTELLIGENCE_IDS.reduce((s, i) => s + countForIntel(i), 0)
      : countForIntel(id as IntelligenceId)

  const confidenceFor = (count: number) => Math.min(96, 55 + Math.round(count / 5))
  const loadFor = (count: number) => Math.min(95, 38 + Math.round(count / 4))
  const activityFor = (count: number) => (count > 150 ? 'High' : count > 60 ? 'Active' : 'Standby')
  const recentFor = (id: AgentId, count: number): string => {
    if (id === 'oracle') return outcomes.length ? `${outcomes.length} outcomes in memory` : 'Awaiting first outcome'
    if (id === 'opus') return 'Synthesizing across the network'
    return `${count.toLocaleString()} signals indexed`
  }

  return (
    <>
      <PageHeader
        system="08"
        title="Agent Network"
        subtitle="The living intelligence architecture behind the Creative Reactor. OPUS directs five intelligence layers; this is visibility into the machinery — not configuration."
        tagline={stats.live ? 'Live knowledge layer' : 'Demo intelligence — configure Supabase + Voyage for live counts'}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {AGENT_NETWORK.map((agent) => {
          const count = countFor(agent.id)
          const confidence = confidenceFor(count)
          const load = loadFor(count)
          const accent = ACCENT[agent.id]
          return (
            <Panel key={agent.id} hover className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full animate-pulse-glow"
                      style={{ backgroundColor: agent.accent }}
                    />
                    <h2 className="font-display text-lg font-bold tracking-tight text-white">
                      {agent.codename}
                    </h2>
                  </div>
                  <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-glow/70">
                    {agent.role}
                  </p>
                </div>
                <RadialGauge value={confidence} accent={accent} size={56} stroke={5} />
              </div>

              <p className="mb-4 line-clamp-2 text-[12px] leading-relaxed text-white/50">
                {agent.mission}
              </p>

              <div className="space-y-2.5">
                <StatRow icon={<Database size={13} />} label="Knowledge" value={count.toLocaleString()} />
                <StatRow icon={<Activity size={13} />} label="Activity" value={activityFor(count)} />
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-white/45">
                    <span className="flex items-center gap-1.5">
                      <Cpu size={13} /> System Load
                    </span>
                    <span className="tabular text-white/60">{load}%</span>
                  </div>
                  <ProgressBar value={load} />
                </div>
                <StatRow icon={<Gauge size={13} />} label="Recent" value={recentFor(agent.id, count)} />
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <Pill tone="success">Online</Pill>
                <span className="text-[11px] font-medium text-success/80">{confidence}% confidence</span>
              </div>
            </Panel>
          )
        })}
      </div>
    </>
  )
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="flex items-center gap-1.5 text-white/45">
        {icon} {label}
      </span>
      <span className="truncate text-right text-white/70">{value}</span>
    </div>
  )
}
