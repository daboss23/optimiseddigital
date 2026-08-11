import {
  Activity,
  Anchor,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Box,
  Brain,
  CircleDollarSign,
  Clapperboard,
  Clock3,
  Crosshair,
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
import { learnings, recommendations } from '@/lib/reactor-data'
import { getDashboardData, winningAngles } from '@/lib/dashboard-data'
import { resolveMetaDashboard } from '@/lib/meta-graph'
import { listOutcomes, patternConfidence, VERDICT_LABELS, type Verdict } from '@/lib/outcomes'
import { cn } from '@/lib/utils'
import { MetaSyncButton } from './MetaSyncButton'

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

const verdictTone: Record<Verdict, 'success' | 'warning' | 'danger' | 'default'> = {
  winner: 'success',
  high_performer: 'success',
  average: 'warning',
  loser: 'danger',
  unknown: 'default',
  pending: 'default',
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

function LearningStat({ label, value, accent }: { label: string; value: string; accent: Accent }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface/40 p-3.5', accentClass[accent])}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className="mt-1.5 font-display text-xl font-bold tabular text-white">{value}</p>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 mt-2 px-1 font-display text-sm font-semibold uppercase tracking-wider text-white/50">
      {children}
    </h2>
  )
}

export default async function ReactorDashboard() {
  const [data, meta, memory, outcomes] = await Promise.all([
    getDashboardData(),
    resolveMetaDashboard(),
    patternConfidence(),
    listOutcomes(12),
  ])
  const live = meta.source === 'live'
  const hasMemory = memory.length > 0

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

        {/* Intelligence panels: winning angles · recent activity */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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
            <PanelFooterLink href="/playbook">View the Playbook</PanelFooterLink>
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

        {/* ── The learning loop — what Meta results teach ORACLE ─────────── */}
        <SectionLabel>What ORACLE Learned</SectionLabel>

        <Panel>
          <PanelHeader
            icon={<Brain size={16} />}
            accent="amber"
            title="Reactor Learning Loop"
            subtitle="Live ad grades flow into ORACLE memory — winners re-ingest into the Vault"
            accessory={
              <div className="hidden items-center gap-2 sm:flex">
                <MetaSyncButton />
              </div>
            }
          />

          <div className="grid grid-cols-2 gap-3 px-5 pt-5 sm:grid-cols-4">
            <LearningStat label="Signals ingested" value={meta.learningStats.signalsIngested.toLocaleString()} accent="blue" />
            <LearningStat label="Winners logged" value={String(meta.learningStats.winnersLogged)} accent="emerald" />
            <LearningStat label="Patterns updated" value={String(meta.learningStats.patternsUpdated)} accent="violet" />
            <LearningStat label="Last sync" value={meta.learningStats.lastSync} accent="cyan" />
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
            {meta.agentInsights.map((ins) => (
              <div
                key={ins.insight}
                className="recommendation-card glass-hover rounded-xl border border-border bg-surface/40 p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-white">{ins.insight}</p>
                  <Pill tone="success">{ins.lift}</Pill>
                </div>
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-background/40 p-3">
                  <Sparkles size={13} className="mt-0.5 shrink-0 text-glow" />
                  <p className="text-xs leading-relaxed text-white/65">
                    <span className="text-glow/80">Agent action:</span> {ins.action}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border px-5 py-4 text-[11px] leading-relaxed text-white/40">
            Winning ads and their performance are re-ingested into the knowledge layer as new
            patterns — every campaign the reactor fires gets sharper as Meta results compound.
            {!live && ' Connect the Meta Marketing API (META_ACCESS_TOKEN) to stream live performance in once real spend builds up.'}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {/* Strategic Memory — pattern confidence learned from real outcomes */}
          <Panel>
            <PanelHeader
              icon={<Brain size={16} />}
              accent="pink"
              title="Strategic Memory"
              subtitle="What is winning, by pattern — confidence rises as proven outcomes accumulate."
              accessory={hasMemory ? <Pill tone="primary">{memory.length} patterns</Pill> : undefined}
            />
            {hasMemory ? (
              <div className="space-y-3 p-5">
                {memory.map((m) => (
                  <div key={m.pattern} className="rounded-lg border border-border bg-surface/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-sm font-medium text-white">
                        <Sparkles size={13} className="text-glow" />
                        {m.pattern}
                      </span>
                      <span className="text-[11px] text-white/45">
                        {m.wins}/{m.total} wins ·{' '}
                        <span className="font-semibold text-success">{m.confidence}% confidence</span>
                      </span>
                    </div>
                    <ProgressBar value={m.confidence} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid place-items-center px-6 py-14 text-center">
                <Trophy size={32} className="mb-3 text-white/15" />
                <p className="max-w-md text-sm text-white/40">
                  No outcomes logged yet. Mark concepts as Winner, High Performer, Average, or Loser
                  in the Campaign Reactor — each one teaches ORACLE which patterns win, and feeds the
                  recommendations. (Logging persists with Supabase configured.)
                </p>
              </div>
            )}
          </Panel>

          {/* Recent outcomes feed */}
          <Panel>
            <PanelHeader
              icon={<BarChart3 size={16} />}
              accent="violet"
              title="Recent Outcomes"
              subtitle="The live record OPUS learns from."
            />
            {outcomes.length > 0 ? (
              <div className="divide-y divide-border">
                {outcomes.map((o) => (
                  <div key={o.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="mb-0.5 flex items-center gap-2">
                        <Pill tone="primary">{o.conceptType}</Pill>
                        {o.attributes.pattern && (
                          <span className="text-[11px] text-white/40">{o.attributes.pattern}</span>
                        )}
                      </div>
                      <p className="truncate text-sm text-white/70">{o.conceptText}</p>
                      <p className="mt-0.5 text-[11px] text-white/35">
                        {[o.angle, o.attributes.audience, o.attributes.awareness]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Pill tone={verdictTone[o.verdict]}>{VERDICT_LABELS[o.verdict]}</Pill>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid place-items-center px-6 py-14 text-center">
                <BarChart3 size={30} className="mb-3 text-white/15" />
                <p className="max-w-sm text-sm text-white/40">
                  No outcomes yet. Grade concepts in the Reactor and they appear here as the record
                  the agent learns from.
                </p>
              </div>
            )}
          </Panel>
        </div>

        {/* Strategic recommendations — compact briefing cards → full tab */}
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

        {/* Creative Learnings Rubric — the lessons ORACLE applies on self-critique */}
        <SectionLabel>Creative Learnings Rubric</SectionLabel>
        <div className="space-y-4">
          {learnings.map((l, i) => (
            <Panel key={l.insight} hover className="p-5">
              <div className="flex items-start gap-4">
                <span className="panel-icon acc-emerald grid h-10 w-10 shrink-0 place-items-center rounded-lg font-display text-sm font-bold">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex items-center gap-2">
                    <Lightbulb size={16} className="text-glow" />
                    <h3 className="font-display text-base font-semibold text-white">{l.insight}</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-surface/40 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-warning">
                        <BarChart3 size={13} />
                        <span className="text-[10px] font-medium uppercase tracking-wider">Evidence</span>
                      </div>
                      <p className="text-sm text-white/70">{l.evidence}</p>
                    </div>
                    <div className="rounded-lg border border-success/20 bg-success/[0.04] p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-success">
                        <Lightbulb size={13} />
                        <span className="text-[10px] font-medium uppercase tracking-wider">
                          Recommendation
                        </span>
                      </div>
                      <p className="flex items-start gap-1.5 text-sm text-white/80">
                        <ArrowRight size={14} className="mt-0.5 shrink-0 text-success" />
                        {l.recommendation}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>

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
