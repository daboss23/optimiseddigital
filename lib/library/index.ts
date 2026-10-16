/**
 * The Platform Library — the owner's method, used by every brand's agents and
 * seen by none of them.
 *
 *   owner uploads SOPs / frameworks / Notion exports
 *     → normalised, chunked by heading, embedded, tagged by niche
 *     → stored in library_documents / library_chunks (schema.library.sql)
 *   a brand fires the Reactor
 *     → its niches are read off its own catalog and website
 *     → `searchLibrary` pulls the matching sections
 *     → `libraryMethodBlock` hands them to OPUS as METHOD, with three rules:
 *       method only, the brand's own material wins a conflict, never cited.
 *
 * Who may call what:
 *   · ingest / list / retag / delete — the owner routes (app/api/owner/**),
 *     each behind `isOwnerRequest()`.
 *   · searchLibrary / brandLibraryNiches / libraryMethodBlock — the Reactor.
 *     They return text for a prompt, never a document title or id for a
 *     screen: nothing here is shaped to be rendered to a brand.
 * `npm run selftest:library` and `selftest:tenant` hold both lines.
 *
 * Never throws to its callers: an unconfigured or un-migrated library reads as
 * empty, and an ingest failure comes back per document.
 */

import { createHash } from 'crypto'
import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import { embed, embedOne, hasEmbeddings } from '@/lib/embeddings'
import { rerankConfigured, rerankItems } from '@/lib/rerank'
import { getCatalog, inferNiches } from '@/lib/catalog'
import { getTenant } from '@/lib/tenant'
import { chunkSections, normaliseText } from './text'
import { brandNicheKeys, cleanNiches } from './niches'

export const LIBRARY_KINDS = ['sop', 'framework', 'playbook', 'swipe', 'other'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export function isLibraryKind(v: unknown): v is LibraryKind {
  return typeof v === 'string' && (LIBRARY_KINDS as readonly string[]).includes(v)
}

function supabaseReady(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

/* -------------------------------- readiness -------------------------------- */

export interface LibraryReadiness {
  /** Supabase and Voyage are both configured. */
  configured: boolean
  /** schema.library.sql has been run. */
  installed: boolean
  reason?: string
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /library_documents|does not exist|schema cache/i.test(error.message ?? '')
  )
}

export async function libraryReadiness(): Promise<LibraryReadiness> {
  if (!supabaseReady()) {
    return { configured: false, installed: false, reason: 'Supabase is not configured — the library needs it to store anything.' }
  }
  if (!hasEmbeddings()) {
    return { configured: false, installed: false, reason: 'VOYAGE_API_KEY is not set — the library is searched by meaning, so it needs embeddings.' }
  }
  try {
    const { error } = await getSupabaseAdmin()
      .from('library_documents')
      .select('id', { head: true })
      .limit(1)
    if (isMissingTable(error)) {
      return { configured: true, installed: false, reason: 'Run supabase/schema.library.sql in the Supabase SQL editor.' }
    }
    if (error) return { configured: true, installed: false, reason: error.message }
    return { configured: true, installed: true }
  } catch (err) {
    return { configured: true, installed: false, reason: err instanceof Error ? err.message : 'Library check failed' }
  }
}

/* --------------------------------- listing --------------------------------- */

export interface LibraryDocumentRow {
  id: string
  title: string
  sourceName: string | null
  kind: LibraryKind
  niches: string[]
  chunkCount: number
  charCount: number
  createdAt: string
}

export async function listLibraryDocuments(): Promise<LibraryDocumentRow[]> {
  if (!supabaseReady()) return []
  const { data, error } = await getSupabaseAdmin()
    .from('library_documents')
    .select('id, title, source_name, kind, niches, chunk_count, char_count, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    sourceName: r.source_name ? String(r.source_name) : null,
    kind: isLibraryKind(r.kind) ? r.kind : 'other',
    niches: Array.isArray(r.niches) ? r.niches.map(String) : [],
    chunkCount: Number(r.chunk_count ?? 0),
    charCount: Number(r.char_count ?? 0),
    createdAt: String(r.created_at),
  }))
}

/* --------------------------------- ingest ---------------------------------- */

export interface LibraryUpload {
  title: string
  sourceName?: string | null
  text: string
  niches: string[]
  kind: LibraryKind
}

export interface LibraryIngestResult {
  title: string
  status: 'added' | 'duplicate' | 'empty' | 'error'
  chunks: number
  error?: string
}

/** Sections per embedding request — well inside Voyage's per-request limits. */
const EMBED_BATCH = 64
/** Rows per insert — each carries a 1,024-float vector. */
const INSERT_BATCH = 100

export function contentHash(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex')
}

async function ingestOne(doc: LibraryUpload): Promise<LibraryIngestResult> {
  const title = doc.title.trim().slice(0, 200) || 'Untitled'
  const text = normaliseText(doc.text)
  const sections = chunkSections(text)
  if (!sections.length) return { title, status: 'empty', chunks: 0 }

  const admin = getSupabaseAdmin()
  const hash = contentHash(text)
  const { data: existing } = await admin.from('library_documents').select('id').eq('content_hash', hash).limit(1)
  if (existing?.length) return { title, status: 'duplicate', chunks: 0 }

  // Embed before anything is written: a document whose sections cannot be
  // embedded is not stored half-searchable.
  const vectors: number[][] = []
  for (let i = 0; i < sections.length; i += EMBED_BATCH) {
    const batch = sections.slice(i, i + EMBED_BATCH)
    // The heading rides into the vector — "35%" is about testing budgets
    // because of where it sits, and search should know that.
    vectors.push(...(await embed(batch.map((s) => (s.heading ? `${s.heading}\n\n${s.content}` : s.content)), 'document')))
  }

  const niches = cleanNiches(doc.niches)
  const { data: created, error: docErr } = await admin
    .from('library_documents')
    .insert({
      title,
      source_name: doc.sourceName?.slice(0, 500) ?? null,
      kind: doc.kind,
      niches,
      chunk_count: sections.length,
      char_count: text.length,
      content_hash: hash,
    })
    .select('id')
    .single()
  if (docErr || !created) throw docErr ?? new Error('Document was not created')

  const rows = sections.map((s, ord) => ({
    document_id: created.id,
    ord,
    heading: s.heading,
    content: s.content,
    niches,
    embedding: vectors[ord],
  }))
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error } = await admin.from('library_chunks').insert(rows.slice(i, i + INSERT_BATCH))
    if (error) {
      // No half-stored documents: the cascade removes any sections written.
      await admin.from('library_documents').delete().eq('id', created.id)
      throw error
    }
  }
  return { title, status: 'added', chunks: sections.length }
}

