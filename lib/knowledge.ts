// Knowledge layer for the Reactor: chunk + ingest Vault content into the
// pgvector store, and retrieve it for the agent. Everything degrades gracefully —
// if Supabase or Voyage isn't configured, retrieval falls back to the curated
// demo intelligence so the platform still works end to end.

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import { embed, embedOne, hasEmbeddings } from '@/lib/embeddings'
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
import { demoDataEnabled } from '@/lib/demo-mode'

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
  similarity: number
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
  builderId?: string | null
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

  const vectors = await embed(chunks, 'document')
  const rows = chunks.map((content, i) => ({
    system: input.system,
    category: input.category ?? null,
    title: input.title,
    content,
    builder_id: input.builderId ?? null,
    metadata: input.metadata ?? {},
    embedding: vectors[i],
  }))

  const { error } = await getSupabaseAdmin().from('knowledge_chunks').insert(rows)
  if (error) throw error

  return { ok: true, chunks: chunks.length, stored: true }
}

/* ------------------------------- Retrieval -------------------------------- */

export async function searchKnowledge(
  query: string,
  opts: { k?: number; system?: KnowledgeSystem; builderId?: string | null } = {},
): Promise<KnowledgeHit[]> {
  const k = opts.k ?? 8

  if (dbReady()) {
    try {
      const queryEmbedding = await embedOne(query, 'query')
      const { data, error } = await getSupabaseAdmin().rpc('match_knowledge', {
        query_embedding: queryEmbedding,
        match_count: k,
        filter_system: opts.system ?? null,
        filter_builder: opts.builderId ?? null,
      })
      if (error) throw error
      // A successful search that matched nothing is an ANSWER, not a failure.
      // Falling through to the demo corpus here would hand every tenant with an
      // empty vault the curated stand-in knowledge of whoever seeded it — the
      // agents would then ground a campaign in another company's frameworks and
      // report it as retrieved evidence. An empty vault must retrieve nothing.
      return (data ?? []).map((d: KnowledgeHit) => ({
        system: d.system,
        category: d.category ?? null,
        title: d.title,
        content: d.content,
        similarity: d.similarity,
      }))
    } catch (err) {
      console.error('Vector search failed, using demo knowledge:', err)
    }
  }

  // Reached only when the knowledge layer is unconfigured (no Supabase/Voyage)
  // or the query itself errored — i.e. demo mode, where the curated corpus is
  // the intended experience.
  return demoSearch(query, k, opts.system)
}

/* ------------------------------ Vault stats ------------------------------- */
// Live counts of what's actually stored in the knowledge layer. Degrades to the
// curated demo map so the dashboards always render meaningful numbers.

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

export async function vaultStats(): Promise<VaultStats> {
  if (supabaseReady()) {
    try {
      const admin = getSupabaseAdmin()

      // Authoritative total via a direct count — never depends on the RPC, so the
      // "stored" badge can't read 0 while rows exist.
      const { count, error: countErr } = await admin
        .from('knowledge_chunks')
        .select('id', { count: 'exact', head: true })
      if (countErr) throw countErr

      // Per-system / per-category breakdown for the categories panel.
      let groups: VaultStatGroup[] = []
      const { data, error: rpcErr } = await admin.rpc('knowledge_stats')
      if (!rpcErr && data) {
        groups = (data as { system: string; category: string | null; count: number }[]).map((r) => ({
          system: r.system,
          category: r.category ?? null,
          count: Number(r.count),
        }))
      }

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

export async function browseKnowledge(
  opts: { query?: string; system?: KnowledgeSystem; limit?: number } = {},
): Promise<BrowseResult> {
  const limit = opts.limit ?? 60
  const q = opts.query?.trim()

  if (supabaseReady()) {
    try {
      const admin = getSupabaseAdmin()

      // Semantic search when a query is present and embeddings are configured.
      if (q && hasEmbeddings()) {
        const queryEmbedding = await embedOne(q, 'query')
        const { data, error } = await admin.rpc('match_knowledge', {
          query_embedding: queryEmbedding,
          match_count: limit,
          filter_system: opts.system ?? null,
          filter_builder: null,
        })
        if (error) throw error
        return {
          live: true,
          items: (data ?? []).map((d: VaultItem & { similarity: number }) => ({
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
        .order('created_at', { ascending: false })
        .limit(limit)
      if (opts.system) sel = sel.eq('system', opts.system)
      if (q) sel = sel.or(`title.ilike.%${q}%,content.ilike.%${q}%`)

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

export async function deleteKnowledge(id: string): Promise<void> {
  if (!supabaseReady()) throw new Error('Vector store not configured')
  const { error } = await getSupabaseAdmin().from('knowledge_chunks').delete().eq('id', id)
  if (error) throw error
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
export async function updateKnowledge(input: {
  id: string
  title?: string
  content?: string
}): Promise<{ reembedded: boolean }> {
  if (!supabaseReady()) throw new Error('Vector store not configured')

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

  const { error } = await getSupabaseAdmin().from('knowledge_chunks').update(patch).eq('id', input.id)
  if (error) throw error
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

  // ATLAS's foundation — the `vault` and `website` systems. Without these the
  // Knowledge Intelligence layer is the only one with no documents behind it,
  // so it reports zero evidence on every run that isn't backed by a live
  // Supabase + Voyage stack.
  for (const a of foundationAssets) {
    docs.push({ system: a.system, category: a.category, title: a.title, content: a.content })
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
