import { NextRequest, NextResponse } from 'next/server'
import { recordOutcome, type OutcomeAttributes, type Verdict } from '@/lib/outcomes'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'

// Log how a generated concept performed. Wins (winner / high performer) feed back
// into the knowledge layer as new patterns (the Performance Intelligence loop).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { angle, concept } = body as {
      angle?: string
      concept?: { type: string; text: string; basis?: string }
    }

    if (!angle || !concept?.text) {
      return NextResponse.json(
        { success: false, error: 'angle and concept are required' },
        { status: 400 },
      )
    }

    const result = await recordOutcome({
      angle,
      concept,
      attributes: body.attributes as OutcomeAttributes | undefined,
      metricName: body.metricName,
      metricValue: body.metricValue,
      verdict: (body.verdict as Verdict) ?? 'winner',
      builderId: await currentAccount(),
      notes: body.notes,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('Outcome logging error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to log outcome' },
      { status: 500 },
    )
  }
}
