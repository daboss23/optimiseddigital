'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search,
  Plus,
  Loader2,
  Check,
  AlertCircle,
  Trash2,
  Maximize2,
  Pencil,
  X,
  Save,
  RotateCcw,
  Database,
  FileText,
  FolderOpen,
  Sparkles,
  Type,
  Clapperboard,
  UploadCloud,
  Download,
  FileType2,
  Image as ImageIcon,
  Film,
  Music,
  Globe,
  Layers,
  type LucideIcon,
} from 'lucide-react'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { vaultCategories } from '@/lib/reactor-data'
import type { KnowledgeSystem, VaultStatGroup } from '@/lib/knowledge'

interface VaultItem {
  id: string | null
  system: string
  category: string | null
  title: string
  content: string
  created_at: string | null
  similarity?: number
}

interface Stats {
  live: boolean
  total: number
  groups: VaultStatGroup[]
}

// Friendly labels for each intelligence system in the live category breakdown.
const SYSTEM_LABELS: Record<string, string> = {
  vault: 'Frameworks & SOPs',
  copy: 'Copy Assets',
  creative: 'Creative Assets',
  design: 'Ad Design DNA',
  transformation: 'Transformation Assets',
  research: 'Research Intelligence',
  pattern: 'Patterns',
  learning: 'Learnings',
  website: 'Website Intelligence',
}

interface CategoryGroup {
  group: string
  items: { name: string; count: number }[]
}

