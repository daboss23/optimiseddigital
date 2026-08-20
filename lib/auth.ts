/**
 * Platform access — the gate in front of the command center.
 *
 * This is a single-operator demo gate, not a user system: one name, one
 * password, one signed cookie. It exists so a deployment can be handed to
 * somebody for the afternoon without the whole Reactor being open to the
 * internet, and so Mike knows WHO just walked in.
 *
 * Everything here is Web-standard — `crypto.subtle`, `btoa`/`atob`, no Node
 * imports — because the same module is read by the edge middleware, by a route
 * handler, and (for the cookie name only) by the browser. A `node:crypto`
 * import would break the middleware build.
 *
 * The session cookie is signed rather than a flag. An unsigned `loggedIn=true`
 * is one devtools edit away from being useless, and the signature costs four
 * lines. It is NOT encryption: the name inside is readable, which is fine —
 * the only claim it makes is "this browser passed the password".
 */

/** Signed session. httpOnly — the browser never needs to read this one. */
export const SESSION_COOKIE = 'reactor.session'

/**
 * The operator's name, readable by client JS on purpose: it is what Mike
 * greets, and the greeting renders in the browser from the operator's own
 * memory. Carries no authority — the session cookie is the credential.
 */
export const OPERATOR_NAME_COOKIE = 'reactor.operator.name'

/** Thirty days. Long enough that a tester is not re-typing this all week. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

/* ------------------------------- credentials ------------------------------- */

const DEMO_NAME = 'Bamik'
const DEMO_PASSWORD = '1234'

export interface Credentials {
  name: string
  password: string
}

/**
 * The pair that opens the platform.
 *
 * Env-overridable so a real deployment can set its own without a code change;
 * falls back to the demo pair, which is the one printed on the login page.
 */
export function expectedCredentials(): Credentials {
  return {
    name: (process.env.PLATFORM_LOGIN_NAME ?? '').trim() || DEMO_NAME,
    password: (process.env.PLATFORM_LOGIN_PASSWORD ?? '').trim() || DEMO_PASSWORD,
  }
}

/**
 * Whether the deployment is still running the shipped demo pair.
 *
 * The login page only prints the credentials when this is true. The moment a
 * deployment sets its own, the hint disappears on its own rather than
 * publishing a real password to anyone who loads the page.
 */
export function credentialsAreDemo(): boolean {
  const { name, password } = expectedCredentials()
  return name === DEMO_NAME && password === DEMO_PASSWORD
}

/** Name is case-insensitive (people capitalise inconsistently); password is not. */
export function checkCredentials(name: unknown, password: unknown): boolean {
  if (typeof name !== 'string' || typeof password !== 'string') return false
  const expected = expectedCredentials()
  return (
    name.trim().toLowerCase() === expected.name.toLowerCase() &&
    password === expected.password
  )
}

/* --------------------------------- signing --------------------------------- */

function secret(): string {
  return (
    (process.env.AUTH_SECRET ?? '').trim() ||
    // A fixed development fallback. Deployments that care set AUTH_SECRET; a
    // demo gate whose secret is public is still a gate, just not a lock.
    'tpb-creative-reactor-session-key'
  )
}

/** URL-safe base64 of a UTF-8 string, without Buffer. */
function encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  // Indexed rather than `for…of`: the project targets ES5 lib semantics for
  // iterables, and a typed-array iteration needs downlevelIteration there.
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Constant-time compare — a signature check that leaks timing is not a check. */
function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface Session {
  name: string
  issuedAt: number
}

export async function createSessionToken(name: string): Promise<string> {
  const payload = encode(JSON.stringify({ name, issuedAt: Date.now() } satisfies Session))
  return `${payload}.${await sign(payload)}`
}

/**
 * Verify a cookie value. Returns the session, or null for anything at all
 * wrong — bad shape, bad signature, expired. Never throws: a malformed cookie
 * is a logged-out visitor, not a 500.
 */
export async function readSessionToken(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  if (!sameSignature(signature, await sign(payload))) return null

  const json = decode(payload)
  if (!json) return null
  try {
    const session = JSON.parse(json) as Partial<Session>
    if (typeof session.name !== 'string' || typeof session.issuedAt !== 'number') return null
    if (Date.now() - session.issuedAt > SESSION_MAX_AGE * 1000) return null
    return { name: session.name, issuedAt: session.issuedAt }
  } catch {
    return null
  }
}

/* ------------------------------ browser helper ----------------------------- */

/**
 * The logged-in operator's name, read in the browser.
 *
 * Used by the operator provider so Mike greets whoever signed in, rather than
 * whatever name was baked into NEXT_PUBLIC_OPERATOR_NAME at build time.
 * Returns null on the server and when nobody is signed in.
 */
export function readOperatorNameCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${OPERATOR_NAME_COOKIE}=([^;]*)`),
  )
  if (!match) return null
  try {
    return decodeURIComponent(match[1]).trim() || null
  } catch {
    return null
  }
}
