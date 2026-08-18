'use client'

/* ----------------------------------------------------------------------------
   BrandMark — the shell's identity, resolved at runtime.

   Renders, in order of what is actually available:
     1. An uploaded logo — the user's explicit choice, so it always wins.
     2. The connected business's logo, read off their site by ATLAS.
     3. A clean wordmark built from their company name, when no logo was found.
     4. An upload box, before anything is connected.

   There is deliberately no default artwork. The product lockup used to stand
   in here, but that file has one company's name painted into it — so every
   fresh deployment wore someone else's brand until a site was connected.

   Fetched once per page load and shared across every mount through a module
   cache, so the sidebar and topbar marks never disagree or double-fetch.

   The logo renders through a plain <img>, not next/image, deliberately: the URL
   is on whatever domain the customer's site lives, and next/image would need a
   wildcard remotePattern — which turns the image optimizer into an open proxy
   for any host on the internet.
---------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { DEFAULT_IDENTITY, type BrandIdentity } from '@/lib/brand-identity'
import { cn } from '@/lib/utils'

let cache: BrandIdentity | null = null
let inflight: Promise<BrandIdentity> | null = null

function loadIdentity(): Promise<BrandIdentity> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch('/api/brand-identity')
    .then((r) => r.json())
    .then((res: { success?: boolean; data?: BrandIdentity }) => {
      cache = res?.data ?? DEFAULT_IDENTITY
      return cache
    })
    .catch(() => DEFAULT_IDENTITY)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop the cache so the next render picks up a freshly uploaded logo. */
export function refreshBrandIdentity(): void {
  cache = null
}

/** Shared hook — also used by the topbar avatar for its monogram. */
export function useBrandIdentity(): BrandIdentity {
  const [identity, setIdentity] = useState<BrandIdentity>(cache ?? DEFAULT_IDENTITY)
  useEffect(() => {
    let cancelled = false
    loadIdentity().then((next) => {
      if (!cancelled) setIdentity(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return identity
}

export function BrandMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md'
  className?: string
}) {
  const identity = useBrandIdentity()
  const [logoFailed, setLogoFailed] = useState(false)

  // Nothing connected and nothing uploaded — offer the upload rather than
  // showing placeholder artwork the customer has no relationship with.
  if (!identity.branded) return <LogoUpload size={size} className={className} />

  if (identity.logoUrl && !logoFailed) {
    return (
      <span
        className={cn(
          'inline-flex items-center',
          size === 'md' ? 'h-11 w-full' : 'h-9',
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={identity.logoUrl}
          alt={identity.name}
          // Logos are wordmarks as often as they are squares, so height is
          // fixed and width is free — `contain` keeps either shape intact.
          className={cn(
            'w-auto max-w-full object-contain object-left',
            size === 'md' ? 'max-h-11' : 'max-h-9',
          )}
          // A dead or hotlink-blocked logo URL must degrade to the wordmark,
          // never to a broken-image icon in the middle of the chrome.
          onError={() => setLogoFailed(true)}
        />
      </span>
    )
  }

  // Wordmark fallback — a real logo could not be found or would not load.
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-display font-bold tracking-tight text-white',
        size === 'md' ? 'text-lg' : 'text-sm',
        className,
      )}
    >
      <span
        className={cn(
          'grid place-items-center rounded-lg bg-gradient-to-br from-primary to-cyan font-bold text-white',
          size === 'md' ? 'h-8 w-8 text-xs' : 'h-7 w-7 text-[10px]',
        )}
        aria-hidden="true"
      >
        {identity.initials}
      </span>
      <span className="truncate">{identity.name}</span>
    </span>
  )
}

/**
 * The empty logo slot. Small on purpose — it is chrome, not a form — but
 * visible enough that a new customer understands a logo belongs here and can
 * put one in without hunting through settings.
 */
function LogoUpload({ size, className }: { size: 'sm' | 'md'; className?: string }) {
  const identity = useBrandIdentity()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('read failed'))
        reader.readAsDataURL(file)
      })
      const res = await fetch('/api/brand/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      }).then((r) => r.json())
      if (!res?.success) {
        setError(res?.error ?? 'Upload failed.')
        return
      }
      refreshBrandIdentity()
      window.location.reload()
    } catch {
      setError('Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={cn('inline-flex flex-col gap-1', className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-3 text-white/45 transition-colors hover:border-glow/40 hover:text-glow disabled:opacity-50',
          size === 'md' ? 'h-11 w-full text-[12px]' : 'h-9 text-[11px]',
        )}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        <span>{busy ? 'Uploading…' : 'Add your logo'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/svg+xml,image/webp,image/jpeg"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {error ? <span className="text-[10px] leading-tight text-red-400">{error}</span> : null}
    </span>
  )
}
