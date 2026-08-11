'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RANGE_PRESETS,
  rangeFromPreset,
  rangeLabel,
  rangeSubLabel,
  resolveRange,
  type DateRange,
} from '@/lib/date-range'

/* ----------------------------------------------------------------------------
   The global date-range control.

   One control, one range, for the entire page. Selecting here is the only way
   any performance figure on Meta Intelligence changes window — there is no
   per-card period, and nothing on the page carries a hard-coded "last 30 days".
---------------------------------------------------------------------------- */

export function DateRangePicker({
  value,
  onChange,
  busy,
}: {
  value: DateRange
  onChange: (next: DateRange) => void
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCustomFrom(value.from)
    setCustomTo(value.to)
  }, [value.from, value.to])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (next: DateRange) => {
    setOpen(false)
    onChange(next)
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'glass-hover flex items-center gap-2.5 rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-left transition-colors',
          open && 'border-primary/50',
        )}
      >
        <CalendarDays size={17} className="shrink-0 text-glow" />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold leading-tight text-white">
            {rangeLabel(value)}
          </span>
          <span className="block text-[11px] leading-tight text-white/50">
            {rangeSubLabel(value)}
          </span>
        </span>
        {busy ? (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border border-primary/30 border-t-glow" />
        ) : (
          <ChevronDown
            size={15}
            className={cn('shrink-0 text-white/45 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="glass reactor-panel shadow-panel absolute right-0 z-40 mt-2 w-[19rem] overflow-hidden rounded-xl p-2"
        >
          {RANGE_PRESETS.map((p) => {
            const active = value.preset === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(rangeFromPreset(p.id, value.timezone))}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
                  active ? 'bg-primary/12 text-glow' : 'text-white/70 hover:bg-white/[0.05] hover:text-white',
                )}
              >
                {p.label}
                {active && <Check size={14} />}
              </button>
            )
          })}

          <div className="mt-2 border-t border-border px-3 pb-1 pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              Custom range
            </p>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-[12px] text-white"
                aria-label="Start date"
              />
              <span className="text-white/30">→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background/60 px-2 py-1.5 text-[12px] text-white"
                aria-label="End date"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                pick(resolveRange({ from: customFrom, to: customTo, tz: value.timezone }))
              }
              disabled={!customFrom || !customTo || customFrom > customTo}
              className="mt-2 w-full rounded-lg border border-primary/35 bg-primary/12 px-3 py-2 text-[12px] font-semibold text-glow transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              Apply range
            </button>
          </div>

          <p className="px-3 pb-1 pt-2 text-[10px] leading-relaxed text-white/35">
            Every metric, chart, ranking and status on this page is calculated over the selected
            range and compared against the equally long period before it.
          </p>
        </div>
      )}
    </div>
  )
}
