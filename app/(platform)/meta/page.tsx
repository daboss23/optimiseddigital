import { MetaIntelligenceClient } from '@/components/reactor/meta/MetaIntelligenceClient'
import { resolveRange } from '@/lib/date-range'
import { resolveMetaDashboard } from '@/lib/meta-graph'

export const dynamic = 'force-dynamic'

/**
 * Meta Intelligence.
 *
 * The server resolves the range from the URL and renders the first payload, so
 * a shared link (or a jump in from the Reactor Dashboard) arrives with the
 * right window already on screen — no flash of the default period. Every range
 * change after that is handled client-side by one shared control.
 */
export default async function MetaIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const range = resolveRange({
    from: first(params.from),
    to: first(params.to),
    preset: first(params.preset),
    tz: first(params.tz),
  })
  const data = await resolveMetaDashboard(range)

  return <MetaIntelligenceClient initialRange={range} initialData={data} />
}
