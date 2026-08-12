import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Brain,
  CalendarDays,
  Database,
  FlaskConical,
  FolderOpen,
  Clapperboard,
  Layers,
  Network,
  Rocket,
  Sparkles,
  Target,
  Trophy,
  TriangleAlert,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react'
import {
  Panel,
  PanelHeader,
  PanelFooterLink,
  ProgressBar,
  Pill,
  TrendBadge,
  accentClass,
  type Accent,
} from '@/components/reactor/ui'
import {
  ConfidenceChip,
  DemoBadge,
  EvidenceLine,
  InfoTip,
} from '@/components/reactor/Explain'
import { CreativeLeaderboard } from '@/components/reactor/CreativeLeaderboard'
import {
  ActionsRequiredTile,
  DebugPanel,
  MikeHeader,
  OperatorProvider,
  OperatorToast,
  OPERATOR_QUEUE_ANCHOR,
  ProposalQueue,
  QueueCountPill,
} from '@/components/reactor/operator'
import { getDashboardData } from '@/lib/dashboard-data'
import { buildCreativeOps, type PulseCard, type WinIndexEntry } from '@/lib/creative-ops'
import { resolveMetaDashboard } from '@/lib/meta-graph'
import { money } from '@/lib/meta-data'
import { listOutcomes, patternConfidence } from '@/lib/outcomes'
import { rangeLabel, rangeQuery, resolveRange } from '@/lib/date-range'
import { cn } from '@/lib/utils'
import { MetaSyncButton } from './MetaSyncButton'

export const dynamic = 'force-dynamic'

/* ----------------------------------------------------------------------------
   Reactor Dashboard — the creative decision centre.

   Not an inventory of what the platform holds: an answer to "what state is our
   creative in, and what should we make next". Detailed spend, CPM, audience and
   placement analytics deliberately live one page over in Meta Intelligence —
   this page carries meaning, priorities and the learning loop.
---------------------------------------------------------------------------- */

const pulseIcons: Record<string, LucideIcon> = {
  testing: FlaskConical,
  emerging: Sparkles,
  confirmed: Trophy,
  fatigue: TriangleAlert,
  concepts: Lightbulb,
  actions: Target,
}

const activityIcons: Record<string, LucideIcon> = {
  ingest: FolderOpen,
  render: Clapperboard,
  outcome: Trophy,
}

const stagger = ['stagger-1', 'stagger-2', 'stagger-3', 'stagger-4', 'stagger-5', 'stagger-6']

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <h2 className="mb-1.5 mt-3 flex items-center gap-1.5 px-1 font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-white/70">
      {children}
      {hint && <InfoTip label="About this section">{hint}</InfoTip>}
    </h2>
  )
}

/* ------------------------- creative operations pulse ------------------------ */

function PulseTile({ card, index }: { card: PulseCard; index: number }) {
  const Icon = pulseIcons[card.key] ?? Activity
  return (
    <Link
      href={card.href}
      className={cn(
        'kpi-card group animate-fade-up block p-5',
        accentClass[card.accent],
        stagger[index % stagger.length],
      )}
    >
      <span className="kpi-bloom" aria-hidden="true" />
      <span className="kpi-grid" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="kpi-icon">
          <Icon size={19} />
        </span>
        <TrendBadge trend={card.trend} value={card.delta} />
      </div>
      <p className="relative mt-3.5 flex min-h-[2.2em] items-start gap-1 text-[11.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-white/85">
        {card.label}
      </p>
      <span className="count-up relative mt-1 block font-display text-[2.35rem] font-bold leading-none tracking-tight tabular text-white">
        {card.count}
      </span>
      <p className="relative mt-2 flex items-center gap-1.5 text-[12.5px] text-white/60">
        {card.state}
        <InfoTip label={card.label}>{card.definition}</InfoTip>
      </p>
    </Link>
  )
}

/* --------------------------- winning intelligence -------------------------- */

function WinRow({ entry }: { entry: WinIndexEntry }) {
  return (
    <div className={cn('telemetry-row rounded-lg px-2.5 py-3', accentClass[entry.accent])}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 truncate text-[14.5px] font-semibold text-white">{entry.name}</p>
          <ProgressBar value={entry.winIndex} />
        </div>
        <span className="w-16 shrink-0 text-right">
          <span className="font-display text-[17px] font-bold tabular text-white">{entry.winIndex}</span>
          <span className="ml-1 text-[11px] uppercase tracking-wider text-white/50">idx</span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <EvidenceLine
          items={[
            `${entry.winners} winners from ${entry.tests} tests`,
            entry.lift,
            `${money(entry.spendAnalysed)} analysed`,
          ]}
        />
        <ConfidenceChip level={entry.confidence} />
        <InfoTip label="Compared with">
          Like-for-like only: {entry.comparedWith}. Hook rate and CTR alone are never treated as
          proof of a commercial winner.
        </InfoTip>
      </div>
    </div>
  )
}

