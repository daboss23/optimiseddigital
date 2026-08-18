'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Clapperboard,
  FileText,
  Anchor,
  LayoutTemplate,
  Tag,
  Film,
  ListChecks,
  Trophy,
  CalendarDays,
  Mic,
  MonitorPlay,
  BookOpen,
  UploadCloud,
  Check,
  Loader2,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import { uploadCards } from '@/lib/reactor-data'
import type { KnowledgeSystem } from '@/lib/knowledge'

const iconMap: Record<string, LucideIcon> = {
  Clapperboard,
  FileText,
  Anchor,
  LayoutTemplate,
  Tag,
  Film,
  ListChecks,
  Trophy,
  CalendarDays,
  Mic,
  MonitorPlay,
  BookOpen,
}

// Map each upload tile to the intelligence system + category it ingests into.
const routing: Record<string, { system: KnowledgeSystem; category: string }> = {
  'Upload Winning Creative': { system: 'creative', category: 'Winning Creative' },
  'Upload Winning Copy': { system: 'copy', category: 'Winning Copy' },
  'Upload Hook Framework': { system: 'vault', category: 'Hook Framework' },
  'Upload Creative Framework': { system: 'vault', category: 'Creative Framework' },
  'Upload Offer Framework': { system: 'vault', category: 'Offer Framework' },
  'Upload VSL Framework': { system: 'vault', category: 'VSL Framework' },
  'Upload Creative SOP': { system: 'vault', category: 'Creative SOP' },
  'Upload Member Win': { system: 'transformation', category: 'Member Win' },
  'Upload Event Content': { system: 'vault', category: 'Event Content' },
  'Upload Podcast Transcript': { system: 'vault', category: 'Podcast Transcript' },
  'Upload Webinar': { system: 'vault', category: 'Webinar' },
  'META Frameworks / SOP': { system: 'vault', category: 'META Frameworks / SOP' },
}

const TEXT_EXT = ['md', 'txt', 'pdf']

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; chunks: number; stored: boolean; file: string }
  | { kind: 'error'; message: string }

function UploadTile({ title, accept, icon }: { title: string; accept: string; icon: string }) {
  const Icon = iconMap[icon] ?? FileText
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [drag, setDrag] = useState(false)
  // Nothing enters the vault without a yes — a dropped file waits here first.
  const [pending, setPending] = useState<File | null>(null)

  const route = routing[title] ?? { system: 'vault' as KnowledgeSystem, category: 'Vault Asset' }

  const ingest = async (file: File) => {
    setStatus({ kind: 'working' })
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      let content: string

      if (TEXT_EXT.includes(ext)) {
        // Extract real text from md / txt / pdf so it embeds meaningfully.
        const fd = new FormData()
        fd.append('file', file)
        const parsed = await fetch('/api/frameworks/parse-file', { method: 'POST', body: fd }).then(
          (r) => r.json(),
        )
        if (!parsed.success) throw new Error(parsed.error || 'Could not read file')
        content = parsed.content
      } else {
        // Image / video / other: ingest retrievable metadata (filename + context).
        // Pixel content isn't embedded by the text model — this makes the asset
        // findable by name, category, and angle.
        content = `${route.category}: ${file.name}. Asset type: ${accept}. Filed under ${route.system} intelligence.`
      }

      const res = await fetch('/api/vault/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: route.system,
          category: route.category,
          title: file.name,
          content,
        }),
      }).then((r) => r.json())

      if (!res.success) throw new Error(res.error || 'Ingest failed')
      setStatus({ kind: 'done', chunks: res.chunks, stored: res.stored, file: file.name })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  return (
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
        if (e.dataTransfer.files?.[0]) setPending(e.dataTransfer.files[0])
      }}
      className={`glass glass-hover group flex h-full flex-col items-center justify-center gap-2 rounded-xl border-dashed p-5 text-center transition-all ${
        drag ? 'border-glow shadow-glow' : 'border-border'
      }`}
    >
      <span className="panel-icon acc-blue grid h-11 w-11 place-items-center rounded-lg transition-transform group-hover:scale-110">
        {status.kind === 'working' ? (
          <Loader2 size={18} className="animate-spin" />
        ) : status.kind === 'done' ? (
          <Check size={18} className="text-success" />
        ) : status.kind === 'error' ? (
          <AlertCircle size={18} className="text-danger" />
        ) : (
          <Icon size={18} />
        )}
      </span>
      <span className="text-[15px] font-semibold text-white">{title}</span>

      {status.kind === 'idle' && (
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-white/65">
          <UploadCloud size={14} className="text-glow/80" /> {accept}
        </span>
      )}
      {status.kind === 'working' && (
        <span className="text-[12.5px] font-medium text-glow">Ingesting…</span>
      )}
      {status.kind === 'done' && (
        <span className="max-w-full truncate text-[12.5px] font-medium text-success">
          {status.stored ? `Ingested · ${status.chunks} chunk${status.chunks === 1 ? '' : 's'}` : 'Queued (demo mode)'}
        </span>
      )}
      {status.kind === 'error' && (
        <span className="max-w-full truncate text-[12.5px] font-medium text-danger">{status.message}</span>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) setPending(f)
          e.target.value = ''
        }}
      />
    </button>

    {pending && (
      <ConfirmIngest
        fileName={pending.name}
        destination={route.category}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const file = pending
          setPending(null)
          void ingest(file)
        }}
      />
    )}
    </>
  )
}

/**
 * Yes/no gate before anything is embedded. A drop is easy to do by accident and
 * an ingest is a write into shared memory — so the vault always asks first.
 */
function ConfirmIngest({
  fileName,
  destination,
  onConfirm,
  onCancel,
}: {
  fileName: string
  destination: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm vault ingest"
      className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 text-center shadow-glow"
      >
        <span className="panel-icon acc-blue mx-auto mb-3 grid h-11 w-11 place-items-center rounded-lg">
          <UploadCloud size={18} />
        </span>
        <p className="text-[15px] font-semibold text-white">
          Ingest “{fileName}” into the vault?
        </p>
        <p className="mt-1.5 text-[12.5px] text-white/55">
          It is embedded and filed under {destination}, then retrievable by every agent.
        </p>
        <div className="mt-5 flex justify-center gap-2.5">
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="fire-btn fire-btn--md tap-target inline-flex items-center gap-2 font-display font-bold uppercase tracking-wide text-white"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="tap-target inline-flex min-h-[44px] items-center rounded-xl border border-border px-5 text-sm font-semibold text-white/70 transition-colors hover:border-white/25 hover:text-white"
          >
            No
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function UploadGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {uploadCards.map((c) => (
        <UploadTile key={c.title} {...c} />
      ))}
    </div>
  )
}
