import { NextResponse } from 'next/server'
import { metaIngestStatus, syncMetaPerformance } from '@/lib/meta-ingest'
import { currentAccount, requireAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const maxDuration = 120

// Performance Intelligence ingest — pulls live ad-level CTR/CPL/ROAS from the
// Meta Marketing API, grades every ad against its account cohort, and logs the
// verdicts into ORACLE memory (campaign_outcomes). Winners re-ingest into the
// Vault automatically. GET reports readiness; POST runs a sync.

export async function GET() {
  const status = await metaIngestStatus(await currentAccount())
  return NextResponse.json(status)
}

export async function POST() {
  const summary = await syncMetaPerformance(await requireAccount())
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 })
}
