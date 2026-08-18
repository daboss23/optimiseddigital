'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  Check,
  AlertCircle,
  Satellite,
  MessageSquare,
  Clapperboard,
  Globe,
  ClipboardPaste,
  Moon,
  Frown,
  Wrench,
  Star,
  Heart,
  Brain,
  ShieldQuestion,
  Quote,
  Zap,
  RotateCw,
  type LucideIcon,
} from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import type {
  MarketIntelProfile,
  MarketIntelResult,
  NovaEvent,
  NovaSourceType,
} from '@/lib/market-intelligence'

const inputCls =
  'w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-glow focus:outline-none focus:ring-1 focus:ring-glow/40 transition-colors'

/* ---------------------------- Research streaming -------------------------- */

async function streamResearch(
  body: Record<string, unknown>,
  onEvent: (e: NovaEvent) => void,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/nova/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    onEvent({ type: 'error', message: 'Could not reach NOVA. Try again.' })
    return
  }

  if (!res.ok || !res.body) {
    let message = 'NOVA research failed.'
    try {
      const j = await res.json()
      message = j.error || message
    } catch {
      /* non-JSON error */
    }
    onEvent({ type: 'error', message })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as NovaEvent)
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

/* ------------------------------ Progress list ----------------------------- */

function ProgressList({ steps }: { steps: string[] }) {
  return (
    <ul className="space-y-2">
      {steps.map((step, i) => {
        const active = i === steps.length - 1
        return (
          <li key={`${step}-${i}`} className="flex items-center gap-2.5 text-sm">
            {active ? (
              <Loader2 size={14} className="shrink-0 animate-spin text-glow" />
            ) : (
              <Check size={14} className="shrink-0 text-success" />
            )}
            <span className={active ? 'text-white/80' : 'text-white/45'}>{step}</span>
          </li>
        )
      })}
    </ul>
  )
}

/* ----------------------------- Profile rendering -------------------------- */

const CATEGORIES: { key: keyof MarketIntelProfile; label: string; icon: LucideIcon; accent: string }[] = [
  { key: 'keepThemUpAtNight', label: 'Keeps them up at night', icon: Moon, accent: 'text-violet-300' },
  { key: 'frustrations', label: 'Frustrations & dislikes', icon: Frown, accent: 'text-rose-300' },
  { key: 'problems', label: 'Problems & pains', icon: Wrench, accent: 'text-amber-300' },
  { key: 'desires', label: 'Dreams, goals, aspirations', icon: Star, accent: 'text-cyan-300' },
  { key: 'joys', label: 'What brings them joy', icon: Heart, accent: 'text-emerald-300' },
  { key: 'beliefs', label: 'Beliefs & worldview', icon: Brain, accent: 'text-sky-300' },
  { key: 'objections', label: 'Objections & distrust', icon: ShieldQuestion, accent: 'text-orange-300' },
  { key: 'triggerEvents', label: 'Trigger events', icon: Zap, accent: 'text-yellow-300' },
]

