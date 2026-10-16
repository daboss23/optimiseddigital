import { NextResponse } from 'next/server'
import { backfillTaxonomy, backfillStatus } from '@/lib/taxonomy-backfill'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Classifying a batch is a series of single-shot model calls — give it room.
export const maxDuration = 300

/**
 * Taxonomy backfill control.
 *
 * GET  — how much of ORACLE memory is tagged (total / tagged / untagged).
 * POST — classify a batch of untagged outcomes into the fixed taxonomy.
 *        Body: { limit?: number } (default 200). Never throws — returns a
 *        structured summary the strategic-memory UI can render.
 */

export async function GET() {
  return NextResponse.json(await backfillStatus(await currentAccount()))
}

export async function POST(req: Request) {
  let limit = 200
  try {
    const body = (await req.json()) as { limit?: number }
    if (typeof body.limit === 'number' && body.limit > 0) limit = Math.min(body.limit, 500)
  } catch {
    // No body / bad JSON — fall back to the default batch size.
  }
  return NextResponse.json(await backfillTaxonomy(await currentAccount(), limit))
}
