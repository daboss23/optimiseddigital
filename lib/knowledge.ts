// Knowledge layer for the Reactor: chunk + ingest Vault content into the
// pgvector store, and retrieve it for the agent. Everything degrades gracefully —
// if Supabase or Voyage isn't configured, retrieval falls back to the curated
// demo intelligence so the platform still works end to end.

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import { embed, embedOne, hasEmbeddings, EMBED_DIM } from '@/lib/embeddings'
import { rerankConfigured, rerankItems } from '@/lib/rerank'
import {
  patterns,
  topHooks,
  topHeadlines,
  topOffers,
  transformations,
  learnings,
  researchOutputs,
  creativeAnalyses,
  vaultCategories,
  foundationAssets,
} from '@/lib/reactor-data'
import { demoDataEnabled, demoRetrievalEnabled } from '@/lib/demo-mode'

export type KnowledgeSystem =
  | 'vault'
  | 'research'
  | 'transformation'
  | 'creative'
  | 'copy'
  | 'pattern'
  | 'learning'
  | 'website'
  // 'design' is the VISUAL knowledge section — the design DNA of ads that have
  // already won: measured palette, layout archetype, every element's zone and
  // treatment, the on-ad copy, the contrast device. It is its own section
  // rather than a corner of `creative` because it answers a different question:
  // `creative` is how a winning ad is WRITTEN, `design` is how it LOOKS. SPARK
  // reads both, and lib/visual-library.ts reads this one structurally so a run
  // can rebuild a proven layout instead of paraphrasing a description of it.
  | 'design'

export interface KnowledgeHit {
  system: string
  category: string | null
  title: string
  content: string
  /** Cosine similarity to the query — the same scale whichever search found the row. */
  similarity: number
  /**
   * The reranker's relevance score, when the hit was reranked. A different
   * scale from `similarity` and never interchangeable with it: similarity says
   * how near two embeddings are, relevance says how well this document answers
   * this query read together.
   */
  relevance?: number
}

/* -------------------------------- Chunking -------------------------------- */

// Split long text into ~1,000-char chunks on paragraph boundaries.
export function chunkText(text: string, maxChars = 1000): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const p of paras) {
    if ((current + '\n\n' + p).length > maxChars && current) {
      chunks.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text.slice(0, maxChars)]
}

function dbReady(): boolean {
  return Boolean(supabaseUrl()) && hasEmbeddings()
}

