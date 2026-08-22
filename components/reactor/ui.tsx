import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CountUp } from '@/components/reactor/CountUp'

/* ----------------------------------------------------------------------------
   Accent channels — neon colour identities shared across the command center.
   The .acc-* classes (globals.css) expose --acc / --acc-hi to every child.
---------------------------------------------------------------------------- */

export type Accent = 'blue' | 'cyan' | 'violet' | 'emerald' | 'pink' | 'amber'

export const accentClass: Record<Accent, string> = {
  blue: 'acc-blue',
  cyan: 'acc-cyan',
  violet: 'acc-violet',
  emerald: 'acc-emerald',
  pink: 'acc-pink',
  amber: 'acc-amber',
}

/* ------------------------------- Panel ----------------------------------- */

export function Panel({
  children,
  className,
  hover,
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}) {
  return (
    <div className={cn('glass reactor-panel shadow-panel', hover && 'glass-hover', className)}>
      <div className="panel-sheen" aria-hidden="true" />
      {children}
    </div>
  )
}

export function PanelHeader({
  title,
  subtitle,
  icon,
  accessory,
  accent = 'blue',
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  accessory?: ReactNode
  accent?: Accent
}) {
  return (
    /* `flex-wrap` with a real basis on the text group is what lets the
       accessory — usually a status pill — drop to its own line on a phone
       rather than being squeezed to its minimum width beside a two-line
       subtitle. On a desktop the basis is never the binding constraint, so the
       header keeps its single row. The icon aligns to the TITLE rather than to
       the centre of the whole block, which is only the same place when the
       subtitle happens to be one line long. */
    <div className="panel-header flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5 border-b border-border px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex min-w-0 flex-1 basis-[15rem] items-start gap-3">
        {icon && (
          <span
            className={cn(
              'panel-icon mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg',
              accentClass[accent],
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-[15px] font-semibold tracking-tight text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-white/55">{subtitle}</p>}
        </div>
      </div>
      {accessory && <div className="shrink-0">{accessory}</div>}
    </div>
  )
}

export function PanelFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="panel-footer-btn">
      {children}
      <ChevronRight size={13} />
    </Link>
  )
}

/* ------------------------------ Page header ------------------------------- */

export function PageHeader({
  system,
  title,
  subtitle,
  tagline,
}: {
  system?: string
  title: string
  subtitle: string
  tagline?: string
}) {
  return (
    <div className="animate-fade-up">
      {system && (
        <span className="font-mono text-[11px] tracking-[0.3em] text-glow/70">
          INTELLIGENCE SYSTEM {system}
        </span>
      )}
      <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-white md:text-3xl">
        {title}
      </h1>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/65">{subtitle}</p>
      {tagline && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.28em] text-white/30">
          {tagline}
        </p>
      )}
    </div>
  )
}

/* -------------------------------- Trend ----------------------------------- */

export function TrendBadge({
  trend,
  value,
}: {
  trend: 'up' | 'down' | 'flat'
  value: string
}) {
  const map = {
    up: { Icon: TrendingUp, cls: 'text-emerald bg-emerald/10' },
    down: { Icon: TrendingDown, cls: 'text-danger bg-danger/10' },
    flat: { Icon: Minus, cls: 'text-white/40 bg-white/5' },
  } as const
  const { Icon, cls } = map[trend]
  return (
    <span
      className={cn(
        'trend-badge inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium tabular',
        cls,
      )}
    >
      <Icon size={12} />
      {value}
    </span>
  )
}

/* ------------------------------- KPI card --------------------------------- */

const sparkPaths = [
  'M1 26L11 23L20 25L30 17L39 21L49 12L60 18L71 15L81 16L92 6L101 13L111 9',
  'M1 24L11 26L20 19L30 22L39 14L49 17L60 10L71 14L81 9L92 12L101 6L111 10',
  'M1 27L11 22L20 24L30 18L39 20L49 15L60 17L71 11L81 14L92 8L101 11L111 5',
] as const

