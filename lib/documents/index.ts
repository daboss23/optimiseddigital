/**
 * Long documents — the account's ledger of PDFs read by structure.
 *
 * The Vault chunks what it ingests, which is right for a hook, a design read or
 * a graded outcome and wrong for a 60-page brand book: chunking cuts the link
 * between a rule and the heading it sits under, and between a rule and its
 * exception. Those documents go to PageIndex (./pageindex.ts) instead, which
 * keeps the structure and answers by reasoning down it.
 *
 * Tenancy is enforced HERE, not at the provider. Every operation takes the
 * account resolved from the session (lib/account.ts) and finds the document
 * by (account_id, id) in `long_documents`. The provider's document id is read
 * off that row and never accepted from a request, so the worst a forged id can
 * do is miss.
 *
 * Never throws. Missing configuration and provider failures come back as a
 * `Result` with a sentence an operator can act on.
 */

import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import {
  askPdf,
  documentStatus,
  normaliseStatus,
  pageIndexConfigured,
  removePdf,
  submitPdf,
  type ProviderStatus,
  type Result,
} from '@/lib/documents/pageindex'

export interface LongDocument {
  id: string
  name: string
  status: ProviderStatus
  pageCount: number | null
  error: string | null
  createdAt: string
}

/**
 * Vercel refuses a serverless request body over 4.5 MB, and the PDF travels
 * through this deployment on its way to the provider (the API key must never
 * reach the browser, so the browser cannot upload directly). 4 MB leaves room
 * for the multipart envelope, and a text-based PDF of a few hundred pages fits.
 */
export const MAX_PDF_BYTES = 4 * 1024 * 1024

/** Status reads per list call. Bounded so a list never fans out unbounded provider calls. */
const MAX_STATUS_REFRESHES = 5

/** How many documents the Reactor is offered in one run. */
const MAX_READY_FOR_RUN = 12

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function storeReady(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

export interface DocumentsReadiness {
  /** PAGEINDEX_API_KEY is set. */
  provider: boolean
  /** Supabase is configured, so the ledger can persist. */
  store: boolean
  /** Both — uploads will work. */
  ready: boolean
  /** What is missing, in one sentence, when not ready. */
  reason?: string
}

export function documentsReadiness(): DocumentsReadiness {
  const provider = pageIndexConfigured()
  const store = storeReady()
  const reason = !provider
    ? 'Set PAGEINDEX_API_KEY to read long documents by structure.'
    : !store
      ? 'Long documents need Supabase configured to keep the account’s document ledger.'
      : undefined
  return { provider, store, ready: provider && store, ...(reason ? { reason } : {}) }
}

interface Row {
  id: string
  name: string
  status: string
  page_count: number | null
  error: string | null
  created_at: string
  provider_doc_id: string
}

function toDocument(row: Row): LongDocument {
  return {
    id: row.id,
    name: row.name,
    status: normaliseStatus(row.status),
    pageCount: row.page_count ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
  }
}

const COLUMNS = 'id, name, status, page_count, error, created_at, provider_doc_id'

function terminal(status: ProviderStatus): boolean {
  return status === 'completed' || status === 'failed'
}

/** One row, found by the account AND the id — never by id alone. */
async function findRow(accountId: string, id: string): Promise<Row | null> {
  if (!UUID_RE.test(id)) return null
  const { data, error } = await getSupabaseAdmin()
    .from('long_documents')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Row | null) ?? null
}

/** Ask the provider where a still-processing document has got to, and record it. */
async function refreshRow(accountId: string, row: Row): Promise<Row> {
  const current = await documentStatus(row.provider_doc_id)
  if (!current.ok) return row
  const changed = current.status !== normaliseStatus(row.status) || current.pageCount !== row.page_count
  if (!changed) return row
  const next = {
    status: current.status,
    page_count: current.pageCount,
    error: current.status === 'failed' ? 'PageIndex could not process this document.' : null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await getSupabaseAdmin()
    .from('long_documents')
    .update(next)
    .eq('account_id', accountId)
    .eq('id', row.id)
  if (error) {
    console.error('Long document status update failed:', error)
    return row
  }
  return { ...row, ...next }
}

/**
 * The account's documents, newest first, with up to MAX_STATUS_REFRESHES
 * still-processing ones refreshed from the provider on the way out.
 */
export async function listDocuments(accountId: string): Promise<Result<{ documents: LongDocument[] }>> {
  if (!storeReady()) return { ok: true, documents: [] }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('long_documents')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    const rows = (data ?? []) as Row[]

    if (pageIndexConfigured()) {
      const pending = rows
        .map((row, i) => ({ row, i }))
        .filter(({ row }) => !terminal(normaliseStatus(row.status)))
        .slice(0, MAX_STATUS_REFRESHES)
      const refreshed = await Promise.all(pending.map(({ row }) => refreshRow(accountId, row)))
      pending.forEach(({ i }, n) => {
        rows[i] = refreshed[n]
      })
    }

    return { ok: true, documents: rows.map(toDocument) }
  } catch (err) {
    console.error('Long document list failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Could not list documents.' }
  }
}

