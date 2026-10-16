/**
 * Tenant isolation self-test — the rules a multi-tenant deployment must obey.
 *
 * This platform is sold as SaaS: many customers, one deployment, each with
 * their own website, vault, outcomes and ad account. The data model was built
 * for that — a `builders` table and a `builder_id` column with indexes across
 * eight tables — but the application on top of it was not. Every check here
 * failed when it was written, and each one is a way one customer could read or
 * overwrite another's data:
 *
 *   · the tenant arrived in the REQUEST BODY (`const { builderId } =
 *     await request.json()`), so the client declared who it was and the server
 *     believed it;
 *   · the session carried a name and no account, so there was nothing to check
 *     that claim against;
 *   · the website scan wrote chunks with no tenant at all, and
 *     `match_knowledge` returns rows where `builder_id is null` to EVERY
 *     tenant — so one customer's brand intelligence was retrievable by all;
 *   · `getConnectedWebsite()` returned "the most recently scanned domain",
 *     deployment-wide, so customer 2 connecting their site changed customer 1's
 *     brand;
 *   · the resolved tenant was cached in module memory for 60 seconds, shared
 *     by every request that instance served;
 *   · `platform_settings` was keyed by `key` alone, so the logo, the Meta token
 *     and the curated sources were one shared set.
 *
 * These are structural assertions, deliberately: they hold with no database
 * configured, so the rules are enforced in CI rather than only observable once
 * two real customers exist. The live two-account read/write test runs when
 * Supabase is configured and skips (loudly) when it is not.
 *
 * Run: npx tsx scripts/tenant-isolation-selftest.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failures++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      \x1b[2m${detail}\x1b[0m` : ''}`)
  }
}

/** Every .ts/.tsx file under a directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Source with comments stripped.
 *
 * Used for every scan. Three separate checks here failed on a comment that
 * documented the very bug being fixed — a test that cannot tell an explanation
 * from a statement punishes writing down why the code looks the way it does.
 */
function sql(file: string): string {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
}

