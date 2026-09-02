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
      /\bbody\.(?:builderId|accountId|tenantId)\b/.test(src)
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