// Roll the flat stat groups up into per-system cards for the categories panel.
function liveCategoryGroups(groups: VaultStatGroup[]): CategoryGroup[] {
  const bySystem = new Map<string, { name: string; count: number }[]>()
  for (const g of groups) {
    const items = bySystem.get(g.system) ?? []
    items.push({ name: g.category ?? 'Uncategorized', count: g.count })
    bySystem.set(g.system, items)
  }
  return Array.from(bySystem.entries())
    .map(([system, items]) => ({
      group: SYSTEM_LABELS[system] ?? system,
      items: items.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => a.group.localeCompare(b.group))
}

// A vault artifact = one document, grouped from its underlying chunks.
type AssetKind = 'pdf' | 'doc' | 'link' | 'image' | 'video' | 'audio' | 'text'

/** One stored chunk of a document, as the expanded reader edits it. */
interface ArtifactChunk {
  id: string | null
  content: string
}

interface VaultArtifact {
  key: string
  title: string
  system: string
  category: string | null
  kind: AssetKind
  preview: string
  chunkCount: number
  ids: string[]
  /** Every chunk of this document, in stored order — the expand/edit reader. */
  chunks: ArtifactChunk[]
  similarity?: number
}

const KIND_META: Record<AssetKind, { icon: LucideIcon; label: string }> = {
  pdf: { icon: FileType2, label: 'PDF' },
  doc: { icon: FileText, label: 'Doc' },
  link: { icon: Globe, label: 'Web' },
  image: { icon: ImageIcon, label: 'Image' },
  video: { icon: Film, label: 'Video' },
  audio: { icon: Music, label: 'Audio' },
  text: { icon: Type, label: 'Text' },
}

// Infer an asset kind from the document title (extension) — the data layer
// doesn't yet carry an explicit kind, so the filename is the best signal.
function inferKind(title: string): AssetKind {
  const t = title.toLowerCase()
  if (/\.pdf$/.test(t)) return 'pdf'
  if (/\.(md|txt|docx?|rtf)$/.test(t)) return 'doc'
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(t)) return 'image'
  if (/\.(mp4|mov|webm|mkv)$/.test(t)) return 'video'
  if (/\.(mp3|wav|m4a|aac)$/.test(t)) return 'audio'
  if (/^https?:\/\//.test(t) || /youtube|youtu\.be/.test(t)) return 'link'
  return 'text'
}

// Roll the flat chunk rows up into one artifact per document.
function groupArtifacts(items: VaultItem[]): VaultArtifact[] {
  const byDoc = new Map<string, VaultArtifact>()
  for (const it of items) {
    const key = `${it.system}|${it.category ?? ''}|${it.title}`
    const existing = byDoc.get(key)
    if (existing) {
      existing.chunkCount += 1
      if (it.id) existing.ids.push(it.id)
      existing.chunks.push({ id: it.id, content: it.content })
      if (typeof it.similarity === 'number')
        existing.similarity = Math.max(existing.similarity ?? 0, it.similarity)
    } else {
      byDoc.set(key, {
        key,
        title: it.title,
        system: it.system,
        category: it.category,
        kind: it.system === 'website' ? 'link' : inferKind(it.title),
        preview: it.content,
        chunkCount: 1,
        ids: it.id ? [it.id] : [],
        chunks: [{ id: it.id, content: it.content }],
        similarity: it.similarity,
      })
    }
  }
  const arr = Array.from(byDoc.values())
  // Surface best semantic matches first when searching; otherwise keep order.
  if (arr.some((a) => typeof a.similarity === 'number'))
    arr.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
  return arr
}

/* ------------------------- Artifact reader / editor ------------------------ */

/**
 * Full-document reader for a vault artifact, with in-place editing.
 *
 * Cards only ever showed a three-line clamp of the first chunk, so what the
 * reactor actually retrieves was unreadable and uncorrectable from the UI. This
 * opens the whole document chunk by chunk and lets each one be edited and saved
 * back. Saves go through PATCH /api/vault/list, which re-embeds the chunk so
 * search reflects the correction instead of the superseded text.
 */
function ArtifactReader({
  artifact,
  onClose,
  onSaved,
}: {
  artifact: VaultArtifact
  onClose: () => void
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<string[]>(() => artifact.chunks.map((c) => c.content))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // The reader owns the screen while it is open.
  useEffect(() => {
    const { body } = document
    const prev = body.style.overflow
    body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, saving])

  const dirty = drafts.some((d, i) => d !== artifact.chunks[i]?.content)
  // A chunk with no id lives in the curated demo corpus, not the database.
  const editable = artifact.chunks.some((c) => c.id)

  const revert = () => {
    setDrafts(artifact.chunks.map((c) => c.content))
    setStatus(null)
  }

  const save = async () => {
    setSaving(true)
    setStatus(null)
    const changed = artifact.chunks
      .map((c, i) => ({ chunk: c, content: drafts[i] }))
      .filter((x) => x.chunk.id && x.content.trim() && x.content !== x.chunk.content)

    try {
      const results = await Promise.all(
        changed.map((x) =>
          fetch('/api/vault/list', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: x.chunk.id, content: x.content }),
          }).then((r) => r.json()),
        ),
      )
      const failed = results.filter((r) => !r.success)
      if (failed.length > 0) {
        setStatus({ ok: false, message: failed[0]?.error || 'Some changes could not be saved.' })
      } else {
        const stale = results.some((r) => r.reembedded === false)
        setStatus({
          ok: true,
          message: stale
            ? `Saved ${changed.length} chunk${changed.length === 1 ? '' : 's'} — text updated, but embeddings are not configured so search still matches the old wording.`
            : `Saved and re-embedded ${changed.length} chunk${changed.length === 1 ? '' : 's'}.`,
        })
        setEditing(false)
        onSaved()
      }
    } catch {
      setStatus({ ok: false, message: 'Could not reach the vault. Try again.' })
    } finally {
      setSaving(false)
    }
  }

  const Icon = KIND_META[artifact.kind].icon

  if (!mounted) return null

  // Portaled to <body>: the panel chrome this renders inside sets its own
  // stacking context, which would trap a fixed overlay behind the shell.
  // z-[120] clears the VaultDoor, which is itself a portaled `fixed inset-0
  // z-[100]` — at a lower index the reader opened *behind* the vault interior.
  return createPortal(
    <div
      className="launch-overlay fixed inset-0 z-[120] grid place-items-center p-0 sm:px-4 sm:py-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={artifact.title}
    >
      <div className="launch-panel flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none sm:h-auto sm:max-h-[90vh] sm:w-[820px] sm:max-w-[calc(100vw-2rem)] sm:rounded-[1.5rem]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-white/10 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
          <span className="vault-artifact-icon grid h-10 w-10 shrink-0 place-items-center rounded-lg">
            <Icon size={18} className="text-glow" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-base font-bold text-white" title={artifact.title}>
              {artifact.title}
            </h2>
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/40">
              {KIND_META[artifact.kind].label} · {artifact.chunkCount} chunk
              {artifact.chunkCount === 1 ? '' : 's'} · {artifact.system}
              {artifact.category ? ` · ${artifact.category}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="tap-target grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — one block per stored chunk */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {artifact.chunks.map((chunk, i) => (
            <div key={chunk.id ?? i} className="rounded-xl border border-white/10 bg-white/[0.02]">
              {artifact.chunks.length > 1 && (
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white/35">
                    Chunk {i + 1} of {artifact.chunks.length}
                  </span>
                  {drafts[i] !== chunk.content && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">
                      Edited
                    </span>
                  )}
                </div>
              )}
              {editing && chunk.id ? (
                <textarea
                  value={drafts[i]}
                  onChange={(e) =>
                    setDrafts((d) => d.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  spellCheck={false}
                  rows={Math.min(24, Math.max(6, Math.ceil(drafts[i].length / 90)))}
                  className="w-full resize-y bg-transparent px-3 py-3 font-mono text-[12.5px] leading-relaxed text-white/85 outline-none"
                />
              ) : (
                <p className="whitespace-pre-wrap px-3 py-3 text-[13px] leading-relaxed text-white/70">
                  {drafts[i]}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          {status ? (
            <span
              className={`flex min-w-0 items-start gap-1.5 text-[11px] leading-snug ${
                status.ok ? 'text-success' : 'text-danger'
              }`}
            >
              {status.ok ? (
                <Check size={12} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
              )}
              {status.message}
            </span>
          ) : (
            <span className="text-[11px] text-white/35">
              {editable
                ? 'Edits are re-embedded, so the reactor retrieves the corrected text.'
                : 'Demo corpus — connect Supabase to edit stored knowledge.'}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={dirty ? revert : () => setEditing(false)}
                  disabled={saving}
                  className="launch-nav tap-target disabled:opacity-40"
                >
                  <RotateCcw size={14} /> {dirty ? 'Revert' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty}
                  className="launch-nav launch-nav--primary tap-target disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              editable && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true)
                    setStatus(null)
                  }}
                  className="launch-nav launch-nav--primary tap-target"
                >
                  <Pencil size={14} /> Edit
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const SYSTEMS: { value: KnowledgeSystem; label: string }[] = [
  { value: 'vault', label: 'Framework / SOP' },
  { value: 'copy', label: 'Copy · Hook / Headline' },
  { value: 'creative', label: 'Creative' },
  { value: 'design', label: 'Ad Design DNA' },
  { value: 'transformation', label: 'Client Win' },
  { value: 'research', label: 'Research' },
  { value: 'pattern', label: 'Pattern' },
  { value: 'learning', label: 'Learning' },
]

const inputCls =
  'w-full rounded-lg border border-border bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-glow focus:outline-none focus:ring-1 focus:ring-glow/40 transition-colors'

type IngestStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; chunks: number; stored: boolean }
  | { kind: 'error'; message: string }

// Which input mode the "Add Knowledge" panel is in. Website Intelligence lives
// on its own Brand Intelligence tab now, not in the Vault.
type SourceMode = 'text' | 'document' | 'youtube'

const SOURCES: { value: SourceMode; label: string; icon: typeof Type }[] = [
  { value: 'text', label: 'Paste Text', icon: Type },
  { value: 'document', label: 'Doc / PDF', icon: UploadCloud },
  { value: 'youtube', label: 'YouTube', icon: Clapperboard },
]

// Status while pulling content from an external source into the content box.
type FetchStatus =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'fetched'; chars: number }
  | { kind: 'error'; message: string }

export function VaultManager({ initialStats }: { initialStats: Stats }) {
  const [stats, setStats] = useState<Stats>(initialStats)
  const [items, setItems] = useState<VaultItem[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(initialStats.live)

  // Library search / filter
  const [query, setQuery] = useState('')
  const [systemFilter, setSystemFilter] = useState<'' | KnowledgeSystem>('')

  // Ingest form
  const [sourceMode, setSourceMode] = useState<SourceMode>('text')
  const [title, setTitle] = useState('')
  const [system, setSystem] = useState<KnowledgeSystem>('vault')
  const [category, setCategory] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<IngestStatus>({ kind: 'idle' })

  // Source-fetch state (website / youtube / document)
  const [sourceUrl, setSourceUrl] = useState('')
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({ kind: 'idle' })
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async (q: string, sys: '' | KnowledgeSystem) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (sys) params.set('system', sys)
      const [listRes, statsRes] = await Promise.all([
        fetch(`/api/vault/list?${params.toString()}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/vault/stats', { cache: 'no-store' }).then((r) => r.json()),
      ])
      if (listRes.success) {
        // Website Intelligence has moved to the Brand Intelligence tab, so its
        // chunks no longer surface in the Vault library.
        setItems((listRes.items as VaultItem[]).filter((it) => it.system !== 'website'))
        setLive(listRes.live)
      }
      if (statsRes.success) {
        setStats({ live: statsRes.live, total: statsRes.total, groups: statsRes.groups ?? [] })
      }
    } catch {
      /* network error — leave existing state, surface nothing destructive */
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + react to query / filter changes (debounced).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(query, systemFilter), 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, systemFilter, load])

  // Switching source mode clears any in-progress fetch state, keeps editable content.
  const switchMode = (mode: SourceMode) => {
    setSourceMode(mode)
    setSourceUrl('')
    setFetchStatus({ kind: 'idle' })
    setStatus({ kind: 'idle' })
  }

  // Pull text content from the chosen external source into the content box.
  const fetchSource = async (endpoint: string, body: BodyInit, headers?: HeadersInit) => {
    setFetchStatus({ kind: 'fetching' })
    setStatus({ kind: 'idle' })
    try {
      const res = await fetch(endpoint, { method: 'POST', headers, body }).then((r) => r.json())
      if (!res.success) throw new Error(res.error || 'Could not extract content')
      const text: string = res.content ?? ''
      setContent(text)
      setFetchStatus({ kind: 'fetched', chars: text.length })
      return true
    } catch (err) {
      setFetchStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Could not extract content',
      })
      return false
    }
  }

  const fetchYoutube = async () => {
    if (!sourceUrl.trim()) return
    const ok = await fetchSource(
      '/api/frameworks/scrape-youtube',
      JSON.stringify({ url: sourceUrl.trim() }),
      { 'Content-Type': 'application/json' }
    )
    if (ok && !title.trim()) setTitle('YouTube Transcript')
  }

  const handleFile = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const ok = await fetchSource('/api/frameworks/parse-file', form)
    if (ok && !title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim())
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    setStatus({ kind: 'working' })
    try {
      const res = await fetch('/api/vault/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system,
          title: title.trim(),
          category: category.trim() || null,
          content: content.trim(),
          metadata:
            sourceMode === 'text'
              ? undefined
              : { source: sourceMode, sourceUrl: sourceUrl.trim() || undefined },
        }),
      }).then((r) => r.json())
      if (!res.success) throw new Error(res.error || 'Ingest failed')
      setStatus({ kind: 'done', chunks: res.chunks, stored: res.stored })
      setTitle('')
      setCategory('')
      setContent('')
      setSourceUrl('')
      setFetchStatus({ kind: 'idle' })
      load(query, systemFilter)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Ingest failed' })
    }
  }

  // Remove a whole document — delete every chunk it was split into.
  const removeDoc = async (artifact: VaultArtifact) => {
    const ids = new Set(artifact.ids)
    setItems((prev) => prev.filter((i) => !i.id || !ids.has(i.id)))
    try {
      await Promise.all(
        artifact.ids.map((id) =>
          fetch(`/api/vault/list?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
        ),
      )
    } finally {
      load(query, systemFilter)
    }
  }

  // Group chunks into document artifacts, then page them so the vault never
  // becomes an endless wall regardless of how much knowledge is stored.
  const artifacts = useMemo(() => groupArtifacts(items), [items])
  const [visibleCount, setVisibleCount] = useState(12)
  useEffect(() => setVisibleCount(12), [query, systemFilter])
  const visibleArtifacts = artifacts.slice(0, visibleCount)

  // The artifact currently open in the full reader/editor, if any.
  const [reading, setReading] = useState<VaultArtifact | null>(null)
  // Keep the open reader pointed at fresh data after a save re-loads the list.
  useEffect(() => {
    if (!reading) return
    const next = artifacts.find((a) => a.key === reading.key)
    if (next && next !== reading) setReading(next)
  }, [artifacts, reading])

  const categoriesLive = live && stats.groups.length > 0
  const categoryGroups: CategoryGroup[] = categoriesLive
    ? liveCategoryGroups(stats.groups)
    : vaultCategories

  const fetching = fetchStatus.kind === 'fetching'

  return (
    <>
      {/* ----------------------------- Add knowledge --------------------------- */}
      <Panel>
        <PanelHeader
          icon={<Plus size={16} />}
          accent="emerald"
          title="Add Knowledge"
          subtitle="Paste text, pull a website, drop a doc or PDF, or transcribe a YouTube video — embedded into the reactor's brain in seconds"
        />
        <form onSubmit={submit} className="space-y-4 p-5">
          {/* Source picker */}
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => {
              const Icon = s.icon
              const active = sourceMode === s.value
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => switchMode(s.value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    active
                      ? 'border-primary/40 bg-primary/15 text-glow shadow-glow'
                      : 'border-border bg-surface/40 text-white/50 hover:border-white/20 hover:text-white/80'
                  }`}
                >
                  <Icon size={14} />
                  {s.label}
                </button>
              )
            })}
          </div>

          {/* Source-specific input */}
          {sourceMode === 'youtube' && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                YouTube URL
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Clapperboard
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
                  />
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        fetchYoutube()
                      }
                    }}
                    placeholder="https://youtube.com/watch?v=…"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                <button
                  type="button"
                  onClick={fetchYoutube}
                  disabled={fetching || !sourceUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface/60 px-4 py-2 text-sm font-medium text-white/80 transition-all hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:w-40"
                >
                  {fetching ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Transcribing…
                    </>
                  ) : (
                    <>
                      <Download size={15} /> Transcribe
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {sourceMode === 'document' && (
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                Document
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-all ${
                  dragActive
                    ? 'border-glow bg-primary/10'
                    : 'border-border bg-surface/40 hover:border-white/25'
                }`}
              >
                {fetching ? (
                  <Loader2 size={22} className="animate-spin text-glow" />
                ) : (
                  <UploadCloud size={22} className="text-white/40" />
                )}
                <span className="text-sm text-white/70">
                  {fetching ? 'Extracting text…' : 'Drag & drop a file, or click to browse'}
                </span>
                <span className="text-[11px] text-white/30">PDF, Markdown, or TXT</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.md,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ''
                }}
              />
            </div>
          )}

          {/* Source fetch status */}
          {sourceMode !== 'text' && fetchStatus.kind !== 'idle' && (
            <div className="text-[11px]">
              {fetchStatus.kind === 'fetched' && (
                <span className="flex items-center gap-1.5 text-success">
                  <Check size={13} /> Pulled {fetchStatus.chars.toLocaleString()} characters — review
                  below, then ingest
                </span>
              )}
              {fetchStatus.kind === 'error' && (
                <span className="flex items-center gap-1.5 text-danger">
                  <AlertCircle size={13} /> {fetchStatus.message}
                </span>
              )}
            </div>
          )}

          {/* Title / system / category */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The 3-Beat Hook Framework"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                Intelligence System
              </label>
              <select
                value={system}
                onChange={(e) => setSystem(e.target.value as KnowledgeSystem)}
                className={inputCls}
              >
                {SYSTEMS.map((s) => (
                  <option key={s.value} value={s.value} className="bg-surface text-white">
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
                Category <span className="text-white/25">(optional)</span>
              </label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Hook Framework"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-white/40">
              {sourceMode === 'text' ? 'Content' : 'Extracted Content'}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                sourceMode === 'text'
                  ? 'Paste the full framework, hook, SOP, transcript, or member story here…'
                  : 'Pulled content appears here for review — edit before ingesting if you like…'
              }
              rows={6}
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px]">
              {status.kind === 'done' && (
                <span className="flex items-center gap-1.5 text-success">
                  <Check size={13} />
                  {status.stored
                    ? `Ingested · ${status.chunks} chunk${status.chunks === 1 ? '' : 's'} embedded`
                    : 'Captured (demo mode — configure Supabase + Voyage to persist)'}
                </span>
              )}
              {status.kind === 'error' && (
                <span className="flex items-center gap-1.5 text-danger">
                  <AlertCircle size={13} /> {status.message}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={status.kind === 'working' || fetching || !title.trim() || !content.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-glow transition-all hover:bg-primary/20 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status.kind === 'working' ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Ingesting…
                </>
              ) : (
                <>
                  <Sparkles size={15} /> Ingest into Vault
                </>
              )}
            </button>
          </div>
        </form>
      </Panel>

      {/* ----------------------------- Library view ---------------------------- */}
      <Panel>
        <PanelHeader
          icon={<Database size={16} />}
          title="Vault Library"
          subtitle="Search and manage everything stored in the reactor's brain"
          accessory={
            <Pill tone={live ? 'success' : 'default'}>
              <Database size={12} />
              {live ? `${stats.total.toLocaleString()} stored` : 'Demo corpus'}
            </Pill>
          }
        />

        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hooks, frameworks, member wins…"
                className={`${inputCls} pl-9`}
              />
            </div>
            <select
              value={systemFilter}
              onChange={(e) => setSystemFilter(e.target.value as '' | KnowledgeSystem)}
              className={`${inputCls} sm:w-56`}
            >
              <option value="" className="bg-surface text-white">
                All systems
              </option>
              {SYSTEMS.map((s) => (
                <option key={s.value} value={s.value} className="bg-surface text-white">
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {!live && (
            <p className="rounded-lg border border-border bg-surface/40 px-3 py-2 text-[11px] text-white/40">
              Showing the curated demo corpus. Configure Supabase + Voyage and run
              <span className="font-mono text-white/60"> supabase/schema.reactor.sql</span> to store and
              search your real knowledge here.
            </p>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/40">
              <Loader2 size={16} className="animate-spin" /> Loading vault…
            </div>
          ) : artifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <FileText size={24} className="text-white/20" />
              <p className="text-sm text-white/40">
                {query || systemFilter
                  ? 'Nothing matches that search yet.'
                  : 'The vault is empty — paste your first framework above.'}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleArtifacts.map((art) => {
                  const Icon = KIND_META[art.kind].icon
                  return (
                    <div
                      key={art.key}
                      className="vault-artifact group relative flex flex-col rounded-xl border border-border bg-surface/40 p-4"
                    >
                      <div className="mb-2 flex items-start gap-3">
                        <span className="vault-artifact-icon grid h-10 w-10 shrink-0 place-items-center rounded-lg">
                          <Icon size={18} className="text-glow" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold text-white" title={art.title}>
                            {art.title}
                          </h3>
                          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/35">
                            {KIND_META[art.kind].label} · {art.chunkCount} chunk
                            {art.chunkCount === 1 ? '' : 's'}
                          </p>
                        </div>
                        {art.ids.length > 0 && (
                          <button
                            type="button"
                            onClick={() => removeDoc(art)}
                            aria-label={`Delete ${art.title}`}
                            className="shrink-0 rounded-lg border border-border p-1.5 text-white/30 opacity-0 transition-all hover:border-danger/40 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                      <p className="line-clamp-3 flex-1 text-xs leading-relaxed text-white/50">
                        {art.preview}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Pill tone="primary">{art.system}</Pill>
                        {art.category && <Pill>{art.category}</Pill>}
                        {typeof art.similarity === 'number' && (
                          <span className="ml-auto font-mono text-[10px] text-glow/70">
                            {Math.round(art.similarity * 100)}% match
                          </span>
                        )}
                      </div>

                      {/* Read the whole document, and correct it. The card only
                          ever shows a three-line clamp of the first chunk. */}
                      <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-2.5">
                        <button
                          type="button"
                          onClick={() => setReading(art)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-[11px] font-medium text-white/65 transition-all hover:border-glow/40 hover:text-glow"
                        >
                          <Maximize2 size={12} /> Expand
                        </button>
                        {art.ids.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setReading(art)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-[11px] font-medium text-white/65 transition-all hover:border-glow/40 hover:text-glow"
                          >
                            <Pencil size={12} /> Edit
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px] text-white/35">
                <span>
                  Showing {visibleArtifacts.length} of {artifacts.length} artifact
                  {artifacts.length === 1 ? '' : 's'}
                </span>
                {visibleCount < artifacts.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + 12)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-3 py-1.5 font-medium text-white/70 transition-all hover:border-glow/40 hover:text-glow"
                  >
                    <Layers size={13} /> Load more
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </Panel>

      {/* ---------------------------- Vault categories ------------------------- */}
      <Panel>
        <PanelHeader
          icon={<FolderOpen size={16} />}
          accent="violet"
          title="Vault Categories"
          subtitle={
            categoriesLive
              ? "Live breakdown of what's actually stored in the reactor"
              : 'Everything the business knows, organized for the reactor'
          }
          accessory={
            <Pill tone={categoriesLive ? 'success' : 'default'}>
              {categoriesLive ? `${stats.total.toLocaleString()} stored` : 'Demo map'}
            </Pill>
          }
        />
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          {categoryGroups.map((cat) => (
            <div key={cat.group} className="rounded-xl border border-border bg-surface/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-white">{cat.group}</h3>
                <span className="font-mono text-[11px] text-white/30">
                  {cat.items.reduce((s, i) => s + i.count, 0).toLocaleString()}
                </span>
              </div>
              <ul className="space-y-1.5">
                {cat.items.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/[0.03]"
                  >
                    <span>{item.name}</span>
                    <span className="font-display text-xs font-semibold tabular text-glow">
                      {item.count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      {reading && (
        <ArtifactReader
          artifact={reading}
          onClose={() => setReading(null)}
          onSaved={() => load(query, systemFilter)}
        />
      )}
    </>
  )
}
