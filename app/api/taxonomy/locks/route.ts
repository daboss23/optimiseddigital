import { NextResponse } from 'next/server'
import { getTaxonomyLocks } from '@/lib/taxonomy-locks'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Isolation-mode lock defaults: the best-performing value per taxonomy axis
 * (from ORACLE memory) plus the persona/pain options actually seen in history.
 * Never throws — degrades to canonical defaults without Supabase.
 */
export async function GET() {
  return NextResponse.json(await getTaxonomyLocks(await currentAccount()))
}
