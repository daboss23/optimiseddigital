/**
 * Where the operator's live Meta credentials come from.
 *
 * Two sources, in priority order:
 *
 * 1. **The stored connection** — the `meta.connection` platform setting,
 *    written by the Connect Meta panel on the dashboard. The token is
 *    validated against the Graph API before it is allowed to persist, so a
 *    stored connection is a working one at the moment it was saved.
 * 2. **The deployment environment** — `META_ACCESS_TOKEN` /
 *   `META_AD_ACCOUNT_ID`. The fallback that keeps a self-hosted deployment
 *   and the live self-test working without ever opening the settings screen.
 *
 * A stored connection wins over the environment because it is the more
 * deliberate act: somebody pasted that token into this deployment, for this
 * account, after the env was already an option.
 *
 * Everything here is server-side. The token is resolved here and used by
 * `meta-server.ts`; the only thing allowed to leave the server is the
 * connection summary produced by `describeMetaConnection`, with the token
 * reduced to its last four characters.
 */

import { getSetting, SETTING_META_CONNECTION } from '@/lib/settings'

export interface StoredMetaConnection {
  accessToken: string
  /** Normalised — no `act_` prefix. Null means "the first account the token can see". */
  adAccountId: string | null
  /** The account's display name at connect time, so the settings screen reads like a place, not an id. */
  accountName?: string
  connectedAt: string
}

export interface ResolvedMetaCredentials {
  token: string
  /** Null means resolve to the first account the token can see. */
  accountId: string | null
  origin: 'settings' | 'env'
}

/** `act_123` and `123` are the same account — store and compare one shape. */
export function normaliseAccountId(raw: string): string {
  return raw.trim().replace(/^act_/, '')
}

/**
 * Resolve the credentials the live source should use FOR ONE ACCOUNT, or null
 * when neither source has any.
 *
 * The stored connection is a Meta System User token with write access to an ad
 * account. It lived in a globally-keyed setting, so on a multi-tenant
 * deployment whichever customer connected last owned the credential every
 * other customer's ads published and reported through. It is now read from
 * that account's own settings row.
 *
 * The environment fallback is deliberately kept but is DEPLOYMENT-WIDE by
 * nature: it exists for a single-tenant install. On a deployment with real
 * accounts it should be left unset, and `npm run selftest:tenant` says so.
 *
 * Never throws — a settings-store failure reads as "no stored connection" and
 * the environment gets its say, which is the same philosophy as every other
 * setting on the platform.
 */
export async function resolveMetaCredentials(
  accountId: string | null,
): Promise<ResolvedMetaCredentials | null> {
  const stored = await getSetting<StoredMetaConnection>(SETTING_META_CONNECTION, accountId)
  if (stored?.accessToken) {
    return {
      token: stored.accessToken,
      accountId: stored.adAccountId ? normaliseAccountId(stored.adAccountId) : null,
      origin: 'settings',
    }
  }

  const envToken = (process.env.META_ACCESS_TOKEN ?? '').trim()
  if (envToken) {
    const envAccount = (process.env.META_AD_ACCOUNT_ID ?? '').trim()
    return {
      token: envToken,
      accountId: envAccount ? normaliseAccountId(envAccount) : null,
      origin: 'env',
    }
  }

  return null
}

/** The last four characters — the only part of a token allowed off the server. */
export function tokenTail(token: string): string {
  return token.slice(-4)
}
