'use client'

import { useEffect, useState } from 'react'
import { renderBrandIsUsable } from '@/lib/brand-context'
import type { RenderBrand } from '@/lib/render-prompt'

/**
 * Who the ads are FOR, for the surfaces that compile render prompts in the
 * browser (the Reactor's concept cards, the Creative Canvas nodes).
 *
 * Mirrors `useBrandIdentity` deliberately — same module-level cache, same
 * single in-flight request — but answers a different question. `useBrandIdentity`
 * is whose logo the chrome wears; this is what belongs inside the frame. Keeping
 * them apart keeps a data-URI logo out of every render request, and keeps a
 * render from waiting on the shell's branding.
 *
 * Returns `undefined` until it resolves, and stays `undefined` when nothing is
 * connected — the compiler then omits the brand block entirely rather than
 * emitting a header with no facts under it.
 */

let cache: RenderBrand | null = null
let inflight: Promise<RenderBrand | null> | null = null

function loadRenderBrand(): Promise<RenderBrand | null> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch('/api/brand/render-context')
    .then((r) => r.json())
    .then((res: { success?: boolean; data?: RenderBrand }) => {
      // One definition of "usable", shared with the server resolver, so the
      // client cannot decide a brand is worth sending that the server built as
      // empty (or the reverse).
      cache = res?.data && renderBrandIsUsable(res.data) ? res.data : null
      return cache
    })
    // A branding lookup must never stop a render — the prompt just omits the
    // block. Not cached on failure, so a transient error retries next time.
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop the cache so the next render picks up a freshly connected website. */
export function refreshRenderBrand(): void {
  cache = null
}

export function useRenderBrand(): RenderBrand | undefined {
  const [brand, setBrand] = useState<RenderBrand | undefined>(cache ?? undefined)
  useEffect(() => {
    let cancelled = false
    loadRenderBrand().then((next) => {
      if (!cancelled && next) setBrand(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return brand
}
