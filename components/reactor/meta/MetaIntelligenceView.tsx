import Link from 'next/link'
import {
  Activity,
  DollarSign,
  Gauge,
  Layers,
  Minus,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Panel, PanelHeader, Pill, ProgressBar, RadialGauge, accentClass } from '@/components/reactor/ui'
import { InfoTip } from '@/components/reactor/Explain'
import { CreativeLeaderboard } from '@/components/reactor/CreativeLeaderboard'
import { RESULT_LABELS, thresholdSummary } from '@/lib/creative-status'
import { type BreakdownRow, type MetaDashboard } from '@/lib/meta-data'
import { rangeLabel, rangeSubLabel } from '@/lib/date-range'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   Meta Intelligence — the evidence surface. It answers "what happened".

   Purely presentational: it renders ONE dashboard payload, which was computed
   over ONE date range. Because the whole page reads from a single object, two
   sections can never show different windows — the swap is atomic by
   construction, not by discipline.
---------------------------------------------------------------------------- */

const heroIcons: Record<string, LucideIcon> = {
  'Ad Spend': DollarSign,
  'Primary Results': Target,
  'Cost per Result': Gauge,
  'Result Efficiency': Activity,
  ROAS: TrendingUp,
}

/** Subtle in-card skeleton shown while a new range is being fetched. */
function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'my-1 block animate-pulse rounded-md bg-gradient-to-r from-white/[0.07] via-white/[0.14] to-white/[0.07]',
        className,
      )}
    />
  )
}

function BreakdownPanel({
  rows,
  note,
  loading,
}: {
  rows: BreakdownRow[]
  note: string
  loading?: boolean
}) {
  return (
    <div className="space-y-3.5 p-5">
      {rows.map((r) => (
        <div key={r.label} className="telemetry-row flex items-center gap-3">
          <div className="w-32 shrink-0">
            <p className="truncate text-[14px] font-medium text-white">{r.label}</p>
            {loading ? (
              <Shimmer className="h-3 w-16" />
            ) : (
              <p className="text-[12px] text-white/55">{r.metric}</p>
            )}
          </div>
          <div className="flex-1">
            <ProgressBar value={loading ? 0 : r.share} />
          </div>
          <span className="w-12 text-right font-display text-[15px] font-bold tabular text-white">
            {loading ? '—' : `${r.share}%`}
          </span>
        </div>
      ))}
      <p className="border-t border-border pt-3 text-[12px] leading-relaxed text-white/45">{note}</p>
    </div>
  )
}