/** Ingest a batch, one document at a time. One failure never sinks the rest. */
export async function ingestLibraryDocuments(docs: LibraryUpload[]): Promise<LibraryIngestResult[]> {
  const results: LibraryIngestResult[] = []
  for (const doc of docs) {
    try {
      results.push(await ingestOne(doc))
    } catch (err) {
      results.push({
        title: doc.title || 'Untitled',
        status: 'error',
        chunks: 0,
        error: err instanceof Error ? err.message : 'Ingest failed',
      })
    }
  }
  return results
}

/* ------------------------------ retag / delete ----------------------------- */

export async function retagLibraryDocument(id: string, niches: string[]): Promise<string[]> {
  const clean = cleanNiches(niches)
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('library_documents').update({ niches: clean }).eq('id', id)
  if (error) throw error
  // The sections carry their own copy for the indexed filter — kept in step.
  const { error: chunkErr } = await admin.from('library_chunks').update({ niches: clean }).eq('document_id', id)
  if (chunkErr) throw chunkErr
  return clean
}

export async function deleteLibraryDocument(id: string): Promise<void> {
  const { error } = await getSupabaseAdmin().from('library_documents').delete().eq('id', id)
  if (error) throw error
}

/* -------------------------------- retrieval -------------------------------- */

export interface LibraryHit {
  heading: string | null
  content: string
  similarity: number
  relevance?: number
}

/** The candidate pool handed to the reranker. */
const LIBRARY_POOL = 24

/**
 * The library sections that match this brief, for a brand in these niches.
 * Empty — never an error — when the library is unconfigured, uninstalled or
 * has nothing for the niche.
 */
export async function searchLibrary(query: string, nicheKeys: string[], k = 6): Promise<LibraryHit[]> {
  const q = query.trim()
  if (!q || !nicheKeys.length || !supabaseReady() || !hasEmbeddings()) return []
  try {
    const queryEmbedding = await embedOne(q.slice(0, 4000), 'query')
    const pool = rerankConfigured() ? Math.max(k, LIBRARY_POOL) : k
    const { data, error } = await getSupabaseAdmin().rpc('match_library', {
      query_embedding: queryEmbedding,
      query_text: q.slice(0, 500),
      match_count: pool,
      filter_niches: nicheKeys,
    })
    if (error) {
      if (!/match_library/i.test(error.message ?? '')) console.error('Library search failed:', error)
      return []
    }
    const hits: LibraryHit[] = (
      (data ?? []) as { heading: string | null; content: string; similarity: number }[]
    ).map((d) => ({
      heading: d.heading ?? null,
      content: String(d.content),
      similarity: Number(d.similarity),
    }))
    const { items } = await rerankItems(q, hits, k, (h) => `${h.heading ?? ''}\n${h.content}`)
    return items
  } catch (err) {
    console.error('Library search failed:', err)
    return []
  }
}

/**
 * The library niches a brand draws on: its catalog's vertical, plus whatever
 * its connected website's industry names. Read from the brand's OWN account —
 * the brand never chooses, and a request cannot claim, a niche.
 */
export async function brandLibraryNiches(accountId: string | null): Promise<string[]> {
  const [catalog, tenant] = await Promise.all([
    getCatalog(accountId).catch(() => null),
    getTenant(accountId).catch(() => null),
  ])
  const verticals = inferNiches(catalog?.products ?? [], tenant?.industry ?? '')
  return brandNicheKeys(verticals)
}

/** Characters of method handed to OPUS — enough for several sections, not a manual. */
const MAX_BLOCK_CHARS = 7_000

/**
 * The library as OPUS reads it. The three rules travel with the text every
 * time, because the text alone looks exactly like evidence.
 */
export function libraryMethodBlock(hits: LibraryHit[]): string {
  if (!hits.length) return ''
  let used = 0
  const sections: string[] = []
  for (const h of hits) {
    const body = `${h.heading ? `[${h.heading}]\n` : ''}${h.content}`
    if (used + body.length > MAX_BLOCK_CHARS) break
    sections.push(body)
    used += body.length
  }
  return `

PLATFORM METHOD — how this platform plans, builds and judges creative, written by the people who run it. Apply it; do not repeat it.
RULES FOR THIS BLOCK:
- METHOD ONLY. It tells you HOW to work: structures, sequences, testing logic, decision rules. Its examples, figures, products, customers and results belong to other businesses — never state any of them as a claim, a statistic, a testimonial or a result for this brand, and never put one on a creative.
- THE BRAND WINS. Where this method disagrees with the brand's own Vault, website, product facts or brief, follow the brand's material.
- NEVER CITE IT. Do not name, quote or refer to this method, a "playbook", an "SOP" or any section heading in any field of your output — concepts, basis, rationale or telemetry. It shapes the work; it is not shown.

${sections.join('\n\n---\n\n')}`
}
