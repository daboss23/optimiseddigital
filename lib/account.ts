/**
 * Which account is this request for?
 *
 * ONE answer, resolved server-side from the signed session, and the only place
 * that answer is produced. Everything that reads or writes customer data asks
 * here.
 *
 * The rule this module exists to enforce: **a tenant is established, never
 * claimed.** Before it, nine API routes did this —
 *
 *     const { brief, builderId } = await request.json()
 *
 * — so the client named its own tenant and the server believed it. Every query
 * built on that id was scoped to whatever the caller typed, which on a
 * deployment with two customers is not scoping at all. The account now rides
 * inside the HMAC-signed session cookie, so it cannot be edited in devtools,
 * and a request that carries no account gets no customer data rather than
 * everyone's.
 *
 * Server-only: it reads cookies and Supabase. The edge middleware verifies the
 * session signature via `lib/auth.ts` and does not import this.
 */

import { cookies } from 'next/headers'
import { readSessionToken, SESSION_COOKIE, verifyPassword } from '@/lib/auth'
import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'

/** A resolved tenant. Opaque on purpose — callers pass it, they don't parse it. */
export type AccountId = string

export interface AccountUser {
  id: string
  accountId: AccountId
  email: string
  name: string | null
  role: string
}

function ready(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

/**
 * The account this request may act for, or null.
 *
 * Null is a real answer with a real meaning: the single-operator gate is open
 * (a session with no account), or nobody is signed in. Callers must treat it as
 * "no customer data", never as "all customer data" — which is exactly the
 * mistake `match_knowledge` used to make, returning every row when handed a
 * null filter.
 */
export async function currentAccount(): Promise<AccountId | null> {
  try {
    const jar = await cookies()
    const session = await readSessionToken(jar.get(SESSION_COOKIE)?.value)
    return session?.accountId ?? null
  } catch {
    // Called outside a request scope (a script, a build-time evaluation).
    return null
  }
}

/**
 * The account, or a thrown error naming what is missing.
 *
 * For write paths and anything that would be actively wrong unscoped. A throw
 * is the correct outcome: silently writing a row with no tenant is how one
 * customer's content becomes visible to all of them.
 */
export async function requireAccount(): Promise<AccountId> {
  const account = await currentAccount()
  if (!account) {
    throw new Error(
      'No account on this session. Sign in as a user of the account you are acting for — the single-operator gate cannot read or write customer data.',
    )
  }
  return account
}

/** The signed-in user's account, resolved from their email + password. */
export async function authenticateUser(
  email: unknown,
  password: unknown,
): Promise<AccountUser | null> {
  if (typeof email !== 'string' || typeof password !== 'string') return null
  if (!ready()) return null

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('users')
      .select('id, account_id, email, name, role, password_hash')
      .ilike('email', email.trim())
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) return null

    // The hash is verified even when no row matched in spirit — but there is no
    // row here, so we simply return null. Timing equalisation would need a dummy
    // hash; noted rather than pretended at.
    const ok = await verifyPassword(password, String(data.password_hash ?? ''))
    if (!ok) return null

    return {
      id: String(data.id),
      accountId: String(data.account_id),
      email: String(data.email),
      name: data.name ? String(data.name) : null,
      role: String(data.role ?? 'member'),
    }
  } catch (err) {
    console.error('User authentication failed:', err)
    return null
  }
}

/** True when this deployment has real user accounts (the SaaS path is live). */
export async function hasUsers(): Promise<boolean> {
  if (!ready()) return false
  try {
    const { count, error } = await getSupabaseAdmin()
      .from('users')
      .select('id', { count: 'exact', head: true })
    if (error) throw error
    return (count ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Create an account and its first user. The provisioning primitive behind
 * signup — kept here so account creation and account resolution share one
 * module and cannot drift apart.
 */
export async function createAccount(input: {
  accountName: string
  email: string
  passwordHash: string
  userName?: string
  website?: string
}): Promise<AccountUser | null> {
  if (!ready()) return null
  try {
    const admin = getSupabaseAdmin()
    const { data: account, error: accountErr } = await admin
      .from('accounts')
      .insert({ name: input.accountName.trim(), website: input.website?.trim() || null })
      .select('id')
      .single()
    if (accountErr) throw accountErr

    const { data: user, error: userErr } = await admin
      .from('users')
      .insert({
        account_id: account.id,
        email: input.email.trim().toLowerCase(),
        name: input.userName?.trim() || null,
        password_hash: input.passwordHash,
        role: 'owner',
      })
      .select('id, account_id, email, name, role')
      .single()
    if (userErr) throw userErr

    return {
      id: String(user.id),
      accountId: String(user.account_id),
      email: String(user.email),
      name: user.name ? String(user.name) : null,
      role: String(user.role),
    }
  } catch (err) {
    console.error('Account creation failed:', err)
    return null
  }
}
