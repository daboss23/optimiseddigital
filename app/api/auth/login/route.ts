import { NextResponse } from 'next/server'
import {
  OPERATOR_NAME_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkCredentials,
  createSessionToken,
  expectedCredentials,
} from '@/lib/auth'
import { authenticateUser, hasUsers, resolveOperatorAccount } from '@/lib/account'

export const runtime = 'nodejs'

/**
 * Sign in.
 *
 * Two paths, tried in that order:
 *
 *   1. A real user of a real account (`users` table). The session it issues
 *      CARRIES THAT ACCOUNT, which is what makes every downstream query
 *      scopeable — the tenant is established here, once, from a credential,
 *      instead of being taken on trust from each request body later.
 *   2. The single-operator gate: one name, one password, for a deployment
 *      handed to somebody for an afternoon. It issues a session with no
 *      account, so the shell opens and no customer data is reachable.
 *
 * Once a deployment has users, the operator gate stops accepting logins
 * entirely. Leaving it live alongside real customers would be a second door
 * into the building with a password printed on the login page.
 *
 * Sets two cookies: the signed session (httpOnly — the browser never reads it)
 * and the operator's name (readable, because the greeting is rendered client
 * side by Mike's own provider). A wrong credential returns one generic message;
 * saying WHICH half was wrong is free intelligence for anyone guessing.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }

  const { name, email, password } = (body ?? {}) as {
    name?: unknown
    email?: unknown
    password?: unknown
  }

  const rejected = NextResponse.json(
    { success: false, error: 'Those details do not match an account.' },
    { status: 401 },
  )

  // The login form sends one identifier field; an address is a user login,
  // anything else is the operator name.
  const identifier = typeof email === 'string' && email.trim() ? email : name
  const looksLikeEmail = typeof identifier === 'string' && identifier.includes('@')

  let operator: string
  let identity: { accountId?: string; userId?: string } = {}

  if (looksLikeEmail) {
    const user = await authenticateUser(identifier, password)
    if (!user) return rejected
    operator = user.name?.trim() || user.email.split('@')[0]
    identity = { accountId: user.accountId, userId: user.id }
  } else {
    // The operator gate closes as soon as real accounts exist.
    if (await hasUsers()) return rejected
    if (!checkCredentials(identifier, password)) return rejected
    // Store the canonical spelling, not whatever casing was typed — Mike greets
    // "Bamik", never "bamik".
    operator = expectedCredentials().name
    // The gate works IN an account rather than outside every account. Without
    // this a single-brand deployment signs in successfully and then cannot
    // connect a website, ingest anything, or save an ad — every scoped write
    // refusing, correctly, for want of a tenant that was never created.
    const operatorAccount = await resolveOperatorAccount(operator)
    if (operatorAccount) identity = { accountId: operatorAccount }
  }

  const response = NextResponse.json({ success: true, name: operator })
  const secure = process.env.NODE_ENV === 'production'

  response.cookies.set(SESSION_COOKIE, await createSessionToken(operator, identity), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  response.cookies.set(OPERATOR_NAME_COOKIE, operator, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })

  return response
}
