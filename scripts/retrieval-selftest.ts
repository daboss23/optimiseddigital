/**
 * Retrieval self-test — guards hybrid search, reranking and long documents.
 *
 * Runs entirely in process. No Voyage key, no PageIndex key, no Supabase
 * project: the network is stubbed, and the SQL runs against a real Postgres
 * with pgvector compiled to WebAssembly (PGlite), so the migration is proven
 * by executing it rather than by reading it.
 *
 * What it locks down:
 *   - the migration runs, re-runs, and leaves an HNSW index and a full-text
 *     index behind
 *   - hybrid search finds an exact phrase vector search misses, and its tenant
 *     scope is IDENTICAL to match_knowledge: one account never sees another's
 *     rows, an unscoped row is seen by nobody, and a null account sees global
 *     rows only
 *   - the reranker reads the documented REST shape, drops malformed rows
 *     rather than guessing, and degrades to the fused order on a missing key,
 *     an error status or a timeout — it can reorder results, never lose them
 *   - long documents: a file is validated before a byte leaves the deployment,
 *     every ledger query is scoped to the session's account, the provider id is
 *     never taken from a request, and nothing throws when PageIndex is not set
 *   - the PageIndex SDK still exposes the four calls this code depends on, so
 *     a version bump that renames one fails here and not in production
 *
 * Run: npx tsx scripts/retrieval-selftest.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { PageIndexApi, PageIndexError } from '@pageindex/sdk'
import { parseRerankResponse, rerank, rerankConfigured, rerankItems, rerankModel } from '@/lib/rerank'
import { describePageIndexError, normaliseStatus } from '@/lib/documents/pageindex'
import { MAX_PDF_BYTES, askDocument, documentsReadiness, uploadDocument, validatePdf } from '@/lib/documents'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failures++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const root = process.cwd()
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf-8')

/** Every .ts file under a directory, recursively. */
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/* ----------------------------- network stubbing ---------------------------- */

