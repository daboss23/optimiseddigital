/**
 * Deployment-level settings — an uploaded logo, curated research sources.
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
export async function getSetting<T>(key: string): Promise<T | null> {
  if (!configured()) return null
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('platform_settings')
      .select('value')
      .eq('key', key)
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
export async function setSetting(key: string, value: unknown): Promise<boolean> {
  if (!configured()) return false
  try {
    const { error } = await getSupabaseAdmin()
      .from('platform_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) throw error
    return true
  } catch (err) {
    console.error(`setSetting(${key}) failed:`, err)
    return false
  }
}

/** Remove one setting. Returns false when unconfigured or on error. */
export async function clearSetting(key: string): Promise<boolean> {
  if (!configured()) return false
  try {
    const { error } = await getSupabaseAdmin().from('platform_settings').delete().eq('key', key)
    if (error) throw error
    return true
  } catch (err) {
    console.error(`clearSetting(${key}) failed:`, err)
    return false
  }
}
