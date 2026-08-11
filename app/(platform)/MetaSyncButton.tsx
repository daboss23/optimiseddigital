'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { Pill } from '@/components/reactor/ui'
import type { MetaIngestSummary } from '@/lib/meta-ingest'

type SyncState =
  | { status: 'idle' }
  | { status: 'syncing' }
  | { status: 'done'; summary: MetaIngestSummary }
  | { status: 'error'; message: string }

/**
 * The Performance Intelligence sync control — one click pulls live ad-level
 * CTR/CPL/ROAS from Meta, grades every ad against its cohort, and writes the
 * verdicts into ORACLE memory (winners feed the Vault automatically). Sits in
 * the Reactor Learning Loop panel header; shows the run summary inline.
 */
export function MetaSyncButton() {
  const router = useRouter()
  const [state, setState] = useState<SyncState>({ status: 'idle' })
  const [configured, setConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/meta/ingest')
      .then((r) => r.json())
      .then((s: { configured: boolean; storageReady: boolean }) => {
        if (!cancelled) setConfigured(Boolean(s.configured && s.storageReady))
      })
      .catch(() => {
        if (!cancelled) setConfigured(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const runSync = async () => {
    setState({ status: 'syncing' })
    try {
      const res = await fetch('/api/meta/ingest', { method: 'POST' })
      const summary = (await res.json()) as MetaIngestSummary
      if (summary.ok) {
        setState({ status: 'done', summary })
        // Fresh outcomes change the dashboard + strategic memory — re-render.
        router.refresh()
      } else {
        setState({ status: 'error', message: summary.error || 'Sync failed' })
      }
    } catch {
      setState({ status: 'error', message: 'Sync failed — check the connection' })
    }
  }

  if (configured === false) {
    return (
      <Pill tone="warning">
        <span className="font-semibold uppercase tracking-wide">Connect Meta API to sync</span>
      </Pill>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === 'done' && (
        <span className="text-[11px] tabular text-white/55">
          {state.summary.eligible} ads graded ·{' '}
          <span className="text-success">{state.summary.winners} winners → Vault</span>
          {state.summary.losers > 0 && (
            <span className="text-danger"> · {state.summary.losers} losers</span>
          )}
        </span>
      )}
      {state.status === 'error' && (
        <span className="text-[11px] text-danger">{state.message}</span>
      )}
      <button
        type="button"
        onClick={runSync}
        disabled={state.status === 'syncing' || configured === null}
        className="ghost-btn px-3 py-1.5 text-[11px] disabled:opacity-60"
      >
        {state.status === 'syncing' ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Grading live ads…
          </>
        ) : (
          <>
            <RefreshCw size={12} /> Sync Meta → ORACLE
          </>
        )}
      </button>
    </div>
  )
}
