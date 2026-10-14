/**
 * Reranking — the second pass of retrieval.
 *
 * Vector search answers "what is NEAR this?" and keyword search answers "what
 * SAYS this?". Neither answers the question the agents actually ask — "which
 * of these is most relevant to THIS brief?" — because nearness is a property of
 * two embeddings computed separately, never of the query and the document read
 * together. A cross-encoder reranker reads them together. It is the cheap fix
 * for "similarity is not relevance": one fast scoring call over a candidate
 * pool, not an LLM reasoning loop per search.
 *
 * Voyage AI, the same provider and key as the embeddings (`VOYAGE_API_KEY`).
 * REST contract, verified against docs.voyageai.com/reference/reranker-api:
 *
 *   POST https://api.voyageai.com/v1/rerank
 *   { query, documents: string[], model, top_k?, truncation? }
 *   → { object: "list", data: [{ index, relevance_score }], model, usage }
 *
 * `data` arrives sorted by descending relevance. (The Python client exposes it
 * as `.results`; the REST body says `data` — both are read, so a client-shaped
 * proxy in front of the API cannot silently empty the ranking.)
 *
 * Never throws. A reranker that is unconfigured, slow or down returns null and
 * the caller keeps its fused order: reranking improves retrieval, it is never
 * allowed to be the reason retrieval returned nothing.
 */

const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank'

/** The documented recommendation. Override with VOYAGE_RERANK_MODEL; `off` disables. */
const DEFAULT_RERANK_MODEL = 'rerank-2.5'

/**
 * Retrieval sits on the hot path of every layer the Reactor briefs before
 * OPUS's first turn. A rerank slower than this is worth less than the order it
 * would improve, so the search proceeds without it.
 */
const DEFAULT_RERANK_TIMEOUT_MS = 4000

/**
 * Per-document character ceiling. A Vault chunk is ~1,000 characters; the cap
 * only bites on an oversized row, and keeps one row from spending the request's
 * token budget on its own.
 */
const MAX_DOC_CHARS = 4000

export function rerankModel(): string | null {
  const raw = (process.env.VOYAGE_RERANK_MODEL ?? '').trim()
  if (raw.toLowerCase() === 'off') return null
  return raw || DEFAULT_RERANK_MODEL
}

export function rerankConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY) && rerankModel() !== null
}

function rerankTimeoutMs(): number {
  const n = Number(process.env.VOYAGE_RERANK_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RERANK_TIMEOUT_MS
}

export interface RerankScore {
  /** Position in the documents array that was sent. */
  index: number
  relevanceScore: number
}

interface VoyageRerankItem {
  index?: unknown
  relevance_score?: unknown
}

/**
 * Read a rerank response body into scores, most relevant first.
 *
 * Exported for the self-test, which asserts it against the documented shape.
 * Anything malformed is dropped rather than guessed at — an index outside the
 * array sent, a missing score — so a bad row can never reorder a good one.
 */
export function parseRerankResponse(body: unknown, documentCount: number): RerankScore[] {
  if (!body || typeof body !== 'object') return []
  const record = body as { data?: unknown; results?: unknown }
  const items = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.results)
      ? record.results
      : []

  const seen = new Set<number>()
  const scores: RerankScore[] = []
  for (const raw of items as VoyageRerankItem[]) {
    const index = typeof raw?.index === 'number' ? raw.index : NaN
    const score = typeof raw?.relevance_score === 'number' ? raw.relevance_score : NaN
    if (!Number.isInteger(index) || index < 0 || index >= documentCount) continue
    if (!Number.isFinite(score) || seen.has(index)) continue
    seen.add(index)
    scores.push({ index, relevanceScore: score })
  }
  return scores.sort((a, b) => b.relevanceScore - a.relevanceScore)
}

/**
 * Score documents against a query. Returns scores most relevant first, at most
 * `topK` of them, or null when reranking is unavailable for any reason.
 */
export async function rerank(
  query: string,
  documents: string[],
  topK: number,
): Promise<RerankScore[] | null> {
  const key = process.env.VOYAGE_API_KEY
  const model = rerankModel()
  if (!key || !model) return null
  if (!query.trim() || documents.length === 0) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), rerankTimeoutMs())
  try {
    const res = await fetch(VOYAGE_RERANK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        documents: documents.map((d) => d.slice(0, MAX_DOC_CHARS)),
        model,
        top_k: Math.max(1, Math.min(topK, documents.length)),
        truncation: true,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`Voyage rerank failed (${res.status}): ${detail.slice(0, 200)}`)
      return null
    }
    const scores = parseRerankResponse(await res.json(), documents.length)
    return scores.length ? scores.slice(0, topK) : null
  } catch (err) {
    console.error(
      controller.signal.aborted
        ? `Voyage rerank timed out after ${rerankTimeoutMs()}ms — keeping the fused order.`
        : 'Voyage rerank failed — keeping the fused order:',
      controller.signal.aborted ? '' : err,
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Rerank a list of anything that carries text, keeping the top `k`.
 *
 * Falls back to the input order (already fused by the database) when the
 * reranker is unavailable, so the result is always the best order on hand and
 * never shorter than it would have been without reranking.
 */
export async function rerankItems<T extends { relevance?: number }>(
  query: string,
  items: T[],
  k: number,
  toText: (item: T) => string,
): Promise<{ items: T[]; reranked: boolean }> {
  if (items.length <= 1) return { items: items.slice(0, k), reranked: false }
  const scores = await rerank(query, items.map(toText), k)
  if (!scores) return { items: items.slice(0, k), reranked: false }
  const ranked: T[] = scores.map((s) => ({
    ...items[s.index],
    relevance: s.relevanceScore,
  }))
  // A response that dropped rows (malformed entries are discarded, never
  // guessed at) is topped up from the fused order, so a partial rerank can
  // reorder the pool but never shrink it.
  if (ranked.length < Math.min(k, items.length)) {
    const used = new Set(scores.map((s) => s.index))
    for (let i = 0; i < items.length && ranked.length < k; i += 1) {
      if (!used.has(i)) ranked.push(items[i])
    }
  }
  return { items: ranked, reranked: true }
}
