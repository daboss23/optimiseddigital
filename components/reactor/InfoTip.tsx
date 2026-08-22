'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ----------------------------------------------------------------------------
   A definition attached to a label.

   This was a CSS-only hover tooltip — an `absolute` 16rem panel hung off a
   16px button. Two things were wrong with that on a phone, and the second one
   was not a tooltip bug at all:

   1. Hover does not exist on a touchscreen, so the definitions behind every
      number on the dashboard were simply unreachable there.

   2. A 256px panel anchored to a button near the right edge of a 390px screen
      overflows the document. Chrome answers horizontal document overflow by
      WIDENING THE LAYOUT VIEWPORT — `window.innerWidth` measured 583 on a
      390px phone — and every `position: fixed` overlay on the platform is laid
      out against that. Mike's first-run welcome, his room, the nav drawer and
      the brief sheet were all being sized and centred to a 583px box, so a
      third of each of them sat off the side of the screen. One tooltip nobody
      could see was breaking the first thing a new operator ever sees.

   So the panel is portaled to <body> and positioned as `fixed`, measured and
   CLAMPED into the visual viewport every time it opens. Fixed content is not
   in the document's scrollable overflow, so it cannot widen anything, and the
   clamp means it cannot leave the screen no matter where its anchor sits.

   Interaction follows the input device rather than assuming a mouse: hover and
   keyboard focus open it on a pointer device, an explicit tap toggles it on a
   touchscreen, and the button carries a 44px hit area there without changing
   its 16px inline footprint (the target is an invisible ::after, so the icon
   still sits tight against the label it defines).
---------------------------------------------------------------------------- */

/** Kept clear of the screen edges — and of the notch, on a phone held sideways. */
const EDGE = 12
/** Between the anchor and the panel. */
const GAP = 8

interface Position {
  left: number
  top: number
  /** Which side of the anchor it resolved to — drives the arrival transform. */
  side: 'above' | 'below'
}

export function InfoTip({
  children,
  label,
  className,
  align = 'left',
}: {
  children: ReactNode
  label?: string
  className?: string
  /**
   * Preferred horizontal bias when the panel is narrower than the space around
   * it. Retained so call sites keep reading the same; the viewport clamp is
   * what actually guarantees it lands on screen.
   */
  align?: 'left' | 'right'
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  /* Measure and clamp. Runs before paint so the panel is never seen at 0,0. */
  const place = useCallback(() => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const a = anchor.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    // The VISUAL viewport, not innerWidth: on a pinch-zoomed page they differ,
    // and the one the person is looking at is the one to stay inside of.
    const vw = window.visualViewport?.width ?? window.innerWidth
    const vh = window.visualViewport?.height ?? window.innerHeight

    const centred = a.left + a.width / 2 - p.width / 2
    const biased = align === 'right' ? a.right - p.width : centred
    const left = Math.min(Math.max(biased, EDGE), Math.max(EDGE, vw - p.width - EDGE))

    // Above by preference — a tooltip under a thumb is a tooltip under a
    // thumb. Below only when there is genuinely no room up there.
    const above = a.top - p.height - GAP
    const fitsAbove = above >= EDGE
    const top = fitsAbove
      ? above
      : Math.min(a.bottom + GAP, Math.max(EDGE, vh - p.height - EDGE))

    setPosition({ left, top, side: fitsAbove ? 'above' : 'below' })
  }, [align])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()
  }, [open, place])

  /* Anything that moves the anchor closes it. Re-positioning mid-scroll would
     mean tracking a rect every frame to keep a hint on screen — the hint is
     not worth that, and a definition that follows you around the page reads as
     something stuck rather than something offered. */
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  /* Hover opens on a device that has one. A touchscreen reports a pointerenter
     on tap too, so the hover handlers only act for a real fine pointer. */
  const hoverOpens = (event: { pointerType?: string }) => event.pointerType === 'mouse'

  /**
   * What the press was, and what the state was BEFORE it.
   *
   * Tapping a button focuses it, and focus is one of the things that opens
   * this — so a naive `onClick={() => setOpen(v => !v)}` opened it on focus and
   * closed it again on the click of the same tap, and the definition never
   * appeared on a phone at all. Reading the state at `pointerdown` (which
   * lands before focus) is what makes the toggle mean what the person meant.
   */
  const press = useRef<{ type: string; wasOpen: boolean } | null>(null)

  const onClick = () => {
    const gesture = press.current
    press.current = null
    // A mouse governs this by hovering and a keyboard by focusing; both have
    // already done the right thing by the time a click arrives.
    if (!gesture || gesture.type === 'mouse') return
    setOpen(!gesture.wasOpen)
  }

  return (
    <span className={cn('group/tip relative inline-flex items-center', className)}>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label ? `What ${label} means` : 'Definition'}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerDown={(e) => {
          press.current = { type: e.pointerType, wasOpen: open }
        }}
        onClick={onClick}
        onPointerEnter={(e) => hoverOpens(e) && setOpen(true)}
        onPointerLeave={(e) => hoverOpens(e) && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          'infotip-trigger inline-grid h-4 w-4 shrink-0 place-items-center rounded-full text-white/30 transition-colors',
          'hover:text-glow focus:outline-none focus-visible:text-glow focus-visible:ring-1 focus-visible:ring-primary/60',
          open && 'text-glow',
        )}
      >
        <Info size={11} />
      </button>

      {open && mounted &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="tooltip"
            data-side={position?.side ?? 'above'}
            className="infotip-panel"
            style={
              position
                ? { left: `${position.left}px`, top: `${position.top}px` }
                : // Measured on the first pass; kept out of sight until placed
                  // rather than rendered at the origin and jumped into place.
                  { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            {label && <span className="infotip-panel__label">{label}</span>}
            {children}
          </div>,
          document.body,
        )}
    </span>
  )
}
