import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Atom, ShieldCheck, Sparkles } from 'lucide-react'
import { SESSION_COOKIE, credentialsAreDemo, expectedCredentials, readSessionToken } from '@/lib/auth'
import { DEFAULT_IDENTITY } from '@/lib/brand-identity'
import { getBrandIdentity } from '@/lib/brand-identity.server'
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
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="w-full max-w-[420px] animate-fade-up">
        {/* Identity — the mark, then who this belongs to. */}
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[color:rgb(var(--lg-cyan)/0.3)] bg-gradient-to-br from-primary/25 to-violet/15 shadow-glow">
            <Atom size={26} className="animate-pulse-glow text-glow motion-reduce:animate-none" />
          </span>
          {/* "Creative Intelligence Command Center" is the dashboard hero's
              eyebrow and it wraps to two ragged lines inside a 420px card.
              Two words here, the full phrase under the title. */}
          <span className="command-eyebrow mt-4">
            <span className="command-eyebrow-dot" />
            Operator Access
          </span>
          <h1 className="mt-3 font-display text-[30px] font-bold leading-[1.1] tracking-tight text-white">
            {identity.name}
          </h1>
          <p className="mt-2 text-[13px] font-medium uppercase tracking-[0.14em] text-glow/60">
            Creative Intelligence Command Center
          </p>
          <p className="mt-3 max-w-[19rem] text-[14px] leading-relaxed text-white/60">
            Sign in and Mike Delight will pick up where your Meta account left off.
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

        <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-white/35">
          <ShieldCheck size={12} />
          Engineered For Performance.
        </p>
      </div>
    </main>
  )
}
