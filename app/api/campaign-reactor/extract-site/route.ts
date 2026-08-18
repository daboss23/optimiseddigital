import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { assertSafeUrl, fetchReadablePage } from '@/lib/website-intelligence'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import { getTenant, tenantDescriptor } from '@/lib/tenant'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Quick Launch website extractor. Reads a single public page (SSRF-guarded,
 * redirect-revalidated by fetchReadablePage) and distils a tight campaign-intel
 * brief — offer, audience, positioning, pains, proof — that the Quick Launch UI
 * folds into the brief so the reactor fires grounded in the business's own site.
 *
 * Never throws to the client: a fetch/model failure still returns a trimmed
 * readable snippet (or a clean error), so the flow keeps moving.
 */
export async function POST(request: NextRequest) {
  let url = ''
  try {
    const body = await request.json()
    url = assertSafeUrl(String(body?.url ?? '')).toString()
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'That doesn’t look like a valid URL.' },
      { status: 200 },
    )
  }

  const domain = new URL(url).hostname.replace(/^www\./, '')

  const text = await fetchReadablePage(url, 9000).catch(() => '')
  if (!text || text.trim().length < 60) {
    return NextResponse.json(
      { ok: false, error: 'Could not read meaningful content from that page.' },
      { status: 200 },
    )
  }

  const snippet = () => text.replace(/\s+/g, ' ').trim().slice(0, 600)

  // No key → hand back a trimmed readable snippet so the brief still gets context.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: true, domain, intel: snippet() })
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: 400,
      system:
        `You are ATLAS, extracting campaign intelligence from a business website for ${tenantDescriptor(await getTenant())}'s creative reactor. Read the page and distil ONLY what a strategist needs to brief a paid-ads campaign. Be concrete and specific to THIS business. No preamble, no markdown headers.`,
      messages: [
        {
          role: 'user',
          content: `Website: ${domain}\n\nReadable page content:\n"""${text.slice(0, 8000)}"""\n\nReturn a tight campaign-intel brief (max ~110 words) as short labelled lines:\nBusiness: <what they sell>\nAudience: <who they serve>\nOffer: <primary offer / CTA>\nPositioning: <angle / differentiator>\nPains: <2-3 customer pains they speak to>\nProof: <any named results / social proof, or "none stated">`,
        },
      ],
    })
    const out =
      response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text?.trim() ?? ''
    if (!out) throw new Error('empty extraction')
    return NextResponse.json({ ok: true, domain, intel: out })
  } catch (err) {
    console.error('extract-site error:', err)
    return NextResponse.json({ ok: true, domain, intel: snippet() })
  }
}
