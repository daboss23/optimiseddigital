import { Anchor, Heading, Network, Tag } from 'lucide-react'
import { PageHeader, Panel, PanelHeader, Pill, ProgressBar, accentClass, type Accent } from '@/components/reactor/ui'
import { topHooks, topHeadlines, topOffers, patterns } from '@/lib/reactor-data'
import type { CopyItem } from '@/lib/reactor-data'
import { cn } from '@/lib/utils'

const patternAccents: Accent[] = ['emerald', 'cyan', 'blue', 'amber', 'violet', 'pink']

function CopyList({ items, rank }: { items: CopyItem[]; rank: string }) {
  return (
    <ol className="space-y-2.5 p-5">
      {items.map((item, i) => (
        <li
          key={item.text}
          className="glass-hover flex items-start gap-3 rounded-xl border border-border bg-surface/40 p-3"
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 font-display text-xs font-bold text-glow">
            {rank}
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/85">{item.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Pill tone="success">{item.metric}</Pill>
              <Pill>{item.angle}</Pill>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-2 px-1 font-display text-sm font-semibold uppercase tracking-wider text-white/50">
      {children}
    </h2>
  )
}

export default function PlaybookPage() {
  return (
    <>
      <PageHeader
        system="04"
        title="Playbook"
        subtitle="Everything that has already worked, decoded. The winning copy TPB has run — hook, headline, offer — and the reusable strategic patterns behind it. This is the proven material the reactor draws on."
        tagline="Engineered For Performance."
      />

      {/* ── Winning copy, by role ─────────────────────────────────────── */}
      <SectionLabel>Winning Copy</SectionLabel>

      <div className="flex flex-wrap gap-2">
        {['Angle', 'Emotion', 'Belief', 'Desire', 'Objection', 'Offer'].map((d) => (
          <Pill key={d} tone="primary">
            {d}
          </Pill>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel>
          <PanelHeader icon={<Anchor size={16} />} accent="blue" title="Top Performing Hooks" />
          <CopyList items={topHooks} rank="H" />
        </Panel>
        <Panel>
          <PanelHeader icon={<Heading size={16} />} accent="violet" title="Top Performing Headlines" />
          <CopyList items={topHeadlines} rank="L" />
        </Panel>
        <Panel>
          <PanelHeader icon={<Tag size={16} />} accent="amber" title="Top Performing Offers" />
          <CopyList items={topOffers} rank="O" />
        </Panel>
      </div>

      {/* ── Strategic patterns (ORACLE's memory) ──────────────────────── */}
      <SectionLabel>Strategic Patterns</SectionLabel>
      <p className="-mt-1 mb-1 px-1 text-sm leading-relaxed text-white/45">
        ORACLE&apos;s memory of the configurations that win on repeat — angle, audience, offer,
        awareness, and the creative + copy structure behind each — feeding every future
        recommendation.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {patterns.map((p, i) => {
          const accent = patternAccents[i % patternAccents.length]
          return (
            <Panel key={p.name} hover className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={cn('panel-icon grid h-9 w-9 place-items-center rounded-lg', accentClass[accent])}
                  >
                    <Network size={16} />
                  </span>
                  <h2 className="font-display text-base font-semibold text-white">{p.name}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold tabular text-glow">{p.strength}</span>
                  <span className="text-[10px] text-white/35">strength</span>
                </div>
              </div>
              <ProgressBar value={p.strength} />

              <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
                {[
                  { k: 'Hook', v: p.hook },
                  { k: 'Headline', v: p.headline },
                  { k: 'Creative Style', v: p.creativeStyle },
                  { k: 'Transformation', v: p.transformation },
                  { k: 'Offer', v: p.offer },
                  { k: 'CTA', v: p.cta },
                ].map((row) => (
                  <div key={row.k}>
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                      {row.k}
                    </dt>
                    <dd className="text-sm text-white/75">{row.v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 rounded-lg border border-border bg-surface/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-white/35">Notes</p>
                <p className="mt-1 text-sm text-white/65">{p.notes}</p>
              </div>
            </Panel>
          )
        })}
      </div>
    </>
  )
}
