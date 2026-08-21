/**
 * The server's copy of the data-source seam.
 *
 * `lib/operator/adapters/index.ts` is the seam the BROWSER reads through, and
 * its live implementation is deliberately a fetch to `/api/operator/source` —
 * a relative URL, which cannot resolve inside a server runtime. So the agent
 * needs its own resolver, and this is it.
 *
 * The property that matters is that it resolves the SAME two sources by the
 * SAME switch: seeded unless the deployment says `meta`. If these two ever
 * disagree, the queue on screen and the answers Mike gives about it are
 * reading different accounts, which is a worse failure than either being
 * wrong on its own — it is unfalsifiable from the UI.
 *
 * `NEXT_PUBLIC_OPERATOR_SOURCE` is read rather than a new server-only variable
 * because a second switch is a second thing to forget. It is a build-time
 * inlined value in the browser and an ordinary environment variable here, and
 * one name means the two can never be set to different things.
 */

import {
  createSeededSource,
  SEEDED_ACCOUNT_TIMEZONE,
} from '@/lib/operator/adapters/seeded'
import { fetchOperatorSource } from '@/lib/operator/adapters/meta-server'
import { todayIn } from '@/lib/operator/dates'
import type {
  CreativeSnapshot,
  DataSource,
  DataSourceMetadata,
  PerformanceBaseline,
} from '@/lib/operator/types'

export type SourceOrigin = 'seeded' | 'meta'

/** Which source this deployment reads. The one switch, read in one place. */
export function configuredOrigin(): SourceOrigin {
  const flag = (process.env.OPERATOR_SOURCE ?? process.env.NEXT_PUBLIC_OPERATOR_SOURCE ?? '').trim()
  return flag === 'meta' ? 'meta' : 'seeded'
}

/**
 * The live source, wrapped so its three methods share ONE Graph pull.
 *
 * `fetchOperatorSource` does the whole account in a single pass — three calls
 * would triple the Graph work for the same payload, and worse, could return
 * three views of an account that moved between them.
 */
function metaSource(): DataSource {
  let payload: ReturnType<typeof fetchOperatorSource> | null = null
  const load = () => {
    if (!payload) payload = fetchOperatorSource()
    return payload
  }
  return {
    getCreatives: async () => (await load()).creatives,
    getBaselines: async () => (await load()).baselines,
    getMetadata: async () => (await load()).metadata,
  }
}

export function serverDataSource(evaluationDate: string): DataSource {
  return configuredOrigin() === 'meta' ? metaSource() : createSeededSource({ evaluationDate })
}

/* ------------------------------ the bootstrap ------------------------------ */

export interface OperatorContext {
  /** Today in the AD ACCOUNT's timezone, never the reader's. */
  evaluationDate: string
  creatives: CreativeSnapshot[]
  baselines: PerformanceBaseline[]
  metadata: DataSourceMetadata
}

/**
 * Load the account, date and all.
 *
 * The chicken-and-egg this function exists to remove: a `DataSource` needs an
 * evaluation date to be built, and the only authority on which date that is —
 * the ad account's own timezone — arrives in the metadata the source returns.
 * Building one with a placeholder date to read the timezone off it produces a
 * seeded account generated around an invalid date, which fails at the first
 * arithmetic rather than anywhere near the cause.
 *
 * So each origin answers it the way only it can. The live source resolves the
 * account's today server-side and hands it back in the payload. The seeded one
 * declares its timezone as a constant, because a fixture that had to be built
 * before it could say where it lived would have the same problem.
 */
export async function loadOperatorContext(): Promise<OperatorContext> {
  if (configuredOrigin() === 'meta') {
    const payload = await fetchOperatorSource()
    return {
      evaluationDate: payload.evaluationDate,
      creatives: payload.creatives,
      baselines: payload.baselines,
      metadata: payload.metadata,
    }
  }

  const evaluationDate = todayIn(SEEDED_ACCOUNT_TIMEZONE)
  const source = createSeededSource({ evaluationDate })
  const [creatives, baselines, metadata] = await Promise.all([
    source.getCreatives(),
    source.getBaselines(),
    source.getMetadata(),
  ])
  return { evaluationDate, creatives, baselines, metadata }
}
