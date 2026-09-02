import { NextRequest } from 'next/server'
import { runNovaResearch, type NovaEvent, type NovaResearchInput, type NovaSourceType } from '@/lib/market-intelligence'
import { requireAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const maxDuration = 120

const VALID_TYPES: NovaSourceType[] = ['reddit', 'youtube', 'web', 'text']

// NOVA market research. Streams polished progress (Server-Sent Events) while she
// pulls a source (Reddit / YouTube / web / pasted text), extracts the
// psychographic profile, and embeds it into the knowledge layer. Mirrors the
// ATLAS website-scan route so the client streaming pattern is identical.
export async function POST(request: NextRequest) {
  let input: NovaResearchInput
  try {
    const body = await request.json()
    const sourceType = body?.sourceType as NovaSourceType
    if (!VALID_TYPES.includes(sourceType)) {
      throw new Error(`sourceType must be one of: ${VALID_TYPES.join(', ')}`)
    }
    input = {
      sourceType,
      url: typeof body.url === 'string' ? body.url : undefined,
      subreddit: typeof body.subreddit === 'string' ? body.subreddit : undefined,
      query: typeof body.query === 'string' ? body.query : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      builderId: await requireAccount(),
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: NovaEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        } catch {
          /* client disconnected */
        }
      }
      try {
        await runNovaResearch(input, send)
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'NOVA research failed',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
