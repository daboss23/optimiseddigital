import {
  Activity,
  DollarSign,
  Layers,
  MousePointerClick,
  Minus,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  PageHeader,
  Panel,
  PanelHeader,
  Pill,
  ProgressBar,
  RadialGauge,
  accentClass,
} from '@/components/reactor/ui'
import { type MetaAd, type BreakdownRow } from '@/lib/meta-data'
import { resolveMetaDashboard } from '@/lib/meta-graph'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const heroIcons: Record<string, LucideIcon> = {
  'Ad Spend': DollarSign,
  'Blended ROAS': TrendingUp,
  Conversions: Target,
  'Avg CTR': MousePointerClick,
}

const statusTone: Record<MetaAd['status'], 'success' | 'primary' | 'warning' | 'danger'> = {
  Scaling: 'success',
  Winner: 'success',
  Stable: 'primary',
  Testing: 'warning',
  Fatiguing: 'danger',
}

function BreakdownPanel({ rows }: { rows: BreakdownRow[] }) {
  return (
    <div className="space-y-3 p-5">
      {rows.map((r) => (
        <div key={r.label} className="telemetry-row flex items-center gap-3">
          <div className="w-28 shrink-0">
            <p className="truncate text-sm font-medium text-white">{r.label}</p>
            <p className="text-[11px] text-white/35">{r.metric}</p>
          </div>
          <div className="flex-1">
            <ProgressBar value={r.share} />
          </div>
          <span className="w-10 text-right font-display text-sm font-bold tabular text-white">
            {r.share}%
          </span>
        </div>
      ))}
    </div>
  )
}

export default async function MetaIntelligencePage() {
  const {
    source,
    heroKpis: metaHeroKpis,
    metrics: metaMetrics,
    topAds: metaTopAds,
    spendTrend: metaSpendTrend,
    audienceBreakdown: metaAudienceBreakdown,
    placementBreakdown: metaPlacementBreakdown,
  } = await resolveMetaDashboard()
  const live = source === 'live'
  const maxSpend = Math.max(...metaSpendTrend.map((w) => w.spend), 1)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          system="06"
          title="Meta Intelligence"
          subtitle="Live ad performance feeding the reactor. What is actually converting — spend, ROAS, CTR, CPA, creative quality — read straight from the Meta Marketing API. The learning loop these numbers drive lives on the Reactor Dashboard."
          tagline="Engineered For Performance."
        />
        <Pill tone={live ? 'success' : 'warning'}>
          <span
            className={cn('h-1.5 w-1.5 rounded-full', live ? 'dot-live animate-pulse-glow' : 'bg-warning')}
          />
          <span className="font-semibold uppercase tracking-[0.16em]">
            {live ? 'Live · Meta API' : 'Demo data'}
          </span>
        </Pill>
      </div>

      <div className="dashboard-console">
        {/* Hero KPIs */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {metaHeroKpis.map((k) => {
            const Icon = heroIcons[k.label] ?? Activity
            const TrendIcon =
              k.trend === 'down' ? TrendingDown : k.trend === 'flat' ? Minus : TrendingUp
            return (
              <div key={k.label} className={cn('kpi-card group p-4', accentClass[k.accent])}>
                <div className="kpi-bloom" aria-hidden="true" />
                <div className="relative flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="kpi-icon">
                      <Icon size={20} />
                    </span>
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
                      {k.label}
                    </p>
                  </div>
                  <span className="accent-chip tabular">
                    <TrendIcon size={12} />
                    {k.delta.replace('+', '')}
                  </span>
                </div>
                <span className="relative mt-3 block font-display text-[2rem] font-bold leading-none tabular text-white">
                  {k.value}
                </span>
                <p className="mt-1 text-[11px] text-white/45">{k.sub}</p>
              </div>
            )
          })}
        </section>

        {/* Efficiency + creative-quality read-outs */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metaMetrics.map((m) => (
            <div
              key={m.label}
              className={cn(
                'kpi-card kpi-card--compact flex items-center justify-between gap-4 p-4',
                accentClass[m.accent],
              )}
            >
              <div className="kpi-bloom" aria-hidden="true" />
              <div className="relative min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  {m.label}
                </p>
                <p className="mt-1.5 truncate font-display text-xl font-bold text-white">{m.value}</p>
                <p className="mt-1 text-[11px] tabular text-white/45">{m.metric}</p>
              </div>
              <RadialGauge value={m.pct} accent={m.accent} />
            </div>
          ))}
        </section>

        {/* Spend / ROAS trend + Top ads */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.1fr]">
          <Panel>
            <PanelHeader
              icon={<Activity size={16} />}
              accent="blue"
              title="Spend & ROAS Trend"
              subtitle="Weekly spend with blended return"
              accessory={<Pill tone="primary">8 weeks</Pill>}
            />
            <div className="p-5">
              <div className="flex h-44 items-end justify-between gap-2">
                {metaSpendTrend.map((w) => (
                  <div key={w.week} className="flex flex-1 flex-col items-center gap-2">
                    <span className="font-display text-[11px] font-bold tabular text-glow">
                      {w.roas}x
                    </span>
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-primary/30 via-primary to-cyan shadow-[0_0_16px_-4px_rgba(45,190,255,0.7)]"
                      style={{ height: `${Math.round((w.spend / maxSpend) * 100)}%` }}
                    />
                    <span className="text-[10px] uppercase tracking-wider text-white/35">{w.week}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[11px] text-white/45">
                <span>Bar height = weekly spend</span>
                <span className="text-glow/80">Label = ROAS</span>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<Trophy size={16} />}
              accent="emerald"
              title="Top Performing Ads"
              subtitle="Ranked by ROAS across active creatives"
            />
            <div className="overflow-x-auto p-5">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-white/35">
                    <th className="pb-2 text-left font-medium">Creative</th>
                    <th className="pb-2 text-right font-medium">Spend</th>
                    <th className="pb-2 text-right font-medium">ROAS</th>
                    <th className="pb-2 text-right font-medium">Hook Rate</th>
                    <th className="pb-2 text-right font-medium">CTR</th>
                    <th className="pb-2 text-right font-medium">CPA</th>
                    <th className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {metaTopAds.map((ad) => (
                    <tr key={ad.name} className="text-white/80">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-white">{ad.name}</p>
                        <p className="text-[11px] text-white/35">{ad.format}</p>
                      </td>
                      <td className="py-2.5 text-right tabular">{ad.spend}</td>
                      <td className="py-2.5 text-right font-display font-bold tabular text-glow">
                        {ad.roas}x
                      </td>
                      <td className="py-2.5 text-right tabular text-cyan">{ad.hookRate}</td>
                      <td className="py-2.5 text-right tabular">{ad.ctr}</td>
                      <td className="py-2.5 text-right tabular">{ad.cpa}</td>
                      <td className="py-2.5 text-right">
                        <Pill tone={statusTone[ad.status]}>{ad.status}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Panel>
            <PanelHeader
              icon={<Users size={16} />}
              accent="violet"
              title="Audience Breakdown"
              subtitle="Spend share and return by segment"
            />
            <BreakdownPanel rows={metaAudienceBreakdown} />
          </Panel>
          <Panel>
            <PanelHeader
              icon={<Layers size={16} />}
              accent="pink"
              title="Placement Breakdown"
              subtitle="Spend share and CTR by placement"
            />
            <BreakdownPanel rows={metaPlacementBreakdown} />
          </Panel>
        </div>
      </div>
    </>
  )
}
