import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Atom, Sparkles } from 'lucide-react'
import { SESSION_COOKIE, credentialsAreDemo, expectedCredentials, readSessionToken } from '@/lib/auth'
import { DEFAULT_IDENTITY } from '@/lib/brand-identity'
import { getBrandIdentity } from '@/lib/brand-identity.server'
import { LoginField } from '@/components/login/LoginField'
import { LoginForm } from '@/components/login/LoginForm'

/* ----------------------------------------------------------------------------
   Login.

   Deliberately outside the (platform) group: no sidebar, no topbar, no
   navigation to anywhere that would only bounce back here. The aurora and the
   glass come from the root layout, so this reads as the same product with the
   chrome stripped rather than as a bolted-on sign-in screen.
---------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in — Creative Intelligence Command Center',
}

/**
 * Only ever redirect to a path on this deployment.
 *
 * `?next=` comes off the URL, and a redirect target taken from a query string
 * without this check is an open redirect — a link that looks like our domain
 * and lands on somebody else's. `//evil.com` is a protocol-relative URL, which
 * is why the second character is checked too.
 */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params.next
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw)

  // Already signed in — the door is not a place to stand around in.
  const session = await readSessionToken(cookies().get(SESSION_COOKIE)?.value)
  if (session) redirect(next)

  let identity = DEFAULT_IDENTITY
  try {
    identity = await getBrandIdentity()
  } catch {
    /* branding must never be able to fail the door */
  }

  const demo = credentialsAreDemo()
  const credentials = expectedCredentials()

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      {/* Loose motes of light behind the door. Subtle on purpose — there is a
          form in front of it that somebody has to read. */}
      <LoginField />
      <div className="relative z-10 w-full max-w-[420px] animate-fade-up">
        {/* Identity — the mark, then who this belongs to. */}
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[color:rgb(var(--lg-cyan)/0.3)] bg-gradient-to-br from-primary/25 to-violet/15 shadow-glow">
            <Atom size={26} className="animate-pulse-glow text-glow motion-reduce:animate-none" />
          </span>
          {/* "Creative Intelligence Command Center" is the dashboard hero's
              eyebrow and it wraps to two ragged lines inside a 420px card.
              Two words here, the full phrase under the title. */}
          {/* The eyebrow's typography without its wire-and-dot decoration —
              a centred card does not need a rule pointing into it. */}
          <span className="command-eyebrow command-eyebrow--bare mt-4">Operator Access</span>
          <h1 className="mt-3 font-display text-[30px] font-bold leading-[1.1] tracking-tight text-white">
            {identity.name}
          </h1>
          <p className="mt-2 text-[13px] font-medium uppercase tracking-[0.14em] text-glow/60">
            Creative Intelligence Command Center
          </p>
        </div>

        <div className="glass reactor-panel shadow-panel p-6 sm:p-7">
          <LoginForm next={next} />

          {/* The demo pair, printed on purpose — this deployment is being
              handed to a tester. It disappears by itself the moment
              PLATFORM_LOGIN_NAME / PLATFORM_LOGIN_PASSWORD are set, so a real
              deployment cannot accidentally publish its own password. */}
          {demo && (
            <div className="mt-6 rounded-lg border border-[color:rgb(var(--lg-cyan)/0.28)] bg-[color:rgb(var(--lg-cyan)/0.05)] px-4 py-3.5">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.28em] text-glow/70">
                <Sparkles size={11} />
                Demo access
              </p>
              <dl className="mt-2.5 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[12.5px] text-white/50">Name</dt>
                  <dd className="font-mono text-[13.5px] font-semibold tracking-wide text-white">
                    {credentials.name}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[12.5px] text-white/50">Password</dt>
                  <dd className="font-mono text-[13.5px] font-semibold tracking-wide text-white">
                    {credentials.password}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        {/* The tagline, lit. A slow band of light travels across the letters
            rather than the whole line pulsing: a pulse is a status indicator,
            a sweep reads as something with current running through it. */}
        <p className="tagline mt-6" aria-label="Engineered For Performance.">
          <span aria-hidden>Engineered For Performance.</span>
        </p>
      </div>
    </main>
  )
}
