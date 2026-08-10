'use client'

import { useState } from 'react'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import type { CreativeDNA } from '@/lib/spark'

const PLATFORMS = [
  'Meta Ads',
  'Facebook Ad Library',
  'TikTok',
  'YouTube',
  'Uploaded / Other',
] as const

const DNA_ROWS: { key: keyof CreativeDNA; label: string }[] = [
  { key: 'hook', label: 'Hook' },
  { key: 'opening', label: 'Opening' },
  { key: 'storyStructure', label: 'Story Structure' },
  { key: 'ctaStructure', label: 'CTA Structure' },
  { key: 'offerPresentation', label: 'Offer Presentation' },
  { key: 'editingStyle', label: 'Editing Style' },
  { key: 'visualStyle', label: 'Visual Style' },
]

export function SparkAnalyzer() {
  const [platform, setPlatform] = useState<string>(PLATFORMS[0])
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dna, setDna] = useState<CreativeDNA | null>(null)
  const [stored, setStored] = useState<boolean | null>(null)

  const analyze = async () => {
    setBusy(true)
    setError(null)
    setDna(null)
    setStored(null)
    try {
      const res = await fetch('/api/spark/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, url: url.trim() || undefined, text: text.trim() || undefined }),
      }).then((r) => r.json())
      if (res.success && res.dna) {
        setDna(res.dna as CreativeDNA)
        setStored(Boolean(res.stored))
      } else {
        setError(res.error || 'Analysis failed')
      }
    } catch {
      setError('Analysis failed — try again.')
    } finally {
      setBusy(false)
    }
  }

  const selectClass =
    'w-full rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/60'

  return (
    <Panel>
      <PanelHeader
        icon={<Sparkles size={16} />}
        accent="amber"
        title="SPARK · Winning Creative Intelligence"
        subtitle="Study a winning ad — extract its Creative DNA, not its words. Stored as a retrievable pattern."
        accessory={dna ? <Pill tone="primary">{dna.patternType}</Pill> : undefined}
      />

      <div className="grid gap-4 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
              Platform
            </p>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectClass}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p} className="bg-card">
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
              Creative URL (optional)
            </p>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a YouTube URL — SPARK pulls the transcript for you"
              className={selectClass}
            />
            <p className="mt-1 text-[11px] text-white/35">
              YouTube links auto-transcribe (no pasting needed). Other URLs read page text where
              available.
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/40">
              Script / Transcript / Notes
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the ad's hook, script, or what made it work. The more detail, the sharper the DNA."
              className="h-[150px] w-full resize-none rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/60"
            />
          </div>
          <button
            type="button"
            onClick={analyze}
            disabled={busy || (!text.trim() && !url.trim())}
            className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-semibold text-glow transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {busy ? 'SPARK analyzing…' : 'Extract Creative DNA'}
          </button>
          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/[0.06] p-2.5 text-[12px] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-surface/30 p-4">
          {!dna && !busy && (
            <div className="grid h-full min-h-[220px] place-items-center text-center">
              <p className="max-w-xs text-sm text-white/35">
                The extracted Creative DNA appears here — pattern type, hook, opening, story, CTA,
                editing, and offer structure.
              </p>
            </div>
          )}
          {busy && !dna && (
            <div className="grid h-full min-h-[220px] place-items-center">
              <span className="flex items-center gap-2 text-sm text-glow">
                <Loader2 size={16} className="animate-spin" /> Extracting Creative DNA…
              </span>
            </div>
          )}
          {dna && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="primary">{dna.patternType}</Pill>
                <Pill>{dna.creativeCategory}</Pill>
                {stored ? (
                  <Pill tone="success">Stored as pattern</Pill>
                ) : (
                  <Pill tone="warning">Not stored — configure Supabase + Voyage</Pill>
                )}
              </div>
              <dl className="space-y-2">
                {DNA_ROWS.map((row) => (
                  <div key={row.key} className="grid grid-cols-[110px_1fr] gap-2">
                    <dt className="text-[10px] font-medium uppercase tracking-wider text-white/35">
                      {row.label}
                    </dt>
                    <dd className="text-[13px] text-white/75">{dna[row.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}