/** Why a file cannot be sent, or null when it can. Checked before a byte leaves the deployment. */
export function validatePdf(name: string, bytes: ArrayBuffer): string | null {
  if (!/\.pdf$/i.test(name.trim())) return 'Long documents must be PDFs.'
  if (bytes.byteLength === 0) return 'The file is empty.'
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return `The file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.`
  }
  // `%PDF-` — a renamed Word file is refused here rather than billed there.
  const head = new Uint8Array(bytes.slice(0, 5))
  const magic = String.fromCharCode(...Array.from(head))
  if (magic !== '%PDF-') return 'That file is not a valid PDF.'
  return null
}

export async function uploadDocument(
  accountId: string,
  name: string,
  bytes: ArrayBuffer,
): Promise<Result<{ document: LongDocument }>> {
  const readiness = documentsReadiness()
  if (!readiness.ready) return { ok: false, error: readiness.reason ?? 'Long documents are not configured.' }

  const invalid = validatePdf(name, bytes)
  if (invalid) return { ok: false, error: invalid }

  const cleanName = name.trim().slice(0, 200)
  const submitted = await submitPdf(bytes, cleanName)
  if (!submitted.ok) return submitted

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('long_documents')
      .insert({
        account_id: accountId,
        provider: 'pageindex',
        provider_doc_id: submitted.providerDocId,
        name: cleanName,
        status: 'queued',
      })
      .select(COLUMNS)
      .single()
    if (error) throw error
    return { ok: true, document: toDocument(data as Row) }
  } catch (err) {
    // The provider has the file but the ledger does not, so nobody could ever
    // reach or delete it. Remove it rather than leave it orphaned and billed.
    await removePdf(submitted.providerDocId)
    console.error('Long document ledger insert failed:', err)
    return { ok: false, error: 'The document was uploaded but could not be recorded, so it was removed. Try again.' }
  }
}

export async function deleteDocument(accountId: string, id: string): Promise<Result<object>> {
  if (!storeReady()) return { ok: false, error: 'Supabase is not configured.' }
  try {
    const row = await findRow(accountId, id)
    if (!row) return { ok: false, error: 'No such document on this account.' }
    if (pageIndexConfigured()) {
      const removed = await removePdf(row.provider_doc_id)
      if (!removed.ok) return removed
    }
    const { error } = await getSupabaseAdmin()
      .from('long_documents')
      .delete()
      .eq('account_id', accountId)
      .eq('id', row.id)
    if (error) throw error
    return { ok: true }
  } catch (err) {
    console.error('Long document delete failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Could not delete the document.' }
  }
}

/** Ask one of the account's documents a question. */
export async function askDocument(
  accountId: string,
  id: string,
  question: string,
): Promise<Result<{ answer: string; document: LongDocument }>> {
  const readiness = documentsReadiness()
  if (!readiness.ready) return { ok: false, error: readiness.reason ?? 'Long documents are not configured.' }
  const q = question.trim()
  if (!q) return { ok: false, error: 'Ask a question.' }

  try {
    let row = await findRow(accountId, id)
    if (!row) return { ok: false, error: 'No such document on this account.' }
    if (!terminal(normaliseStatus(row.status))) row = await refreshRow(accountId, row)
    const status = normaliseStatus(row.status)
    if (status === 'failed') return { ok: false, error: `${row.name} could not be processed.` }
    if (status !== 'completed') return { ok: false, error: `${row.name} is still being indexed.` }

    const answered = await askPdf(row.provider_doc_id, q.slice(0, 2000))
    if (!answered.ok) return answered
    return { ok: true, answer: answered.answer, document: toDocument(row) }
  } catch (err) {
    console.error('Long document question failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Could not read the document.' }
  }
}

/**
 * The documents a Reactor run may read: indexed, this account's, newest first.
 *
 * Read from the ledger ALONE — no provider call. This sits ahead of every run,
 * and refreshing still-indexing documents here would put a slow provider's
 * latency straight onto the run's clock for documents the run cannot use yet.
 * The Vault panel polls them to completion; a run reads what is ready.
 */
export async function readyDocuments(accountId: string | null): Promise<LongDocument[]> {
  if (!accountId || !documentsReadiness().ready) return []
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('long_documents')
      .select(COLUMNS)
      .eq('account_id', accountId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(MAX_READY_FOR_RUN)
    if (error) throw error
    return ((data ?? []) as Row[]).map(toDocument)
  } catch (err) {
    console.error('Long document lookup for the run failed:', err)
    return []
  }
}
