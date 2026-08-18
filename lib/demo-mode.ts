/**
 * Curated demo data — on or off.
 *
 * The dashboards ship with a full set of illustrative numbers, hooks, angles
 * and ad names. That set is written around one business, and on any other
 * deployment it is worse than useless: a new customer sees confident metrics
 * for campaigns they never ran, in a vocabulary that is not their market, and
 * has no way to tell which parts of the screen are real.
 *
 * So it is off unless explicitly asked for. Set NEXT_PUBLIC_REACTOR_DEMO_DATA=1
 * on a deployment used for demos or screenshots; leave it unset everywhere else
 * and every panel renders its real state, empty until the platform has
 * something genuine to show.
 *
 * NEXT_PUBLIC_ because the dashboards that read it are client components; the
 * flag is not a secret, it only chooses which of two harmless states renders.
 */
export function demoDataEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REACTOR_DEMO_DATA === '1'
}
