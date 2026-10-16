/**
 * Is this deployment one brand, or many?
 *
 * The question decides what a DEPLOYMENT-WIDE credential may do. A
 * single-brand deployment — the owner's own install, a brand testing the
 * platform — may lean on the environment: `META_ACCESS_TOKEN`, the Pipeboard
 * MCP token, and the operator account that `currentAccount()` heals a bare
 * session onto. The moment the deployment serves more than one brand, every
 * one of those becomes a leak: the env token is the OWNER'S ad account, and a
 * brand that has not connected its own would be shown — and would publish
 * into — somebody else's.
 *
 * Multi-tenant when either:
 *   · `PLATFORM_MULTI_TENANT=true` — the owner says so, before the first brand
 *     account exists; or
 *   · the `users` table has a row — real brand logins exist, so the platform
 *     is shared whether or not anyone set the flag.
 *
 * Kept out of `lib/account.ts` because it needs no request scope: the Meta
 * credential resolver and the Reactor route ask it without reading cookies.
 *
 * Fails CLOSED where it matters: a users-table read that errors is NOT taken
 * as "no users" by `isMultiTenant()` when the flag is set, and the flag alone
 * is enough. Without the flag, an unreachable database reads as single-brand —
 * the same answer `hasUsers()` has always given, because with no database
 * there are no brand accounts to leak between.
 */

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'

function ready(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
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

/** The owner's explicit declaration, readable without a database round trip. */
export function multiTenantDeclared(): boolean {
  return (process.env.PLATFORM_MULTI_TENANT ?? '').trim().toLowerCase() === 'true'
}

/**
 * Cached for a minute: this sits on the path of every Meta read and every
 * Reactor run, and the answer only ever changes when the first brand account
 * is provisioned — at which point it closes the env fallback within a minute,
 * on its own.
 */
const MODE_TTL_MS = 60_000
let modeCache: { multi: boolean; at: number } | null = null

export async function isMultiTenant(): Promise<boolean> {
  if (multiTenantDeclared()) return true
  const now = Date.now()
  if (modeCache && now - modeCache.at < MODE_TTL_MS) return modeCache.multi
  const multi = await hasUsers()
  modeCache = { multi, at: now }
  return multi
}

/**
 * May a deployment-wide credential act for this request?
 *
 * Only on a single-brand deployment. On a shared one the environment belongs
 * to the owner, and no brand — and no anonymous session — borrows it.
 */
export async function deploymentCredentialsAllowed(): Promise<boolean> {
  return !(await isMultiTenant())
}
