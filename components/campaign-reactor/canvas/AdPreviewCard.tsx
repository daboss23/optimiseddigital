'use client'

import { Globe, ImageIcon, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComposedAd } from '@/lib/campaign-reactor/canvas'
import { useBrandIdentity } from '@/components/reactor/BrandMark'

/**
 * The live ad preview — a Meta-style ad assembled from the canvas selection and
 * repainted by the chosen colour theme. Everything is driven by `ad`, so it
 * re-renders the instant the user swaps a hook, headline, body, CTA, visual or
 * theme on the canvas. Visual rendering is wired to the run context: a selected
 * visual concept can be turned into a still in place, and the result shows here.
 */
export function AdPreviewCard({
  ad,
  image,
  imageBusy,
  imageError,
  canGenerate,
  onGenerateImage,
}: {
  ad: ComposedAd
  /** Resolved still for the selected visual (concept image or a manual render). */
  image?: string
  imageBusy?: boolean
  imageError?: string
  /** True when the selected visual has a brief we can render from. */
  canGenerate?: boolean
  onGenerateImage?: () => void
}) {
  const { theme } = ad
  // The preview wears the connected brand, never the deployment's original
  // customer — a fresh instance shows neutral placeholders until a site is read.
  const identity = useBrandIdentity()
  const advertiser = identity.branded ? identity.name : 'Your brand'
  const advertiserDomain = identity.domain ?? 'yourdomain.com'

  return (
    <div className={cn('overflow-hidden rounded-xl border', theme.surface, theme.ring)}>
      {/* Meta ad chrome */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br font-display text-[11px] font-bold text-black',
            theme.swatchFrom,
            theme.swatchTo,
          )}
        >
          {identity.initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-white">{advertiser}</p>
          <p className="flex items-center gap-1 text-[10px] text-white/45">
            Sponsored <span aria-hidden>·</span> <Globe size={9} />
          </p>
        </div>
      </div>

      {/* Primary text — hook leads, body supports */}
      <div className="space-y-1 px-3 pb-2.5">
        {ad.hook ? (
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-white">{ad.hook.text}</p>
        ) : (
          <p className="text-[12px] italic text-white/35">Pick a hook to lead the ad…</p>
        )}
        {ad.body && <p className="line-clamp-4 text-[12px] leading-relaxed text-white/65">{ad.body.text}</p>}
      </div>

      {/* Media — generated still or a themed placeholder driven by the visual brief */}
      <div className="relative aspect-square w-full overflow-hidden border-y border-white/5 bg-black/30">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={ad.visual?.label ?? 'Ad creative'} className="h-full w-full object-cover" />
        ) : (
          <div
            className={cn(
              'flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br p-5 text-center',
              theme.swatchFrom,
              theme.swatchTo,
            )}
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-black/35 text-white/90 backdrop-blur-sm">
              {imageBusy ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
            </span>
            {ad.visual ? (
              <>
                <p className="line-clamp-3 max-w-[15rem] text-[11px] font-medium text-black/80">
                  {ad.visual.text}
                </p>
                {imageBusy ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-black/60">
                    Rendering…
                  </span>
                ) : canGenerate && onGenerateImage ? (
                  <button
                    type="button"
                    onClick={onGenerateImage}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-black/30 bg-black/25 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/40"
                  >
                    <ImageIcon size={12} /> Generate this visual
                  </button>
                ) : (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-black/55">
                    {ad.visual.label}
                  </span>
                )}
              </>
            ) : (
              <p className="text-[11px] font-medium text-black/70">Pick a visual to set the creative</p>
            )}
          </div>
        )}
      </div>

      {/* Link card footer — domain, headline, CTA */}
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-[9px] uppercase tracking-wider text-white/35">{advertiserDomain}</p>
          {ad.headline ? (
            <p className={cn('line-clamp-2 text-[13px] font-bold leading-tight', theme.headline)}>
              {ad.headline.text}
            </p>
          ) : (
            <p className="text-[12px] italic text-white/35">Add a headline…</p>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 whitespace-nowrap rounded-lg border px-3 py-2 text-[12px] font-bold shadow-sm',
            theme.cta,
          )}
        >
          {ad.cta ? ad.cta.text : 'Learn More'}
        </span>
      </div>

      {imageError && (
        <p className="border-t border-warning/20 bg-warning/[0.06] px-3 py-1.5 text-[10px] text-warning">
          {imageError}
        </p>
      )}
    </div>
  )
}