// Reading/browsing/deleting only needs Supabase — not Voyage embeddings.
function supabaseReady(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

/* -------------------------------- Ingest ---------------------------------- */

export interface IngestInput {
  system: KnowledgeSystem
  title: string
  content: string
  category?: string | null
  /**
   * The account this knowledge belongs to. Required for customer content.
   *
   * It used to be optional and written as `builder_id: input.builderId ?? null`
   * — and `match_knowledge` returned null-tenant rows to EVERY tenant, so a
   * caller that forgot to pass one did not write a private row, it published
   * one. The two callers that could not supply an account were the website
   * scan and the vault ingest: exactly the two that carry a customer's own
   * brand intelligence.
   */
  builderId?: string | null
  /**
   * Platform-owned knowledge, deliberately readable by every account (shared
   * craft, never a customer's material). Must be set explicitly — the intent
   * can no longer be inferred from an absent tenant, because "global" and
   * "somebody forgot" looked identical and one of them is a leak.
   */
  isGlobal?: boolean
  metadata?: Record<string, unknown>
}

export interface IngestResult {
  ok: boolean
  chunks: number
  stored: boolean
  reason?: string
}

export async function ingestKnowledge(input: IngestInput): Promise<IngestResult> {
  const chunks = chunkText(input.content)

  if (!dbReady()) {
    return { ok: true, chunks: chunks.length, stored: false, reason: 'Vector store not configured' }
  }

  // Refused rather than written unscoped. A row with no account and no explicit
  // global flag is retrievable by nobody under the new match function and was
  // retrievable by everybody under the old one; neither is what the caller
  // meant, and guessing which is not this function's job.
  const accountId = input.builderId ?? null
  const isGlobal = input.isGlobal === true
  if (!accountId && !isGlobal) {
    return {
      ok: false,
      chunks: chunks.length,
      stored: false,
      reason:
        'Refused: knowledge must belong to an account. Pass builderId (the signed-in account), or isGlobal for platform-owned craft.',
    }
  }

  const vectors = await embed(chunks, 'document')
  const rows = chunks.map((content, i) => ({
    system: input.system,
    category: input.category ?? null,
    title: input.title,
    content,
    builder_id: accountId,
    is_global: isGlobal,
    metadata: input.metadata ?? {},
    embedding: vectors[i],
  }))

  const { error } = await getSupabaseAdmin().from('knowledge_chunks').insert(rows)
  if (error) throw error

  return { ok: true, chunks: chunks.length, stored: true }
}

/* ------------------------------- Retrieval -------------------------------- */

/**
 * How many candidates the database hands the reranker. Wide enough that the
 * right row is in the pool when the fused order puts it 15th; narrow enough
 * that the rerank call stays well inside its timeout.
 */
const RERANK_POOL = 24

/**
 * Whether `match_knowledge_hybrid` exists (supabase/schema.retrieval.sql).
 *
 * Checked by trying it: a project that has not run the migration answers
 * "function not found", and every search then uses `match_knowledge` until the
 * next re-check, so an un-migrated deployment pays one failed call per window
 * rather than one per search. The window is short enough that running the
 * migration takes effect without a redeploy.
 */
const HYBRID_RECHECK_MS = 10 * 60_000
let hybridMissingSince: number | null = null

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // PGRST202: PostgREST could not find the function. 42883: Postgres itself.
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /match_knowledge_hybrid/i.test(error.message ?? '')
  )
}

interface ScopedSearch {
  queryEmbedding: number[]
  queryText: string
  count: number
  system: KnowledgeSystem | null
  builderId: string | null
}

/**
 * One scoped database search: hybrid when the migration is in, pure vector
 * otherwise. Both functions apply the same tenant predicate — a null account
 * returns global rows only — so the fallback can never widen a result set.
 */
async function scopedSearch(search: ScopedSearch): Promise<KnowledgeHit[]> {
  const admin = getSupabaseAdmin()
  const scope = { filter_system: search.system, filter_builder: search.builderId }
  const toHit = (d: KnowledgeHit): KnowledgeHit => ({
    system: d.system,
    category: d.category ?? null,
    title: d.title,
    content: d.content,
    similarity: d.similarity,
  })

  const hybridDue =
    hybridMissingSince === null || Date.now() - hybridMissingSince > HYBRID_RECHECK_MS
  if (hybridDue) {
    const { data, error } = await admin.rpc('match_knowledge_hybrid', {
      query_embedding: search.queryEmbedding,
      query_text: search.queryText,
      match_count: search.count,
      ...scope,
    })
    if (!error) {
      hybridMissingSince = null
      return (data ?? []).map(toHit)
    }
    if (isMissingFunction(error)) {
      if (hybridMissingSince === null) {
        console.warn(
          'match_knowledge_hybrid is not installed — retrieval is vector-only. Run supabase/schema.retrieval.sql to add keyword matching.',
        )
      }
      hybridMissingSince = Date.now()
    } else {
      // A real failure of the hybrid query is not a reason to fail the search:
      // the vector path answers the same question, under the same scope.
      console.error('Hybrid search failed, using vector search:', error)
    }
  }

  const { data, error } = await admin.rpc('match_knowledge', {
    query_embedding: search.queryEmbedding,
    match_count: search.count,
    ...scope,
  })
  if (error) throw error
  return (data ?? []).map(toHit)
}

