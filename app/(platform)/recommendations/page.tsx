import { Target, Package, ArrowUpRight } from 'lucide-react'
import { PageHeader, Panel, Pill, ProgressBar } from '@/components/reactor/ui'
import { recommendations } from '@/lib/reactor-data'

export default function RecommendationsPage() {
  return (
    <>
      <PageHeader
        system="07"
        title="Strategic Recommendations"
        subtitle="The one question the platform answers: what should this business create next? Each recommendation is engineered from everything that has already worked."
        tagline="Engineered For Performance."
      />

      <div className="space-y-4">
        {recommendations.map((r) => (
          <Panel key={r.campaign} hover className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="panel-icon acc-amber grid h-10 w-10 place-items-center rounded-lg">
                  <Target size={18} />
                </span>
                <div>
                  <h2 className="font-display text-lg font-semibold text-white">{r.campaign}</h2>
                  <p className="text-xs text-white/40">Recommended campaign</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Pill tone={r.priority === 'Critical' ? 'danger' : 'warning'}>{r.priority}</Pill>
                <div className="text-right">
                  <p className="font-display text-xl font-bold tabular text-glow">{r.confidence}%</p>
                  <p className="text-[10px] text-white/35">confidence</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                    Reason
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-white/70">{r.reason}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/40 p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                    Suggested Hook
                  </p>
                  <p className="mt-1 font-display text-base italic text-white/90">
                    “{r.suggestedHook}”
                  </p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] text-white/40">
                    <span>Confidence index</span>
                    <span>{r.confidence}/100</span>
                  </div>
                  <ProgressBar value={r.confidence} />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface/40 p-4">
                <div className="mb-3 flex items-center gap-2 text-white/60">
                  <Package size={15} className="text-glow" />
                  <span className="text-[11px] font-medium uppercase tracking-wider">
                    Assets Needed
                  </span>
                </div>
                <ul className="space-y-2">
                  {r.assetsNeeded.map((a) => (
                    <li
                      key={a}
                      className="flex items-center justify-between rounded-lg border border-border bg-background/30 px-3 py-2 text-sm text-white/75"
                    >
                      {a}
                      <ArrowUpRight size={14} className="text-glow" />
                    </li>
                  ))}
                </ul>
                <a
                  href="/campaign-reactor"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-glow transition-all hover:bg-primary/20"
                >
                  Build in Reactor <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </>
  )
}
