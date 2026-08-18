import { NextResponse } from 'next/server'
import { validateAdPackage, metaAdName, type MetaAdPackage } from '@/lib/meta-ads'
import {
  publishCreativeToMeta,
  publishConfigured,
  publishMissingEnv,
} from '@/lib/meta-publish'
import { recordOutcome } from '@/lib/outcomes'
import type { CreativeTaxonomy } from '@/lib/taxonomy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Push Creative to Meta.
 *
 * GET  — connection status for the Studio button ({ configured, missing }).
 * POST — validate the configured ad server-side (same launch gate as the
 *        orchestrator), then create the ad creative in the connected account.
 *        Never throws: every failure returns 200 with a structured reason so
 *        the Studio renders it inline.
 *
 * When the concept carries test attribution (testId/variantId/taxonomy from an
 * isolation run), the creative name leads with the RXN token and a pending
 * outcome row is pre-seeded so the Meta performance ingest later attributes the
 * live result back to the exact hypothesis — no re-deriving the taxonomy.
 */

export async function GET() {
  return NextResponse.json({ configured: publishConfigured(), missing: publishMissingEnv() })
}

interface PublishBody {
  pkg?: MetaAdPackage
  imageUrl?: string
  videoUrl?: string
  name?: string
  // Optional test attribution threaded from an isolation-run concept.
  testId?: string
  variantId?: string
  isolatedAxis?: string
  // The brief-configured variation lever and this version's concrete
  // difference. Carried here because the ingest can only recover testId /
  // variantId from an ad NAME — the lever has to be banked at push time or the
  // graded outcome comes back knowing which version won but not what it tested.
  variationMethod?: string
  variationLabel?: string
  taxonomy?: CreativeTaxonomy
  angle?: string
  conceptType?: string
  conceptText?: string
}

export async function POST(req: Request) {
  let body: PublishBody
  try {
    body = (await req.json()) as PublishBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 })
  }

  const pkg = body.pkg
  if (!pkg?.primaryText?.trim() || !pkg.headline?.trim()) {
    return NextResponse.json({
      ok: false,
      error: 'The ad needs primary text and a headline before it can be pushed.',
    })
  }

  // Same hard launch gate as the reactor's submit path — compliance errors
  // never ship, warnings pass through (they only truncate, not violate).
  const issues = validateAdPackage(pkg)
  const errors = issues.filter((i) => i.severity === 'error')
  if (errors.length) {
    return NextResponse.json({
      ok: false,
      error: `Fix the compliance issues first: ${errors.map((e) => e.message).join(' ')}`,
      issues: errors,
    })
  }

  // Lead the creative name with the RXN token so the ingest can auto-attribute
  // the live ad back to its test; keep the caller's name as the descriptor.
  const name = metaAdName({
    variantId: body.variantId,
    testId: body.testId,
    taxonomy: body.taxonomy,
    fallback: body.name || pkg.headline,
  })

  const result = await publishCreativeToMeta({
    pkg,
    imageUrl: body.imageUrl,
    videoUrl: body.videoUrl,
    name,
  })

  // Pre-seed a pending outcome row carrying the authoritative taxonomy + test
  // IDs. Best-effort: the push already succeeded, so a memory hiccup here must
  // never surface as a publish failure (route convention: never throw).
  if (result.ok && body.variantId && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      await recordOutcome({
        angle: body.angle || pkg.headline,
        concept: {
          type: body.conceptType || 'Meta creative',
          text: body.conceptText || pkg.primaryText,
          basis: 'Pushed to Meta',
        },
        attributes: {
          platform: 'meta',
          testId: body.testId,
          variantId: body.variantId,
          isolatedAxis: body.isolatedAxis,
          variationMethod: body.variationMethod,
          variationLabel: body.variationLabel,
          taxonomy: body.taxonomy,
        },
        verdict: 'pending',
        notes: `Pushed to Meta as "${name}"${result.creativeId ? ` (creative ${result.creativeId})` : ''}`,
      })
    } catch (err) {
      console.error('Pre-seed pending outcome failed (push still succeeded):', err)
    }
  }

  return NextResponse.json(result)
}
