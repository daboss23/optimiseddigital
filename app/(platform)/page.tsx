import {
  Activity,
  Anchor,
  ArrowUpRight,
  Banknote,
  Box,
  CircleDollarSign,
  Clapperboard,
  Clock3,
  Crosshair,
  Cpu,
  FolderOpen,
  FileText,
  Hexagon,
  Lightbulb,
  Network,
  Sparkles,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  KpiCard,
  Panel,
  PanelHeader,
  PanelFooterLink,
  ProgressBar,
  Pill,
  RadialGauge,
  TrendBadge,
  accentClass,
  type Accent,
} from '@/components/reactor/ui'
import { WinRateDonut } from '@/components/reactor/charts/WinRateDonut'
import { recommendations } from '@/lib/reactor-data'
import { getDashboardData, winningAngles } from '@/lib/dashboard-data'
import { AGENT_NETWORK, type AgentId } from '@/lib/agents'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Accent channel + icon identity for each KPI instrument, mirroring the
// command-center mockup: blue / emerald / violet / cyan / pink / amber.
const kpiIdentity: Record<string, { accent: Accent; icon: LucideIcon }> = {
  'Knowledge Assets': { accent: 'blue', icon: FolderOpen },
  'Winning Creatives': { accent: 'emerald', icon: Crosshair },
  'Winning Hooks': { accent: 'violet', icon: Anchor },
  Frameworks: { accent: 'cyan', icon: Box },
  SOPs: { accent: 'emerald', icon: FileText },
  'Member Wins': { accent: 'pink', icon: Trophy },
  'Patterns Identified': { accent: 'amber', icon: Hexagon },
  'Campaign Ideas Ready': { accent: 'blue', icon: Lightbulb },
}

const angleIcons: Record<string, LucideIcon> = {
  Profit: CircleDollarSign,
  Systems: Box,
  'Time Freedom': Clock3,
  Leadership: Users,
  Cashflow: Banknote,
}

const activityIcons: Record<string, LucideIcon> = {
  ingest: FolderOpen,
  render: Clapperboard,
  outcome: Trophy,
}

// Agent network identity — each codename maps to one neon channel + a glyph.
// Icons are restricted to the set already proven in this bundle.
const agentIdentity: Record<AgentId, { accent: Accent; icon: LucideIcon }> = {
  opus: { accent: 'amber', icon: Cpu },
  atlas: { accent: 'blue', icon: FolderOpen },
  nova: { accent: 'violet', icon: Crosshair },
  spark: { accent: 'cyan', icon: Sparkles },
  echo: { accent: 'emerald', icon: FileText },
  oracle: { accent: 'pink', icon: Hexagon },
}

