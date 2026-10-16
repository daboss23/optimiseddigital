'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2, LockKeyhole, TriangleAlert } from 'lucide-react'

/* ----------------------------------------------------------------------------
   The owner's door.

   One field. It is not the brand login and does not look like a second copy
   of it: no name, no demo hint, nothing printed — the credential lives in the
   deployment environment and only the owner knows it.
---------------------------------------------------------------------------- */

const fieldClass =
  'w-full rounded-lg border border-border bg-background/50 py-3 pl-10 pr-3 text-[14px] text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40'

export function OwnerLogin({ enabled, reason }: { enabled: boolean; reason?: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!enabled) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3.5 text-[13px] leading-relaxed text-warning">
        <LockKeyhole size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>{reason ?? 'The owner area is closed on this deployment.'}</p>
      </div>
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/owner/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = (await response.json()) as { success?: boolean; error?: string }
      if (!response.ok || !data.success) {
        setError(data.error ?? 'That password is not right.')
        setBusy(false)
        return
      }
      router.replace('/owner/library')
      router.refresh()
    } catch {
      setError('Could not reach the platform. Check your connection and try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5" noValidate>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
          Owner password
        </span>
        <span className="relative block">
          <KeyRound
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
            className={fieldClass}
          />
        </span>
      </label>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-[13px] text-danger">
          <TriangleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !password}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}
        {busy ? 'Checking…' : 'Open the library'}
      </button>
    </form>
  )
}