function code(file: string): string {
  return readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

const root = process.cwd()
const apiFiles = walk(join(root, 'app', 'api'))
const libFiles = walk(join(root, 'lib'))

async function main() {
  console.log('\nThe tenant is established by the server, never claimed by the client')

  /* The single most dangerous line in a multi-tenant app is a tenant id read
     out of a request the tenant itself sent. It is not authentication, it is a
     suggestion — and every scoped query built on it is scoped to whatever the
     caller typed. */
  const bodyTenant: string[] = []
  for (const f of apiFiles) {
    const src = code(f)
    // `builderId` (or accountId/tenantId) pulled out of the parsed request body.
    if (
      /(?:const|let)\s*\{[^}]*\b(?:builderId|accountId|tenantId)\b[^}]*\}\s*=\s*(?:await\s*)?(?:request|req)\.json\(\)/.test(
        src,
      ) ||
      /\bbody\.(?:builderId|accountId|tenantId|builder_id|account_id)\b/.test(src) ||
      // A multipart form or a query string is the same suggestion in another
      // envelope — the faces upload read its tenant from `form.get('builderId')`.
      /\.get\(\s*['"](?:builderId|accountId|tenantId|builder_id|account_id|builderScope)['"]\s*\)/.test(src)
    ) {
      bodyTenant.push(f.replace(`${root}/`, ''))
    }
  }
  check(
    'no API route takes its tenant from the request body',
    bodyTenant.length === 0,
    bodyTenant.length ? `client-declared tenant in: ${bodyTenant.join(', ')}` : '',
  )

  const authSrc = code(join(root, 'lib', 'auth.ts'))
  check(
    'the session carries the account it belongs to',
    /accountId/.test(authSrc),
    'lib/auth.ts issues a session with a name and no account, so a tenant claim cannot be verified against anything',
  )

  const hasAccountModule = (() => {
    try {
      readFileSync(join(root, 'lib', 'account.ts'), 'utf-8')
      return true
    } catch {
      return false
    }
  })()
  check(
    'there is one server-side resolver for "which account is this request"',
    hasAccountModule,
    'expected lib/account.ts — the single place the tenant is resolved, from the session',
  )

  // A deployment handed to ONE brand gets an account without provisioning one:
  // a signed-in session with no account resolves the operator account so the
  // first thing anybody does — connect a website — works. That convenience must
  // stay welded to "this deployment has no customers". The moment a user row
  // exists it is a shared deployment, and a session that names no account must
  // get no account.
  const accountSrc = hasAccountModule ? code(join(root, 'lib', 'account.ts')) : ''
  check(
    'the single-brand fallback is gated on the deployment having no users',
    /hasUsers\(\)\)\s*\?\s*null\s*:\s*(await\s+)?resolveOperatorAccount/.test(accountSrc),
    'lib/account.ts hands out the operator account without checking hasUsers() — on a deployment with real customers, a session that names no tenant would be given one',
  )
  check(
    'an unauthenticated request still resolves no account',
    /if\s*\(!session\)\s*return null/.test(accountSrc),
    'lib/account.ts resolves an account for a request carrying no session at all',
  )

  console.log('\nNo tenant data is written or read without an account')

  const knowledgeSrc = code(join(root, 'lib', 'knowledge.ts'))
  check(
    'an ingest with no account is refused rather than written as global',
    /accountId|requireAccount/.test(knowledgeSrc) &&
      !/builder_id:\s*input\.builderId\s*\?\?\s*null/.test(knowledgeSrc),
    'lib/knowledge.ts writes `builder_id: input.builderId ?? null` — an unscoped write becomes a row every tenant can retrieve',
  )

  const websiteSrc = code(join(root, 'lib', 'website-intelligence.ts'))
  check(
    'the website scan stores its intelligence against an account',
    /accountId|builderId|builder_id/.test(websiteSrc),
    'lib/website-intelligence.ts has no tenant reference at all — every scan writes global rows',
  )
  check(
    'the connected website is resolved per account, not per deployment',
    !/most recently scanned domain/i.test(websiteSrc),
    'getConnectedWebsite() returns the most recently scanned domain for the whole deployment',
  )
  check(
    'a scan with no account is held, not written unscoped',
    /persistConfigured\(\)\s*&&\s*accountId/.test(websiteSrc),
    'the scan ingests without first establishing an account — the rows land with no tenant on them',
  )

  const reactorSql = sql(join(root, 'supabase', 'schema.reactor.sql'))
  check(
    'the retrieval function cannot return one tenant\'s rows to another',
    !/or\s+kc\.builder_id\s+is\s+null/i.test(reactorSql),
    "match_knowledge() matches `or kc.builder_id is null`, so any row written without a tenant is returned to every tenant",
  )

  console.log('\nNothing tenant-shaped is cached or keyed globally')

  const tenantSrc = code(join(root, 'lib', 'tenant.ts'))
  check(
    'the resolved tenant is not held in module memory across requests',
    !/^let cached/m.test(tenantSrc),
    'lib/tenant.ts caches one profile in module scope — a serverless instance serves it to whichever customer lands there next',
  )

  const settingsSql = sql(join(root, 'supabase', 'schema.settings.sql'))
  check(
    'settings are keyed per account',
    /account_id|builder_id/.test(settingsSql),
    'platform_settings is `key text primary key` — the logo, the Meta token and the curated sources are one shared set across every customer',
  )

  const metaCreds = libFiles.find((f) => f.endsWith('meta-credentials.ts'))
  if (metaCreds) {
    const src = code(metaCreds)
    /* `accountId` in this module means the META AD ACCOUNT, not the tenant —
       matching on the bare word passed this check while the credentials were
       still one shared env pair. The question is whether the RESOLVER is given
       a tenant, so that is what is asked. */
    check(
      'ad-account credentials are resolved for a given tenant',
      /function\s+\w*[Cc]redentials\s*\([^)]*\b(?:tenant|account|builder)\w*\s*:/.test(src),
      'Meta credentials resolve from one stored setting and one env pair — every customer publishes into the same ad account',
    )
  }

  console.log('\nEvery table the code queries actually exists')

  /* `schema.tenancy.sql` renames `builders` to `accounts`. Three queries in
     lib/supabase.ts still named the old table after that migration was written,
     so `getBuilder` — and the brand memory that depends on it — would have
     failed the moment the migration ran. A rename is invisible to the compiler
     and invisible to every test that does not touch a database, which is
     exactly why it needs asserting here. */
  // `exec` loops rather than `matchAll`: the project targets ES5 lib semantics
  // for iterables, and iterating a matchAll result needs downlevelIteration.
  const eachMatch = (re: RegExp, text: string, fn: (m: RegExpExecArray) => void) => {
    const r = new RegExp(re.source, re.flags)
    let m: RegExpExecArray | null
    while ((m = r.exec(text)) !== null) fn(m)
  }

  const declared = new Set<string>()
  for (const f of readdirSync(join(root, 'supabase')).filter((f) => f.endsWith('.sql'))) {
    const src = sql(join(root, 'supabase', f))
    eachMatch(/create table (?:if not exists )?([a-z_]+)/gi, src, (m) => declared.add(m[1]))
    eachMatch(/alter table ([a-z_]+) rename to ([a-z_]+)/gi, src, (m) => {
      declared.add(m[2])
      declared.delete(m[1])
    })
  }

  const queried = new Map<string, string[]>()
  for (const f of [...libFiles, ...apiFiles]) {
    eachMatch(/\.from\('([a-z_]+)'\)/g, code(f), (m) => {
      queried.set(m[1], [...(queried.get(m[1]) ?? []), f.replace(`${root}/`, '')])
    })
  }
  const missing = Array.from(queried.keys()).filter((t) => !declared.has(t))
  check(
    'no query names a table the schema does not define',
    missing.length === 0,
    missing.map((t) => `${t} (in ${queried.get(t)?.join(', ')})`).join(' · '),
  )

  console.log('\nEvery query against a tenant table names the account it reads')

  /* The audit that wrote this section found the same bug in a dozen places:
     a query against a tenant table with no account in it. The Vault listed
     every brand's chunks, ORACLE's memory and the learnings rubric read every
     brand's outcomes, the Reactor's "best banked design" could be another
     brand's winning ad, the Research page summarised everyone's research, and
     a delete or update by id touched whatever row the id named.

     So the rule is structural and general rather than one check per bug: each
     query chain against a tenant table must carry the account in the chain
     itself — `.eq('builder_id', …)` / `.eq('account_id', …)`, or the tenant
     key written in an insert's own row. A predicate somewhere else in the
     function does not count; that is exactly how the second query in a
     function goes unscoped while the first one passes review. */
  const TENANT_TABLES = [
    'knowledge_chunks',
    'campaign_outcomes',
    'faces',
    'frameworks',
    'creative_outputs',
    'media_generations',
    'long_documents',
    'platform_settings',
  ]
  const PREDICATE =
    /\.(?:eq|in|match)\(\s*['"](?:builder_id|account_id)['"]|\b(?:builder_id|account_id)\s*:|\.or\(\s*[`'"][^`'"]*\b(?:builder_id|account_id)\.|\.is\(\s*['"]builder_id['"]\s*,\s*null\s*\)/

  /* Queries that touch a tenant table and read no tenant rows at all. Each is
     pinned to the one shape that makes it safe, so a later edit that turns it
     into a real read fails here. */
  const ROWLESS_PROBES: Record<string, RegExp> = {
    // Selects a COLUMN with head:true to learn whether a migration ran.
    'app/api/health/route.ts': /\.select\(\s*'is_global'\s*,\s*\{\s*head:\s*true\s*\}\s*\)/,
  }

  /* Inserts whose row is built (and typed) before the query rather than
     written inline. Each one is named with the reason it is safe, and each
     reason is asserted below rather than taken on trust. */
  const TYPED_ROW_INSERTS: Record<string, { why: string; proof: RegExp }> = {
    'lib/knowledge.ts': {
      why: 'rows are built with builder_id from the resolved account, and an ingest with no account is refused before this',
      proof: /builder_id:\s*accountId[\s\S]*\.insert\(rows\)/,
    },
    'lib/video/persistence.ts': {
      why: 'MediaGenerationInsert carries builder_id, set by every caller from the session',
      proof: /interface MediaGenerationInsert\s*\{[^}]*builder_id/,
    },
    'lib/supabase.ts': {
      why: 'CreativeOutputInsert carries builder_id; its one route sets it from requireAccount()',
      proof: /interface CreativeOutputInsert\s*\{[^}]*builder_id/,
    },
  }

  /** The query chain starting at a `.from(` — bracket-aware, through every `.method()` line. */
  const chainAt = (src: string, at: number): string => {
    let i = at
    let depth = 0
    for (; i < src.length; i += 1) {
      const ch = src[i]
      if (ch === '(' || ch === '[' || ch === '{') depth += 1
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1
        if (depth < 0) break
      } else if (ch === ';' && depth === 0) break
      else if (ch === '\n' && depth === 0) {
        const next = /^\s*(\S)/.exec(src.slice(i + 1))
        if (!next || next[1] !== '.') break
      }
    }
    let chain = src.slice(at, i)
    /* `let sel = admin.from(…)` followed by `sel = sel.eq(…)`, or a `base`
       finished later as `base.or(…)`: the predicate can legitimately arrive
       on a later line of the same build. */
    const head = src.slice(Math.max(0, at - 160), at)
    const assigned = /(?:let|const)\s+(\w+)\s*=\s*[\w.()]*\s*$/.exec(head.replace(/\s+$/, ''))
    if (assigned) {
      const v = assigned[1]
      const later = src.slice(i, i + 1500)
      const extend = new RegExp(`\\b${v}(?:\\s*=\\s*${v})?\\.[a-z]\\w*\\([^\\n]*`, 'g')
      let m: RegExpExecArray | null
      while ((m = extend.exec(later)) !== null) chain += `\n${m[0]}`
    }
    return chain
  }

  const unscoped: string[] = []
  const typedInsertProblems: string[] = []
  for (const f of [...libFiles, ...apiFiles]) {
    const rel = f.replace(`${root}/`, '')
    const src = code(f)
    eachMatch(/\.from\(\s*'([a-z_]+)'\s*\)/g, src, (m) => {
      if (!TENANT_TABLES.includes(m[1])) return
      const chain = chainAt(src, m.index)
      if (PREDICATE.test(chain)) return
      if (ROWLESS_PROBES[rel]?.test(chain)) return
      const insertsTypedRow = /\.(?:insert|upsert)\(\s*\[?\s*[a-zA-Z_]\w*\s*\]?\s*[,)]/.test(chain)
      const allowed = TYPED_ROW_INSERTS[rel]
      if (insertsTypedRow && allowed) {
        if (!allowed.proof.test(src)) typedInsertProblems.push(`${rel} (${allowed.why})`)
        return
      }
      const line = src.slice(0, m.index).split('\n').length
      unscoped.push(`${rel}:${line} ${m[1]}`)
    })
  }
  check(
    'every query against a tenant table carries the account in the query itself',
    unscoped.length === 0,
    unscoped.length ? `no account predicate: ${unscoped.join(' · ')}` : '',
  )
  check(
    'every typed-row insert still writes the account it claims to',
    typedInsertProblems.length === 0,
    typedInsertProblems.join(' · '),
  )

  /* The retrieval functions take the account as `filter_builder`. A literal
     null is the global-only scope — right for a deployment probe, wrong for
     anything a brand reads, and it is how the Vault's semantic browse never
     found a brand's own uploads. `knowledge_stats()` takes no scope at all. */
  const nullScopedRpc: string[] = []
  for (const f of [...libFiles, ...apiFiles]) {
    const rel = f.replace(`${root}/`, '')
    const src = code(f)
    eachMatch(/\.rpc\(\s*'([a-z_]+)'/g, src, (m) => {
      const call = chainAt(src, m.index)
      if (m[1] === 'knowledge_stats') {
        nullScopedRpc.push(`${rel}: knowledge_stats() is unscoped — use knowledge_stats_scoped`)
        return
      }
      if (!/^match_knowledge/.test(m[1])) return
      if (/probeHybridSearch/.test(src.slice(Math.max(0, m.index - 1200), m.index)) && /filter_builder:\s*null/.test(call)) {
        return // the health probe: global scope by design, reads no account's rows
      }
      // A literal null is the bug. A spread scope object (`...scope`) is how
      // the shared search passes the caller's account, which every caller now
      // supplies — so it is accepted only where that object names filter_builder.
      const spreadsScope = /\.\.\.(\w+)/.exec(call)
      const scopeObject = spreadsScope
        ? new RegExp(`const\\s+${spreadsScope[1]}\\s*=\\s*\\{[^}]*filter_builder:\\s*(?!null)`).test(src)
        : false
      if (/filter_builder:\s*null/.test(call) || (!/filter_builder:/.test(call) && !scopeObject)) {
        nullScopedRpc.push(`${rel}: ${m[1]} without an account`)
      }
    })
  }
  check(
    'no retrieval call passes a null account outside the health probe',
    nullScopedRpc.length === 0,
    nullScopedRpc.join(' · '),
  )

  /* Accounts are provisioned and resolved in one module. A route that lists
     them is a directory of every customer — /api/builders was exactly that,
     unauthenticated, and could also create accounts. */
  const accountReaders: string[] = []
  for (const f of [...libFiles, ...apiFiles]) {
    const rel = f.replace(`${root}/`, '')
    if (['lib/account.ts', 'lib/tenancy-mode.ts', 'lib/supabase.ts'].includes(rel)) continue
    if (/\.from\(\s*'(?:accounts|users)'\s*\)/.test(code(f))) accountReaders.push(rel)
  }
  check(
    'accounts and users are only read where tenancy is resolved',
    accountReaders.length === 0,
    accountReaders.join(' · '),
  )
  const supabaseSrc = code(join(root, 'lib', 'supabase.ts'))
  const accountListings: string[] = []
  eachMatch(/\.from\(\s*'accounts'\s*\)/g, supabaseSrc, (m) => {
    const chain = chainAt(supabaseSrc, m.index)
    // Reading one account by id is resolution; anything else is a listing.
    if (/\.select\(/.test(chain) && !/\.eq\(\s*'id'/.test(chain)) {
      accountListings.push(`lib/supabase.ts:${supabaseSrc.slice(0, m.index).split('\n').length}`)
    }
  })
  check(
    'no helper lists every account on the deployment',
    accountListings.length === 0 && !/function\s+listBuilders\b/.test(supabaseSrc),
    `an accounts query with no id filter — a directory of every customer: ${accountListings.join(' · ')}`,
  )

  console.log('\nDeployment-wide credentials never act for a brand on a shared deployment')

  /* The env Meta token is the OWNER'S ad account. On a single-brand install it
     is that brand's, and the fallback is a convenience. Once a second brand
     exists it is somebody else's account, and a brand that has not connected
     its own must be told to connect — not shown, and not uploaded into, the
     owner's. */
  const credsSrc = metaCreds ? code(metaCreds) : ''
  const resolverBody = /async function resolveMetaCredentials[\s\S]*?\n\}/.exec(credsSrc)?.[0] ?? ''
  check(
    'the Meta env token answers only where deployment credentials may act',
    /META_ACCESS_TOKEN/.test(resolverBody) && /deploymentCredentialsAllowed\(\)/.test(resolverBody),
    'resolveMetaCredentials falls back to META_ACCESS_TOKEN without asking lib/tenancy-mode.ts — every unconnected brand reads the owner\'s ad account',
  )
  const modeSrc = (() => {
    try {
      return code(join(root, 'lib', 'tenancy-mode.ts'))
    } catch {
      return ''
    }
  })()
  check(
    'a deployment with brand logins is multi-tenant whether or not the flag is set',
    /PLATFORM_MULTI_TENANT/.test(modeSrc) && /hasUsers\(\)/.test(modeSrc) && /!\(await isMultiTenant\(\)\)/.test(modeSrc),
    'lib/tenancy-mode.ts must treat existing user rows as multi-tenant, not only the env flag',
  )
  const graphSrc = code(join(root, 'lib', 'meta-graph.ts'))
  check(
    'the Graph client never defaults to the deployment token',
    /function graphGet\([^)]*token:\s*string\s*,?\s*\)/.test(graphSrc) &&
      !/process\.env\.META_ACCESS_TOKEN/.test(graphSrc),
    'graphGet falls back to META_ACCESS_TOKEN when a caller omits the token — the owner\'s account becomes the silent default',
  )
  const envTokenReaders: string[] = []
  const ENV_TOKEN_ALLOWED: Record<string, string> = {
    'lib/operator/adapters/meta-credentials.ts': 'the one resolver, gated above',
    'app/api/health/route.ts': 'reports presence as a boolean, never the value',
    'app/api/ad-library/search/route.ts': 'queries the PUBLIC ads archive — no account data',
  }
  for (const f of [...libFiles, ...apiFiles]) {
    const rel = f.replace(`${root}/`, '')
    if (ENV_TOKEN_ALLOWED[rel]) continue
    if (/process\.env\.META_ACCESS_TOKEN/.test(code(f))) envTokenReaders.push(rel)
  }
  check(
    'nothing else reads the env Meta token directly',
    envTokenReaders.length === 0,
    envTokenReaders.join(' · '),
  )
  const reactorSrc = code(join(root, 'app', 'api', 'campaign-reactor', 'route.ts'))
  const mcpResolver = /async function metaAdsServer[\s\S]*?\n\}/.exec(reactorSrc)?.[0] ?? ''
  check(
    'the Meta Ads MCP (owner\'s token) is attached only on a single-brand deployment',
    /deploymentCredentialsAllowed\(\)/.test(mcpResolver),
    'metaAdsServer attaches PIPEBOARD_API_TOKEN / META_ADS_ACCESS_TOKEN to every brand\'s run — OPUS could read the owner\'s campaigns into another brand\'s concepts',
  )
  const connectionRoute = code(join(root, 'app', 'api', 'operator', 'meta-connection', 'route.ts'))
  check(
    'a brand\'s Meta settings screen is never told about the owner\'s env token',
    /envFallbackAvailable\(\)/.test(connectionRoute) && !/process\.env\.META_ACCESS_TOKEN/.test(connectionRoute),
    'the connection route reports the env token (and its ad account id) to every brand',
  )

  console.log('\nProvider keys only travel to the provider')

  /* fal's response_url round-trips through the browser and every request to it
     carries `Authorization: Key <FAL_KEY>`. Followed unchecked, any caller
     could name a host and receive the deployment's key. */
  const falSrc = code(join(root, 'lib', 'video', 'fal.ts'))
  check(
    'a caller-supplied fal response URL is followed only on fal\'s own host',
    /function resultUrlFor[\s\S]*?isFalQueueUrl\(responseUrl\)/.test(falSrc),
    'lib/video/fal.ts sends FAL_KEY to whatever responseUrl the poll request names',
  )
  const downloadSrc = code(join(root, 'app', 'api', 'image', 'download', 'route.ts'))
  check(
    'the image download proxy re-checks every redirect hop',
    /safeFetch\(/.test(downloadSrc) && !/\bawait fetch\(/.test(downloadSrc),
    'app/api/image/download fetches with redirects followed blindly — a public URL can bounce it inward',
  )

  console.log('\nRow-level security is the backstop, not the plan')

  /* A policy is not automatically protection. The only one in the schema is
     `Allow anon read access` on creative_outputs — a blanket grant, which this
     check counted as evidence of isolation until it was made to read what the
     policy actually says. A policy that isolates has to reference the tenant
     column; one that grants the anon role a read over a whole table is the
     leak itself. */
  const sqlFiles = readdirSync(join(root, 'supabase')).filter((f) => f.endsWith('.sql'))
  const openPolicies: string[] = []
  let scopedPolicies = 0
  for (const f of sqlFiles) {
    // Strip `--` comments first. A schema file that DOCUMENTS the dangerous
    // policy it removed still contains the words, and a check that cannot tell
    // an explanation from a statement fails on the fix.
    const src = sql(join(root, 'supabase', f))
    const policies = src.match(/create policy[\s\S]*?;/gi) ?? []
    for (const p of policies) {
      if (/\b(?:account_id|builder_id|tenant_id)\b/.test(p)) scopedPolicies += 1
      else if (/\bto\s+anon\b|using\s*\(\s*true\s*\)/i.test(p)) openPolicies.push(`${f}: ${p.split('\n')[0]}`)
    }
  }
  check(
    'no policy grants a blanket read across tenants',
    openPolicies.length === 0,
    openPolicies.join(' · '),
  )
  /* Deliberately NOT "every tenant table has a scoped policy". The app connects
     with the service-role key, which bypasses RLS by design, so a scoped policy
     would not be the thing separating customers — the account resolved from the
     session is. What RLS must do here is stop the ANON key, which ships to the
     browser, from reading tenant tables at all. Asserting a policy the runtime
     never exercises would be theatre; this asserts the protection that is
     actually in force. */
  const tenancySql = (() => {
    try {
      return readFileSync(join(root, 'supabase', 'schema.tenancy.sql'), 'utf-8')
    } catch {
      return ''
    }
  })()
  check(
    'row-level security is enabled on the tenant tables',
    /enable row level security/i.test(tenancySql) && /knowledge_chunks/.test(tenancySql),
    'nothing enables RLS across the tenant tables — the public anon key can read them',
  )
  void scopedPolicies

  console.log(
    failures === 0
      ? '\n\x1b[32mTenant isolation holds.\x1b[0m\n'
      : `\n\x1b[31m${failures} isolation rule(s) BROKEN — one customer can reach another's data.\x1b[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