function CategoryCard({
  icon: Icon,
  label,
  accent,
  items,
}: {
  icon: LucideIcon
  label: string
  accent: string
  items: string[]
}) {
  if (!items.length) return null
  return (
    <div className="rounded-xl border border-border bg-surface/40 p-4">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={15} className={accent} />
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">{label}</h4>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-white/70">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-glow/70" />
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProfileView({ result }: { result: MarketIntelResult }) {
  const { profile, source, stored, chunks } = result
  const hasAny = CATEGORIES.some((c) => (profile[c.key] as string[]).length > 0) || profile.exactPhrases.length > 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="primary">
          <Satellite size={12} /> {source.label}
        </Pill>
        <Pill>{source.itemsAnalyzed.toLocaleString()} signals read</Pill>
        {stored ? (
          <Pill tone="success">Embedded · {chunks} chunk{chunks === 1 ? '' : 's'} in memory</Pill>
        ) : (
          <Pill tone="warning">Not stored — configure Supabase + Voyage to persist</Pill>
        )}
      </div>

      {profile.audienceSnapshot && (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-glow/70">
            Audience snapshot
          </div>
          <p className="text-sm leading-relaxed text-white/80">{profile.audienceSnapshot}</p>
        </div>
      )}

      {!hasAny && (
        <p className="rounded-lg border border-border bg-surface/40 px-3 py-2.5 text-[13px] text-white/45">
          NOVA didn’t find strong psychographic signal in this source. Try a busier thread, a different
          subreddit, or paste a richer conversation.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {CATEGORIES.map((c) => (
          <CategoryCard
            key={c.key}
            icon={c.icon}
            label={c.label}
            accent={c.accent}
            items={profile[c.key] as string[]}
          />
        ))}
      </div>

      {profile.exactPhrases.length > 0 && (
        <div className="rounded-xl border border-glow/25 bg-glow/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Quote size={15} className="text-glow" />
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-glow/80">
              Voice of customer — verbatim (the gold for hooks)
            </h4>
          </div>
          <ul className="space-y-2">
            {profile.exactPhrases.map((p, i) => (
              <li
                key={i}
                className="rounded-lg border border-border bg-surface/40 px-3 py-2 text-[13px] italic leading-relaxed text-white/75"
              >
                “{p}”
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile.summary && (
        <div className="rounded-xl border border-border bg-surface/40 p-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">
            NOVA’s strategic read
          </div>
          <p className="text-sm leading-relaxed text-white/75">{profile.summary}</p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- Source forms ----------------------------- */

const SOURCE_TABS: { id: NovaSourceType; label: string; icon: LucideIcon }[] = [
  { id: 'reddit', label: 'Reddit', icon: MessageSquare },
  { id: 'youtube', label: 'YouTube', icon: Clapperboard },
  { id: 'web', label: 'Forum / Web', icon: Globe },
  { id: 'text', label: 'Paste', icon: ClipboardPaste },
]

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; steps: string[] }
  | { kind: 'complete'; result: MarketIntelResult }
  | { kind: 'error'; message: string }

interface ResearchSource {
  kind: 'reddit' | 'forum' | 'web'
  label: string
  url?: string
  note: string
}

export function NovaResearch() {
  const [tab, setTab] = useState<NovaSourceType>('reddit')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // The places to mine come from ATLAS's read of the connected website (or
  // whatever the user added by hand), never a built-in list — see
  // /api/research/sources. Until one exists the subreddit field is simply an
  // empty text box, which is honest and still fully usable.
  const [sources, setSources] = useState<ResearchSource[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/api/research/sources', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled) setSources(res?.data?.sources ?? [])
      })
      .catch(() => {
        /* an empty picker is the correct fallback */
      })
    return () => {
      cancelled = true
    }
  }, [])
  const subreddits = sources.filter((s) => s.kind === 'reddit')
  const forums = sources.filter((s) => s.kind !== 'reddit' && s.url)

  // Form state
  const [subreddit, setSubreddit] = useState('')
  const [query, setQuery] = useState('')
  const [redditUrl, setRedditUrl] = useState('')
  const [ytUrl, setYtUrl] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')

  const running = phase.kind === 'running'

  const canRun =
    tab === 'reddit'
      ? Boolean(subreddit.trim() || redditUrl.trim())
      : tab === 'youtube'
        ? Boolean(ytUrl.trim() || text.trim())
        : tab === 'web'
          ? Boolean(webUrl.trim() || text.trim())
          : Boolean(text.trim())

  const deploy = useCallback(async () => {
    if (running) return
    const body: Record<string, unknown> = { sourceType: tab, title: title.trim() || undefined }
    if (tab === 'reddit') {
      body.subreddit = subreddit.trim() || undefined
      body.query = query.trim() || undefined
      body.url = redditUrl.trim() || undefined
    } else if (tab === 'youtube') {
      body.url = ytUrl.trim() || undefined
      body.text = text.trim() || undefined
    } else if (tab === 'web') {
      body.url = webUrl.trim() || undefined
      body.text = text.trim() || undefined
    } else {
      body.text = text.trim() || undefined
    }

    setPhase({ kind: 'running', steps: ['NOVA deploying to the field…'] })
    await streamResearch(body, (e) => {
      if (e.type === 'progress') {
        setPhase((p) =>
          p.kind === 'running'
            ? { kind: 'running', steps: [...p.steps.filter((s) => s !== e.message), e.message] }
            : p,
        )
      } else if (e.type === 'complete') {
        setPhase({ kind: 'complete', result: e.result })
      } else if (e.type === 'error') {
        setPhase({ kind: 'error', message: e.message })
      }
    })
  }, [running, tab, title, subreddit, query, redditUrl, ytUrl, webUrl, text])

  return (
    <Panel>
      <PanelHeader
        icon={<Satellite size={16} />}
        accent="violet"
        title="NOVA · Deploy to the field"
        subtitle="Point NOVA at where your audience actually talks. She reads the real conversations and extracts the psychographics — then remembers them for every campaign."
        accessory={running ? <Pill tone="primary">Researching…</Pill> : undefined}
      />

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Left — source controls */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_TABS.map((s) => {
              const active = tab === s.id
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setTab(s.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
                    active
                      ? 'border-primary/40 bg-primary/15 text-glow shadow-glow'
                      : 'border-border bg-surface/40 text-white/50 hover:border-white/20 hover:text-white/80'
                  }`}
                >
                  <Icon size={13} /> {s.label}
                </button>
              )
            })}
          </div>

          {tab === 'reddit' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  Subreddit
                </label>
                <input
                  value={subreddit}
                  onChange={(e) => setSubreddit(e.target.value.replace(/^r\//i, ''))}
                  list="nova-subreddits"
                  placeholder={subreddits[0] ? subreddits[0].label : 'e.g. marketing'}
                  className={inputCls}
                />
                <datalist id="nova-subreddits">
                  {subreddits.map((s) => (
                    <option key={s.label} value={s.label}>
                      {s.note}
                    </option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  Focus keyword (optional)
                </label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g. cashflow, burnout, hiring, pricing"
                  className={inputCls}
                />
              </div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/25">
                <span className="h-px flex-1 bg-border" /> or a specific thread <span className="h-px flex-1 bg-border" />
              </div>
              <input
                value={redditUrl}
                onChange={(e) => setRedditUrl(e.target.value)}
                placeholder="https://www.reddit.com/r/…/comments/…"
                className={inputCls}
              />
            </div>
          )}

          {tab === 'youtube' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  YouTube URL
                </label>
                <input
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=…"
                  className={inputCls}
                />
                <p className="mt-1.5 text-[11px] text-white/35">
                  NOVA reads the transcript. Competitor coaching videos are rich in pains + objections.
                </p>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="…or paste the transcript / comments here as a fallback."
                className={`${inputCls} h-24 resize-none`}
              />
            </div>
          )}

          {tab === 'web' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  Forum / review / article URL
                </label>
                <input
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  placeholder="https://…"
                  className={inputCls}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {forums.map((f) => (
                  <button
                    key={f.url}
                    type="button"
                    onClick={() => setWebUrl(f.url as string)}
                    title={f.note}
                    className="rounded-md border border-border bg-surface/50 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-glow/40 hover:text-glow"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="…or paste the page text if the site blocks automated reads."
                className={`${inputCls} h-24 resize-none`}
              />
            </div>
          )}

          {tab === 'text' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                  Source label (optional)
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Member onboarding calls, FB group thread"
                  className={inputCls}
                />
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste real customer conversations — survey answers, DMs, sales-call notes, group threads. The rawer, the better."
                className={`${inputCls} h-40 resize-none`}
              />
            </div>
          )}

          <button
            type="button"
            onClick={deploy}
            disabled={!canRun || running}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-glow transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <Satellite size={15} />}
            {running ? 'NOVA in the field…' : 'Deploy NOVA'}
          </button>

          {phase.kind === 'error' && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/30 bg-danger/[0.05] px-3 py-2.5">
              <span className="flex items-start gap-1.5 text-[12px] text-danger">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {phase.message}
              </span>
              <button
                type="button"
                onClick={deploy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface/60 px-2.5 py-1 text-[11px] font-medium text-white/70 hover:text-white"
              >
                <RotateCw size={12} /> Retry
              </button>
            </div>
          )}
        </div>

        {/* Right — live output */}
        <div className="min-h-[280px] rounded-xl border border-border bg-surface/30 p-4">
          {phase.kind === 'idle' && (
            <div className="grid h-full min-h-[260px] place-items-center text-center">
              <div className="max-w-sm">
                <Satellite size={26} className="mx-auto mb-3 text-glow/50" />
                <p className="text-sm text-white/40">
                  NOVA’s psychographic read appears here — what keeps your audience up at night, what they
                  hate, what they dream about, and the exact words they use.
                </p>
              </div>
            </div>
          )}

          {phase.kind === 'running' && (
            <div>
              <div className="mb-4 flex items-center gap-2">
                <Satellite size={16} className="animate-pulse text-glow" />
                <span className="font-display text-sm font-semibold text-white">
                  NOVA is gathering customer intelligence…
                </span>
              </div>
              <ProgressList steps={phase.steps} />
            </div>
          )}

          {phase.kind === 'complete' && <ProfileView result={phase.result} />}

          {phase.kind === 'error' && (
            <div className="grid h-full min-h-[260px] place-items-center text-center">
              <p className="max-w-xs text-sm text-white/40">
                NOVA came back empty. Some sites block automated reads — switch to “Paste” and drop the
                conversation text in directly.
              </p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