export function MetaIntelligenceView({
  data,
  loading = false,
}: {
  data: MetaDashboard
  loading?: boolean
}) {
  const {
    heroKpis,
    metrics,
    topAds,
    spendTrend,
    audienceBreakdown,
    placementBreakdown,
    resultMix,
    primaryResultType,
    revenueConnected,
    thresholds,
    range,
    comparison,
  } = data

  const maxSpend = Math.max(...spendTrend.map((w) => w.spend), 1)
  const resultLabel = RESULT_LABELS[primaryResultType]
  const windowLabel = rangeLabel(range).toLowerCase()

  return (
    <div className={cn('dashboard-console', loading && 'pointer-events-none select-none')}>
      {/* Hero KPIs — objective-aware, every number defined, all one window */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {heroKpis.map((k) => {
          const Icon = heroIcons[k.label] ?? Activity
          const TrendIcon =
            k.trend === 'down' ? TrendingDown : k.trend === 'flat' ? Minus : TrendingUp
          return (
            <div key={k.label} className={cn('kpi-card group p-5', accentClass[k.accent])}>
              <div className="kpi-bloom" aria-hidden="true" />
              <div className="relative flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="kpi-icon">
                    <Icon size={21} />
                  </span>
                  <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-white/85">
                    {k.label}
                    {k.definition && <InfoTip label={k.label}>{k.definition}</InfoTip>}
                  </p>
                </div>
                {k.delta && !loading && (
                  <span className="accent-chip tabular" title={`vs ${rangeSubLabel(comparison)}`}>
                    <TrendIcon size={13} />
                    {k.delta.replace('+', '')}
                  </span>
                )}
              </div>

              {loading ? (
                <Shimmer className="relative mt-4 h-9 w-3/4" />
              ) : (
                <span className="relative mt-4 block font-display text-[2.15rem] font-bold leading-none tabular text-white">
                  {k.value}
                </span>
              )}
              {loading ? (
                <Shimmer className="h-3 w-1/2" />
              ) : (
                <p className="mt-2 text-[12.5px] leading-snug text-white/60">{k.sub}</p>
              )}

              {/* A mixed total is never left as one number — the split is right here. */}
              {k.breakdown && k.breakdown.length > 1 && (
                <ul className="relative mt-3.5 space-y-1.5 border-t border-border pt-3">
                  {k.breakdown.map((slice) => (
                    <li key={slice.type} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="truncate text-white/60">{RESULT_LABELS[slice.type].many}</span>
                      <span className="tabular font-medium text-white/90">
                        {loading ? '—' : slice.count.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </section>

      {/* Efficiency + creative-quality read-outs */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className={cn(
              'kpi-card kpi-card--compact flex min-h-[7.9rem] items-center justify-between gap-4 p-5',
              accentClass[m.accent],
            )}
          >
            <div className="kpi-bloom" aria-hidden="true" />
            <div className="relative min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-tight tracking-[0.1em] text-white/75">
                {m.label}
                {m.definition && <InfoTip label={m.label}>{m.definition}</InfoTip>}
              </p>
              {loading ? (
                <Shimmer className="mt-2 h-6 w-20" />
              ) : (
                <p className="mt-2 truncate font-display text-[1.55rem] font-bold leading-none text-white">
                  {m.value}
                </p>
              )}
              <p className="mt-2 text-[12px] leading-snug tabular text-white/55">{m.metric}</p>
            </div>
            <RadialGauge value={loading ? 0 : m.pct} accent={m.accent} />
          </div>
        ))}
      </section>

      {/* Spend / efficiency trend */}
      <Panel>
        <PanelHeader
          icon={<Activity size={16} />}
          accent="blue"
          title={revenueConnected ? 'Spend & ROAS Trend' : 'Spend & Cost per Result Trend'}
          subtitle={
            revenueConnected
              ? `Spend with connected revenue return across ${windowLabel}`
              : `Spend with ${resultLabel.cost} across ${windowLabel} — the efficiency line for a lead account`
          }
          accessory={<Pill tone="primary">{spendTrend.length} periods</Pill>}
        />
        <div className="p-5">
          <div className="flex h-52 items-end justify-between gap-2">
            {spendTrend.map((w) => (
              <div key={w.from} className="flex h-full flex-1 flex-col items-center gap-2">
                <span className="font-display text-[12.5px] font-bold tabular text-glow">
                  {loading
                    ? '—'
                    : revenueConnected && w.roas !== null
                      ? `${w.roas}x`
                      : w.costPerResult > 0
                        ? `$${Math.round(w.costPerResult)}`
                        : '—'}
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={cn(
                      'w-full rounded-t-md bg-gradient-to-t from-primary/30 via-primary to-cyan shadow-[0_0_16px_-4px_rgba(45,190,255,0.7)] transition-[height] duration-500',
                      loading && 'animate-pulse opacity-40',
                    )}
                    style={{ height: `${loading ? 30 : Math.round((w.spend / maxSpend) * 100)}%` }}
                    title={`${w.from} → ${w.to}: $${w.spend.toLocaleString()}`}
                  />
                </div>
                <span className="text-[11px] uppercase tracking-wider text-white/45">{w.label}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[12px] text-white/55">
            <span>Bar height = spend per period</span>
            <span className="flex items-center gap-1 text-glow/90">
              Label = {revenueConnected ? 'ROAS' : resultLabel.cost}
              <InfoTip label={revenueConnected ? 'ROAS' : resultLabel.cost} align="right">
                {revenueConnected
                  ? 'Purchase ROAS reported by Meta for each period in the selected range.'
                  : `Spend divided by ${resultLabel.many} for each period in the selected range. ROAS is not shown because no revenue or defensible conversion value is connected — an assigned lead value would not be a return.`}
              </InfoTip>
            </span>
          </div>
        </div>
      </Panel>

      {/* Top performing ads */}
      <Panel>
        <PanelHeader
          icon={<Trophy size={16} />}
          accent="emerald"
          title="Top Performing Ads"
          subtitle={`Ranked by ${resultLabel.cost} over ${windowLabel} — click a status for the evidence behind it`}
          accessory={
            <InfoTip label="Ranking rules" align="right">
              Ranked within a comparable cohort only, using the selected range. Creatives below the
              evaluation threshold ({thresholdSummary(thresholds)}) are shown as Insufficient data
              rather than forced into a ranking. Days live is lifecycle metadata — the creative&apos;s
              own age, not the analysed window.
            </InfoTip>
          }
        />
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Shimmer className="h-11 w-11 shrink-0 rounded-lg" />
                <Shimmer className="h-4 flex-1" />
                <Shimmer className="h-4 w-24" />
                <Shimmer className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <CreativeLeaderboard
            ads={topAds}
            thresholds={thresholds}
            revenueConnected={revenueConnected}
            variant="full"
            interactiveStatus
            hrefFor={(ad) => `/ad-library?creative=${encodeURIComponent(ad.id)}`}
          />
        )}
      </Panel>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel>
          <PanelHeader
            icon={<Users size={16} />}
            accent="violet"
            title="Audience Breakdown"
            subtitle={`Spend share and ${resultLabel.cost} by segment, ${windowLabel}`}
          />
          <BreakdownPanel
            rows={audienceBreakdown}
            loading={loading}
            note="Cold prospecting and retargeting are shown side by side, not compared as equivalent cohorts — a retargeting cost per result is not evidence that a creative beats a cold one."
          />
        </Panel>
        <Panel>
          <PanelHeader
            icon={<Layers size={16} />}
            accent="pink"
            title="Placement Breakdown"
            subtitle={`Spend share and CTR by placement, ${windowLabel}`}
          />
          <BreakdownPanel
            rows={placementBreakdown}
            loading={loading}
            note="CTR by placement is a delivery signal, not a commercial verdict. Judge placements on cost per result before shifting budget."
          />
        </Panel>
      </div>

      {/* Result mix + hand-off back to the decision surface */}
      <Panel>
        <PanelHeader
          icon={<Target size={16} />}
          accent="cyan"
          title="Result Mix"
          subtitle="Every result type counted separately — the account total is never one blended number"
        />
        <div className="flex flex-wrap items-center gap-3 p-5">
          {resultMix.map((slice) => (
            <div key={slice.type} className="rounded-xl border border-border bg-surface/40 px-5 py-3.5">
              {loading ? (
                <Shimmer className="h-6 w-16" />
              ) : (
                <p className="font-display text-[1.4rem] font-bold tabular text-white">
                  {slice.count.toLocaleString()}
                </p>
              )}
              <p className="mt-1 text-[12.5px] text-white/60">{RESULT_LABELS[slice.type].many}</p>
            </div>
          ))}
          <Link href="/" className="brief-cta !mt-0 ml-auto">
            What this means → Reactor Dashboard
          </Link>
        </div>
      </Panel>
    </div>
  )
}
