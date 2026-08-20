/**
 * The Connect Meta settings screen's endpoint.
 *
 * GET    → the connection summary the screen renders. The stored token NEVER
 *          leaves this route — it is reduced to its last four characters, the
 *          same convention as a card number on a receipt.
 * POST   → validates a token against the Graph API BEFORE anything persists
 *          (`me/adaccounts` — a token that cannot list an account cannot read
 *          one), then stores it in platform_settings. When the token can see
 *          several ad accounts and none was chosen, nothing is stored yet: the
 *          response carries the account list so the screen can ask which one.
 * DELETE → removes the stored connection. The META_ACCESS_TOKEN env fallback,
 *          if set, takes over from the next request.
 *
 * Why platform_settings and not a new table: this is one small blob of
 * deployment-level configuration, exactly what the key/value store exists for
 * (see schema.settings.sql). The service role is the only database role that
 * can read it, and this route is the only door.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  clearSetting,
  getSetting,
  setSetting,
  settingsConfigured,
  SETTING_META_CONNECTION,
} from '@/lib/settings'
import { listAccounts } from '@/lib/meta-graph'
import {
  normaliseAccountId,
  tokenTail,
  type StoredMetaConnection,
} from '@/lib/operator/adapters/meta-credentials'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const stored = await getSetting<StoredMetaConnection>(SETTING_META_CONNECTION)
  return NextResponse.json({
    success: true,
    data: {
      connected: Boolean(stored?.accessToken),
      adAccountId: stored?.adAccountId ?? null,
      accountName: stored?.accountName ?? null,
      tokenTail: stored?.accessToken ? tokenTail(stored.accessToken) : null,
      connectedAt: stored?.connectedAt ?? null,
      // Whether a connection CAN be stored here, and whether the deployment
      // env would still read live data without one — the screen's two
      // "what happens instead" answers.
      storageAvailable: settingsConfigured(),
      envFallback: {
        token: Boolean(process.env.META_ACCESS_TOKEN),
        adAccountId: (process.env.META_AD_ACCOUNT_ID ?? '').trim() || null,
      },
    },
  })
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    accessToken?: unknown
    adAccountId?: unknown
  } | null
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
  const adAccountId =
    typeof body?.adAccountId === 'string' ? normaliseAccountId(body.adAccountId) : ''

  if (!accessToken) {
    return NextResponse.json({ success: false, error: 'An access token is required.' }, { status: 400 })
  }
  if (!settingsConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Supabase is not configured, so a connection cannot be stored. Set META_ACCESS_TOKEN in the deployment environment instead.',
      },
      { status: 503 },
    )
  }

  // Validate before anything persists — a stored token that cannot read an
  // account is a disconnected state with extra steps.
  let accounts: { id: string; name: string }[]
  try {
    accounts = await listAccounts(accessToken)
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Meta rejected the token: ${error instanceof Error ? error.message : 'unknown error'}`,
      },
      { status: 400 },
    )
  }
  if (accounts.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          'The token works, but it can see no ad accounts. Check it has ads_read on at least one account.',
      },
      { status: 400 },
    )
  }

  // Several accounts and no choice made — hand the list back so the screen
  // can ask. Nothing is stored until the choice comes back.
  if (!adAccountId && accounts.length > 1) {
    return NextResponse.json({ success: true, needsAccount: true, accounts })
  }

  const chosen = accounts.find((a) => a.id === (adAccountId || accounts[0].id))
  if (!chosen) {
    return NextResponse.json(
      {
        success: false,
        error: 'That ad account is not reachable with this token.',
        accounts,
      },
      { status: 400 },
    )
  }

  const stored = await setSetting(SETTING_META_CONNECTION, {
    accessToken,
    adAccountId: chosen.id,
    accountName: chosen.name,
    connectedAt: new Date().toISOString(),
  } satisfies StoredMetaConnection)
  if (!stored) {
    return NextResponse.json(
      { success: false, error: 'The connection could not be saved.' },
      { status: 503 },
    )
  }

  return NextResponse.json({
    success: true,
    data: { adAccountId: chosen.id, accountName: chosen.name, tokenTail: tokenTail(accessToken) },
  })
}

export async function DELETE() {
  await clearSetting(SETTING_META_CONNECTION)
  return NextResponse.json({ success: true })
}
