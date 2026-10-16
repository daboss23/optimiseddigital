import { NextRequest, NextResponse } from 'next/server'
import { OWNER_COOKIE, OWNER_MAX_AGE, checkOwnerPassword, createOwnerToken, ownerAccess } from '@/lib/owner'
import { isOwnerRequest } from '@/lib/owner-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The owner's sign-in.
 *
 * GET    — whether the owner area is open on this deployment, and whether this
 *          browser is signed in to it.
 * POST   — { password } → the signed owner cookie.
 * DELETE — sign out.
 *
 * Outside the brand middleware on purpose (see middleware.ts): a brand session
 * neither grants nor is required for owner access.
 */

export async function GET() {
  const access = ownerAccess()
  return NextResponse.json({ ...access, signedIn: access.enabled ? await isOwnerRequest() : false })
}

/** A wrong password costs this long — cheap for the owner, slow for a guesser. */
const FAILURE_DELAY_MS = 900

export async function POST(request: NextRequest) {
  const access = ownerAccess()
  if (!access.enabled) {
    return NextResponse.json({ success: false, error: access.reason }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  if (!(await checkOwnerPassword(body?.password))) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS))
    return NextResponse.json({ success: false, error: 'That password is not right.' }, { status: 401 })
  }
  const response = NextResponse.json({ success: true })
  response.cookies.set(OWNER_COOKIE, await createOwnerToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: OWNER_MAX_AGE,
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(OWNER_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return response
}
