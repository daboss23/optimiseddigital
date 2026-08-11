// NOVA's LIVE research memory, read back for the Research dashboard.
//
// The Research page used to render `externalSources` and `researchOutputs` from
// `lib/reactor-data.ts` — curated placeholder copy written in TPB's voice. It
// looked exactly like a working intelligence feed, so there was no way to tell
// whether NOVA had ever swept anything: the same six cards showed either way.
// A dashboard that reads identically when it holds nothing is worse than an
// empty one, because it invites decisions ("NOVA brought back great intel") that
// the data doesn't support.
//
// This module reads what is actually in `knowledge_chunks` under NOVA's systems
// (`research` + `transformation`) and reports honestly when there is nothing
// there. Every number it returns is counted, never invented — which is why
// there is no "signal score" here: the curated rows carried one, but nothing in
// the pipeline measures signal strength, so it cannot be shown live.

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import type { MarketIntelProfile } from '@/lib/market-intelligence'

/** One source NOVA has actually mined, aggregated across its chunks. */
export interface LiveNovaSource {
  /** The source label as NOVA recorded it, e.g. "r/Construction". */
  name: string
  /** Source family — reddit / forum / youtube / review / paste / url. */
  type: string
  /** Distinct conversations/posts the reads drew on (summed `items_analyzed`). */
  itemsAnalyzed: number
  /** How many stored chunks came from this source. */
  chunks: number
  /** ISO timestamp of the most recent ingest from this source. */
  lastIngested: string | null
}

/** One category of extracted signal, pooled across every source NOVA has read. */
export interface LiveNovaOutput {
  type: string
  items: string[]
}

export interface LiveNovaIntel {
  /** False when Supabase isn't configured or NOVA has stored nothing yet. */
  live: boolean
  sources: LiveNovaSource[]
  outputs: LiveNovaOutput[]
  /** Total chunks across NOVA's systems. */
  totalChunks: number
  /** Distinct sources mined. */
  sourceCount: number
  lastSweep: string | null
  /**
   * Chunks that predate structured-profile storage (or were written by a path
   * that doesn't carry one). They count toward `totalChunks` and are retrieved
   * by the agent normally — they just can't populate the extracted-signal
   * cards. Surfaced so a thin dashboard over a full Vault is explainable.
   */
  chunksWithoutProfile: number
}

/** Max items rendered per extracted-signal card. */
const MAX_ITEMS_PER_CARD = 8
/** Upper bound on chunks scanned for a dashboard read. */
const SCAN_LIMIT = 500

function configured(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

export function emptyNovaIntel(): LiveNovaIntel {
  return {
    live: false,
    sources: [],
    outputs: [],
    totalChunks: 0,
    sourceCount: 0,
    lastSweep: null,
    chunksWithoutProfile: 0,
  }
}

/**
 * The extracted-signal cards, in the order they read best: what's wrong, what
 * they want, why they don't buy, what they believe, how they say it, when they
 * start looking. Maps `MarketIntelProfile` fields onto display categories —
 * several profile fields pool into one card (fears + frustrations + problems all
 * describe pain), which is why this is a list of keys per card rather than a
 * one-to-one rename.
 */
const OUTPUT_CARDS: { type: string; keys: (keyof MarketIntelProfile)[] }[] = [
  { type: 'Pain Points', keys: ['problems', 'frustrations', 'keepThemUpAtNight'] },
  { type: 'Desires', keys: ['desires', 'joys'] },
  { type: 'Objections', keys: ['objections'] },
  { type: 'Beliefs', keys: ['beliefs'] },
  { type: 'Language', keys: ['exactPhrases'] },
  { type: 'Trigger Events', keys: ['triggerEvents'] },
]

interface ChunkRow {
  created_at: string | null
  metadata: Record<string, unknown> | null
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

/**
 * Read NOVA's live memory. Never throws — any failure degrades to
 * `live: false`, which the dashboard renders as an honest empty state rather
 * than as curated placeholder copy.
 */
export async function liveNovaIntel(): Promise<LiveNovaIntel> {
  if (!configured()) return emptyNovaIntel()

  let rows: ChunkRow[]
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('knowledge_chunks')
      .select('created_at, metadata')
      .in('system', ['research', 'transformation'])
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT)
    if (error) throw error
    rows = (data ?? []) as ChunkRow[]
  } catch (err) {
    console.error('NOVA live intel query failed:', err)
    return emptyNovaIntel()
  }

  if (rows.length === 0) return emptyNovaIntel()

  // Sources: one entry per distinct label. `items_analyzed` is per-source rather
  // than per-chunk (every chunk of one read carries the same figure), so take the
  // max across the source's chunks instead of summing — summing would multiply a
  // single 40-post read by its chunk count.
  const sources = new Map<string, LiveNovaSource>()
  const pooled = new Map<string, Set<string>>()
  let lastSweep: string | null = null
  let chunksWithoutProfile = 0

  for (const row of rows) {
    const meta = row.metadata ?? {}
    const label = String(meta.source_label ?? '').trim()
    const ingested = (meta.ingested_at as string) ?? row.created_at
    if (ingested && (!lastSweep || ingested > lastSweep)) lastSweep = ingested

    if (label) {
      const existing = sources.get(label)
      const items = Number(meta.items_analyzed ?? 0) || 0
      if (existing) {
        existing.chunks += 1
        existing.itemsAnalyzed = Math.max(existing.itemsAnalyzed, items)
        if (ingested && (!existing.lastIngested || ingested > existing.lastIngested)) {
          existing.lastIngested = ingested
        }
      } else {
        sources.set(label, {
          name: label,
          type: String(meta.source_type ?? 'source'),
          itemsAnalyzed: items,
          chunks: 1,
          lastIngested: ingested ?? null,
        })
      }
    }

    const profile = meta.profile
    if (!profile || typeof profile !== 'object') {
      chunksWithoutProfile += 1
      continue
    }
    const p = profile as Record<string, unknown>
    for (const card of OUTPUT_CARDS) {
      let bucket = pooled.get(card.type)
      if (!bucket) {
        bucket = new Set<string>()
        pooled.set(card.type, bucket)
      }
      for (const key of card.keys) {
        for (const item of asStrings(p[key])) bucket.add(item)
      }
    }
  }

  const outputs: LiveNovaOutput[] = OUTPUT_CARDS.map((card) => ({
    type: card.type,
    items: Array.from(pooled.get(card.type) ?? []).slice(0, MAX_ITEMS_PER_CARD),
  })).filter((o) => o.items.length > 0)

  return {
    live: true,
    sources: Array.from(sources.values()).sort((a, b) => b.chunks - a.chunks),
    outputs,
    totalChunks: rows.length,
    sourceCount: sources.size,
    lastSweep,
    chunksWithoutProfile,
  }
}