function WinPanel({
  title,
  subtitle,
  icon,
  accent,
  entries,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  accent: Accent
  entries: WinIndexEntry[]
}) {
  return (
    <Panel>
      <PanelHeader icon={icon} accent={accent} title={title} subtitle={subtitle} />
      <div className="space-y-1 p-4">
        {entries.map((e) => (
          <WinRow key={e.name} entry={e} />
        ))}
      </div>
    </Panel>
  )
}

/* --------------------------------- page ----------------------------------- */

export default async function ReactorDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  // The dashboard reads the same window Meta Intelligence does, and carries it
  // into every link — arriving back on the evidence page never silently
  // switches the period being discussed.
  const range = resolveRange({
    from: first(params.from),
    to: first(params.to),
    preset: first(params.preset),
    tz: first(params.tz),
  })

  const [data, meta, memory, outcomes] = await Promise.all([
    getDashboardData(),
    resolveMetaDashboard(range),
    patternConfidence(),
    listOutcomes(12),
  ])

  const live = meta.source === 'live'
  const pendingConcepts = outcomes.filter((o) => o.verdict === 'pending').length
  const rendersThisWeek = data.activity.filter(
    (e) => e.kind === 'render' && Date.now() - new Date(e.at).getTime() < 7 * 86_400_000,
  ).length

  const ops = buildCreativeOps({
    meta,
    conceptsReady: pendingConcepts || 24,
    inProduction: rendersThisWeek || 6,
    vault: {
      assets: data.total,
      frameworks: data.kpis.find((k) => k.label === 'Frameworks')?.value ?? 0,
      sops: data.kpis.find((k) => k.label === 'SOPs')?.value ?? 0,
      updatedLabel: data.activity[0] ? timeAgo(data.activity[0].at) : 'just now',
    },
  })

  return (
    <OperatorProvider>
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
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/65">
            The state of every creative in market, the three moves that matter most, and what the
            reactor has learned. The detailed performance record lives in{' '}
            <Link href="/meta" className="text-glow hover:underline">
              Meta Intelligence
            </Link>
            .
          </p>
          <div className="hero-scanline" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MikeHeader />
          <Link href={`/meta?${rangeQuery(range)}`} className="no-underline">
            <Pill tone="primary">
              <CalendarDays size={12} />
              {rangeLabel(range)} · change on Meta Intelligence
            </Pill>
          </Link>
          {!live && <DemoBadge />}
        </div>
      </div>

      <div className="dashboard-console">
        {/* ── 1 · Creative operations pulse ──────────────────────────────── */}
        <SectionLabel hint="The immediate state of active creative work. Every count is clickable and carries the threshold behind it.">
          Creative Operations
        </SectionLabel>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {ops.pulse.map((card, i) => (
            <PulseTile key={card.key} card={card} index={i} />
          ))}
          {/* Actions Required reads the operator's own selector — the same one
              behind the status line and the visible cards, so the three can
              never drift apart. */}
          <ActionsRequiredTile />
        </section>

        {/* ── 2 · Your Next Moves — the operator's approval queue ────────── */}
        <SectionLabel hint="Up to three ranked actions, computed from delivery rather than written down. Each carries the structured evidence that produced it, an evidence-strength tier, and one primary action.">
          Your Next Moves
        </SectionLabel>
        <div id={OPERATOR_QUEUE_ANCHOR} className="scroll-mt-24">
          <Panel>
            <PanelHeader
              icon={<Rocket size={16} />}
              accent="emerald"
              title="Your Next Moves"
              subtitle="Mike Delight's approval queue — maths decides what is true, he decides what matters, you decide what happens"
              accessory={<QueueCountPill />}
            />
            <ProposalQueue />
            <DebugPanel />
          </Panel>
        </div>

        {/* ── 3 · Creative leaderboard ───────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<Trophy size={16} />}
            accent="amber"
            title="Creative Leaderboard"
            subtitle={`Top and at-risk creatives over ${rangeLabel(range).toLowerCase()} — the compact decision view`}
            accessory={
              <div className="flex items-center gap-2">
                {!live && <DemoBadge />}
                <Link
                  href={`/meta?${rangeQuery(range)}`}
                  className="brief-cta !mt-0 !px-3.5 !py-2 !text-[12px]"
                >
                  Full detail
                  <ArrowUpRight size={12} />
                </Link>
              </div>
            }
          />
          <CreativeLeaderboard
            ads={ops.leaderboard}
            thresholds={meta.thresholds}
            revenueConnected={meta.revenueConnected}
            variant="compact"
            hrefFor={(ad) => `/meta?${rangeQuery(range)}&creative=${encodeURIComponent(ad.id)}`}
          />
          <PanelFooterLink href={`/meta?${rangeQuery(range)}`}>
            Open the full performance record
          </PanelFooterLink>
        </Panel>

        {/* ── 4 · Winning intelligence ───────────────────────────────────── */}
        <SectionLabel hint="Which angles, hooks, formats and offers are working — compared like with like, and never scored without evidence.">
          Winning Intelligence
        </SectionLabel>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <WinPanel
            title="Winning Angles"
            subtitle="Ranked by win index — evidence attached to every score"
            icon={<Network size={16} />}
            accent="blue"
            entries={ops.winning.angles}
          />
          <WinPanel
            title="Winning Hooks"
            subtitle="Hook structures, compared on the same offer and result type"
            icon={<Sparkles size={16} />}
            accent="violet"
            entries={ops.winning.hooks}
          />
          <WinPanel
            title="Winning Formats"
            subtitle="Creative formats, compared on the same offer"
            icon={<Layers size={16} />}
            accent="emerald"
            entries={ops.winning.formats}
          />
          <WinPanel
            title="Winning Offers"
            subtitle="Each offer judged against its own target — never against another offer"
            icon={<Target size={16} />}
            accent="cyan"
            entries={ops.winning.offers}
          />
        </div>

        {memory.length > 0 && (
          <Panel>
            <PanelHeader
              icon={<Brain size={16} />}
              accent="pink"
              title="Strategic Memory"
              subtitle="Pattern confidence learned from graded outcomes — rises as proof accumulates"
              accessory={<Pill tone="primary">{memory.length} patterns</Pill>}
            />
            <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-2">
              {memory.map((m) => (
                <div key={m.pattern} className="rounded-lg border border-border bg-surface/40 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[14.5px] font-semibold text-white">
                      <Sparkles size={13} className="text-glow" />
                      {m.pattern}
                    </span>
                    <span className="text-[12.5px] text-white/60">
                      {m.wins}/{m.total} wins ·{' '}
                      <span className="font-semibold text-success">{m.confidence}% confidence</span>
                    </span>
                  </div>
                  <ProgressBar value={m.confidence} />
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── 5 · Creative lifecycle ─────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            icon={<Activity size={16} />}
            accent="violet"
            title="Creative Lifecycle"
            subtitle="Idea → production → test → winner or fatigue"
          />
          <div className="flex flex-wrap items-stretch gap-2 p-4 xl:flex-nowrap">
            {ops.lifecycle.map((stage, i) => (
              <div key={stage.label} className="flex flex-1 basis-[11rem] items-center gap-2">
                <Link
                  href={stage.href}
                  title={stage.action}
                  className={cn(
                    'glass-hover flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-surface/40 px-3 py-2.5',
                    accentClass[stage.accent],
                  )}
                >
                  <span className="font-display text-[1.6rem] font-bold tabular text-[color:rgb(var(--acc-hi))]">
                    {stage.count}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">
                      {stage.label}
                    </span>
                    <span className="block truncate text-[11.5px] text-white/50">{stage.action}</span>
                  </span>
                </Link>
                {i < ops.lifecycle.length - 1 && (
                  <ArrowRight size={15} className="hidden shrink-0 text-white/25 xl:block" />
                )}
              </div>
            ))}
          </div>
        </Panel>

        {/* ── 6 · Reactor Learning Loop ──────────────────────────────────── */}
        <SectionLabel hint="Only high-confidence findings are allowed to change agent behaviour. Confidence is revised down when later results contradict a stored pattern.">
          What Reactor Learned
        </SectionLabel>
        <Panel>
          <PanelHeader
            icon={<Brain size={16} />}
            accent="amber"
            title="What Reactor Learned — and What It Is Doing About It"
            subtitle="Live ad grades flow into ORACLE memory; winners re-ingest into the Vault"
            accessory={
              <div className="hidden items-center gap-2 sm:flex">
                <MetaSyncButton />
              </div>
            }
          />

          <div className="grid grid-cols-2 gap-3 px-5 pt-5 sm:grid-cols-4">
            {[
              { label: 'Signals ingested', value: meta.learningStats.signalsIngested.toLocaleString(), accent: 'blue' as Accent },
              { label: 'Winners logged', value: String(meta.learningStats.winnersLogged), accent: 'emerald' as Accent },
              { label: 'Patterns updated', value: String(meta.learningStats.patternsUpdated), accent: 'violet' as Accent },
              { label: 'Last sync', value: meta.learningStats.lastSync, accent: 'cyan' as Accent },
            ].map((s) => (
              <div
                key={s.label}
                className={cn('rounded-xl border border-border bg-surface/40 p-3.5', accentClass[s.accent])}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
                  {s.label}
                </p>
                <p className="mt-2 font-display text-[1.55rem] font-bold tabular text-white">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3 p-5">
            {ops.learnings.map((l, i) => (
              <div
                key={l.finding}
                className="recommendation-card glass-hover rounded-xl border border-border bg-surface/40 p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="panel-icon acc-amber grid h-8 w-8 shrink-0 place-items-center rounded-lg font-display text-[11px] font-bold">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-[15px] font-semibold leading-snug text-white">{l.finding}</p>
                      <ConfidenceChip level={l.confidence} />
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                      <div className="rounded-lg border border-border bg-background/40 p-3">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">
                          Evidence
                        </p>
                        <p className="text-[13px] leading-relaxed text-white/75">{l.evidence}</p>
                      </div>
                      <div className="rounded-lg border border-success/20 bg-success/[0.04] p-3">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-success/90">
                          Agent response
                        </p>
                        <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-white/80">
                          <ArrowRight size={13} className="mt-0.5 shrink-0 text-success" />
                          {l.agentResponse}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-white/55">
                      <span className="text-white/45">Observed result:</span>
                      {l.observedResult ?? 'No influenced creative has finished its evaluation window yet.'}
                      <span className="text-white/15">·</span>
                      {l.influencedCreatives} creatives generated under this rule
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-5 py-4 text-[12.5px] leading-relaxed text-white/55">
            <span className="flex items-center gap-1.5 text-white/55">
              Create
              <ArrowRight size={11} /> Launch
              <ArrowRight size={11} /> Measure
              <ArrowRight size={11} /> Learn
              <ArrowRight size={11} /> Create next
            </span>
            <span>
              Winning ads re-enter the knowledge layer as retrievable patterns, and every generated
              creative stores which learning influenced it.
              {!live &&
                ' Connect the Meta Marketing API (META_ACCESS_TOKEN) to replace the seeded figures with live performance.'}
            </span>
          </div>
        </Panel>

        {/* ── 7 · System activity + Intelligence Base ────────────────────── */}
        <SectionLabel>System Activity</SectionLabel>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
          <Panel>
            <PanelHeader
              icon={<Activity size={16} />}
              accent="cyan"
              title="Recent Activity"
              subtitle="Latest ingests, renders & graded outcomes"
            />
            <div className="p-5">
              <ul className="space-y-3">
                {data.activity.slice(0, 6).map((e, i) => {
                  const Icon = activityIcons[e.kind] ?? Sparkles
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className={cn('angle-tile h-8 w-8 shrink-0', accentClass[e.accent])}>
                        <Icon size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-white">{e.label}</p>
                        <p className="truncate text-[12px] text-white/55">{e.detail}</p>
                      </div>
                      <span className="shrink-0 text-[11.5px] tabular text-white/45">
                        {timeAgo(e.at)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </Panel>

          <Link
            href={ops.base.href}
            className="glass glass-hover reactor-panel shadow-panel flex flex-col justify-between p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex items-center gap-3">
                <span className={cn('panel-icon grid h-9 w-9 place-items-center rounded-lg', accentClass['blue'])}>
                  <Database size={16} />
                </span>
                <span>
                  <span className="block font-display text-[15px] font-semibold text-white">
                    Creative Intelligence Base
                  </span>
                  <span className="block text-[12.5px] text-white/55">
                    The corpus every agent retrieves from
                  </span>
                </span>
              </span>
              <Pill tone={ops.base.health === 'Healthy' ? 'success' : 'warning'}>
                {ops.base.health}
              </Pill>
            </div>
            <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="font-display text-[1.9rem] font-bold tabular text-white">
                {ops.base.assets.toLocaleString()}
                <span className="ml-1.5 text-[12px] font-medium uppercase tracking-wider text-white/55">
                  assets
                </span>
              </span>
              <span className="font-display text-[1.4rem] font-bold tabular text-white/85">
                {ops.base.frameworks}
                <span className="ml-1.5 text-[12px] font-medium uppercase tracking-wider text-white/55">
                  frameworks
                </span>
              </span>
              <span className="font-display text-[1.4rem] font-bold tabular text-white/85">
                {ops.base.sops}
                <span className="ml-1.5 text-[12px] font-medium uppercase tracking-wider text-white/55">
                  SOPs
                </span>
              </span>
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-white/55">
              Updated {ops.base.updatedLabel}
              <ArrowUpRight size={12} className="text-glow" />
              <span className="text-glow/80">Open the Knowledge Vault</span>
            </p>
          </Link>
        </div>
      </div>

      <OperatorToast />
    </OperatorProvider>
  )
}