export async function searchKnowledge(
  query: string,
  opts: { k?: number; system?: KnowledgeSystem; builderId?: string | null } = {},
): Promise<KnowledgeHit[]> {
  const k = opts.k ?? 8

  if (dbReady()) {
    try {
      const queryEmbedding = await embedOne(query, 'query')
      // A wider pool is only worth fetching when something will reorder it.
      const pool = rerankConfigured() ? Math.max(k, RERANK_POOL) : k
      const candidates = await scopedSearch({
        queryEmbedding,
        queryText: query,
        count: pool,
        system: opts.system ?? null,
        builderId: opts.builderId ?? null,
      })
      // A successful search that matched nothing is an ANSWER, not a failure.
      // Falling through to the demo corpus here would hand every tenant with an
      // empty vault the curated stand-in knowledge of whoever seeded it — the
      // agents would then ground a campaign in another company's frameworks and
      // report it as retrieved evidence. An empty vault must retrieve nothing.
      const { items } = await rerankItems(query, candidates, k, (h) => `${h.title}\n${h.content}`)
      return items
    } catch (err) {
      console.error('Vector search failed, using demo knowledge:', err)
    }
  }

  // Reached only when the knowledge layer is unconfigured (no Supabase/Voyage)
  // or the query itself errored — i.e. demo mode, where the curated corpus is
  // the intended experience.
  return demoSearch(query, k, opts.system)
}

/**
 * Is hybrid search installed? For the health check — one global-scope probe
 * with a unit vector, which matches only platform rows and reads nothing that
 * belongs to an account.
 */
export async function probeHybridSearch(): Promise<{ installed: boolean; error?: string }> {
  if (!supabaseReady()) return { installed: false, error: 'Supabase not configured' }
  try {
    const probe = new Array<number>(EMBED_DIM).fill(0)
    probe[0] = 1
    const { error } = await getSupabaseAdmin().rpc('match_knowledge_hybrid', {
      query_embedding: probe,
      query_text: 'probe',
      match_count: 1,
      filter_system: null,
      filter_builder: null,
    })
    if (!error) return { installed: true }
    return {
      installed: false,
      error: isMissingFunction(error)
        ? 'Run supabase/schema.retrieval.sql to install hybrid search.'
        : error.message,
    }
  } catch (err) {
    return { installed: false, error: err instanceof Error ? err.message : 'probe failed' }
  }
}

/* ------------------------------ Vault stats ------------------------------- */
// Live counts of what THIS ACCOUNT has stored. Degrades to the curated demo map
// so the dashboards always render meaningful numbers.
//
// Scoped, because the counts are themselves a read of tenant data: the old
// version counted every row in the table and grouped it with the unscoped
// `knowledge_stats()`, so a brand's Vault badge and Agent Network read the
// size and the shape of every other brand's library.

export interface VaultStatGroup {
  system: string
  category: string | null
  count: number
}

export interface VaultStats {
  live: boolean
  total: number
  groups: VaultStatGroup[]
}

// Sum of the curated category map — the demo "mapped" total.
export function curatedVaultTotal(): number {
  return vaultCategories.reduce(
    (sum, g) => sum + g.items.reduce((s, i) => s + i.count, 0),
    0,
  )
}

/** Every system a chunk can be filed under — the fallback breakdown's buckets. */
const KNOWLEDGE_SYSTEMS: KnowledgeSystem[] = [
  'vault',
  'research',
  'transformation',
  'creative',
  'copy',
  'pattern',
  'learning',
  'website',
  'design',
]

/**
 * The per-system / per-category breakdown for one account.
 *
 * `knowledge_stats_scoped` (supabase/schema.lockdown.sql) groups in the
 * database. Until that migration runs, one head-count per system answers the
 * per-system half — what the Agent Network needs — with the category left
 * unbroken rather than read across tenants.
 */
