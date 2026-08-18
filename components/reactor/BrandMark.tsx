'use client'

/* ----------------------------------------------------------------------------
   BrandMark — the shell's identity, resolved at runtime.

   Renders, in order of what is actually available:
     1. The connected business's logo, read off their site by ATLAS.
     2. A clean wordmark built from their company name, when no logo was found.
     3. The product lockup, before any website is connected.

   Fetched once per page load and shared across every mount through a module
   cache, so the sidebar and topbar marks never disagree or double-fetch.

   The logo renders through a plain <img>, not next/image, deliberately: the URL
   is on whatever domain the customer's site lives, and next/image would need a
   wildcard remotePattern — which turns the image optimizer into an open proxy
   for any host on the internet.
---------------------------------------------------------------------------- */

import { useEffect, useState } from 'react'
import { ReactorLogo } from '@/components/reactor/ReactorLogo'
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

  // Nothing connected yet — the product's own lockup.
  if (!identity.branded) return <ReactorLogo size={size} className={className} />

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
