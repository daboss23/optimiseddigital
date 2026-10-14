/**
 * PageIndex transport — the provider behind long-document reading.
 *
 * PageIndex (VectifyAI, MIT) indexes one long document as a table-of-contents
 * tree and answers a question by having an LLM reason its way down that tree to
 * the right section, rather than by vector similarity over chunks. That is the
 * right tool for exactly one job on this platform — a long, structured upload
 * (a brand book, an SOP manual, an offer document) where WHICH section a rule
 * sits in is the whole point — and the wrong tool for the Vault's thousands of
 * small, flat chunks, which stay on hybrid vector search (lib/knowledge.ts).
 *
 * Shaped like lib/gethookd/client.ts: a transport that never throws, so every
 * caller handles one result type and a dead provider is a sentence, not a 500.
 *
 * Uses the official SDK's REST client (`PageIndexApi` from `@pageindex/sdk`),
 * NOT its MCP client: the REST client is plain fetch with no long-lived
 * connection, which is what a serverless function can hold. Endpoints and
 * field names are the SDK's, verified against its type definitions —
 * submitDocument → { doc_id }, getDocument → { status, pageNum },
 * chatCompletions({ messages, doc_id }) → choices[0].message.content.
 *
 * Config:
 *   PAGEINDEX_API_KEY      required — generated in the PageIndex Cloud dashboard
 *   PAGEINDEX_API_BASE     optional — default https://api.pageindex.ai
 *   PAGEINDEX_TIMEOUT_MS   optional — default 40000, per question
 */

import { PageIndexApi, PageIndexError } from '@pageindex/sdk'

const DEFAULT_API_BASE = 'https://api.pageindex.ai'

/**
 * A question sits inside a Reactor run's wall-clock budget, alongside the
 * other tools OPUS called in the same turn. Past this the run stops waiting
 * and OPUS is told the document did not answer in time.
 */
const DEFAULT_ASK_TIMEOUT_MS = 40_000

/** Uploads and status reads are small and should be quick. */
const DEFAULT_IO_TIMEOUT_MS = 20_000

export function pageIndexConfigured(): boolean {
  return Boolean((process.env.PAGEINDEX_API_KEY ?? '').trim())
}

function client(): PageIndexApi {
  return new PageIndexApi({
    apiKey: (process.env.PAGEINDEX_API_KEY ?? '').trim(),
    apiUrl: (process.env.PAGEINDEX_API_BASE ?? '').trim() || DEFAULT_API_BASE,
  })
}

function askTimeoutMs(): number {
  const n = Number(process.env.PAGEINDEX_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ASK_TIMEOUT_MS
}

class TimeoutError extends Error {}

/**
 * Stop WAITING after `ms`. The SDK's fetch carries no signal, so the request
 * itself may finish in the background; what matters is that the caller — a
 * route or a Reactor turn — is released on time.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** One plain sentence for a provider failure — shown to an operator, read by OPUS. */
export function describePageIndexError(err: unknown): string {
  if (err instanceof TimeoutError) return err.message
  if (err instanceof PageIndexError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        return 'PageIndex rejected the API key. Check PAGEINDEX_API_KEY.'
      case 'USAGE_LIMIT_REACHED':
        return 'The PageIndex account has reached its usage limit.'
      case 'PLAN_REQUIRED':
        return 'This needs a paid PageIndex plan.'
      case 'RATE_LIMITED':
        return 'PageIndex is rate-limiting requests. Try again shortly.'
      case 'NOT_FOUND':
        return 'PageIndex no longer has this document.'
      case 'INVALID_INPUT':
        return `PageIndex refused the request: ${err.message}`
      case 'SERVICE_UNAVAILABLE':
        return 'PageIndex is temporarily unavailable.'
      default:
        return `PageIndex error: ${err.message}`
    }
  }
  return err instanceof Error ? err.message : 'PageIndex request failed'
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

/** The provider's processing states. Anything else is treated as still processing. */
export type ProviderStatus = 'queued' | 'processing' | 'completed' | 'failed'

export function normaliseStatus(raw: unknown): ProviderStatus {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'completed' || s === 'failed' || s === 'queued') return s
  return 'processing'
}

export async function submitPdf(
  bytes: ArrayBuffer,
  fileName: string,
): Promise<Result<{ providerDocId: string }>> {
  if (!pageIndexConfigured()) return { ok: false, error: 'PAGEINDEX_API_KEY is not set.' }
  try {
    const res = await withTimeout(
      client().submitDocument(bytes, fileName),
      DEFAULT_IO_TIMEOUT_MS,
      'Uploading to PageIndex',
    )
    if (!res?.doc_id) return { ok: false, error: 'PageIndex accepted the upload but returned no document id.' }
    return { ok: true, providerDocId: res.doc_id }
  } catch (err) {
    return { ok: false, error: describePageIndexError(err) }
  }
}

export async function documentStatus(
  providerDocId: string,
): Promise<Result<{ status: ProviderStatus; pageCount: number | null }>> {
  if (!pageIndexConfigured()) return { ok: false, error: 'PAGEINDEX_API_KEY is not set.' }
  try {
    const meta = await withTimeout(
      client().getDocument(providerDocId),
      DEFAULT_IO_TIMEOUT_MS,
      'Reading PageIndex status',
    )
    return {
      ok: true,
      status: normaliseStatus(meta?.status),
      pageCount: typeof meta?.pageNum === 'number' ? meta.pageNum : null,
    }
  } catch (err) {
    return { ok: false, error: describePageIndexError(err) }
  }
}

/**
 * The instruction every question carries. It exists for one reason: an answer
 * from a long document is only useful to the Reactor if it is the DOCUMENT
 * speaking — quoted where wording matters, located by section and page, and
 * honest when the document is silent. A fluent paraphrase that fills a gap
 * with general knowledge is the failure this guards against.
 */
const READING_INSTRUCTION = [
  'Answer strictly from this document. Do not add general knowledge.',
  'Quote the exact wording for any rule, requirement, claim or restriction.',
  'Name the section heading and page number each part of the answer comes from.',
  'If the document does not cover the question, say so plainly in one sentence.',
].join(' ')

export async function askPdf(
  providerDocId: string,
  question: string,
): Promise<Result<{ answer: string }>> {
  if (!pageIndexConfigured()) return { ok: false, error: 'PAGEINDEX_API_KEY is not set.' }
  try {
    const res = await withTimeout(
      client().chatCompletions({
        messages: [
          { role: 'system', content: READING_INSTRUCTION },
          { role: 'user', content: question },
        ],
        doc_id: providerDocId,
        enable_citations: true,
        stream: false,
      }),
      askTimeoutMs(),
      'Reading the document',
    )
    const answer = res?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!answer) return { ok: false, error: 'PageIndex returned an empty answer.' }
    return { ok: true, answer }
  } catch (err) {
    return { ok: false, error: describePageIndexError(err) }
  }
}

export async function removePdf(providerDocId: string): Promise<Result<object>> {
  if (!pageIndexConfigured()) return { ok: false, error: 'PAGEINDEX_API_KEY is not set.' }
  try {
    await withTimeout(client().deleteDocument(providerDocId), DEFAULT_IO_TIMEOUT_MS, 'Deleting from PageIndex')
    return { ok: true }
  } catch (err) {
    // Already gone at the provider is the outcome a delete wanted.
    if (err instanceof PageIndexError && err.code === 'NOT_FOUND') return { ok: true }
    return { ok: false, error: describePageIndexError(err) }
  }
}
