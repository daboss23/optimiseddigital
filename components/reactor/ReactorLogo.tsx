import Image from 'next/image'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   ReactorLogo — the product lockup, shown until a website is connected.
   Once ATLAS reads a site, BrandMark renders that business's own logo instead.
   The artwork itself stays still; two glow layers sit exactly over the
   engine core (82.3% / 31% of the canvas) and breathe on a slow 3.6s loop —
   a soft orange-red halo plus a white-hot center, blended with `screen`
   so only the reactor heart appears to pulse.
---------------------------------------------------------------------------- */

export function ReactorLogo({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      className={cn(
        'engine-logo relative inline-block',
        size === 'md' ? 'w-full' : 'h-9 w-auto',
        className,
      )}
    >
      <Image
        src="/tpb-reactor-logo.png"
        alt="TPB Creative Reactor"
        width={1055}
        height={604}
        priority={size === 'md'}
        className={size === 'md' ? 'h-auto w-full' : 'h-9 w-auto'}
      />
      <span className="engine-glow" aria-hidden="true" />
      <span className="engine-glow-core" aria-hidden="true" />
    </span>
  )
}
