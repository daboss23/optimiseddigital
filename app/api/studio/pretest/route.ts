import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import {
  demoNeuroScore,
  NEURO_PRINCIPLES,
  pretestCreative,
  retrieveNeuroPrinciples,
  scoreConceptsNeuro,
} from '@/lib/neuro'
import { fetchImage } from '@/lib/ad-image'
import { assertSafeUrl } from '@/lib/website-intelligence'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Launch Bay pre-test — NEURO's predicted-response read on the FINISHED
 * creative, before any spend.
 *
 * It reads the pixels, not the plan: the four NEURO axes, plus the two checks
 * that decide whether an e-commerce creative can be uploaded at all — every
 * on-image word spelled as written, and the product visible at thumb size.
 * The text check is computed in code from the model's verbatim transcription,
 * so a misspelled headline is caught by comparison, not by opinion.
 *
 * Degrades in steps and says which step it landed on: no render yet → the
 * plan is scored instead (`basis: 'plan'`); no ANTHROPIC_API_KEY → the
 * curated demo estimate (`demo: true`). Never throws.
 */

interface PretestBody {
  imageUrl?: string
  conceptType?: string
  conceptText?: string
  /** The words the brief asked the renderer to set. */
  onImageText?: string[]
}

export async function POST(req: Request) {
  let body: PretestBody
  try {
    body = (await req.json()) as PretestBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 })
  }

  const conceptType = body.conceptType?.trim() || 'Creative'
  const conceptText = body.conceptText?.trim() || ''
  const onImageText = (body.onImageText ?? []).filter((t): t is string => typeof t === 'string')
  if (!conceptText && !body.imageUrl) {
    return NextResponse.json({ ok: false, error: 'Pick a creative before pre-testing it.' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, demo: true, basis: 'plan', neuro: demoNeuroScore(7, conceptType) })
  }

  const anthropic = new Anthropic({ apiKey })
  const principles = await retrieveNeuroPrinciples(conceptType, await currentAccount()).catch(
    () => NEURO_PRINCIPLES,
  )

  // The render itself, when there is one. Fetched here (bounded, with browser
  // headers) and sent inline; a render too large to inline goes by URL instead.
  if (body.imageUrl) {
    let safe: string | null = null
    try {
      const u = assertSafeUrl(body.imageUrl)
      if (u.protocol === 'https:') safe = u.toString()
    } catch {
      safe = null
    }
    if (safe) {
      const fetched = await fetchImage(safe)
      const read = await pretestCreative(
        anthropic,
        INTELLIGENCE_MODEL,
        {
          type: conceptType,
          text: conceptText,
          image: fetched ? { mediaType: fetched.mediaType, data: fetched.data } : { url: safe },
          onImageText,
        },
        principles,
      )
      if (read) return NextResponse.json({ ok: true, demo: false, basis: 'creative', ...read })
    }
  }

  // No render (or it could not be read) — score the plan, and say so.
  try {
    const [neuro] = await scoreConceptsNeuro(
      anthropic,
      INTELLIGENCE_MODEL,
      [
        {
          type: conceptType,
          text: conceptText || conceptType,
          productionBrief: { onImageText: onImageText.map((text) => ({ text })) },
        },
      ],
      principles,
    )
    return NextResponse.json({ ok: true, demo: false, basis: 'plan', neuro })
  } catch {
    return NextResponse.json({ ok: true, demo: true, basis: 'plan', neuro: demoNeuroScore(7, conceptType) })
  }
}
