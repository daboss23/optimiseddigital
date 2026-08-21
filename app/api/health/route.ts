import { NextResponse } from 'next/server'
import { supabaseUrl, getSupabaseAdmin } from '@/lib/supabase'
import { demoDataEnabled } from '@/lib/demo-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Read-only connection check. Reports which keys are PRESENT (never their values)
// and whether the Supabase tables that power the learning loop actually respond.
// Open this in a browser to confirm the platform is wired end to end.

type TableProbe = { table: string; ok: boolean; error?: string }

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
  }

  // The learning loop needs the URL + service key to write/read outcomes.
  const supabaseConfigured = keys.supabaseUrl && keys.supabaseServiceKey

  let tables: TableProbe[] = []
  if (supabaseConfigured) {
    tables = await Promise.all(
      ['campaign_outcomes', 'knowledge_chunks', 'builders'].map(probeTable),
    )
  }

  const tablesOk = supabaseConfigured && tables.every((t) => t.ok)

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

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    keys,
    display,
    supabaseConfigured,
    tables,
    learningLoop,
  })
}
