/**
 * The owner gate — the door to the Platform Library.
 *
 * A separate credential from a brand login, on purpose. A brand session says
 * "this browser may act for one brand"; the owner session says "this browser
 * may read and change the method every brand's agents use". The second must
 * never be reachable from the first, so it has its own password, its own
 * cookie, its own signing key, and routes the brand middleware does not cover.
 *
 * `PLATFORM_OWNER_PASSWORD` (Vercel env) is the credential. Unset — or shorter
 * than 12 characters — and the owner area is closed outright: the library
 * holds the owner's own IP, and a short password on a public URL is not a
 * lock. The session is signed with a key derived from that password, so
 * changing the password signs every owner session out at once.
 *
 * Web Crypto only (no Node imports), matching lib/auth.ts.
 */

export const OWNER_COOKIE = 'reactor.owner'
/** Twelve hours: an upload session, not a standing login. */
export const OWNER_MAX_AGE = 60 * 60 * 12
export const OWNER_MIN_PASSWORD = 12

function ownerPassword(): string {
  return (process.env.PLATFORM_OWNER_PASSWORD ?? '').trim()
}

/** Whether the owner area may open at all, and why not when it may not. */
export function ownerAccess(): { enabled: boolean; reason?: string } {
  const pw = ownerPassword()
  if (!pw) {
    return {
      enabled: false,
      reason: 'Set PLATFORM_OWNER_PASSWORD in the deployment environment to open the Platform Library.',
    }
  }
  if (pw.length < OWNER_MIN_PASSWORD) {
    return {
      enabled: false,
      reason: `PLATFORM_OWNER_PASSWORD must be at least ${OWNER_MIN_PASSWORD} characters — the library is reachable from the public URL.`,
    }
  }
  return { enabled: true }
}

function signingKey(): string {
  const base = (process.env.AUTH_SECRET ?? '').trim() || 'optimised-digital-session-key'
  // Domain-separated from brand sessions, and bound to the current password.
  return `${base}:owner:${ownerPassword()}`
}

const enc = new TextEncoder()

async function hmac(key: string, payload: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const mac = await crypto.subtle.sign('HMAC', k, enc.encode(payload))
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Check a submitted password. Both sides are MAC'd first, so the comparison
 * runs over equal-length digests and leaks neither the length nor a prefix.
 */
export async function checkOwnerPassword(input: unknown): Promise<boolean> {
  if (!ownerAccess().enabled || typeof input !== 'string') return false
  const key = 'owner-password-check'
  const [a, b] = await Promise.all([hmac(key, input.trim()), hmac(key, ownerPassword())])
  return sameString(a, b)
}

export async function createOwnerToken(now = Date.now()): Promise<string> {
  const payload = `owner.${now}`
  return `${payload}.${await hmac(signingKey(), payload)}`
}

/** True only for a token this deployment signed, under the current password, within its lifetime. */
export async function verifyOwnerToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !ownerAccess().enabled) return false
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'owner') return false
  const issuedAt = Number(parts[1])
  if (!Number.isFinite(issuedAt) || issuedAt > now + 60_000) return false
  if (now - issuedAt > OWNER_MAX_AGE * 1000) return false
  const expected = await hmac(signingKey(), `${parts[0]}.${parts[1]}`)
  return sameString(parts[2], expected)
}
