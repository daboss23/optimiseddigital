/**
 * Curated demo data — what it may fill, and when.
 *
 * The platform ships a full set of illustrative numbers, hooks, angles and ad
 * names. That set was written around one business, so it is gated, and the
 * gate has TWO halves because the set reaches two very different places:
 *
 *   · DISPLAY — the dashboards, the Vault inventory, the leaderboards. Shown
 *     only where the real source is empty (a connected Meta account or a filled
 *     Vault always wins) and badged DEMO DATA wherever it renders, so a viewer
 *     can tell an illustration from a reading. ON by default while the platform
 *     is being shown around; set NEXT_PUBLIC_REACTOR_DEMO_DATA=0 to render
 *     every panel in its real, empty state.
 *
 *   · RETRIEVAL — the curated corpus the agents search. This is the path that
 *     grounds a campaign, and another company's members, margins and market
 *     retrieved as evidence becomes another company's ads written for you. So
 *     it stays OFF unless explicitly asked for with
 *     NEXT_PUBLIC_REACTOR_DEMO_DATA=1. A dashboard being dressed for a demo
 *     must never quietly change what the Reactor writes.
 *
 * NEXT_PUBLIC_ because the dashboards that read it are client components; the
 * flag is not a secret, it only chooses which of two harmless states renders.
 */

function demoFlag(): string {
  return (process.env.NEXT_PUBLIC_REACTOR_DEMO_DATA ?? '').trim()
}

/** Whether empty dashboards render the curated illustration. On unless `0`. */
export function demoDataEnabled(): boolean {
  return demoFlag() !== '0'
}

/** Whether the agents may retrieve the curated corpus. Off unless `1`. */
export function demoRetrievalEnabled(): boolean {
  return demoFlag() === '1'
}