const realFetch = globalThis.fetch
type Handler = (url: string, init?: RequestInit) => Promise<Response>
function stubFetch(handler: Handler) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input instanceof Request ? input.url : input), init)) as typeof fetch
}
function restoreFetch() {
  globalThis.fetch = realFetch
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  return fn().finally(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
}

/* ---------------------------------- SQL ------------------------------------ */

async function sqlSuite() {
  console.log('\nThe migration, executed against Postgres + pgvector')

  const db = new PGlite({ extensions: { vector } })
  const exec = async (label: string, sql: string): Promise<boolean> => {
    try {
      await db.exec(sql)
      return true
    } catch (err) {
      check(label, false, err instanceof Error ? err.message : String(err))
      return false
    }
  }

  // Supabase ships these roles; plain Postgres does not, and the schema grants to them.
  await exec('supabase roles', 'create role service_role; create role anon; create role authenticated;')
  await exec('stub accounts', 'create table accounts (id uuid primary key default gen_random_uuid(), name text);')
  const reactorOk = await exec('schema.reactor.sql runs', read('supabase', 'schema.reactor.sql'))
  // An existing deployment carries the old IVFFlat index; the migration must remove it.
  await exec(
    'legacy ivfflat index',
    'create index if not exists knowledge_chunks_embedding_idx on knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 1);',
  )
  const firstRun = await exec('schema.retrieval.sql runs', read('supabase', 'schema.retrieval.sql'))
  const secondRun = await exec('schema.retrieval.sql re-runs', read('supabase', 'schema.retrieval.sql'))
  const docsRun = await exec('schema.documents.sql runs', read('supabase', 'schema.documents.sql'))
  check('every schema file executes, and the migration is safe to re-run', reactorOk && firstRun && secondRun && docsRun)

  const indexes = (
    await db.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where tablename = 'knowledge_chunks'",
    )
  ).rows
  check(
    'the vector index is HNSW',
    indexes.some((i) => /using hnsw/i.test(i.indexdef)),
    indexes.map((i) => i.indexname).join(', '),
  )
  check(
    'the legacy IVFFlat index is gone',
    !indexes.some((i) => /using ivfflat/i.test(i.indexdef)),
    indexes.map((i) => i.indexname).join(', '),
  )
  check('the full-text column is indexed', indexes.some((i) => /using gin/i.test(i.indexdef)))

  const unit = (i: number) => {
    const v = new Array<number>(1024).fill(0)
    v[i] = 1
    return `[${v.join(',')}]`
  }
  const A = '11111111-1111-1111-1111-111111111111'
  const B = '22222222-2222-2222-2222-222222222222'
  await exec(
    'seed rows',
    `insert into knowledge_chunks (builder_id, is_global, system, title, content, embedding) values
      ('${A}', false, 'vault', 'Free Audit Offer', 'Our free audit converts cold traffic.', '${unit(5)}'),
      ('${A}', false, 'vault', 'Near neighbour', 'Semantically close to the query.', '${unit(0)}'),
      ('${B}', false, 'vault', 'Other account free audit', 'Free audit belonging to account B.', '${unit(0)}'),
      (null, true, 'vault', 'Global craft', 'Hook construction principles.', '${unit(1)}'),
      (null, false, 'vault', 'Orphan free audit', 'An unscoped row nobody should see.', '${unit(0)}');`,
  )

  const hybrid = async (account: string | null, text: string) =>
    (
      await db.query<{ title: string; similarity: number }>(
        'select title, similarity from match_knowledge_hybrid($1::vector, $2, 10, null, $3::uuid)',
        [unit(0), text, account],
      )
    ).rows.map((r) => r.title)
  const vectorOnly = async (account: string | null) =>
    (
      await db.query<{ title: string }>('select title from match_knowledge($1::vector, 10, null, $2::uuid)', [
        unit(0),
        account,
      ])
    ).rows.map((r) => r.title)

  const a = await hybrid(A, 'free audit')
  check(
    'hybrid finds the exact phrase that vector search alone ranks last',
    a[0] === 'Free Audit Offer',
    a.join(' · '),
  )
  check('an account never sees another account’s rows', !a.some((t) => /Other account/.test(t)), a.join(' · '))
  check('an unscoped row is seen by nobody', !a.some((t) => /Orphan/.test(t)) && !(await hybrid(B, 'free audit')).some((t) => /Orphan/.test(t)))
  const none = await hybrid(null, 'free audit')
  check('a null account sees global rows only', none.length > 0 && none.every((t) => t === 'Global craft'), none.join(' · '))
  const v = await vectorOnly(A)
  check(
    'hybrid and match_knowledge return the same SET of rows for an account',
    JSON.stringify([...v].sort()) === JSON.stringify([...(await hybrid(A, ''))].sort()),
    `vector: ${v.join(' · ')}`,
  )
  check('an empty query text still searches semantically', (await hybrid(A, '')).length > 0)
  let hostileOk = true
  try {
    await hybrid(A, `"unbalanced -- ' ; drop table knowledge_chunks`)
  } catch {
    hostileOk = false
  }
  check('hostile query text is parsed as a search, never as SQL', hostileOk)

  // The tenant predicate is copied from match_knowledge, not re-derived. Compare
  // the text so a future edit to one function cannot quietly diverge the other.
  const norm = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
  const predicate = norm(
    '( kc.is_global or (filter_builder is not null and kc.builder_id = filter_builder) )',
  )
  const retrievalSql = norm(read('supabase', 'schema.retrieval.sql'))
  const occurrences = retrievalSql.split(predicate).length - 1
  check(
    'both branches of the hybrid search carry match_knowledge’s tenant predicate verbatim',
    occurrences === 2 && norm(read('supabase', 'schema.tenancy.sql')).includes(predicate),
    `found ${occurrences} occurrence(s)`,
  )

  await db.close()
}

/* -------------------------------- reranker -------------------------------- */

