import { NextResponse } from 'next/server'
import { metaAdName, validateCreativeCopy, type ShippableCreative } from '@/lib/meta-ads'
import {
  resolveUploadTarget,
  uploadCreativeToMeta,
  uploadStatus,
  type UploadResult,
} from '@/lib/meta-publish'
import { recordOutcome } from '@/lib/outcomes'
import { currentAccount } from '@/lib/account'
import type { CreativeTaxonomy } from '@/lib/taxonomy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A bulk upload moves a run's worth of finished creatives; each image is a
// fetch plus a multipart POST. Fluid compute serves 300s on every plan.
export const maxDuration = 300

/**
 * Upload to Meta.
 *
 * GET  — where this brand's uploads go ({ configured, adAccountId, reason }).
 * POST — one creative, or `{ items: [...] }` for a whole run. Each is checked
 *        against the on-creative compliance gate (words burned into pixels
 *        cannot be edited after the upload), pushed into the brand's own ad
 *        account media library, and pre-seeded as a pending outcome carrying
 *        the image hash / video id the ingest grades it back by.
 *        Never throws: every failure is a 200 with a structured reason.
 */

/** A run is at most 4 variations × 5 formats; this caps one request well above it. */
const MAX_BULK = 24
/** Parallel uploads per request — enough to move a run, few enough to stay polite. */
const CONCURRENCY = 3

export async function GET() {
  return NextResponse.json(await uploadStatus(await currentAccount()))
}

interface UploadItem {
  imageUrl?: string
  videoUrl?: string
  name?: string
  // Test attribution threaded from the concept.
  testId?: string
  variantId?: string
  isolatedAxis?: string
  variationMethod?: string
  variationLabel?: string
  taxonomy?: CreativeTaxonomy
  angle?: string
  conceptType?: string
  conceptText?: string
  /** The words the creative carries — checked before anything leaves. */
  productionBrief?: ShippableCreative['productionBrief']
}

interface ItemResult extends UploadResult {
  /** Echoed so the client can match a bulk result back to its card. */
  ref?: string
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

export async function POST(req: Request) {
  let body: UploadItem & { items?: (UploadItem & { ref?: string })[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 })
  }

  const bulk = Array.isArray(body.items)
  const items = (bulk ? body.items! : [body]).slice(0, MAX_BULK)
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nothing to upload.' })
  }

  const account = await currentAccount()
  // One credential lookup for the whole batch — and one clear refusal when the
  // brand has nowhere to upload to, instead of N identical ones.
  const resolved = await resolveUploadTarget(account)
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, notConfigured: resolved.notConfigured, error: resolved.error })
  }

  const results: ItemResult[] = await mapPool(items, CONCURRENCY, async (item) => {
    const ref = (item as { ref?: string }).ref
    const blocking = validateCreativeCopy({
      type: item.conceptType || 'Creative',
      productionBrief: item.productionBrief,
    }).filter((i) => i.severity === 'error')
    if (blocking.length) {
      return {
        ok: false,
        ref,
        error: `Not uploaded — the creative carries a claim Meta rejects: ${blocking
          .map((b) => b.message)
          .join(' ')}`,
      }
    }

    // Lead the asset name with the RXN token so the ingest can attribute it.
    const name = metaAdName({
      variantId: item.variantId,
      testId: item.testId,
      taxonomy: item.taxonomy,
      fallback: item.name || item.conceptType || 'Reactor creative',
    })
    const result = await uploadCreativeToMeta(
      { imageUrl: item.imageUrl, videoUrl: item.videoUrl, name },
      account,
      resolved.target,
    )

    // Pre-seed the pending outcome that the asset grades back into. Best
    // effort: the upload already succeeded, so a memory hiccup must never
    // surface as an upload failure.
    if (result.ok && result.asset && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        await recordOutcome({
          angle: item.angle || item.conceptType || 'Uploaded creative',
          concept: {
            type: item.conceptType || 'Meta creative',
            text: item.conceptText || result.asset.name,
            basis: 'Uploaded to Meta',
          },
          attributes: {
            platform: 'meta',
            testId: item.testId,
            variantId: item.variantId,
            isolatedAxis: item.isolatedAxis,
            variationMethod: item.variationMethod,
            variationLabel: item.variationLabel,
            taxonomy: item.taxonomy,
            metaImageHash: result.asset.imageHash,
            metaVideoId: result.asset.videoId,
          },
          verdict: 'pending',
          builderId: account,
          notes: `Uploaded to Meta as "${result.asset.name}"${
            result.asset.imageHash
              ? ` (image ${result.asset.imageHash})`
              : result.asset.videoId
                ? ` (video ${result.asset.videoId})`
                : ''
          }`,
        })
      } catch (err) {
        console.error('Pre-seed pending outcome failed (upload still succeeded):', err)
      }
    }

    return { ...result, ref }
  })

  if (!bulk) return NextResponse.json(results[0])

  const uploaded = results.filter((r) => r.ok).length
  return NextResponse.json({
    ok: uploaded === results.length,
    adAccountId: resolved.target.adAccountId,
    uploaded,
    failed: results.length - uploaded,
    truncated: (body.items?.length ?? 0) > MAX_BULK,
    results,
  })
}
