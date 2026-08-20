import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, readSessionToken } from '@/lib/auth'

/* ----------------------------------------------------------------------------
   The gate.

   Everything under the platform shell requires a signed session. The login
   page, the auth routes and the health check are the only doors that open
   without one — health specifically, because a deployment probe that starts
   getting redirected to /login reads as an outage.

   The signature is verified here rather than trusting the cookie's presence:
   a gate that accepts any value for its own cookie is a suggestion.
---------------------------------------------------------------------------- */

export async function middleware(request: NextRequest) {
  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

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
     *   _next/*, assets  — static output and public files
     */
    '/((?!login|api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|woff|woff2)$).*)',
  ],
}
