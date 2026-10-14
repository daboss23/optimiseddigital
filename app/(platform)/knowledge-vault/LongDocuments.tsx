'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  BookOpenText,
  Check,
  FileText,
  Loader2,
  MessageSquareText,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { EmptyState, Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import type { LongDocument } from '@/lib/documents'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   Long Documents — PDFs the agents read by structure.

   The tiles above chunk what they ingest, which suits a hook or a framework
   and breaks a 60-page brand book: the rule loses the heading it sat under.
   These go to PageIndex, which keeps the table of contents and answers by
   reading down it. Once a document is indexed, the Reactor can ask it
   questions mid-run, and the "Ask" box here makes the same call so the
   operator can see what the agents will be told.
---------------------------------------------------------------------------- */

interface Readiness {
  provider: boolean
  store: boolean
  ready: boolean
  reason?: string
}

interface ListResponse {
  success: boolean
  error?: string
  readiness?: Readiness
  maxBytes?: number
  documents?: LongDocument[]
}

/** How often a still-indexing document is re-checked. */
const POLL_MS = 6000

function pending(d: LongDocument): boolean {
  return d.status === 'queued' || d.status === 'processing'
}

function StatusPill({ doc }: { doc: LongDocument }) {
  if (doc.status === 'completed') {
    return (
      <Pill tone="success">
        <Check size={11} />
        <span className="whitespace-nowrap">Ready{doc.pageCount ? ` · ${doc.pageCount} pages` : ''}</span>
      </Pill>
    )
  }
  if (doc.status === 'failed') {
    return (
      <Pill tone="danger">
        <AlertCircle size={11} /> Failed
      </Pill>
    )
  }
  return (
    <Pill tone="primary">
      <Loader2 size={11} className="animate-spin" /> Indexing
    </Pill>
  )
}

function AskBox({ doc }: { doc: LongDocument }) {
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'asking' } | { kind: 'answer'; text: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const ask = async () => {
    const q = question.trim()
    if (!q) return
    setState({ kind: 'asking' })
    try {
      const res = (await fetch('/api/vault/documents/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: doc.id, question: q }),
      }).then((r) => r.json())) as { success: boolean; answer?: string; error?: string }
      if (!res.success || !res.answer) throw new Error(res.error || 'No answer')
      setState({ kind: 'answer', text: res.answer })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not read the document' })
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface/40 p-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          void ask()
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Which claims are we not allowed to make?"
          className="min-h-[44px] flex-1 rounded-lg border border-border bg-black/30 px-3 text-[13.5px] text-white placeholder:text-white/35 focus:border-primary/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={state.kind === 'asking' || !question.trim()}
          className="tap-target inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-4 text-[13px] font-semibold text-glow transition-colors hover:bg-primary/25 disabled:opacity-50"
        >
          {state.kind === 'asking' ? <Loader2 size={14} className="animate-spin" /> : <MessageSquareText size={14} />}
          {state.kind === 'asking' ? 'Reading…' : 'Ask'}
        </button>
      </form>
      {state.kind === 'answer' && (
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">{state.text}</p>
      )}
      {state.kind === 'error' && <p className="mt-3 text-[12.5px] text-danger">{state.message}</p>}
    </div>
  )
}

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: LongDocument
  onDelete: (doc: LongDocument) => Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <li className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-icon acc-violet grid h-9 w-9 shrink-0 place-items-center rounded-lg">
            <FileText size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-white">{doc.name}</p>
            <p className="text-[12px] text-white/45">
              Added {new Date(doc.createdAt).toLocaleDateString()}
              {doc.error ? ` · ${doc.error}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill doc={doc} />
          {doc.status === 'completed' && (
            <button
              type="button"
              onClick={() => setAsking((v) => !v)}
              className={cn(
                'tap-target inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors',
                asking
                  ? 'border-primary/40 bg-primary/15 text-glow'
                  : 'border-border text-white/70 hover:border-white/25 hover:text-white',
              )}
            >
              <MessageSquareText size={13} /> Ask
            </button>
          )}
          {confirmDelete ? (
            <>
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  await onDelete(doc)
                  setDeleting(false)
                  setConfirmDelete(false)
                }}
                className="tap-target inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 text-[12.5px] font-semibold text-danger"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="tap-target inline-flex min-h-[36px] items-center rounded-lg border border-border px-3 text-[12.5px] font-semibold text-white/60 hover:text-white"
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={`Delete ${doc.name}`}
              onClick={() => setConfirmDelete(true)}
              className="tap-target inline-flex min-h-[36px] items-center rounded-lg border border-border px-2.5 text-white/50 transition-colors hover:border-danger/40 hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {asking && doc.status === 'completed' && <AskBox doc={doc} />}
    </li>
  )
}

export function LongDocuments() {
  const [loaded, setLoaded] = useState(false)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [maxBytes, setMaxBytes] = useState(4 * 1024 * 1024)
  const [documents, setDocuments] = useState<LongDocument[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [staged, setStaged] = useState<File | null>(null)
  const [upload, setUpload] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  })
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = (await fetch('/api/vault/documents', { cache: 'no-store' }).then((r) => r.json())) as ListResponse
      if (res.readiness) setReadiness(res.readiness)
      if (res.maxBytes) setMaxBytes(res.maxBytes)
      if (!res.success) throw new Error(res.error || 'Could not load documents')
      setDocuments(res.documents ?? [])
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load documents')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Re-check while anything is still indexing; stop the moment nothing is.
  const indexing = documents.some(pending)
  useEffect(() => {
    if (!indexing) return
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [indexing, load])

  const stage = (file: File | undefined) => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) {
      setUpload({ kind: 'error', message: 'Long documents must be PDFs.' })
      return
    }
    if (file.size > maxBytes) {
      setUpload({
        kind: 'error',
        message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${maxBytes / 1024 / 1024} MB.`,
      })
      return
    }
    setUpload({ kind: 'idle' })
    setStaged(file)
  }

  const send = async (file: File) => {
    setStaged(null)
    setUpload({ kind: 'sending' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = (await fetch('/api/vault/documents', { method: 'POST', body: fd }).then((r) => r.json())) as {
        success: boolean
        error?: string
        document?: LongDocument
      }
      if (!res.success || !res.document) throw new Error(res.error || 'Upload failed')
      setDocuments((prev) => [res.document as LongDocument, ...prev])
      setUpload({ kind: 'idle' })
    } catch (err) {
      setUpload({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  const remove = async (doc: LongDocument) => {
    try {
      const res = (await fetch(`/api/vault/documents?id=${encodeURIComponent(doc.id)}`, { method: 'DELETE' }).then(
        (r) => r.json(),
      )) as { success: boolean; error?: string }
      if (!res.success) throw new Error(res.error || 'Delete failed')
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const ready = readiness?.ready === true

  return (
    <Panel>
      <PanelHeader
        icon={<BookOpenText size={16} />}
        accent="violet"
        title="Long Documents"
        subtitle="Brand books, SOP manuals, offer documents — read by structure, section by section, so a rule keeps the heading it sits under"
        accessory={ready ? <Pill tone="primary">PageIndex</Pill> : undefined}
      />
      <div className="p-5">
        {!loaded ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/50">
            <Loader2 size={16} className="animate-spin" /> Loading documents…
          </div>
        ) : !ready ? (
          <EmptyState
            icon={<BookOpenText size={28} />}
            message="Long-document reading is not switched on for this deployment."
            hint={readiness?.reason ?? 'Set PAGEINDEX_API_KEY and configure Supabase, then run supabase/schema.documents.sql.'}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                stage(e.dataTransfer.files?.[0])
              }}
              disabled={upload.kind === 'sending'}
              className={cn(
                'glass glass-hover flex w-full flex-col items-center justify-center gap-2 rounded-xl border-dashed p-6 text-center transition-all',
                drag ? 'border-glow shadow-glow' : 'border-border',
              )}
            >
              <span className="panel-icon acc-violet grid h-11 w-11 place-items-center rounded-lg">
                {upload.kind === 'sending' ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
              </span>
              <span className="text-[15px] font-semibold text-white">
                {upload.kind === 'sending' ? 'Sending to PageIndex…' : 'Upload a long PDF'}
              </span>
              <span className="text-[12.5px] text-white/55">
                Text-based PDF · up to {maxBytes / 1024 / 1024} MB · indexing takes a few minutes
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                stage(e.target.files?.[0])
                e.target.value = ''
              }}
            />

            {staged && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                <p className="text-[13px] text-white/80">
                  Send “{staged.name}” to PageIndex to be indexed? The file leaves this deployment for PageIndex Cloud.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void send(staged)}
                    className="tap-target inline-flex min-h-[40px] items-center rounded-lg border border-primary/40 bg-primary/15 px-4 text-[13px] font-semibold text-glow hover:bg-primary/25"
                  >
                    Send
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaged(null)}
                    className="tap-target inline-flex min-h-[40px] items-center rounded-lg border border-border px-4 text-[13px] font-semibold text-white/60 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {upload.kind === 'error' && <p className="mt-3 text-[12.5px] text-danger">{upload.message}</p>}
            {loadError && <p className="mt-3 text-[12.5px] text-danger">{loadError}</p>}

            {documents.length === 0 ? (
              <EmptyState
                icon={<FileText size={24} />}
                message="No long documents yet."
                hint="Upload a brand book or SOP manual. Once it is indexed, the Reactor can check a concept against what the document actually says."
              />
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onDelete={remove} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}