async function scopedGroups(accountId: string): Promise<VaultStatGroup[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.rpc('knowledge_stats_scoped', { filter_builder: accountId })
  if (!error && data) {
    return (data as { system: string; category: string | null; count: number }[]).map((r) => ({
      system: r.system,
      category: r.category ?? null,
      count: Number(r.count),
    }))
  }
  const counts = await Promise.all(
    KNOWLEDGE_SYSTEMS.map(async (system) => {
      const { count } = await admin
        .from('knowledge_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('builder_id', accountId)
        .eq('system', system)
      return { system, category: null, count: count ?? 0 }
    }),
  )
  return counts.filter((g) => g.count > 0)
}

export async function vaultStats(accountId: string | null): Promise<VaultStats> {
  if (supabaseReady()) {
    // No account, no library: a session that names no brand reads an empty
    // Vault — never the deployment's.
    if (!accountId) return { live: true, total: 0, groups: [] }
    try {
      const admin = getSupabaseAdmin()

      // Authoritative total via a direct count — never depends on the RPC, so the
      // "stored" badge can't read 0 while rows exist.
      const { count, error: countErr } = await admin
        .from('knowledge_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('builder_id', accountId)
      if (countErr) throw countErr

      const groups = await scopedGroups(accountId).catch(() => [] as VaultStatGroup[])
      return { live: true, total: count ?? 0, groups }
    } catch (err) {
      console.error('Vault stats query failed, using demo counts:', err)
    }
  }

  // Curated counts describe a vault that was filled elsewhere. Off by default,
  // so an unconfigured deployment reads zero rather than someone else's totals.
  if (!demoDataEnabled()) return { live: false, total: 0, groups: [] }

  const groups: VaultStatGroup[] = vaultCategories.flatMap((g) =>
    g.items.map((i) => ({ system: g.group, category: i.name, count: i.count })),
  )
  return { live: false, total: curatedVaultTotal(), groups }
}

/* ------------------------------ Vault browse ------------------------------ */
// List / search the actual stored chunks for the Vault library view.

export interface VaultItem {
  id: string | null
  system: string
  category: string | null
  title: string
  content: string
  created_at: string | null
  similarity?: number
}

export interface BrowseResult {
  live: boolean
  items: VaultItem[]
}

/**
 * List or search the chunks ONE ACCOUNT owns, for the Vault library view.
 *
 * Two bugs lived here. The plain browse had no tenant filter at all, so every
 * brand's Vault listed every brand's chunks. The semantic browse passed
 * `filter_builder: null`, which `match_knowledge` answers with GLOBAL rows
 * only — so a brand searching its own Vault never found its own uploads.
 *
 * The Vault shows what the account owns and nothing else: never global rows,
 * which are platform material and not the brand's to read or edit.
 */
export async function browseKnowledge(
  accountId: string | null,
  opts: { query?: string; system?: KnowledgeSystem; limit?: number } = {},
): Promise<BrowseResult> {
  const limit = opts.limit ?? 60
  const q = opts.query?.trim()

  if (supabaseReady()) {
    if (!accountId) return { live: true, items: [] }
    try {
      const admin = getSupabaseAdmin()

      // Semantic search when a query is present and embeddings are configured.
      if (q && hasEmbeddings()) {
        const queryEmbedding = await embedOne(q, 'query')
        // Scoped to the account — which `match_knowledge` widens to include
        // platform-global rows, so a second, owned-only read decides what is
        // listed. The pool is doubled so global rows cannot crowd out the
        // account's own.
        const { data, error } = await admin.rpc('match_knowledge', {
          query_embedding: queryEmbedding,
          match_count: limit * 2,
          filter_system: opts.system ?? null,
          filter_builder: accountId,
        })
        if (error) throw error
        const hits = (data ?? []) as (VaultItem & { similarity: number })[]
        const ids = hits.map((d) => d.id).filter((id): id is string => Boolean(id))
        const owned = new Set<string>()
        if (ids.length) {
          const { data: rows, error: ownErr } = await admin
            .from('knowledge_chunks')
            .select('id')
            .in('id', ids)
            .eq('builder_id', accountId)
          if (ownErr) throw ownErr
          for (const r of rows ?? []) owned.add(String((r as { id: string }).id))
        }
        return {
          live: true,
          items: hits
            .filter((d) => d.id && owned.has(d.id))
            .slice(0, limit)
            .map((d) => ({
              id: d.id,
              system: d.system,
              category: d.category ?? null,
              title: d.title,
              content: d.content,
              created_at: null,
              similarity: d.similarity,
            })),
        }
      }

      // Plain browse (or keyword filter when there's no embeddings provider).
      let sel = admin
        .from('knowledge_chunks')
        .select('id, system, category, title, content, created_at')
        .eq('builder_id', accountId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (opts.system) sel = sel.eq('system', opts.system)
      // Characters PostgREST reads as filter syntax are dropped, so a search
      // term can only ever be a term — never an extra condition.
      const term = q?.replace(/[%,()*\\]/g, ' ').trim()
      if (term) sel = sel.or(`title.ilike.%${term}%,content.ilike.%${term}%`)

      const { data, error } = await sel
      if (error) throw error
      return { live: true, items: (data ?? []) as VaultItem[] }
    } catch (err) {
      console.error('Vault browse failed, using demo corpus:', err)
    }
  }

  // Demo fallback: browse the curated corpus. Opt-in for the same reason as the
  // counts above — an empty vault must not list another business's assets.
  if (!demoDataEnabled()) return { live: false, items: [] }

  const corpus = buildDemoCorpus().filter((d) => !opts.system || d.system === opts.system)
  const filtered = q
    ? corpus.filter((d) => `${d.title} ${d.content} ${d.category}`.toLowerCase().includes(q.toLowerCase()))
    : corpus
  return {
    live: false,
    items: filtered.slice(0, limit).map((d) => ({
      id: null,
      system: d.system,
      category: d.category,
      title: d.title,
      content: d.content,
      created_at: null,
    })),
  }
}

/**
 * Delete one chunk the account owns. An id that belongs to another account —
 * or to the platform — deletes nothing and reads as "not found", the same
 * answer as an id that does not exist, so the route cannot be used to probe
 * which ids are real.
 */
export async function deleteKnowledge(id: string, accountId: string | null): Promise<void> {
  if (!supabaseReady()) throw new Error('Vector store not configured')
  if (!accountId) throw new Error('No account on this session')
  const { data, error } = await getSupabaseAdmin()
    .from('knowledge_chunks')
    .delete()
    .eq('id', id)
    .eq('builder_id', accountId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Not found')
}

/**
 * Update a stored chunk's title and/or content.
 *
 * Content edits are re-embedded before the write. A chunk whose text changed
 * but whose vector didn't would still be retrieved for the OLD text and then
 * hand the agent the NEW text — the correction would be invisible to search
 * and actively misleading in results. When embeddings aren't configured the
 * text still updates (keyword browse stays correct) and the caller is told the
 * vector is stale.
 */
export async function updateKnowledge(
  input: {
    id: string
    title?: string
    content?: string
  },
  accountId: string | null,
): Promise<{ reembedded: boolean }> {
  if (!supabaseReady()) throw new Error('Vector store not configured')
  if (!accountId) throw new Error('No account on this session')

  const title = input.title?.trim()
  const content = input.content?.trim()
  if (!title && !content) throw new Error('Nothing to update')

  const patch: Record<string, unknown> = {}
  if (title) patch.title = title

  let reembedded = false
  if (content) {
    patch.content = content
    if (hasEmbeddings()) {
      const [vector] = await embed([content], 'document')
      patch.embedding = vector
      reembedded = true
    }
  }

  // Scoped like the delete: an id the account does not own updates nothing.
  // The embedding above is spent before this check on purpose — one wasted
  // embed call is cheaper than a read-then-write race.
  const { data, error } = await getSupabaseAdmin()
    .from('knowledge_chunks')
    .update(patch)
    .eq('id', input.id)
    .eq('builder_id', accountId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Not found')
  return { reembedded }
}

/* ----------------------- Demo fallback knowledge -------------------------- */
// Builds a corpus from the curated intelligence so retrieval works without a DB.

interface Doc {
  system: string
  category: string
  title: string
  content: string
}

let demoCorpus: Doc[] | null = null

function buildDemoCorpus(): Doc[] {
  if (demoCorpus) return demoCorpus
  const docs: Doc[] = []

  // ATLAS's foundation — universal craft knowledge (ad anatomy, PAS/BAB/AIDA,
  // hook construction, compliance, offer framing). True for every business on
  // the platform, so it ships unconditionally: without it the layer the product
  // calls its foundation is the one layer with nothing behind it whenever the
  // vector store is unreachable.
  for (const a of foundationAssets) {
    docs.push({ system: a.system, category: a.category, title: a.title, content: a.content })
  }

  /* Everything below is ONE BUSINESS'S DATA — its patterns, its client
     transformations with their real margins, its winning hooks, its research
     findings, its creative win rates. It exists for demos and screenshots and
     it is gated accordingly.

     The dashboards have always gated it. Retrieval did not, and retrieval is
     the path that feeds the agents: on a deployment with the flag unset, every
     panel rendered honestly empty while every reactor run still retrieved
     another company's members, margins and market as evidence and grounded the
     campaign in them. The screen said "blank platform" and the ads said
     otherwise. Retrieval therefore answers to its OWN half of the gate,
     strictly opt-in: dressing the dashboards for a demo never changes what
     the agents are handed. */
  if (!demoRetrievalEnabled()) {
    demoCorpus = docs
    return docs
  }

  // The Vault's asset inventory is retrievable too, so ATLAS can answer "what
  // do we actually hold on this" with the real shape of the library.
  for (const g of vaultCategories) {
    docs.push({
      system: 'vault',
      category: g.group,
      title: `${g.group} — Vault inventory`,
      content: `${g.group} held in the Knowledge Vault: ${g.items
        .map((i) => `${i.name} (${i.count})`)
        .join(', ')}.`,
    })
  }

  for (const p of patterns) {
    docs.push({
      system: 'pattern',
      category: p.name,
      title: p.name,
      content: `Hook: ${p.hook}. Headline: ${p.headline}. Creative style: ${p.creativeStyle}. Transformation: ${p.transformation}. Offer: ${p.offer}. CTA: ${p.cta}. Notes: ${p.notes}`,
    })
  }
  for (const h of [...topHooks, ...topHeadlines, ...topOffers]) {
    docs.push({ system: 'copy', category: h.angle, title: h.text, content: `${h.text} (${h.metric}, angle: ${h.angle})` })
  }
  for (const t of transformations) {
    docs.push({
      system: 'transformation',
      category: t.type,
      title: t.member,
      content: `${t.member} — ${t.type}. Emotional: ${t.emotional}. Financial: ${t.financial}. Identity: ${t.identity}. Angles: ${t.angles.join(', ')}`,
    })
  }
  for (const l of learnings) {
    docs.push({ system: 'learning', category: 'Creative Learning', title: l.insight, content: `${l.insight} Evidence: ${l.evidence} Recommendation: ${l.recommendation}` })
  }
  for (const r of researchOutputs) {
    docs.push({ system: 'research', category: r.type, title: r.type, content: `${r.type}: ${r.items.join('; ')}` })
  }
  for (const c of creativeAnalyses) {
    docs.push({
      system: 'creative',
      category: c.type,
      title: c.type,
      content: `${c.type} (${c.winRate}% win). Structure: ${c.structure}. Visual: ${c.visualStyle}. Opening: ${c.opening}. CTA: ${c.cta}`,
    })
  }

  demoCorpus = docs
  return docs
}

function demoSearch(query: string, k: number, system?: KnowledgeSystem): KnowledgeHit[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  const corpus = buildDemoCorpus().filter((d) => !system || d.system === system)

  const scored = corpus.map((d) => {
    const hay = `${d.title} ${d.content} ${d.category}`.toLowerCase()
    let score = 0
    for (const t of terms) if (hay.includes(t)) score += 1
    return { d, score }
  })

  // Only documents that actually match the question count as evidence. The
  // previous top-k slice returned k documents whatever the score, so a layer
  // reported unrelated material as findings and banded its confidence off the
  // raw count. With no query terms at all, ranking is meaningless — fall back
  // to the head of the corpus so the layer still has ground to stand on.
  const ranked = scored.sort((a, b) => b.score - a.score)
  const relevant = terms.length ? ranked.filter((s) => s.score > 0) : ranked

  return relevant.slice(0, k).map(({ d, score }) => ({
    system: d.system,
    category: d.category,
    title: d.title,
    content: d.content,
    similarity: terms.length ? score / terms.length : 0,
  }))
}
