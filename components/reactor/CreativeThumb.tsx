import {
  Clapperboard,
  GalleryHorizontal,
  Image as ImageIcon,
  MessageSquareQuote,
  Play,
  User,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { accentClass, type Accent } from '@/components/reactor/ui'

/* ----------------------------------------------------------------------------
   Creative thumbnail — the first column of every creative table.

   A media buyer recognises the ad by sight long before they read its name. When
   Meta hands us a real thumbnail we show it; when it doesn't (demo data, a
   creative with no served still) we fall back to a format-coded tile rather
   than a broken image or an empty box.
---------------------------------------------------------------------------- */

const FORMAT_IDENTITY: Record<string, { icon: LucideIcon; accent: Accent }> = {
  'Founder Video': { icon: User, accent: 'emerald' },
  'UGC Video': { icon: Clapperboard, accent: 'violet' },
  Testimonial: { icon: MessageSquareQuote, accent: 'pink' },
  Static: { icon: ImageIcon, accent: 'blue' },
  VSL: { icon: Play, accent: 'amber' },
  Carousel: { icon: GalleryHorizontal, accent: 'cyan' },
}

export function CreativeThumb({
  format,
  name,
  src,
  size = 'md',
}: {
  format: string
  name: string
  src?: string
  size?: 'sm' | 'md'
}) {
  const id = FORMAT_IDENTITY[format] ?? { icon: ImageIcon, accent: 'blue' as Accent }
  const Icon = id.icon
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`${name} — ${format} creative`}
        className={cn(
          box,
          'shrink-0 rounded-lg border border-border object-cover shadow-[0_2px_10px_-4px_rgba(0,0,0,0.8)]',
        )}
      />
    )
  }

  return (
    <span
      className={cn(
        box,
        'angle-tile shrink-0 rounded-lg text-[color:rgb(var(--acc-hi))]',
        accentClass[id.accent],
      )}
      title={`${format} creative`}
      aria-label={`${format} creative`}
    >
      <Icon size={size === 'sm' ? 14 : 16} />
    </span>
  )
}
