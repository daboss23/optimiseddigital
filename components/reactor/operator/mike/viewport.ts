'use client'

import { useEffect, useState } from 'react'

/* ----------------------------------------------------------------------------
   One answer to "how big is Mike here", for every surface he appears on.

   He has three: the resident orb on the dashboard, the first-run welcome, and
   the brand onboarding hand-off. Each one placed him by hand — a radius, a
   height fraction — and they had drifted apart: the resident orb already
   halved itself under 768px while both transmissions stayed pinned at
   `radius={92}`. On a 390px screen that is a 184px sphere with a corona
   reaching nearly twice as far, sitting exactly where the first paragraph of
   his introduction renders. He was standing on his own words at the only
   moment anybody meets him.

   The size comes from the SHORTER viewport axis, not from a width breakpoint.
   A phone held sideways is 844px wide and 390px tall: by width it is a desktop
   and gets a desktop-sized Mike, in a window with less headroom than a
   portrait phone. The short axis is the one that actually constrains him, and
   reading it makes portrait, landscape and desktop fall out of one line of
   arithmetic instead of three breakpoints that have to agree.
---------------------------------------------------------------------------- */

/** The tablet breakpoint the rest of the platform uses for phone treatment. */
const PHONE_MAX = 767

/** What a laptop was designed around; he never grows past it. */
const RADIUS_MAX = 92
/** Below this he stops reading as a presence and starts reading as an icon. */
const RADIUS_MIN = 52
/** Of the shorter viewport axis. Lands on 92 from ~575px of headroom up. */
const RADIUS_SHARE = 0.16
/**
 * Where his centre sits, as a multiple of his own radius.
 *
 * His corona reaches roughly twice his radius, so a shade over two radii of
 * headroom is what keeps the light off the first line of what he is saying.
 * Expressed in radii rather than in viewport height so the clearance is the
 * same on every screen — it is his corona that has to clear the text, and his
 * corona does not know how tall the window is.
 */
const CENTRE_IN_RADII = 2.15

const clamp = (min: number, value: number, max: number) =>
  Math.min(Math.max(value, min), max)

export interface MikeGeometry {
  /** True on a phone-width screen. Drives type size, not geometry. */
  compact: boolean
  /** Sphere radius for a transmission — he fills the screen without owning it. */
  transmissionRadius: number
  /** Where his centre sits, as a fraction of viewport height. */
  transmissionHeight: number
}

/**
 * Resolved from the real viewport rather than from a media query, because the
 * orb is drawn to a canvas in device pixels and its size is a number rather
 * than a class.
 *
 * Starts at the desktop measurements so the server and the first client render
 * agree; the effect corrects them before paint. The orb springs to its radius,
 * so even a frame that slipped through would settle rather than jump.
 */
export function useMikeGeometry(): MikeGeometry {
  const [size, setSize] = useState({ w: 1440, h: 900 })

  useEffect(() => {
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    measure()
    window.addEventListener('resize', measure)
    // A phone rotating fires resize, but some browsers fire it before the new
    // dimensions have settled — orientationchange catches the second half.
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  const transmissionRadius = clamp(
    RADIUS_MIN,
    Math.round(Math.min(size.w, size.h) * RADIUS_SHARE),
    RADIUS_MAX,
  )

  return {
    compact: size.w <= PHONE_MAX,
    transmissionRadius,
    // Clamped at both ends: never so high that he is cropped by the top of the
    // window, never so low on a short screen that there is nothing left below
    // him to speak into.
    transmissionHeight: clamp(0.14, (transmissionRadius * CENTRE_IN_RADII) / size.h, 0.42),
  }
}