// Build an SVG path from a real numeric series (e.g. weekly cumulative counts),
// normalised into the 112x32 sparkline box. Falls back to a preset shape only
// when no data is supplied, so the line always reflects actual movement.
function pathFromSeries(series: number[]): string {
  if (series.length < 2) return ''
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = max - min || 1
  const stepX = 110 / (series.length - 1)
  return series
    .map((v, i) => {
      const x = 1 + i * stepX
      const y = 28 - ((v - min) / range) * 24 // 4px top/bottom padding
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join('')
}

// Final (x, y) of a real series in the 112x32 box — anchors the glowing
// endpoint dot so the line terminates in a bright, premium node.
function endPointFromSeries(series: number[]): { x: number; y: number } | null {
  if (series.length < 2) return null
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = max - min || 1
  const y = 28 - ((series[series.length - 1] - min) / range) * 24
  return { x: 111, y: Number(y.toFixed(1)) }
}

function Sparkline({ seed, series }: { seed: number; series?: number[] }) {
  const hasSeries = !!series && series.length >= 2
  const d = hasSeries ? pathFromSeries(series!) : sparkPaths[seed % sparkPaths.length]
  const end = hasSeries ? endPointFromSeries(series!) : null
  const fillId = `spark-fill-${seed}`
  return (
    <svg aria-hidden="true" className="kpi-sparkline" viewBox="0 0 112 32">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}V32H1Z`} fill={`url(#${fillId})`} stroke="none" />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        pathLength={1}
        className="draw-line"
      />
      {end && (
        <>
          <circle className="spark-dot-halo" cx={end.x} cy={end.y} r="3" />
          <circle className="spark-dot" cx={end.x} cy={end.y} r="1.7" />
        </>
      )}
    </svg>
  )
}

export function KpiCard({
  label,
  value,
  delta,
  trend,
  accent = 'blue',
  icon: Icon = Activity,
  spark,
}: {
  label: string
  value: number
  delta: string
  trend: 'up' | 'down' | 'flat'
  accent?: Accent
  icon?: LucideIcon
  spark?: number[]
}) {
  const TrendIcon = trend === 'down' ? TrendingDown : trend === 'flat' ? Minus : TrendingUp
  return (
    <div className={cn('kpi-card group p-4', accentClass[accent])}>
      <span className="kpi-bloom" aria-hidden="true" />
      <span className="kpi-grid" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-2">
        <span className="kpi-icon">
          <Icon size={21} />
        </span>
        <span className="accent-chip tabular">
          <TrendIcon size={12} />
          {delta.replace('+', '')}
        </span>
      </div>
      <p className="relative mt-3 truncate text-[11.5px] font-semibold uppercase tracking-[0.1em] text-white/85">
        {label}
      </p>
      <CountUp
        value={value}
        className="count-up relative mt-1 block font-display text-[2.45rem] font-bold leading-none tracking-tight tabular text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.65)]"
      />
      <Sparkline seed={label.length + value} series={spark} />
    </div>
  )
}

/* ------------------------------ Progress bar ------------------------------ */

export function ProgressBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="progress-track h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary via-glow to-cyan"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/* ------------------------------ Radial gauge ------------------------------ */

export function RadialGauge({
  value,
  accent = 'blue',
  size = 64,
  stroke = 5,
}: {
  value: number
  accent?: Accent
  size?: number
  stroke?: number
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.min(100, Math.max(0, value)) / 100)
  return (
    <span className={cn('gauge-wrap shrink-0', accentClass[accent])}>
      <svg
        className="gauge-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          className="gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="gauge-bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="gauge-value font-display text-[14px] font-bold">{value}%</span>
    </span>
  )
}

/* --------------------------------- Pill ----------------------------------- */

/**
 * The state a panel shows before the platform has anything real to display.
 *
 * Deliberately keeps the panel's own heading and subtitle above it — a card
 * with no data still has to explain what it is for and how to fill it, or the
 * user has no idea what they are looking at or what to do next.
 */
export function EmptyState({
  icon,
  message,
  hint,
  action,
}: {
  icon?: ReactNode
  /** One line: what is not here yet. */
  message: string
  /** One line: how the user makes it appear. */
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      {icon ? <span className="text-white/25">{icon}</span> : null}
      <p className="text-sm text-white/55">{message}</p>
      {hint ? (
        <p className="max-w-md text-[12px] leading-relaxed text-white/35">{hint}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Pill({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
}) {
  const tones = {
    default: 'border-border bg-surface/60 text-white/60',
    primary: 'border-primary/30 bg-primary/10 text-glow',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/30 bg-danger/10 text-danger',
  } as const
  return (
    <span
      className={cn(
        'reactor-pill inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}
