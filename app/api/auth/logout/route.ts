import { NextResponse } from 'next/server'
import { OPERATOR_NAME_COOKIE, SESSION_COOKIE } from '@/lib/auth'

/**
 * Sign out.
 *
 * Clears both cookies. Mike's memory — the decision log in localStorage —
 * survives deliberately: signing out is leaving for the day, not resigning.
 * The login form is what resets that, and only when a DIFFERENT operator
 * signs in.
 */
export async function POST() {
  const response = NextResponse.json({ success: true })
  for (const name of [SESSION_COOKIE, OPERATOR_NAME_COOKIE]) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 })
  }
  return response
}
