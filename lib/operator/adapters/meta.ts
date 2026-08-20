/**
 * The live Meta adapter — the client side of the seam.
 *
 * The operator pipeline runs in the browser, but the Meta access token never
 * can. So this adapter is a thin HTTP shell: it fetches the shaped DataSource
 * payload from `/api/operator/source`, where `meta-server.ts` does the Graph
 * work server-side. Everything above `adapters/` reads the same
 * `DataSource` interface either way and knows nothing about the transport.
 *
 * The failure philosophy is unchanged from the stub this file replaces: it
 * THROWS rather than degrades, because a data source that silently returns
 * partial figures is how an operator ends up making a
 * four-hundred-thousand-dollar decision on half an account. The provider
 * catches the throw and renders the disconnected state.
 *
 * What the server side asks the Graph API for, and why each call is not
 * optional, is documented in `meta-server.ts` — in particular the separate
 * range-level insights call per evaluation window, because frequency cannot
 * be reconstructed from daily reach at any level of effort.
 */

import type { DataSource } from '@/lib/operator/types'
import type { OperatorSourcePayload } from '@/lib/operator/adapters/meta-server'

export class MetaAdapterNotImplemented extends Error {
  constructor(reason?: string) {
    super(
      `The live Meta data source is unavailable${
        reason ? `: ${reason}` : ''
      }. The operator renders its disconnected state rather than a partial account.`,
    )
    this.name = 'MetaAdapterNotImplemented'
  }
}

export interface MetaSourceOptions {
  /** The client's today — a hint only. The server resolves the account's own. */
  evaluationDate?: string
}

export function createMetaSource(options: MetaSourceOptions = {}): DataSource {
  // One fetch shared by all three methods — the pipeline calls them together,
  // and three requests would triple the Graph work for the same payload.
  let payload: Promise<OperatorSourcePayload> | null = null

  const load = (): Promise<OperatorSourcePayload> => {
    if (!payload) {
      const qs = options.evaluationDate
        ? `?date=${encodeURIComponent(options.evaluationDate)}`
        : ''
      payload = fetch(`/api/operator/source${qs}`)
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as
            | (OperatorSourcePayload & { error?: string })
            | null
          if (!res.ok || !body || !Array.isArray(body.creatives)) {
            throw new MetaAdapterNotImplemented(body?.error ?? `HTTP ${res.status}`)
          }
          return body
        })
        .catch((error: unknown) => {
          // Any failure — offline, unconfigured, Graph down — becomes the same
          // loud, catchable error. Never a partial payload.
          throw error instanceof MetaAdapterNotImplemented
            ? error
            : new MetaAdapterNotImplemented(
                error instanceof Error ? error.message : 'request failed',
              )
        })
    }
    return payload
  }

  return {
    getCreatives: async () => (await load()).creatives,
    getBaselines: async () => (await load()).baselines,
    getMetadata: async () => (await load()).metadata,
  }
}
