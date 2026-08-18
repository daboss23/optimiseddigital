/**
 * Copy the Knowledge Vault from one deployment's Supabase project into another.
 *
 * Used when standing up a second instance: the direct-response knowledge you
 * uploaded (frameworks, SOPs, hooks, headlines, winning ad structure, design
 * DNA, research) travels, so the new deployment is sharp on day one instead of
 * starting cold.
 *
 * Two things are held back by default, because they identify the business the
 * source instance was built for rather than teaching craft:
 *   - Member wins        (system 'transformation' / category 'Member Win')
 *   - The website read   (system 'website' — brand memory, in vault form)
 * The website read is also pointless to copy: the target's own scan calls
 * clearAllWebsites() and deletes every 'website' chunk before storing its own.
 *
 * Campaign outcomes are NOT copied. They are ORACLE's performance memory for
 * ads that ran on the source business's ad account, and grading a new
 * business's creative against another company's cohort medians would produce
 * confident, wrong verdicts. Pass --include-outcomes only if you specifically
 * want that history carried over.
 *
 * Embeddings are copied verbatim. Both instances run voyage-3, so the vectors
 * are valid as-is — re-embedding would cost money and change nothing.
 *
 * Usage:
 *   SOURCE_SUPABASE_URL=... SOURCE_SUPABASE_SERVICE_ROLE_KEY=... \
 *   TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/vault-copy.ts --dry-run
 *
 * Flags:
 *   --dry-run           Report what would be copied. Writes nothing.
 *   --include-wins      Also copy member wins.
 *   --include-website   Also copy the website read (see caveat above).
 *   --include-outcomes  Also copy campaign_outcomes (ORACLE memory).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PAGE = 500
const INSERT_BATCH = 200

interface Chunk {
  id: string
  created_at: string | null
  builder_id: string | null
  system: string
  category: string | null
  title: string
  content: string
  metadata: Record<string, unknown> | null
  embedding: unknown
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const includeWins = args.has('--include-wins')
const includeWebsite = args.has('--include-website')
const includeOutcomes = args.has('--include-outcomes')

function client(urlVar: string, keyVar: string): SupabaseClient {
  const url = process.env[urlVar]
  const key = process.env[keyVar]
  if (!url || !key) {
    console.error(`Missing ${urlVar} / ${keyVar}.`)
    process.exit(1)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Why a chunk is being held back, or null when it travels. */
function excludeReason(c: Chunk): string | null {
  const category = (c.category ?? '').toLowerCase()
  const isWin = c.system === 'transformation' || category.includes('member win')
  if (isWin && !includeWins) return 'member win'
  if (c.system === 'website' && !includeWebsite) return 'website read (brand memory)'
  return null
}

/** Identity for dedupe — lets the script be re-run without duplicating rows. */
function fingerprint(c: { system: string; title: string; content: string }): string {
  return `${c.system}::${c.title.trim()}::${c.content.trim().slice(0, 200)}`
}

async function readAll(db: SupabaseClient): Promise<Chunk[]> {
  const out: Chunk[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('knowledge_chunks')
      .select('id, created_at, builder_id, system, category, title, content, metadata, embedding')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Read failed: ${error.message}`)
    const rows = (data ?? []) as Chunk[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

function tally(rows: Chunk[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.system} / ${r.category ?? '—'}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function printTally(label: string, rows: Chunk[]): void {
  if (!rows.length) {
    console.log(`\n${label}: none`)
    return
  }
  console.log(`\n${label}: ${rows.length}`)
  const entries = Array.from(tally(rows)).sort((a, b) => b[1] - a[1])
  for (const [k, n] of entries) console.log(`   ${String(n).padStart(5)}  ${k}`)
}

async function copyOutcomes(source: SupabaseClient, target: SupabaseClient): Promise<void> {
  const { data, error } = await source.from('campaign_outcomes').select('*')
  if (error) {
    console.log(`\nCampaign outcomes: skipped (${error.message})`)
    return
  }
  const rows = data ?? []
  console.log(`\nCampaign outcomes: ${rows.length}`)
  if (dryRun || !rows.length) return
  const stripped = rows.map(({ id: _id, ...rest }) => rest)
  for (let i = 0; i < stripped.length; i += INSERT_BATCH) {
    const { error: insErr } = await target
      .from('campaign_outcomes')
      .insert(stripped.slice(i, i + INSERT_BATCH))
    if (insErr) throw new Error(`Outcome insert failed: ${insErr.message}`)
  }
  console.log(`   copied ${stripped.length}`)
}

async function main(): Promise<void> {
  const source = client('SOURCE_SUPABASE_URL', 'SOURCE_SUPABASE_SERVICE_ROLE_KEY')
  const target = client('TARGET_SUPABASE_URL', 'TARGET_SUPABASE_SERVICE_ROLE_KEY')

  console.log(dryRun ? '\nVault copy — DRY RUN, nothing will be written.' : '\nVault copy')

  const all = await readAll(source)
  console.log(`\nSource vault: ${all.length} chunks`)

  const held: Chunk[] = []
  const travelling: Chunk[] = []
  const reasons = new Map<string, number>()
  for (const c of all) {
    const reason = excludeReason(c)
    if (reason) {
      held.push(c)
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    } else {
      travelling.push(c)
    }
  }

  printTally('Copying', travelling)
  printTally('Held back', held)
  for (const [reason, n] of Array.from(reasons)) console.log(`   (${n} × ${reason})`)

  // Skip anything already present so the script is safe to re-run.
  const existing = await readAll(target)
  const seen = new Set(existing.map(fingerprint))
  const fresh = travelling.filter((c) => !seen.has(fingerprint(c)))
  const dupes = travelling.length - fresh.length
  console.log(
    `\nTarget already holds ${existing.length} chunks; ${dupes} of the above are already there.`,
  )
  console.log(`To insert: ${fresh.length}`)

  if (dryRun) {
    console.log('\nDry run complete — nothing written. Re-run without --dry-run to copy.')
    if (includeOutcomes) await copyOutcomes(source, target)
    return
  }

  // Drop the source id so the target assigns its own; keep everything else,
  // embeddings included — both instances embed with voyage-3.
  let inserted = 0
  for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
    const batch = fresh.slice(i, i + INSERT_BATCH).map(({ id: _id, ...rest }) => rest)
    const { error } = await target.from('knowledge_chunks').insert(batch)
    if (error) throw new Error(`Insert failed at row ${i}: ${error.message}`)
    inserted += batch.length
    console.log(`   inserted ${inserted}/${fresh.length}`)
  }

  if (includeOutcomes) await copyOutcomes(source, target)

  console.log(`\nDone. ${inserted} chunks copied into the target vault.`)
}

main().catch((err) => {
  console.error(`\nVault copy failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
