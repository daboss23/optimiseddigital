import { NextResponse } from 'next/server'
import { getWinners } from '@/lib/clone-sources'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Our Winners — proven ads from ORACLE memory (with real CTR/ROAS/winner-score
 * and taxonomy) for the clone dashboard. Never throws; degrades to curated demo
 * rows without Supabase.
 */
export async function GET() {
  return NextResponse.json(await getWinners(await currentAccount()))
}
