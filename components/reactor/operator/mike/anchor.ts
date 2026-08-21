/**
 * Where Mike lives on the page.
 *
 * One id, shared by the element that reserves his space (in the queue
 * headline) and the stage that draws him. He is rendered on a fixed canvas
 * above everything, so the page cannot lay him out — this is how the two
 * halves agree on a position without either owning the other.
 *
 * If the anchor is not on screen — another route, the queue still loading —
 * the stage falls back to the corner of the viewport. He is always somewhere.
 */
export const MIKE_ANCHOR_ID = 'mike-anchor'

/** The anchor's centre in viewport pixels, or null when it is not rendered. */
export function anchorPoint(): { x: number; y: number } | null {
  if (typeof document === 'undefined') return null
  const el = document.getElementById(MIKE_ANCHOR_ID)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  // A zero box means it is in the tree but not laid out yet.
  if (rect.width === 0 && rect.height === 0) return null
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
