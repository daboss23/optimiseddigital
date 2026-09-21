import { NextResponse } from 'next/server'
import { supabaseUrl, getSupabaseAdmin } from '@/lib/supabase'
import { demoDataEnabled } from '@/lib/demo-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Read-only connection check. Reports which keys are PRESENT (never their values)
// and whether the Supabase tables that power the learning loop actually respond.
// Open this in a browser to confirm the platform is wired end to end.

type TableProbe = { table: string; ok: boolean; error?: string }

/**
 * Has supabase/schema.tenancy.sql been applied?
 *
 * The application requires it: it queries `accounts` and `users`, and writes an
 * `is_global` column on every knowledge chunk. Against an un-migrated project
 * those fail one at a time, deep inside a scan or an ingest, as errors that read
 * like the feature is broken rather than like the database is a version behind.
 *
 * So it is asked here, plainly, in the one place people look when something is
 * wrong. Read-only: three head-count probes and one column check.
 */
async function probeTenancy(): Promise<{
  applied: boolean
  missing: string[]
  hint?: string
}> {
  const missing: string[] = []

  for (const table of ['accounts', 'users']) {
    const probe = await probeTable(table)
    if (!probe.ok) missing.push(`table ${table}`)
  }

  // `is_global` on knowledge_chunks — selecting a column that does not exist
  // errors, which is exactly the signal wanted.
  try {
    const { error } = await getSupabaseAdmin()
      .from('knowledge_chunks')
      .select('is_global', { head: true })
      .limit(1)
    if (error) missing.push('column knowledge_chunks.is_global')
  } catch {
    missing.push('column knowledge_chunks.is_global')
  }

  return {
    applied: missing.length === 0,
    missing,
    hint: missing.length
      ? 'Run supabase/schema.tenancy.sql in the Supabase SQL editor. Until it is applied, connecting a website and every Vault write will fail.'
      : undefined,
  }
}

async function probeTable(table: string): Promise<TableProbe> {
  try {
    const { error } = await getSupabaseAdmin()
      .from(table)
      .select('*', { count: 'exact', head: true })
      .limit(1)
    if (error) return { table, ok: false, error: error.message }
    return { table, ok: true }
  } catch (err) {
    return { table, ok: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}

export async function GET() {
  // Presence-only — booleans, never the secret values themselves.
  const keys = {
    supabaseUrl: Boolean(supabaseUrl()),
    supabaseAnonKey: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
    supabaseServiceKey: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    ),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    voyage: Boolean(process.env.VOYAGE_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    higgsfield: Boolean(process.env.HF_CREDENTIALS),
    fal: Boolean(process.env.FAL_KEY),
    muapi: Boolean(process.env.MUAPIAPP_API_KEY || process.env.MUAPI_API_KEY),
    pipeboard: Boolean(process.env.PIPEBOARD_API_TOKEN),
    gethookd: Boolean((process.env.GETHOOKD_API_KEY ?? '').trim()),
  }

  // The learning loop needs the URL + service key to write/read outcomes.
  const supabaseConfigured = keys.supabaseUrl && keys.supabaseServiceKey

  let tables: TableProbe[] = []
  if (supabaseConfigured) {
    tables = await Promise.all(
      ['campaign_outcomes', 'knowledge_chunks', 'accounts'].map(probeTable),
    )
  }

  const tablesOk = supabaseConfigured && tables.every((t) => t.ok)

  // The migration state, reported before anything else that depends on it.
  const tenancy = supabaseConfigured
    ? await probeTenancy()
    : { applied: false, missing: ['supabase not configured'], hint: undefined }

  // The outcome learning loop is fully live only when the DB write path works
  // and embeddings are configured to re-ingest winners as retrievable patterns.
  const learningLoop = {
    canStoreOutcomes: tablesOk,
    canReingestWinners: tablesOk && keys.voyage,
  }

  /**
   * Display switches, reported so they can be CHECKED rather than guessed at.
   *
   * Both are read at build time on the client and at request time here, which
   * is exactly why they need reporting: an environment variable saved in the
   * host's dashboard does nothing until the deployment is rebuilt, and from
   * the outside that is indistinguishable from the flag being wrong. Neither
   * is a secret — they only choose which of two harmless states renders.
   */
  const display = {
    demoData: demoDataEnabled(),
    operatorSource:
      process.env.OPERATOR_SOURCE ?? process.env.NEXT_PUBLIC_OPERATOR_SOURCE ?? 'seeded',
  }

  /**
   * WHICH BUILD IS ANSWERING.
   *
   * The most expensive hour of this project was spent not knowing. A fix was
   * merged to `main`, its build failed on the host's own dependency check, and
   * production kept serving the PREVIOUS commit — so every symptom pointed at
   * the new code while the new code was not running at all. Nothing on screen
   * could distinguish "the fix is wrong" from "the fix never deployed".
   *
   * The commit is not a secret; it is on a public branch. Reporting it turns
   * that question into one request.
   */
  const deployment = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'unknown',
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
    environment: process.env.VERCEL_ENV ?? 'local',
  }

  /**
   * The proven-ad source, reported WITHOUT calling it.
   *
   * This endpoint is deliberately unauthenticated so a deployment probe never
   * gets redirected to a login page. GetHookd bills per returned row, so a live
   * probe here would be an open door to draining the account's credits one
   * request at a time. Presence and configuration only — `npm run gethookd:params`
   * is the thing that actually talks to the API, and it is run by a human.
   *
   * `geoParam` is included because a country filter under the wrong name is the
   * one failure that still returns ads, just the wrong ones.
   */
  const gethookd = {
    configured: keys.gethookd,
    base: process.env.GETHOOKD_API_BASE || 'https://app.gethookd.ai/api/v1',
    geo: process.env.GETHOOKD_GEO || 'US,AU',
    geoParam: process.env.GETHOOKD_GEO_PARAM || 'geo',
  }

  return NextResponse.json({
    // `ok` now means "this deployment can actually do its job", not merely
    // "the route responded". A schema a version behind the code is not ok.
    ok: !supabaseConfigured || tenancy.applied,
    timestamp: new Date().toISOString(),
    deployment,
    tenancy,
    keys,
    display,
    gethookd,
    supabaseConfigured,
    tables,
    learningLoop,
  })
}