async function rerankSuite() {
  console.log('\nThe reranker reads the documented shape and never loses a result')

  const documented = {
    object: 'list',
    data: [
      { relevance_score: 0.455078125, index: 0 },
      { relevance_score: 0.91, index: 2 },
      { relevance_score: 0.439453125, index: 1 },
    ],
    model: 'rerank-2.5',
    usage: { total_tokens: 8 },
  }
  const parsed = parseRerankResponse(documented, 3)
  check(
    'the REST `data` shape parses, most relevant first',
    parsed.map((p) => p.index).join(',') === '2,0,1',
    JSON.stringify(parsed),
  )
  check(
    'the client-library `results` shape parses too',
    parseRerankResponse({ results: documented.data }, 3).length === 3,
  )
  const malformed = parseRerankResponse(
    {
      data: [
        { index: 7, relevance_score: 0.99 },
        { index: 0, relevance_score: 'high' },
        { index: 1, relevance_score: 0.5 },
        { index: 1, relevance_score: 0.4 },
        { index: -1, relevance_score: 0.9 },
      ],
    },
    3,
  )
  check(
    'out-of-range, non-numeric and duplicate rows are dropped, not guessed at',
    malformed.length === 1 && malformed[0].index === 1 && malformed[0].relevanceScore === 0.5,
    JSON.stringify(malformed),
  )
  check('garbage parses to nothing', parseRerankResponse('nope', 3).length === 0 && parseRerankResponse(null, 3).length === 0)

  await withEnv({ VOYAGE_API_KEY: undefined, VOYAGE_RERANK_MODEL: undefined }, async () => {
    check('no key → not configured', !rerankConfigured())
    check('no key → rerank returns null without a network call', (await rerank('q', ['a', 'b'], 2)) === null)
  })
  await withEnv({ VOYAGE_API_KEY: 'k', VOYAGE_RERANK_MODEL: 'off' }, async () => {
    check('VOYAGE_RERANK_MODEL=off disables it', !rerankConfigured() && rerankModel() === null)
  })
  await withEnv({ VOYAGE_API_KEY: 'k', VOYAGE_RERANK_MODEL: undefined }, async () => {
    check('the default model is the documented recommendation', rerankModel() === 'rerank-2.5')

    let sent: { url: string; body: Record<string, unknown> } | null = null
    stubFetch(async (url, init) => {
      sent = { url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> }
      return json({ data: [{ index: 1, relevance_score: 0.8 }, { index: 0, relevance_score: 0.2 }] })
    })
    const items = [
      { title: 'first', relevance: undefined as number | undefined },
      { title: 'second', relevance: undefined as number | undefined },
    ]
    const out = await rerankItems('the query', items, 2, (i) => i.title)
    restoreFetch()
    const request = sent as { url: string; body: Record<string, unknown> } | null
    check(
      'it calls /v1/rerank with query, documents, model and top_k',
      request?.url === 'https://api.voyageai.com/v1/rerank' &&
        request.body.query === 'the query' &&
        Array.isArray(request.body.documents) &&
        request.body.model === 'rerank-2.5' &&
        request.body.top_k === 2,
      JSON.stringify(request),
    )
    check(
      'results are reordered and carry the relevance score',
      out.reranked && out.items[0].title === 'second' && out.items[0].relevance === 0.8,
      JSON.stringify(out),
    )

    stubFetch(async () => json({ data: [{ index: 2, relevance_score: 0.9 }] }))
    const partial = await rerankItems(
      'q',
      [{ title: 'a' }, { title: 'b' }, { title: 'c' }] as Array<{ title: string; relevance?: number }>,
      3,
      (i) => i.title,
    )
    restoreFetch()
    check(
      'a partial response reorders but never shrinks the result',
      partial.items.map((i) => i.title).join(',') === 'c,a,b',
      partial.items.map((i) => i.title).join(','),
    )

    stubFetch(async () => new Response('upstream down', { status: 503 }))
    const failed = await rerankItems('q', [{ title: 'a' }, { title: 'b' }] as Array<{ title: string; relevance?: number }>, 2, (i) => i.title)
    restoreFetch()
    check(
      'an error status keeps the fused order',
      !failed.reranked && failed.items.map((i) => i.title).join(',') === 'a,b',
    )
  })

  await withEnv({ VOYAGE_API_KEY: 'k', VOYAGE_RERANK_TIMEOUT_MS: '50' }, async () => {
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const started = Date.now()
    const slow = await rerank('q', ['a', 'b'], 2)
    restoreFetch()
    check('a slow reranker is abandoned at its timeout', slow === null && Date.now() - started < 2000)
  })
}

/* ------------------------------ long documents ----------------------------- */