const kpiStagger = [
  'stagger-1',
  'stagger-2',
  'stagger-3',
  'stagger-4',
  'stagger-5',
  'stagger-6',
  'stagger-7',
  'stagger-8',
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export default async function ReactorDashboard() {
  const data = await getDashboardData()

  // Fuel per agent = the live signal volume in the knowledge systems it reads.
  // OPUS synthesises the whole network, so it carries the total.
  const systemCount: Record<string, number> = {}
  for (const s of data.systemLoad) systemCount[s.system] = s.count
  const totalFuel = data.systemLoad.reduce((sum, s) => sum + s.count, 0)
  const agentFuel = (id: AgentId): number => {
    const agent = AGENT_NETWORK.find((a) => a.id === id)
    if (!agent || id === 'opus') return totalFuel
    return agent.systems.reduce((sum, sys) => sum + (systemCount[sys] ?? 0), 0)
  }
  const onlineCount = AGENT_NETWORK.filter((a) => a.id === 'opus' || agentFuel(a.id) > 0).length

  return (
    <>
      {/* Command hero — intelligence command-center header */}
      <div className="command-hero flex flex-wrap items-end justify-between gap-5">
        <div className="animate-fade-up">
          <span className="command-eyebrow">
            <span className="command-eyebrow-dot" />
            Creative Intelligence Command Center
          </span>
          <h1 className="mt-2.5 font-display text-3xl font-bold tracking-tight text-white md:text-[2.6rem] md:leading-[1.05]">
            Reactor Dashboard
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-white/55">
            Mission control for The Professional Builder&apos;s creative intelligence. What should
            TPB create next, based on everything that has already worked?
          </p>
          <div className="hero-scanline" />
        </div>
      </div>

      <div className="dashboard-console">
        {/* KPI instruments — neon telemetry cards with live counts + sparklines */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {data.kpis.map((k, i) => {
            const id = kpiIdentity[k.label] ?? { accent: 'blue' as Accent, icon: Activity }
            return (
              <div key={k.label} className={cn('animate-fade-up', kpiStagger[i % kpiStagger.length])}>
                <KpiCard
                  label={k.label}
                  value={k.value}
                  delta={k.delta}
                  trend={k.trend}
                  accent={id.accent}
                  icon={id.icon}
                  spark={k.spark}
                />
              </div>
            )
          })}
        </section>

        {/* Hero analytics: concept win rate */}
        <div className="grid grid-cols-1 gap-3">
          <Panel>
            <PanelHeader
              icon={<Trophy size={16} />}
              accent="emerald"
              title="Concept Win Rate"
              subtitle="Outcomes from generated campaigns"
            />
            <div className="p-5">
              <WinRateDonut outcomes={data.outcomes} />
              {data.outcomes.metrics.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-4">
                  {data.outcomes.metrics.map((m) => (
                    <div key={m.name} className="text-center">
                      <p className="font-display text-lg font-bold tabular text-glow">{m.value}</p>
                      <p className="text-[10px] uppercase tracking-wider text-white/40">{m.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Intelligence panels: angles · agent network · activity */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          {/* Top winning angles */}
          <Panel>
            <PanelHeader
              icon={<Network size={16} />}
              accent="blue"
              title="Top Winning Angles"
              subtitle="Ranked by win index"
            />
            <div className="space-y-2 p-5">
              {winningAngles.slice(0, 5).map((a) => {
                const Icon = angleIcons[a.name] ?? Hexagon
                return (
                  <div key={a.name} className="telemetry-row flex items-center gap-3">
                    <span className={cn('angle-tile', accentClass[a.accent])}>
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{a.name}</p>
                      <ProgressBar value={a.score} />
                    </div>
                    <span className="w-8 text-right font-display text-sm font-bold tabular text-white">
                      {a.score}
                    </span>
                    <TrendBadge trend={a.trend} value={a.delta} />
                  </div>
                )
              })}
            </div>
            <PanelFooterLink href="/patterns">View All Angles</PanelFooterLink>
          </Panel>

          {/* Agent network — OPUS orchestrating the five intelligence layers */}
          <Panel>
            <PanelHeader
              icon={<Cpu size={16} className="animate-pulse-glow" />}
              accent="violet"
              title="Agent Network"
              subtitle="OPUS orchestrating the intelligence layers"
              accessory={<Pill tone="success">{onlineCount}/6 online</Pill>}
            />
            <div className="agent-spine space-y-2 p-5">
              {AGENT_NETWORK.map((agent) => {
                const id = agentIdentity[agent.id]
                const Icon = id.icon
                const isLead = agent.id === 'opus'
                const fuel = agentFuel(agent.id)
                const active = isLead || fuel > 0
                return (
                  <div
                    key={agent.id}
                    className={cn('agent-node', isLead && 'agent-node--lead', accentClass[id.accent])}
                  >
                    <span className="agent-icon">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-sm font-bold tracking-tight text-white">
                          {agent.codename}
                        </span>
                        <span className="truncate text-[11px] text-white/40">{agent.role}</span>
                      </div>
                      <p className="truncate text-[11px] tabular text-white/35">
                        {fuel.toLocaleString()} signals {isLead ? 'synthesised' : 'fueling'}
                      </p>
                    </div>
                    <span className={cn('agent-status', !active && 'agent-status--idle')}>
                      <span className="agent-status__dot" />
                      {isLead ? 'Online' : active ? 'Active' : 'Standby'}
                    </span>
                  </div>
                )
              })}
            </div>
            <PanelFooterLink href="/network">View Agent Network</PanelFooterLink>
          </Panel>

          {/* Recent activity — live pulse of the reactor */}
          <Panel>
            <PanelHeader
              icon={<Activity size={16} />}
              accent="cyan"
              title="Recent Activity"
              subtitle="Latest ingests, renders & outcomes"
            />
            <div className="p-5">
              <ul className="space-y-3">
                {data.activity.map((e, i) => {
                  const Icon = activityIcons[e.kind] ?? Sparkles
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className={cn('angle-tile h-7 w-7 shrink-0', accentClass[e.accent])}>
                        <Icon size={12} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-white">{e.label}</p>
                        <p className="truncate text-[11px] text-white/40">{e.detail}</p>
                      </div>
                      <span className="shrink-0 text-[10px] tabular text-white/30">
                        {timeAgo(e.at)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Panel>
        </div>

        {/* Strategic recommendations — intelligence briefing cards */}
        <Panel>
          <PanelHeader
            icon={<Target size={16} />}
            accent="amber"
            title="Strategic Recommendations"
            subtitle="AI-generated next moves for TPB"
            accessory={<Pill tone="primary">{recommendations.length} ready</Pill>}
          />
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-3">
            {recommendations.map((r) => (
              <div
                key={r.campaign}
                data-priority={r.priority}
                className="recommendation-card glass-hover flex flex-col rounded-xl border border-border bg-surface/40 p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <Pill tone={r.priority === 'Critical' ? 'danger' : 'warning'}>{r.priority}</Pill>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-white/35">
                      Confidence
                    </span>
                    <span className="font-display text-sm font-bold tabular text-glow">
                      {r.confidence}%
                    </span>
                  </span>
                </div>
                <h3 className="font-display text-base font-semibold text-white">{r.campaign}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-white/50">{r.reason}</p>
                <div className="mt-3 rounded-lg border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                    Suggested Hook
                  </p>
                  <p className="mt-1 text-sm italic text-white/80">&ldquo;{r.suggestedHook}&rdquo;</p>
                </div>
                <div className="mb-4 mt-3 flex flex-wrap gap-1.5">
                  {r.assetsNeeded.map((a) => (
                    <span key={a} className="source-tag">
                      {a}
                    </span>
                  ))}
                </div>
                <a href="/recommendations" className="brief-cta mt-auto">
                  Open Brief
                  <ArrowUpRight size={14} />
                </a>
              </div>
            ))}
          </div>
        </Panel>

        {/* Compact performance read-outs */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.performanceSignals.map((p, i) => (
            <div
              key={p.label}
              className={cn(
                'kpi-card kpi-card--compact animate-fade-up flex items-center justify-between gap-4 p-4',
                accentClass[p.accent],
                kpiStagger[i % kpiStagger.length],
              )}
            >
              <span className="kpi-bloom" aria-hidden="true" />
              <span className="kpi-grid" aria-hidden="true" />
              <div className="relative min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
                  {p.label}
                </p>
                <p className="mt-1.5 truncate font-display text-xl font-bold text-white">
                  {p.value}
                </p>
                <p className="mt-1 text-[11px] tabular text-white/45">{p.metric}</p>
              </div>
              <RadialGauge value={p.pct} accent={p.accent} />
            </div>
          ))}
        </section>
      </div>

    </>
  )
}
