import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import type { GenMode, VideoJob } from './types'

/**
 * Optional generation ledger. Records every render so dashboards can report
 * spend/volume and the agent can reuse past clips. Follows project rules:
 * a missing Supabase config is NOT an error here — logging silently no-ops so
 * generation always works end to end.
 */

function persistenceEnabled(): boolean {
  return Boolean(
    supabaseUrl() && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
  )
}

export interface MediaGenerationInsert {
  builder_id?: string | null
  model_id: string
  provider: string
  mode: GenMode
  prompt?: string | null
  image_url?: string | null
  request_id: string
  status: string
}

/** Record a started render. Returns the row id, or null when persistence is off. */
export async function logGeneration(input: MediaGenerationInsert): Promise<string | null> {
  if (!persistenceEnabled()) return null
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('media_generations')
      .insert([input])
      .select('id')
      .single()
    if (error) {
      console.error('media_generations insert error:', error.message)
      return null
    }
    return (data as { id: string }).id
  } catch (err) {
    console.error('logGeneration error:', err)
    return null
  }
}

/**
 * Update one of the account's render rows once polling resolves it
 * (completed/failed + url). A request id from another account's render
 * updates nothing.
 */
export async function updateGeneration(
  requestId: string,
  job: VideoJob,
  accountId: string | null,
): Promise<void> {
  if (!persistenceEnabled() || !requestId || !accountId) return
  try {
    await getSupabaseAdmin()
      .from('media_generations')
      .update({ status: job.status, video_url: job.videoUrl })
      .eq('request_id', requestId)
      .eq('builder_id', accountId)
  } catch (err) {
    console.error('updateGeneration error:', err)
  }
}
