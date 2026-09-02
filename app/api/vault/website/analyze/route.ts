import { NextRequest } from 'next/server'
import { analyzeWebsite, assertSafeUrl, type AnalyzeEvent } from '@/lib/website-intelligence'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const maxDuration = 300

// ATLAS website scan. Streams polished progress (Server-Sent Events) while it
// discovers pages, extracts intelligence, derives the five profiles, and embeds
// everything into the Knowledge Vault. Reused for both first scan and refresh.
export async function POST(request: NextRequest) {
  let url = ''
  try {
    const body = await request.json()
    url = String(body?.url ?? '').trim()
    assertSafeUrl(url)
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Invalid URL' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AnalyzeEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        } catch {
          /* client disconnected */
        }
      }
      try {
        // Scoped to the signed-in account: its chunks carry that account, and a
        // re-scan clears only that account's previous site. Null is allowed and
        // means "do not persist" — the scan still runs and returns its profiles
        // in memory, which is how a deployment with no database behaves. The
        // storage layer refuses an unscoped WRITE; it does not refuse the scan.
        await analyzeWebsite(url, send, await currentAccount())
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Website analysis failed',
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
