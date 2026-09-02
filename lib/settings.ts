/**
 * Per-account settings — an uploaded logo, curated research sources, the Meta
 * connection.
 *
 * Keyed by `(account_id, key)`. It was keyed by `key` alone, which on a
 * multi-tenant deployment made these ONE SHARED SET: the second customer to
 * upload a logo replaced the first customer's, the curated sources were
 * everybody's, and — worst — `meta.connection` holds a System User access token
 * with write access to an ad account, so whichever customer connected last
 * owned the credential every other customer's ads published through.
 *
 * Every accessor therefore requires an account. Passing null reads and writes
 * nothing rather than falling back to a shared row: a settings lookup that
 * silently crosses tenants is the same bug in a quieter place.
 *
 * Everything here is optional by design: with no Supabase configured the
 * getters return null and the setters report that nothing was stored, so the
 * UI can show its "not configured" state rather than throwing. Nothing in the
 * platform is allowed to depend on a setting existing.
 */

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'

export const SETTING_BRAND_LOGO = 'brand.logo'
export const SETTING_RESEARCH_SOURCES = 'research.sources'
/**
 * What the platform's assistant is called in the dashboard headline, e.g.
 * "Mike found 3 actions worth taking today." Unset on a fresh deployment, so
 * the headline reads without a name rather than introducing a stranger.
 */
export const SETTING_ASSISTANT_NAME = 'assistant.name'
/**
 * The Meta connection stored from the dashboard — a System User access token
 * plus the ad account it reads. Server-side only: the value is never
 * serialised to a client in full (the connection route reduces the token to
 * its last four characters before anything leaves the server).
 */
export const SETTING_META_CONNECTION = 'meta.connection'

function configured(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

export function settingsConfigured(): boolean {
  return configured()
}

/** Read one setting. Returns null when absent, unconfigured, or on any error. */
export async function getSetting<T>(
  key: string,
  accountId: string | null,
): Promise<T | null> {
  if (!configured() || !accountId) return null
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('platform_settings')
      .select('value')
      .eq('key', key)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    return (data?.value as T) ?? null
  } catch (err) {
    console.error(`getSetting(${key}) failed:`, err)
    return null
  }
}

/**
 * Write one setting. Returns false when there is nowhere to store it, so the
 * caller can tell the user their change will not persist instead of pretending
 * it saved.
 */
export async function setSetting(
  key: string,
  value: unknown,
  accountId: string | null,
): Promise<boolean> {
  if (!configured() || !accountId) return false
  try {
    const { error } = await getSupabaseAdmin()
      .from('platform_settings')
      .upsert(
        { account_id: accountId, key, value, updated_at: new Date().toISOString() },
        { onConflict: 'account_id,key' },
      )
    if (error) throw error
    return true
  } catch (err) {
    console.error(`setSetting(${key}) failed:`, err)
    return false
  }
}

/** Remove one setting. Returns false when unconfigured or on error. */
export async function clearSetting(key: string, accountId: string | null): Promise<boolean> {
  if (!configured() || !accountId) return false
  try {
    const { error } = await getSupabaseAdmin()
      .from('platform_settings')
      .delete()
      .eq('key', key)
      .eq('account_id', accountId)
    if (error) throw error
    return true
  } catch (err) {
    console.error(`clearSetting(${key}) failed:`, err)
    return false
  }
}
