'use client'

/* ----------------------------------------------------------------------------
   ResearchSources — where NOVA should mine, for THIS business.

   There is no built-in list. Sources come from ATLAS's read of the connected
   website, or the user adds them by hand. Before either has happened the panel
   says so plainly and offers the one action that fixes it, rather than showing
   a market the customer may have nothing to do with.
---------------------------------------------------------------------------- */

import { useCallback, useEffect, useState } from 'react'
import { Clock, MessageSquare, Plus, X, Loader2 } from 'lucide-react'
import { Panel, PanelHeader, Pill, EmptyState } from '@/components/reactor/ui'

interface ResearchSource {
  kind: 'reddit' | 'forum' | 'web'
  label: string
  url?: string
  note: string
  origin: 'derived' | 'manual'
}

const KINDS: { value: ResearchSource['kind']; label: string }[] = [
  { value: 'reddit', label: 'Subreddit' },
  { value: 'forum', label: 'Forum' },
  { value: 'web', label: 'Website' },
]

export function ResearchSources() {
  const [sources, setSources] = useState<ResearchSource[] | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<ResearchSource['kind']>('reddit')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/research/sources', { cache: 'no-store' }).then((r) => r.json())
      setSources(res?.data?.sources ?? [])
      setCanEdit(Boolean(res?.data?.canEdit))
    } catch {
      setSources([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    setError('')
    if (!label.trim()) {
      setError('Give the source a name.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/research/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, label, url, note }),
      }).then((r) => r.json())
      if (!res?.success) {
        setError(res?.error ?? 'Could not add that source.')
        return
      }
      setLabel('')
      setUrl('')
      setNote('')
      setAdding(false)
      await load()
    } catch {
      setError('Could not add that source.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: ResearchSource) => {
    await fetch(
      `/api/research/sources?kind=${encodeURIComponent(s.kind)}&label=${encodeURIComponent(s.label)}`,
      { method: 'DELETE' },
    )
    await load()
  }

  const derivedCount = (sources ?? []).filter((s) => s.origin === 'derived').length

  return (
    <Panel>
      <PanelHeader
        icon={<MessageSquare size={16} />}
        accent="violet"
        title="Where NOVA mines"
        subtitle="The places your audience talks in public. Deploy NOVA at any of them for a targeted dig."
        accessory={
          derivedCount > 0 ? (
            <Pill tone="success">{derivedCount} from your website</Pill>
          ) : (
            <Pill tone="default">
              <Clock size={12} /> Sweeps on demand
            </Pill>
          )
        }
      />

      {sources === null ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-white/45">
          <Loader2 size={15} className="animate-spin text-glow" /> Loading sources…
        </div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={20} />}
          message="No research sources yet."
          hint="Connect your website on Brand Intelligence and ATLAS works out where your audience talks — or add a subreddit, forum or site yourself."
          action={
            canEdit ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/50 px-3 py-1.5 text-[12px] text-white/70 transition-colors hover:border-glow/40 hover:text-glow"
              >
                <Plus size={13} /> Add a source
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-wrap gap-1.5 p-5">
          {sources.map((s) => {
            const text = s.kind === 'reddit' ? `r/${s.label}` : s.label
            const body = (
              <>
                <span className="font-medium">{text}</span>
                {s.note ? <span className="ml-2 text-[11px] text-white/35">{s.note}</span> : null}
              </>
            )
            return (
              <span
                key={`${s.kind}:${s.label}`}
                className="group inline-flex items-center gap-1 rounded-md border border-border bg-surface/50 px-2.5 py-1 text-[12px] text-white/65"
              >
                {s.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-glow"
                  >
                    {body}
                  </a>
                ) : (
                  body
                )}
                {s.origin === 'manual' && canEdit ? (
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    aria-label={`Remove ${text}`}
                    className="tap-target ml-0.5 text-white/25 transition-colors hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </span>
            )
          })}
          {canEdit && !adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-[12px] text-white/45 transition-colors hover:border-glow/40 hover:text-glow"
            >
              <Plus size={12} /> Add
            </button>
          ) : null}
        </div>
      )}

      {adding ? (
        <div className="border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ResearchSource['kind'])}
              className="rounded-lg border border-border bg-surface/60 px-2.5 py-2 text-[13px] text-white/80"
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === 'reddit' ? 'marketing' : 'Name of the forum or site'}
              className="min-w-[10rem] flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-[13px] text-white/80 placeholder:text-white/25"
            />
            {kind !== 'reddit' ? (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="min-w-[12rem] flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-[13px] text-white/80 placeholder:text-white/25"
              />
            ) : null}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What is discussed there (optional)"
              className="min-w-[12rem] flex-1 rounded-lg border border-border bg-surface/60 px-3 py-2 text-[13px] text-white/80 placeholder:text-white/25"
            />
            <button
              type="button"
              onClick={add}
              disabled={saving}
              className="tap-target inline-flex items-center gap-1.5 rounded-lg border border-glow/40 bg-glow/10 px-3 py-2 text-[13px] font-medium text-glow disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setError('')
              }}
              className="tap-target rounded-lg px-3 py-2 text-[13px] text-white/45 hover:text-white/70"
            >
              Cancel
            </button>
          </div>
          {error ? <p className="mt-2 text-[12px] text-red-400">{error}</p> : null}
        </div>
      ) : null}
    </Panel>
  )
}
