'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2, LogIn, TriangleAlert, User } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   The door.

   Two fields and a button. Everything that makes it feel like part of the
   command center — the glass, the aurora behind it, the display face — is
   already in the shell; this borrows the same tokens rather than inventing a
   login look of its own.
---------------------------------------------------------------------------- */

/** Where the operator's name was last recorded, so a change can be detected. */
const LAST_OPERATOR_KEY = 'reactor.operator.name'

/** Mike's memory, and the narration cached against it. */
const OPERATOR_MEMORY_KEY = 'reactor.operator.v1'
const OPERATOR_NARRATION_KEY = 'reactor.operator.narration.v1'

/**
 * A different operator gets a fresh start — including their own first meeting
 * with Mike.
 *
 * The welcome is shown once per browser, keyed on `welcomedAt` in the operator
 * memory. That is exactly right for one person on one machine, and exactly
 * wrong when a second person sits down at the same browser: they would inherit
 * a dismissed greeting and a decision log they never made. Signing in under a
 * new name clears both. The SAME name signing in again changes nothing.
 */
function resetMemoryIfNewOperator(name: string): void {
  try {
    const previous = window.localStorage.getItem(LAST_OPERATOR_KEY)
    if (previous && previous.toLowerCase() !== name.toLowerCase()) {
      window.localStorage.removeItem(OPERATOR_MEMORY_KEY)
      window.localStorage.removeItem(OPERATOR_NARRATION_KEY)
    }
    window.localStorage.setItem(LAST_OPERATOR_KEY, name)
  } catch {
    // Private browsing with storage denied. The greeting still renders — the
    // provider simply has nothing stored saying it was already dismissed.
  }
}

const fieldClass =
  'w-full rounded-lg border border-border bg-background/50 py-3 pl-10 pr-3 text-[14px] text-white placeholder:text-white/30 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40'

export function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password }),
      })
      const data = (await response.json()) as { success?: boolean; error?: string; name?: string }

      if (!response.ok || !data.success) {
        setError(data.error ?? 'That name and password do not match.')
        setBusy(false)
        return
      }

      resetMemoryIfNewOperator(data.name ?? name.trim())

      // `replace`, not `push`: the back button should not return to a login
      // form the operator has already passed. `refresh` re-runs the server
      // components now that the session cookie exists.
      router.replace(next)
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
          Name
        </span>
        <span className="relative block">
          <User
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/35"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="Your name"
            className={fieldClass}
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
          Password
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
            required
            placeholder="••••"
            className={fieldClass}
          />
        </span>
      </label>

      {/* Announced, not just coloured — a failure nobody's screen reader
          mentions is a form that appears to do nothing. */}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-danger"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {/* The page's one action, so it wears the platform's one primary button.
          `.fire-btn` carries the gradient, the gloss and the press physics for
          every ignition control in the product — a sign-in wearing a quieter
          variant is the first thing anybody sees, and it sets the wrong
          expectation for everything behind it. */}
      <button
        type="submit"
        disabled={busy}
        className={cn(
          'fire-btn tap-target mt-1 inline-flex min-h-[46px] w-full items-center justify-center gap-2',
          'font-display text-[13px] font-bold uppercase tracking-wide text-white',
        )}
      >
        {busy ? (
          <>
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
            Opening the reactor…
          </>
        ) : (
          <>
            <LogIn size={14} />
            Enter the command center
          </>
        )}
      </button>
    </form>
  )
}