async function documentsSuite() {
  console.log('\nLong documents are validated, scoped and honest')

  const pdf = (body = 'rest of file') => new TextEncoder().encode(`%PDF-1.7\n${body}`).buffer as ArrayBuffer
  check('a valid PDF passes', validatePdf('Brand Book.pdf', pdf()) === null)
  check('a non-PDF name is refused', validatePdf('notes.docx', pdf()) !== null)
  check('an empty file is refused', validatePdf('a.pdf', new ArrayBuffer(0)) !== null)
  check(
    'a renamed non-PDF is refused by its bytes, before anything is billed',
    validatePdf('fake.pdf', new TextEncoder().encode('PK\u0003\u0004 a zip').buffer as ArrayBuffer) !== null,
  )
  check('an oversized file is refused', validatePdf('big.pdf', new ArrayBuffer(MAX_PDF_BYTES + 1)) !== null)
  check(
    'the size cap fits inside Vercel’s 4.5 MB request body',
    MAX_PDF_BYTES < 4.5 * 1024 * 1024,
  )

  check(
    'provider statuses normalise, and an unknown one reads as still processing',
    normaliseStatus('completed') === 'completed' &&
      normaliseStatus('FAILED') === 'failed' &&
      normaliseStatus('indexing') === 'processing' &&
      normaliseStatus(undefined) === 'processing',
  )
  check(
    'a provider failure becomes a sentence an operator can act on',
    /API key/.test(describePageIndexError(new PageIndexError('no', 'UNAUTHORIZED'))) &&
      /usage limit/.test(describePageIndexError(new PageIndexError('no', 'USAGE_LIMIT_REACHED'))),
  )

  await withEnv({ PAGEINDEX_API_KEY: undefined }, async () => {
    const readiness = documentsReadiness()
    check('no key → not ready, with the reason named', !readiness.ready && /PAGEINDEX_API_KEY/.test(readiness.reason ?? ''))
    const up = await uploadDocument('11111111-1111-1111-1111-111111111111', 'a.pdf', pdf())
    const ask = await askDocument('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'q')
    check('no key → upload and ask return an error result, never throw', !up.ok && !ask.ok)
  })

  // Static isolation: every read, update and delete of the ledger is scoped to
  // the account, and no route hands a provider id in from a request.
  const ledger = read('lib', 'documents', 'index.ts')
  const chains = ledger.split(".from('long_documents')").slice(1).map((c) => c.slice(0, 400))
  const unscoped = chains.filter((c) => !/\.insert\(/.test(c.slice(0, 40)) && !/\.eq\('account_id'/.test(c))
  check(
    'every long_documents read, update and delete is filtered by account_id',
    chains.length >= 4 && unscoped.length === 0,
    unscoped.map((c) => c.slice(0, 80).replace(/\s+/g, ' ')).join(' | '),
  )
  check('every long_documents insert writes the account', /\.insert\(\{\s*account_id: accountId/.test(ledger))

  const routes = tsFiles(join(root, 'app', 'api', 'vault', 'documents'))
  const routeSrc = routes.map((f) => readFileSync(f, 'utf-8'))
  check(
    'every document route resolves the account from the session',
    routeSrc.every((s) => /requireAccount\(\)|currentAccount\(\)/.test(s)),
  )
  check(
    'no document route reads a provider document id or an account from the request',
    routeSrc.every((s) => !/provider_doc_id|providerDocId|accountId\s*[:=]\s*body|body\.account/.test(s)),
  )

  const reactor = read('app', 'api', 'campaign-reactor', 'route.ts')
  check(
    'the Reactor offers read_document only for this run’s own indexed documents',
    /enum: documents\.map\(\(d\) => d\.id\)/.test(reactor) &&
      /runDocuments\.find\(\(d\) => d\.id === document_id\)/.test(reactor) &&
      /readyDocuments\(runAccount\)/.test(reactor),
  )

  const proto = PageIndexApi.prototype as unknown as Record<string, unknown>
  check(
    'the PageIndex SDK still exposes submitDocument, getDocument, chatCompletions and deleteDocument',
    ['submitDocument', 'getDocument', 'chatCompletions', 'deleteDocument'].every((m) => typeof proto[m] === 'function'),
  )
}

async function main() {
  await sqlSuite()
  await rerankSuite()
  await documentsSuite()

  console.log(
    failures === 0
      ? '\n\x1b[32mRetrieval holds: hybrid, reranked, scoped — and long documents read by structure.\x1b[0m\n'
      : `\n\x1b[31m${failures} retrieval check(s) failed.\x1b[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
