import { Radar, Building2, Globe, Sparkles, MessageSquare, Clock, Inbox } from 'lucide-react'
import { PageHeader, Panel, PanelHeader, ProgressBar, Pill } from '@/components/reactor/ui'
import { internalSources, externalSources, researchOutputs } from '@/lib/reactor-data'
import { NOVA_SUBREDDITS, NOVA_FORUMS } from '@/lib/market-intelligence'
import { liveNovaIntel, type LiveNovaSource } from '@/lib/nova-intel'
import { NovaResearch } from './NovaResearch'

export const dynamic = 'force-dynamic'

/** Relative age of an ingest, for the live source rows. */
function ago(iso: string | null): string {
  if (!iso) return 'unknown'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${Math.max(mins, 1)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Sources NOVA has actually mined. Deliberately shows counted facts only —
 * chunks stored, conversations analysed, when it last ran. The curated rows this
 * replaced carried a "signal score" that nothing in the pipeline measures.
 */
function LiveSourceList({ sources }: { sources: LiveNovaSource[] }) {
  return (
    <div className="space-y-3 p-5">
      {sources.map((s) => (
        <div key={s.name} className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{s.name}</p>
            <p className="text-[11px] text-white/35">
              {s.itemsAnalyzed > 0
                ? `${s.itemsAnalyzed.toLocaleString()} conversations · `
                : ''}
              {s.chunks} chunk{s.chunks === 1 ? '' : 's'} · {ago(s.lastIngested)}
            </p>
          </div>
          <span className="shrink-0 rounded-md border border-border bg-surface/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/45">
            {s.type}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Shown when NOVA holds nothing — never curated copy dressed up as findings. */
function NovaEmptyState({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <Inbox size={20} className="text-white/25" />
      <p className="text-sm text-white/55">NOVA hasn’t stored any {what} yet.</p>
      <p className="max-w-md text-[12px] leading-relaxed text-white/35">
        Deploy her above — pick a subreddit, forum, YouTube video or paste a conversation. Everything
        she reads is embedded into the Vault and pulled into every campaign fire automatically.
      </p>
    </div>
  )
}

function SourceList({ data }: { data: { name: string; count: number; signal: number }[] }) {
  return (
    <div className="space-y-3 p-5">
      {data.map((s) => (
        <div key={s.name} className="flex items-center gap-4">
          <div className="w-40 shrink-0">
            <p className="text-sm font-medium text-white">{s.name}</p>
            <p className="text-[11px] text-white/35">{s.count.toLocaleString()} sources</p>
          </div>
          <div className="flex-1">
            <ProgressBar value={s.signal} />
          </div>
          <span className="w-16 text-right">
            <span className="font-display text-sm font-bold tabular text-glow">{s.signal}</span>
            <span className="text-[10px] text-white/30"> sig</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export default async function ResearchPage() {
  // What NOVA actually holds. Never throws — an unconfigured or empty store
  // comes back `live: false`, and the panels below render an empty state rather
  // than curated copy that would read as findings.
  const intel = await liveNovaIntel().catch(() => null)
  const novaIndexed = intel?.totalChunks ?? 0

  return (
    <>
      <PageHeader
        system="02"
        title="Research Intelligence"
        subtitle="NOVA's command center. Send her to where builders actually talk, mine the real conversations, and turn the language, beliefs, and desires into winning campaigns."
        tagline={
          novaIndexed > 0
            ? `${novaIndexed.toLocaleString()} market signals in NOVA's live memory`
            : 'Deploy NOVA to start building live market memory'
        }
      />

      <NovaResearch subreddits={NOVA_SUBREDDITS} forums={NOVA_FORUMS} />

      <Panel>
        <PanelHeader
          icon={<MessageSquare size={16} />}
          accent="violet"
          title="Where NOVA mines — recommended sources"
          subtitle="The highest-signal places a trades & construction audience talks. Deploy NOVA at any of them for a targeted dig."
          accessory={
            <Pill tone="default">
              <Clock size={12} /> Sweeps on demand
            </Pill>
          }
        />
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">
              Reddit communities
            </p>
            <div className="flex flex-wrap gap-1.5">
              {NOVA_SUBREDDITS.map((s) => (
                <span
                  key={s.sub}
                  title={s.note}
                  className="rounded-md border border-border bg-surface/50 px-2.5 py-1 text-[12px] text-white/65"
                >
                  r/{s.sub}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/45">
              Pro forums
            </p>
            <div className="space-y-2">
              {NOVA_FORUMS.map((f) => (
                <a
                  key={f.url}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/40 px-3 py-2 text-sm text-white/70 transition-colors hover:border-glow/40 hover:text-glow"
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="truncate text-[11px] text-white/35">{f.note}</span>
                </a>
              ))}
              <p className="text-[11px] leading-relaxed text-white/35">
                Plus YouTube transcripts and any review or article URL. Facebook Groups & LinkedIn are
                login-walled — paste those conversations into the <span className="text-white/55">Paste</span> tab.
              </p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            icon={<Building2 size={16} />}
            accent="emerald"
            title="Internal Sources"
            subtitle="First-party signal from inside the business — illustrative targets, not yet wired to live data"
            accessory={<Pill tone="warning">Sample</Pill>}
          />
          <SourceList data={internalSources} />
        </Panel>
        <Panel>
          <PanelHeader
            icon={<Globe size={16} />}
            accent="cyan"
            title="External Sources"
            subtitle="What NOVA has actually mined from the wider builder world"
            accessory={
              intel?.live && intel.sources.length > 0 ? (
                <Pill tone="success">
                  <Radar size={12} /> {intel.sourceCount} live
                </Pill>
              ) : (
                <Pill tone="default">No sources yet</Pill>
              )
            }
          />
          {intel?.live && intel.sources.length > 0 ? (
            <LiveSourceList sources={intel.sources} />
          ) : (
            <NovaEmptyState what="external sources" />
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          icon={<Sparkles size={16} />}
          accent="violet"
          title="Extracted Outputs"
          subtitle="What NOVA actually pulled out of the conversations she read"
          accessory={
            intel?.live && intel.outputs.length > 0 ? (
              <Pill tone="success">
                <Radar size={12} /> Live from {intel.sourceCount} source
                {intel.sourceCount === 1 ? '' : 's'}
              </Pill>
            ) : (
              <Pill tone="default">Nothing extracted yet</Pill>
            )
          }
        />
        {intel?.live && intel.outputs.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              {intel.outputs.map((o) => (
                <div key={o.type} className="rounded-xl border border-border bg-surface/40 p-4">
                  <h3 className="mb-3 font-display text-sm font-semibold text-white">{o.type}</h3>
                  <ul className="space-y-2">
                    {o.items.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-white/60">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-glow" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {intel.chunksWithoutProfile > 0 && (
              <p className="px-5 pb-5 text-[11px] leading-relaxed text-white/35">
                {intel.chunksWithoutProfile} stored chunk
                {intel.chunksWithoutProfile === 1 ? '' : 's'} predate structured extraction and
                aren’t shown in these cards. They are still embedded and still retrieved on every
                campaign fire — re-run those sources to surface them here.
              </p>
            )}
          </>
        ) : (
          <NovaEmptyState what="market signal" />
        )}
      </Panel>

      <Panel>
        <PanelHeader
          icon={<Sparkles size={16} />}
          accent="violet"
          title="Sample output — what a full read looks like"
          subtitle="Illustrative only. Not your data, and never used in a campaign."
          accessory={<Pill tone="warning">Sample</Pill>}
        />
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          {researchOutputs.map((o) => (
            <div key={o.type} className="rounded-xl border border-border bg-surface/40 p-4">
              <h3 className="mb-3 font-display text-sm font-semibold text-white">{o.type}</h3>
              <ul className="space-y-2">
                {o.items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-white/60">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-glow" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}
