import { NextResponse } from 'next/server'
import {
  OPERATOR_NAME_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  checkCredentials,
  createSessionToken,
  expectedCredentials,
} from '@/lib/auth'

/**
 * Sign in.
 *
 * Sets two cookies: the signed session (httpOnly — the browser never reads it)
 * and the operator's name (readable, because the greeting is rendered client
 * side by Mike's own provider). A wrong password returns one generic message;
 * saying WHICH half was wrong is free intelligence for anyone guessing.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 })
  }

  const { name, password } = (body ?? {}) as { name?: unknown; password?: unknown }

  if (!checkCredentials(name, password)) {
    return NextResponse.json(
      { success: false, error: 'That name and password do not match.' },
      { status: 401 },
    )
  }

  // Store the canonical spelling, not whatever casing was typed — Mike greets
  // "Bamik", never "bamik".
  const operator = expectedCredentials().name
  const response = NextResponse.json({ success: true, name: operator })
  const secure = process.env.NODE_ENV === 'production'

  response.cookies.set(SESSION_COOKIE, await createSessionToken(operator), {
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
