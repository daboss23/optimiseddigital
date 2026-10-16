/**
 * Platform Library self-test — `npm run selftest:library`.
 *
 * The library is the owner's method, used by every brand's agents and seen by
 * none of them. Each suite here holds one half of that sentence:
 *
 *   · SQL      — the migration runs (twice), a brand's niches decide what it
 *                retrieves, the browser roles can read nothing, and a
 *                library row can never surface through a brand's own Vault
 *                search. Executed against real Postgres + pgvector (PGlite).
 *   · Text     — Notion exports come out as clean, heading-chunked Markdown.
 *   · Zip      — exports unpack in the browser with images left out and
 *                nested zips followed.
 *   · Owner    — the gate: closed without a long password, tokens that
 *                expire, tamper, and die when the password changes.
 *   · Walls    — structural: only owner routes and the Reactor touch the
 *                library, every owner handler checks the owner first, and
 *                the Reactor's telemetry carries a count, never content.
 *
 * No network. Run: npx tsx scripts/library-selftest.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { strToU8, zipSync } from 'fflate'
import {
  MAX_CHUNK_CHARS,
  chunkSections,
  cleanTitle,
  htmlToText,
  normaliseText,
  stageText,
} from '@/lib/library/text'
import { unzipTextFiles } from '@/lib/library/unzip'
import { LIBRARY_NICHES, brandNicheKeys, cleanNiches } from '@/lib/library/niches'
import { checkOwnerPassword, createOwnerToken, ownerAccess, verifyOwnerToken, OWNER_MAX_AGE } from '@/lib/owner'
import { libraryMethodBlock } from '@/lib/library'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failures++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      \x1b[2m${detail}\x1b[0m` : ''}`)
  }
}

const root = process.cwd()
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf-8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/** Source with comments stripped — an explanation is not a statement. */
function code(file: string): string {
  return readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
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
  console.log('\nThe library migration, executed against Postgres + pgvector')
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

  await exec('supabase roles', 'create role service_role; create role anon; create role authenticated;')
  const reactor = await exec('schema.reactor.sql runs', read('supabase', 'schema.reactor.sql'))
  const lockdown = (await exec('schema.lockdown.sql runs', read('supabase', 'schema.lockdown.sql'))) &&
    (await exec('schema.lockdown.sql re-runs', read('supabase', 'schema.lockdown.sql')))
  const first = await exec('schema.library.sql runs', read('supabase', 'schema.library.sql'))
  const second = await exec('schema.library.sql re-runs', read('supabase', 'schema.library.sql'))
  check('the library and lock-down migrations execute and are safe to re-run', reactor && lockdown && first && second)

  const unit = (i: number) => {
    const v = new Array<number>(1024).fill(0)
    v[i] = 1
    return `[${v.join(',')}]`
  }
  const doc = (
    await db.query<{ id: string }>(
      `insert into library_documents (title, niches, content_hash) values ('Testing SOP', '{ecommerce}', 'h1') returning id`,
    )
  ).rows[0].id
  await db.query(
    `insert into library_chunks (document_id, ord, heading, content, niches, embedding) values
      ($1, 0, 'Testing › Budget split', 'Hold roughly a third of spend for testing new concepts.', '{ecommerce}', $2),
      ($1, 1, 'Skincare › Texture first', 'Open on the texture shot before the claim.', '{ecom:32}', $2),
      ($1, 2, 'Apparel › Fit', 'Show the fit on two body types.', '{ecom:11}', $3),
      ($1, 3, 'Services › Booking', 'Ask for the call, not the sale.', '{services}', $2),
      ($1, 4, 'Every brand › One idea', 'One idea per creative.', '{all}', $3)`,
    [doc, unit(0), unit(1)],
  )

  const search = async (niches: string[], text = 'testing') =>
    (
      await db.query<{ heading: string }>(`select heading from match_library($1::vector, $2, 10, $3::text[])`, [
        unit(0),
        text,
        niches,
      ])
    ).rows.map((r) => r.heading)

  const skincare = await search(brandNicheKeys([32]))
  check(
    'a skincare brand gets the general e-commerce, every-brand and skincare sections',
    skincare.includes('Testing › Budget split') &&
      skincare.includes('Skincare › Texture first') &&
      skincare.includes('Every brand › One idea'),
    skincare.join(' · '),
  )
  check(
    'and nothing written for another vertical or another kind of business',
    !skincare.some((h) => /Apparel|Services/.test(h)),
    skincare.join(' · '),
  )
  const unplaced = await search(brandNicheKeys([]))
  check(
    'a brand with no detected vertical still gets the general e-commerce method',
    unplaced.includes('Testing › Budget split') && !unplaced.some((h) => /Skincare|Apparel/.test(h)),
    unplaced.join(' · '),
  )
  check('an empty niche set retrieves nothing', (await search([])).length === 0)
  let hostileOk = true
  try {
    await search(['all'], `"unbalanced -- ' ; drop table library_chunks`)
  } catch {
    hostileOk = false
  }
  check('hostile query text is parsed as a search, never as SQL', hostileOk)

  // A library row must be unreachable through the brand's own retrieval —
  // they are different tables, and match_knowledge only reads its own.
  const viaVault = (
    await db.query<{ title: string }>('select title from match_knowledge($1::vector, 50, null, null)', [unit(0)])
  ).rows
  check('no library section can surface through a brand’s Vault search', viaVault.length === 0)

  const privileges = (
    await db.query<{ docs: boolean; chunks: boolean; fn: boolean; stats: boolean }>(
      `select has_table_privilege('anon', 'library_documents', 'select') as docs,
              has_table_privilege('anon', 'library_chunks', 'select') as chunks,
              has_function_privilege('anon', 'match_library(vector, text, int, text[], int)', 'execute') as fn,
              has_function_privilege('anon', 'knowledge_stats_scoped(uuid)', 'execute') as stats`,
    )
  ).rows[0]
  check(
    'the browser role can neither read the library nor call its search (or the scoped stats)',
    !privileges.docs && !privileges.chunks && !privileges.fn && !privileges.stats,
    JSON.stringify(privileges),
  )
  const rls = (
    await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname in ('library_documents', 'library_chunks')`,
    )
  ).rows
  check('row-level security is on for both library tables', rls.length === 2 && rls.every((r) => r.relrowsecurity))

  await db.exec(`delete from library_documents where id = '${doc}'`)
  const orphans = (await db.query<{ n: number }>('select count(*)::int as n from library_chunks')).rows[0].n
  check('deleting a document removes its sections with it', orphans === 0)

  // The lock-down's scoped stats: one account's rows, and nothing for no account.
  const A = '11111111-1111-1111-1111-111111111111'
  const B = '22222222-2222-2222-2222-222222222222'
  await db.query(
    `insert into knowledge_chunks (builder_id, system, category, title, content, embedding) values
      ($1, 'vault', 'SOP', 'A one', 'a', $3), ($1, 'vault', 'SOP', 'A two', 'a', $3), ($2, 'vault', 'SOP', 'B one', 'b', $3)`,
    [A, B, unit(2)],
  )
  const stats = async (account: string | null) =>
    (await db.query<{ count: number }>('select count::int from knowledge_stats_scoped($1::uuid)', [account])).rows
  const aStats = await stats(A)
  check('vault stats count one account’s rows only', aStats.length === 1 && aStats[0].count === 2, JSON.stringify(aStats))
  check('vault stats for no account count nothing', (await stats(null)).length === 0)

  await db.close()
}

/* ---------------------------------- text ----------------------------------- */

function textSuite() {
  console.log('\nNotion exports become clean, heading-chunked Markdown')

  check(
    'a Notion page id and URL-encoding are stripped from the title',
    cleanTitle('Playbooks%20Q3/Creative%20Testing%20SOP%201a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md') === 'Creative Testing SOP',
    cleanTitle('Playbooks%20Q3/Creative%20Testing%20SOP%201a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md'),
  )
  const normalised = normaliseText(
    '# Hooks\n\n![diagram](Hooks%20123/image.png)\n\nSee [the testing guide](Testing%20abc.md) first.\n\n---\n\n\n\nDone.',
  )
  check('images are dropped and links keep only their text', !/!\[|\]\(|image\.png/.test(normalised) && /See the testing guide first/.test(normalised), normalised)
  check('divider runs and blank-line runs collapse', !/^---$/m.test(normalised) && !/\n{3,}/.test(normalised))

  const html = htmlToText('<html><head><style>p{}</style></head><body><h2>Offer rules</h2><p>State it exactly.</p><ul><li>No rounding</li></ul></body></html>')
  check('an HTML export keeps its headings as Markdown headings', /^## Offer rules$/m.test(html) && /- No rounding/.test(html), html)

  const doc = [
    '# Creative Testing',
    'Intro line.',
    '## Budget split',
    'Hold a third of spend for new concepts.',
    '### Small accounts',
    'Test one concept at a time.',
    '## Decision rules',
    ('Kill a concept that spends twice the target without a sale. '.repeat(60)).trim(),
  ].join('\n\n')
  const sections = chunkSections(doc)
  const small = sections.find((s) => /one concept at a time/.test(s.content))
  check(
    'a section keeps the full heading path it sits under',
    small?.heading === 'Creative Testing › Budget split › Small accounts',
    small?.heading ?? 'missing',
  )
  const rules = sections.filter((s) => s.heading === 'Creative Testing › Decision rules')
  check(
    'a long section is split under its own heading, never across into the next',
    rules.length > 1 && rules.every((s) => s.content.length <= MAX_CHUNK_CHARS),
    rules.map((s) => s.content.length).join(', '),
  )
  check('nothing is lost between sections', sections.some((s) => s.heading === 'Creative Testing' && /Intro line/.test(s.content)))

  const staged = stageText('Untitled 0123456789abcdef0123456789abcdef.md', '# Offer Ladder\n\nState every offer exactly as configured.')
  check('a page’s own first heading becomes its title', staged?.title === 'Offer Ladder', staged?.title ?? 'null')
  check('a page with nothing to read is not staged', stageText('empty.md', '# Title\n\n') === null)
}

/* ----------------------------------- zip ----------------------------------- */

function zipSuite() {
  console.log('\nExports unpack in the browser — text kept, images left out')
  const inner = zipSync({ 'Inner Page 0123456789abcdef0123456789abcdef.md': strToU8('# Inner\n\nNested export page with enough text to keep.') })
  const outer = zipSync({
    'Workspace/Testing SOP 0123456789abcdef0123456789abcdef.md': strToU8('# Testing SOP\n\nOne idea per creative, always.'),
    'Workspace/Testing SOP/diagram.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    'Workspace/notes.csv': strToU8('rule,why\nexact offers,compliance'),
    '__MACOSX/Workspace/._Testing SOP.md': strToU8('junk'),
    'Export-Part-1.zip': inner,
  })
  const report = unzipTextFiles(outer)
  const paths = report.files.map((f) => f.path)
  check('Markdown and CSV pages are kept', paths.some((p) => /Testing SOP .*\.md$/.test(p)) && paths.some((p) => /notes\.csv$/.test(p)), paths.join(' · '))
  check('a nested export zip is followed', paths.some((p) => /Export-Part-1\/Inner Page/.test(p)), paths.join(' · '))
  check('images and macOS metadata are left out, and counted', !paths.some((p) => /\.png$|__MACOSX/.test(p)) && report.skipped >= 2, `skipped ${report.skipped}`)
}

/* --------------------------------- niches ---------------------------------- */

function nicheSuite() {
  console.log('\nNiche tags are one vocabulary')
  check('every brand key set includes every-brand and all-e-commerce', brandNicheKeys([5]).join(',') === 'all,ecommerce,ecom:5')
  check('unknown tags are dropped, and an empty set means every brand', cleanNiches(['ecom:32', 'nonsense', 7]).join(',') === 'ecom:32' && cleanNiches([]).join(',') === 'all')
  check('every vertical in the ad library has a library tag', LIBRARY_NICHES.filter((n) => n.group === 'vertical').length >= 10)
}

/* ---------------------------------- owner ---------------------------------- */

async function ownerSuite() {
  console.log('\nThe owner gate')
  await withEnv({ PLATFORM_OWNER_PASSWORD: undefined }, async () => {
    check('closed when no owner password is set', !ownerAccess().enabled)
    check('and no token verifies while it is closed', !(await verifyOwnerToken(await createOwnerToken())))
  })
  await withEnv({ PLATFORM_OWNER_PASSWORD: 'short-pw' }, async () => {
    check('closed when the password is shorter than 12 characters', !ownerAccess().enabled)
    check('a short password cannot sign in', !(await checkOwnerPassword('short-pw')))
  })
  await withEnv({ PLATFORM_OWNER_PASSWORD: 'a-long-owner-passphrase', AUTH_SECRET: 'test-secret' }, async () => {
    check('the right password signs in', await checkOwnerPassword('a-long-owner-passphrase'))
    check('a wrong one does not', !(await checkOwnerPassword('a-long-owner-passphrasE')))
    const token = await createOwnerToken()
    check('a fresh owner token verifies', await verifyOwnerToken(token))
    const [kind, issued, sig] = token.split('.')
    check('a tampered issue time is rejected', !(await verifyOwnerToken(`${kind}.${Number(issued) + 1}.${sig}`)))
    check('an expired token is rejected', !(await verifyOwnerToken(token, Date.now() + (OWNER_MAX_AGE + 60) * 1000)))
    check('a brand session token is not an owner token', !(await verifyOwnerToken('eyJuYW1lIjoiQmFtaWsifQ.deadbeef')))
    await withEnv({ PLATFORM_OWNER_PASSWORD: 'a-new-owner-passphrase' }, async () => {
      check('changing the password signs every owner session out', !(await verifyOwnerToken(token)))
    })
  })
}

/* ---------------------------------- walls ---------------------------------- */

function wallSuite() {
  console.log('\nBrands never reach the library')
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))]
  const rel = (f: string) => f.replace(`${root}/`, '')

  const tableReaders = files.filter((f) => /\b(library_chunks|library_documents|match_library)\b/.test(code(f))).map(rel)
  check(
    'only the library module names the library tables',
    tableReaders.length === 1 && tableReaders[0] === 'lib/library/index.ts',
    tableReaders.join(' · '),
  )

  const serverImporters = files
    .filter((f) => /from\s+['"]@\/lib\/library['"]/.test(code(f)))
    .map(rel)
    .filter((f) => !f.startsWith('app/api/owner/'))
  check(
    'outside the owner routes, only the Reactor imports the library',
    serverImporters.length === 1 && serverImporters[0] === 'app/api/campaign-reactor/route.ts',
    serverImporters.join(' · '),
  )
  const reactor = code(join(root, 'app', 'api', 'campaign-reactor', 'route.ts'))
  const imported = /import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/library['"]/.exec(reactor)?.[1] ?? ''
  check(
    'and the Reactor can only search it — never list, add to or change it',
    !/\b(listLibraryDocuments|ingestLibraryDocuments|retagLibraryDocument|deleteLibraryDocument)\b/.test(imported) &&
      /searchLibrary/.test(imported),
    imported.trim(),
  )
  const telemetry = /if \(libraryHits\.length\) \{[\s\S]*?\n {8}\}/.exec(reactor)?.[0] ?? ''
  check(
    'the Reactor tells the brand a count, never a heading or a line',
    /libraryHits\.length/.test(telemetry) && !/\.(heading|content)\b/.test(telemetry),
    telemetry || 'telemetry block not found',
  )

  const ownerRoutes = walk(join(root, 'app', 'api', 'owner')).filter((f) => !/session/.test(f))
  const unguarded: string[] = []
  for (const f of ownerRoutes) {
    const src = code(f)
    const handlers = src.split(/export async function (?=GET|POST|PATCH|PUT|DELETE)/).slice(1)
    for (const h of handlers) {
      const firstLines = h.split('\n').slice(0, 3).join('\n')
      if (!/isOwnerRequest\(\)/.test(firstLines)) unguarded.push(`${rel(f)} ${h.slice(0, h.indexOf('('))}`)
    }
    if (!handlers.length) unguarded.push(`${rel(f)} (no handlers found)`)
  }
  check('every owner handler checks the owner before doing anything', unguarded.length === 0, unguarded.join(' · '))

  const ownerPages = walk(join(root, 'app', 'owner')).filter((f) => /page\.tsx$/.test(f))
  check(
    'the owner pages check the owner on the server',
    ownerPages.length >= 2 && ownerPages.every((f) => /isOwnerRequest\(\)/.test(code(f))),
    ownerPages.map(rel).join(' · '),
  )
  const middleware = code(join(root, 'middleware.ts'))
  check(
    'the brand gate neither covers nor hands out access to the owner area',
    /\|owner\|api\/owner\|/.test(middleware),
  )
  const brandNav = [join(root, 'lib', 'nav.ts'), join(root, 'components', 'reactor', 'Sidebar.tsx')]
    .map((f) => {
      try {
        return code(f)
      } catch {
        return ''
      }
    })
    .join('\n')
  check('the brand shell links nowhere near the owner area', !/['"]\/owner/.test(brandNav))

  const block = libraryMethodBlock([{ heading: 'Testing › Budget', content: 'Hold a third for testing.', similarity: 0.9 }])
  check('the method block says method only', /METHOD ONLY/.test(block) && /never put one on a creative/i.test(block))
  check('the method block says the brand’s own material wins', /THE BRAND WINS/.test(block))
  check('the method block says never cite it', /NEVER CITE IT/.test(block))
  check('an empty library adds nothing to the prompt', libraryMethodBlock([]) === '')

  const ownerSrc = code(join(root, 'lib', 'owner.ts'))
  check(
    'owner sessions are signed with a key bound to the current password',
    /function signingKey[\s\S]*?ownerPassword\(\)/.test(ownerSrc),
  )
}

async function main() {
  textSuite()
  zipSuite()
  nicheSuite()
  await ownerSuite()
  wallSuite()
  await sqlSuite()
  console.log(
    failures === 0
      ? '\n\x1b[32mPlatform Library checks passed.\x1b[0m\n'
      : `\n\x1b[31m${failures} Platform Library check(s) FAILED.\x1b[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main()
