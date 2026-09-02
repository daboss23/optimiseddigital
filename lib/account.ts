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
import { expectedCredentials, readSessionToken, SESSION_COOKIE, verifyPassword } from '@/lib/auth'
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
 * Null is a real answer with a real meaning: nobody is signed in, or this is a
 * multi-customer deployment and the session names no customer. Callers must
 * treat it as "no customer data", never as "all customer data" — which is
 * exactly the mistake `match_knowledge` used to make, returning every row when
 * handed a null filter.
 *
 * One case is NOT null: a signed-in session with no account on a deployment
 * that has no user rows. That is a single brand testing the platform, and it
 * gets the operator account (found or created) rather than a refusal.
 */
export async function currentAccount(): Promise<AccountId | null> {
  try {
    const jar = await cookies()
    const session = await readSessionToken(jar.get(SESSION_COOKIE)?.value)
    if (!session) return null
    if (session.accountId) return session.accountId
    // A signed-in session with no account. On a SINGLE-BRAND deployment that is
    // a session issued before the operator account existed, or issued while the
    // tenancy migration had not run — not a tenant to refuse. Heal it here, at
    // the point of use, so the operator does not have to sign out and back in
    // to connect a website. Only ever resolves when the deployment has no user
    // rows: the moment real customers exist, a session with no account gets no
    // customer data, exactly as before.
    return operatorFallbackAccount()
  } catch {
    // Called outside a request scope (a script, a build-time evaluation).
    return null
  }
}

/**
 * The single-brand deployment's one account, memoized.
 *
 * Two reads back this: "does this deployment have real users" and "which row is
 * the operator account". Both are stable for the life of a deployment, and this
 * sits on the hot path of every scoped read, so the answer is cached for a
 * minute — short enough that provisioning the first real customer closes the
 * fallback on its own, long enough that a page of ten scoped reads costs one
 * round trip rather than twenty.
 */
const FALLBACK_TTL_MS = 60_000
let fallbackCache: { id: AccountId | null; at: number } | null = null

async function operatorFallbackAccount(): Promise<AccountId | null> {
  if (!ready()) return null
  const now = Date.now()
  if (fallbackCache && now - fallbackCache.at < FALLBACK_TTL_MS) return fallbackCache.id
  const id = (await hasUsers()) ? null : await resolveOperatorAccount(expectedCredentials().name)
  fallbackCache = { id, at: now }
  return id
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

/**
 * The account a single-operator deployment works in.
 *
 * A deployment handed to one brand — a friend testing the platform, a
 * single-tenant install — signs in through the operator gate, which issues a
 * session with no account. Every scoped read and write then correctly refuses,
 * which is right for a shared deployment and useless for this one: connecting a
 * website is the first thing anyone does, and it failed with a message about
 * signing in as a user of an account that does not exist.
 *
 * So the gate gets ONE account, found or created on first login and reused
 * forever after. Identified by the slug `operator` rather than "the first row",
 * so it stays unambiguous if accounts are later added by signup.
 *
 * Returns null when there is no database, which is a real answer: nothing
 * persists in that mode, and the scan already falls back to an in-memory
 * summary rather than failing.
 */
export const OPERATOR_ACCOUNT_SLUG = 'operator'

export async function resolveOperatorAccount(name: string): Promise<AccountId | null> {
  if (!ready()) return null
  const admin = getSupabaseAdmin()
  const accountName = name.trim() || 'My brand'

  // `slug` arrives with the tenancy migration. A deployment that has run
  // schema.tenancy.sql is addressed by slug — unambiguous, and unaffected by
  // renaming the account. One that has not still gets an account: the slug
  // lookup fails on an unknown column, and the fall-through addresses the row
  // by name instead. Refusing until a migration runs is what left the operator
  // signed in with nothing they could connect.
  try {
    const { data, error } = await admin
      .from('accounts')
      .select('id')
      .eq('slug', OPERATOR_ACCOUNT_SLUG)
      .maybeSingle()
    if (!error && data?.id) return String(data.id)
    if (!error) {
      const { data: created, error: createErr } = await admin
        .from('accounts')
        .insert({ name: accountName, slug: OPERATOR_ACCOUNT_SLUG })
        .select('id')
        .single()
      if (!createErr && created?.id) return String(created.id)
    }
  } catch {
    /* fall through to the slugless path */
  }

  try {
    const { data, error } = await admin
      .from('accounts')
      .select('id')
      .eq('name', accountName)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data?.id) return String(data.id)

    const { data: created, error: createErr } = await admin
      .from('accounts')
      .insert({ name: accountName })
      .select('id')
      .single()
    if (createErr) throw createErr
    return String(created.id)
  } catch (err) {
    // No accounts table at all. The deployment still signs in and still works —
    // the scan runs and is held in memory rather than written to the Vault.
    console.error('Operator account resolution failed:', err)
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
