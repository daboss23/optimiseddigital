// One-shot taxonomy backfill — classifies legacy campaign_outcomes that predate
// the fixed taxonomy so isolation mode's "lock every other axis to the best
// existing value" and ORACLE's group-by have data from day one instead of
// launching blind. Idempotent (skips rows already tagged) and NEVER throws —
// returns a summary the sync UI can render, per the codebase convention.

import { getSupabaseAdmin } from '@/lib/supabase'
import { classifyTaxonomy } from '@/lib/taxonomy-classify'
import { hasTaxonomy, type CreativeTaxonomy } from '@/lib/taxonomy'

export interface BackfillSummary {
  configured: boolean
  ok: boolean
  /** Rows examined. */
  scanned: number
  /** Rows newly tagged this run. */
  tagged: number
  /** Rows skipped because they were already tagged. */
  skipped: number
  /** Rows that errored during classify/update. */
  failed: number
  error?: string
}

interface OutcomeRowLite {
  id: string
  angle: string | null
  concept: {
    type?: string
    text?: string
    attributes?: { taxonomy?: CreativeTaxonomy }
  } | null
}

function empty(configured: boolean): BackfillSummary {
  return { configured, ok: false, scanned: 0, tagged: 0, skipped: 0, failed: 0 }
}

/**
 * Tag untagged outcome rows. Bounded by `limit` so a huge history backfills in
 * batches rather than one long request. Winners already re-ingested keep their
 * text, so the classifier reads real creative, not a stub.
 */
export async function backfillTaxonomy(accountId: string | null, limit = 200): Promise<BackfillSummary> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { ...empty(false), error: 'Supabase not configured' }
  }
  // One account's memory, classified on that account's request. It used to
  // walk every brand's outcomes — rewriting rows the caller does not own and
  // spending a model call on each.
  if (!accountId) return { ...empty(true), error: 'No account on this session' }
  const summary = empty(true)
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('campaign_outcomes')
      .select('id, angle, concept')
      .eq('builder_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error

    for (const r of (data ?? []) as OutcomeRowLite[]) {
      summary.scanned += 1
      if (hasTaxonomy(r.concept?.attributes?.taxonomy)) {
        summary.skipped += 1
        continue
      }
      const text = [r.concept?.type, r.concept?.text, r.angle].filter(Boolean).join(' — ')
      try {
        const taxonomy = await classifyTaxonomy(text)
        const mergedConcept = {
          ...(r.concept ?? {}),
          attributes: { ...(r.concept?.attributes ?? {}), taxonomy },
        }
        const { error: upErr } = await supabase
          .from('campaign_outcomes')
          .update({ concept: mergedConcept })
          .eq('id', r.id)
          .eq('builder_id', accountId)
        if (upErr) throw upErr
        summary.tagged += 1
      } catch (err) {
        console.error(`Taxonomy backfill failed for outcome ${r.id}:`, err)
        summary.failed += 1
      }
    }
    summary.ok = true
    return summary
  } catch (err) {
    console.error('Taxonomy backfill failed:', err)
    summary.error = err instanceof Error ? err.message : 'Taxonomy backfill failed'
    return summary
  }
}

/** How much of ORACLE memory is tagged — powers the backfill control. */
export async function backfillStatus(accountId: string | null): Promise<{
  configured: boolean
  total: number
  tagged: number
  untagged: number
}> {
  const base = { configured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), total: 0, tagged: 0, untagged: 0 }
  if (!base.configured || !accountId) return base
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('campaign_outcomes')
      .select('concept')
      .eq('builder_id', accountId)
      .limit(1000)
    if (error) throw error
    const rows = (data ?? []) as { concept: OutcomeRowLite['concept'] }[]
    const tagged = rows.filter((r) => hasTaxonomy(r.concept?.attributes?.taxonomy)).length
    return { ...base, total: rows.length, tagged, untagged: rows.length - tagged }
  } catch (err) {
    console.error('backfillStatus failed:', err)
    return base
  }
}
