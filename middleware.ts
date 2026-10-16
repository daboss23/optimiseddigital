import { NextResponse, type NextRequest } from 'next/server'
import {
  OPERATOR_NAME_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  expectedCredentials,
  loginRequired,
  readSessionToken,
} from '@/lib/auth'

/* ----------------------------------------------------------------------------
   The gate.

   Everything under the platform shell requires a signed session. The login
   page, the auth routes and the health check are the only doors that open
   without one — health specifically, because a deployment probe that starts
   getting redirected to /login reads as an outage.

   The signature is verified here rather than trusting the cookie's presence:
   a gate that accepts any value for its own cookie is a suggestion.

   While `loginRequired()` is off, the gate is held open rather than removed:
   a visitor with no session is issued the operator session the login form
   would have issued, and the request continues to wherever it was headed.
---------------------------------------------------------------------------- */

/**
 * Issue the operator session on this request and let it through.
 *
 * The cookie is written to BOTH sides: onto the forwarded request, so the
 * server components rendering this very page already see a signed-in session
 * (otherwise the first load would render as nobody), and onto the response,
 * so every request after it carries the cookie on its own.
 */
async function openGate(request: NextRequest): Promise<NextResponse> {
  const operator = expectedCredentials().name
  const token = await createSessionToken(operator)

  request.cookies.set(SESSION_COOKIE, token)
  request.cookies.set(OPERATOR_NAME_COOKIE, operator)
  const response = NextResponse.next({ request: { headers: request.headers } })

  const secure = process.env.NODE_ENV === 'production'
  response.cookies.set(SESSION_COOKIE, token, {
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

export async function middleware(request: NextRequest) {
  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  if (!loginRequired()) return openGate(request)

  const { pathname, search } = request.nextUrl

  // An unauthenticated API call gets a 401, not an HTML login page — a fetch
  // that silently receives a redirect to a page is the hardest kind of failure
  // to read from the client.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })
  }

  const login = request.nextUrl.clone()
  login.pathname = '/login'
  login.search = ''
  // Carry where they were headed, so signing in lands them there rather than
  // dumping everyone on the dashboard.
  if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   login            — the door itself
     *   api/auth/*       — signing in and out
     *   api/health       — deployment probes
     *   owner, api/owner — the Platform Library. It has its OWN credential
     *                      (lib/owner.ts) and checks it on every request; a
     *                      brand session neither grants nor is needed for it,
     *                      and the open gate must not hand one out on the way.
     *   _next/*, assets  — static output and public files
     */
    '/((?!login|api/auth|api/health|owner|api/owner|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|woff|woff2)$).*)',
  ],
}
