'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BookLock,
  Check,
  FileText,
  Loader2,
  LogOut,
  Pencil,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { EmptyState, Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { cn } from '@/lib/utils'
import { LIBRARY_NICHES, NICHE_ECOMMERCE, nicheLabel } from '@/lib/library/niches'
import { isTextFile, isZip, needsServerExtraction, stageText, type StagedDocument } from '@/lib/library/text'
import { unzipTextFiles } from '@/lib/library/unzip'

/* ----------------------------------------------------------------------------
   The Platform Library — the owner's upload screen.

   Drop SOPs, frameworks or a whole Notion export. Zips are opened HERE, in the
   browser: only the text pages leave this tab, so a 300 MB workspace export
   becomes a few hundred kilobytes of Markdown. Each batch is tagged with the
   niches it is for, and the agents of brands in those niches read it as
   method. No brand ever sees this page or anything on it.
---------------------------------------------------------------------------- */

type Kind = 'sop' | 'framework' | 'playbook' | 'swipe' | 'other'

const KINDS: { id: Kind; label: string }[] = [
  { id: 'sop', label: 'SOP' },
  { id: 'framework', label: 'Framework' },
  { id: 'playbook', label: 'Playbook' },
  { id: 'swipe', label: 'Swipe file' },
  { id: 'other', label: 'Other' },
]

interface Readiness {
  configured: boolean
  installed: boolean
  reason?: string
}

interface LibraryDoc {
  id: string
  title: string
  sourceName: string | null
  kind: Kind
  niches: string[]
  chunkCount: number
  charCount: number
  createdAt: string
}

interface Staged extends StagedDocument {
  key: string
}

interface IngestResult {
  title: string
  status: 'added' | 'duplicate' | 'empty' | 'error'
  chunks: number
  error?: string
}

/** Text per request — JSON-escaped and UTF-8 it stays well under 4.5 MB. */
const BATCH_CHARS = 1_200_000
const BATCH_DOCS = 40

const ACCEPT = '.md,.markdown,.txt,.csv,.html,.htm,.pdf,.zip'

function batches(docs: Staged[]): Staged[][] {
  const out: Staged[][] = []
  let current: Staged[] = []
  let size = 0
  for (const d of docs) {
    if (current.length && (size + d.text.length > BATCH_CHARS || current.length >= BATCH_DOCS)) {
      out.push(current)
      current = []
      size = 0
    }
    current.push(d)
    size += d.text.length
  }
  if (current.length) out.push(current)
  return out
}

function NicheChips({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (key: string) => void
}) {
  const groups: { id: 'broad' | 'vertical' | 'other'; label: string }[] = [
    { id: 'broad', label: 'Broad' },
    { id: 'vertical', label: 'E-commerce verticals' },
    { id: 'other', label: 'Other businesses' },
  ]
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.id}>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/40">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {LIBRARY_NICHES.filter((n) => n.group === g.id).map((n) => {
              const on = selected.includes(n.key)
              return (
                <button
                  key={n.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(n.key)}
                  className={cn(
                    'min-h-[32px] rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                    on
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                      : 'border-white/10 bg-white/[0.02] text-white/60 hover:border-white/25 hover:text-white/85',
                  )}
                >
                  {on && <Check size={11} className="mr-1 inline" aria-hidden="true" />}
                  {n.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function LibraryManager() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [docs, setDocs] = useState<LibraryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [staged, setStaged] = useState<Staged[]>([])
  const [reading, setReading] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)

  const [niches, setNiches] = useState<string[]>([NICHE_ECOMMERCE])
  const [kind, setKind] = useState<Kind>('sop')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<IngestResult[] | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [editing, setEditing] = useState<{ id: string; niches: string[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/owner/library', { cache: 'no-store' })
      if (res.status === 404) {
        router.replace('/owner')
        return
      }
      const data = (await res.json()) as {
        readiness: Readiness
        documents: LibraryDoc[]
        error?: string
      }
      setReadiness(data.readiness)
      setDocs(data.documents ?? [])
      if (data.error) setLoadError(data.error)
    } catch {
      setLoadError('The library could not be loaded. Check your connection and refresh.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const toggleNiche = (key: string) =>
    setNiches((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  /* ------------------------------- reading -------------------------------- */

  const readFiles = async (files: File[]) => {
    if (!files.length) return
    setReading(true)
    setResults(null)
    const found: Staged[] = []
    const report: string[] = []
    let skippedEntries = 0

    for (const file of files) {
      try {
        if (isZip(file.name)) {
          const unzipped = unzipTextFiles(new Uint8Array(await file.arrayBuffer()))
          skippedEntries += unzipped.skipped
          if (unzipped.truncated) report.push(`${file.name}: stopped at 25 MB of text — split the export.`)
          for (const f of unzipped.files) {
            const doc = stageText(f.path, f.text)
            if (doc) found.push({ ...doc, key: `${file.name}/${f.path}` })
          }
        } else if (isTextFile(file.name)) {
          const doc = stageText(file.name, await file.text())
          if (doc) found.push({ ...doc, key: `${file.name}:${file.size}:${file.lastModified}` })
          else report.push(`${file.name}: no readable text.`)
        } else if (needsServerExtraction(file.name)) {
          const form = new FormData()
          form.append('file', file)
          const res = await fetch('/api/owner/library/extract', { method: 'POST', body: form })
          const data = (await res.json()) as { success?: boolean; text?: string; error?: string }
          const doc = data.success && data.text ? stageText(file.name, data.text) : null
          if (doc) found.push({ ...doc, key: `${file.name}:${file.size}:${file.lastModified}` })
          else report.push(`${file.name}: ${data.error ?? 'no readable text.'}`)
        } else {
          report.push(`${file.name}: not a supported file — use Markdown, text, CSV, HTML, PDF or a zip of them.`)
        }
      } catch (err) {
        report.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read.'}`)
      }
    }

    if (skippedEntries) report.unshift(`${skippedEntries} images and attachments left out — the agents read words.`)
    setStaged((cur) => {
      const seen = new Set(cur.map((s) => s.key))
      return [...cur, ...found.filter((f) => !seen.has(f.key))]
    })
    setNotes(report)
    setReading(false)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    void readFiles(Array.from(e.dataTransfer.files))
  }

  const stagedChars = useMemo(() => staged.reduce((n, s) => n + s.text.length, 0), [staged])

  /* ------------------------------- uploading ------------------------------ */

  const upload = async () => {
    if (!staged.length || !niches.length) return
    const plan = batches(staged)
    setProgress({ done: 0, total: plan.length })
    setUploadError(null)
    const all: IngestResult[] = []
    // Keys of documents that are finished with — added, already there, or
    // empty. Anything else stays staged so a retry sends only what is missing.
    const settled = new Set<string>()
    for (let i = 0; i < plan.length; i += 1) {
      try {
        const res = await fetch('/api/owner/library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documents: plan[i].map((d) => ({
              title: d.title,
              sourceName: d.sourceName,
              text: d.text,
              niches,
              kind,
            })),
          }),
        })
        const data = (await res.json()) as { success?: boolean; results?: IngestResult[]; error?: string }
        if (!res.ok || !data.success) {
          setUploadError(data.error ?? `Batch ${i + 1} was refused.`)
          break
        }
        const batchResults = data.results ?? []
        all.push(...batchResults)
        plan[i].forEach((doc, j) => {
          if (batchResults[j] && batchResults[j].status !== 'error') settled.add(doc.key)
        })
      } catch {
        setUploadError(`Batch ${i + 1} could not be sent. Check your connection and try again.`)
        break
      }
      setProgress({ done: i + 1, total: plan.length })
    }
    setResults(all)
    setStaged((cur) => cur.filter((s) => !settled.has(s.key)))
    setProgress(null)
    void load()
  }

  /* ------------------------------ row actions ----------------------------- */

  const saveTags = async () => {
    if (!editing) return
    setRowBusy(editing.id)
    try {
      const res = await fetch('/api/owner/library', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      const data = (await res.json()) as { success?: boolean; niches?: string[] }
      if (data.success) {
        setDocs((cur) => cur.map((d) => (d.id === editing.id ? { ...d, niches: data.niches ?? editing.niches } : d)))
        setEditing(null)
      }
    } finally {
      setRowBusy(null)
    }
  }

  const remove = async (id: string) => {
    setRowBusy(id)
    try {
      const res = await fetch(`/api/owner/library?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (res.ok) setDocs((cur) => cur.filter((d) => d.id !== id))
    } finally {
      setRowBusy(null)
      setConfirmDelete(null)
    }
  }

  const signOut = async () => {
    await fetch('/api/owner/session', { method: 'DELETE' }).catch(() => null)
    router.replace('/owner')
    router.refresh()
  }

  const ready = readiness?.installed === true
  const added = results?.filter((r) => r.status === 'added') ?? []
  const duplicates = results?.filter((r) => r.status === 'duplicate') ?? []
  const failures = results?.filter((r) => r.status === 'error' || r.status === 'empty') ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-white/60">
          <BookLock size={15} className="text-amber-400" aria-hidden="true" />
          Brands never see this page or anything in it. Their agents read it as method, for the niches you tag.
        </p>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12.5px] text-white/70 hover:border-white/25 hover:text-white"
        >
          <LogOut size={14} aria-hidden="true" /> Sign out
        </button>
      </div>

      {readiness && !ready && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3.5 text-[13px] leading-relaxed text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{readiness.reason ?? 'The library is not ready on this deployment.'}</p>
        </div>
      )}

      <Panel>
        <PanelHeader
          icon={<UploadCloud size={16} />}
          accent="amber"
          title="Add to the library"
          subtitle="Markdown, text, CSV, HTML, PDF — or a whole Notion export zip. Zips are unpacked in this browser; only the text is sent."
        />
        <div className="space-y-5 p-5">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
              dragging ? 'border-amber-500/70 bg-amber-500/10' : 'border-white/15 bg-white/[0.02] hover:border-white/30',
            )}
          >
            {reading ? (
              <Loader2 size={22} className="animate-spin text-amber-400" aria-hidden="true" />
            ) : (
              <UploadCloud size={22} className="text-white/45" aria-hidden="true" />
            )}
            <p className="text-[13.5px] text-white/75">
              {reading ? 'Reading…' : 'Drop files or a Notion export here, or click to choose'}
            </p>
            <p className="text-[11.5px] text-white/40">Images and attachments are left out automatically.</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                void readFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </div>

          {notes.length > 0 && (
            <ul className="space-y-1 text-[12px] text-white/50">
              {notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}

          {staged.length > 0 && (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[12.5px] font-semibold text-white/80">
                    {staged.length} document{staged.length === 1 ? '' : 's'} ready ·{' '}
                    {Math.round(stagedChars / 1000).toLocaleString()}k characters
                  </p>
                  <button
                    type="button"
                    onClick={() => setStaged([])}
                    className="text-[12px] text-white/45 hover:text-white/80"
                  >
                    Clear
                  </button>
                </div>
                <ul className="max-h-[320px] divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02]">
                  {staged.map((s) => (
                    <li key={s.key} className="flex items-center gap-3 px-3 py-2">
                      <FileText size={14} className="shrink-0 text-white/35" aria-hidden="true" />
                      <input
                        value={s.title}
                        onChange={(e) =>
                          setStaged((cur) => cur.map((x) => (x.key === s.key ? { ...x, title: e.target.value } : x)))
                        }
                        aria-label="Document title"
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-white hover:border-white/10 focus:border-amber-500/50 focus:outline-none"
                      />
                      <span className="hidden shrink-0 text-[11px] text-white/35 sm:inline">
                        {Math.max(1, Math.round(s.text.length / 1000))}k
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${s.title}`}
                        onClick={() => setStaged((cur) => cur.filter((x) => x.key !== s.key))}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-white/40 hover:bg-white/5 hover:text-white"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
                <div>
                  <p className="mb-2 text-[12.5px] font-semibold text-white/80">Who is this method for?</p>
                  <NicheChips selected={niches} onToggle={toggleNiche} />
                  {niches.length === 0 && (
                    <p className="mt-2 text-[12px] text-warning">Pick at least one — a document no brand matches is never read.</p>
                  )}
                </div>
                <label className="block">
                  <span className="mb-2 block text-[12.5px] font-semibold text-white/80">What kind of document</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Kind)}
                    className="min-h-[40px] w-full rounded-lg border border-white/10 bg-background/60 px-3 text-[13px] text-white focus:border-amber-500/50 focus:outline-none"
                  >
                    {KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={upload}
                  disabled={!ready || !niches.length || Boolean(progress)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-[13.5px] font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {progress ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <UploadCloud size={15} aria-hidden="true" />
                  )}
                  {progress
                    ? `Adding — batch ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                    : `Add ${staged.length} to the library`}
                </button>
                {progress && (
                  <div className="flex flex-1 gap-1" aria-hidden="true">
                    {Array.from({ length: progress.total }).map((_, i) => (
                      <span
                        key={i}
                        className={cn('h-1.5 flex-1 rounded-full', i < progress.done ? 'bg-amber-500' : 'bg-white/10')}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {uploadError && (
            <p role="alert" className="flex items-center gap-2 text-[13px] text-danger">
              <AlertTriangle size={14} aria-hidden="true" /> {uploadError}
            </p>
          )}

          {results && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-[12.5px] leading-relaxed text-white/70">
              <p>
                <span className="text-success">{added.length} added</span>
                {' · '}
                {added.reduce((n, r) => n + r.chunks, 0)} sections indexed
                {duplicates.length > 0 && ` · ${duplicates.length} already in the library`}
                {failures.length > 0 && <span className="text-danger">{` · ${failures.length} not added`}</span>}
              </p>
              {failures.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-white/50">
                  {failures.map((f) => (
                    <li key={f.title}>
                      · {f.title}: {f.error ?? 'no readable sections'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          icon={<BookLock size={16} />}
          accent="violet"
          title="In the library"
          subtitle="Every document the agents can draw on, and the niches each one is for."
          accessory={<Pill tone={docs.length ? 'primary' : 'default'}>{docs.length} documents</Pill>}
        />
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-[13px] text-white/50">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading the library…
          </div>
        ) : loadError ? (
          <EmptyState icon={<AlertTriangle size={22} />} message="The library could not be read." hint={loadError} />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={<BookLock size={22} />}
            message="Nothing in the library yet."
            hint="Add your SOPs and frameworks above. Tag each batch with the niches it is for — the agents use it only for brands in those niches."
          />
        ) : (
          <ul className="divide-y divide-white/5">
            {docs.map((d) => (
              <li key={d.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-white">{d.title}</p>
                    <p className="mt-0.5 text-[11.5px] text-white/40">
                      {KINDS.find((k) => k.id === d.kind)?.label ?? 'Other'} · {d.chunkCount} sections ·{' '}
                      {new Date(d.createdAt).toLocaleDateString()}
                    </p>
                    {editing?.id !== d.id && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.niches.map((n) => (
                          <span
                            key={n}
                            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[11px] text-white/65"
                          >
                            {nicheLabel(n)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {rowBusy === d.id ? (
                      <Loader2 size={15} className="animate-spin text-white/50" aria-hidden="true" />
                    ) : confirmDelete === d.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => remove(d.id)}
                          className="min-h-[36px] rounded-md bg-danger/20 px-3 text-[12px] font-semibold text-danger hover:bg-danger/30"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          className="min-h-[36px] rounded-md px-3 text-[12px] text-white/60 hover:text-white"
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`Edit niches for ${d.title}`}
                          onClick={() => setEditing({ id: d.id, niches: d.niches })}
                          className="grid h-9 w-9 place-items-center rounded-md text-white/45 hover:bg-white/5 hover:text-white"
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${d.title}`}
                          onClick={() => setConfirmDelete(d.id)}
                          className="grid h-9 w-9 place-items-center rounded-md text-white/45 hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {editing?.id === d.id && (
                  <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <NicheChips
                      selected={editing.niches}
                      onToggle={(key) =>
                        setEditing((cur) =>
                          cur
                            ? {
                                ...cur,
                                niches: cur.niches.includes(key)
                                  ? cur.niches.filter((k) => k !== key)
                                  : [...cur.niches, key],
                              }
                            : cur,
                        )
                      }
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={saveTags}
                        disabled={!editing.niches.length}
                        className="min-h-[36px] rounded-md bg-amber-500 px-4 text-[12.5px] font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
                      >
                        Save niches
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="min-h-[36px] rounded-md px-3 text-[12.5px] text-white/60 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
