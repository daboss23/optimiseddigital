import { NextRequest, NextResponse } from 'next/server'
import {
  extractCreativeDNA,
  extractVisualDNA,
  storeCreativeDNA,
  type CreativeDNA,
  type VisualDNA,
} from '@/lib/spark'
import { extractVideoId, fetchYouTubeTranscript } from '@/lib/youtube'
import { resolveAdImages, MAX_AD_IMAGES } from '@/lib/ad-image'
import { classifyTaxonomy } from '@/lib/taxonomy-classify'
import type { MeasuredSwatch } from '@/lib/palette'

export const runtime = 'nodejs'
export const maxDuration = 120

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Best-effort fetch of a creative's page text (Meta Ad Library / TikTok /
// YouTube / landing pages). Returns '' on any failure — the user can always
// paste the script/notes instead.
async function fetchUrlText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProBuilderBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return ''
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return ''
    return stripHtml(await res.text()).slice(0, 8000)
  } catch {
    return ''
  }
}

/**
 * SPARK — study a winning creative and extract + store its Creative DNA.
 *
 * Two reads, either or both:
 *   - VISUAL — `images` (data: URLs from drag/drop/paste/upload, or direct
 *     image links) and/or a `url` pointing at the ad. A vision model reads the
 *     design: palette, layout, element placement, on-ad copy, scroll-stop.
 *   - WRITTEN — `text`, or a YouTube URL (auto-transcribed), or page text.
 *
 * Never throws on missing keys — both paths degrade to a heuristic read so the
 * platform always works end to end.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      text?: string
      url?: string
      images?: string[]
      /** Palettes measured in the browser, indexed to match `images`. */
      palettes?: (MeasuredSwatch[] | undefined)[]
      title?: string
      builderId?: string | null
    }

    const url = body.url?.trim()
    const uploads = Array.isArray(body.images) ? body.images.slice(0, MAX_AD_IMAGES) : []
    const palettes = Array.isArray(body.palettes) ? body.palettes.slice(0, MAX_AD_IMAGES) : []
    let text = (body.text ?? '').trim()
    const notes: string[] = []

    // 1. Resolve everything visual first — an upload is the reliable path, and a
    //    link is only scraped for images when there is still room.
    const { images, notes: imageNotes } = await resolveAdImages({
      images: uploads,
      palettes,
      // Only mine the URL for images when the user didn't already upload any;
      // a YouTube link is a transcript source, never an image source.
      url: uploads.length === 0 && url && !extractVideoId(url) ? url : undefined,
      max: MAX_AD_IMAGES,
    })
    notes.push(...imageNotes)

    // 2. Written read. YouTube URLs get the real transcript via the innertube
    //    caption fetcher (lib/youtube.ts) — a generic page scrape never returns
    //    the spoken words. Skip the page scrape entirely when we already have
    //    images: the vision read is richer than stripped page furniture.
    if (text.length < 40 && url) {
      const fetched = extractVideoId(url)
        ? (await fetchYouTubeTranscript(url)).content
        : images.length === 0
          ? await fetchUrlText(url)
          : ''
      text = `${text}\n${fetched}`.trim()
    }

    if (!images.length && text.length < 40) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Nothing to analyze yet. Drop in a screenshot of the ad, paste an image, or paste the ad script / transcript / notes.',
          notes,
        },
        { status: 400 },
      )
    }

    // 3. Extract. With images, one vision call returns BOTH the design read and
    //    the written DNA from the same evidence. Without them, the text path is
    //    unchanged. The taxonomy classifier runs alongside either way so the
    //    reference is comparable in ORACLE.
    // One shape for both reads: the written path simply has no design read.
    let ads: { label: string; dna: CreativeDNA; visual: VisualDNA | null }[]
    let live = false
    let reason: string | undefined

    if (images.length) {
      const analysis = await extractVisualDNA(images, text)
      ads = analysis.ads
      live = analysis.live
      reason = analysis.reason
    } else {
      ads = [{ label: 'Ad 1', dna: await extractCreativeDNA(text), visual: null }]
      live = Boolean(process.env.ANTHROPIC_API_KEY)
      if (!live) {
        reason =
          'ANTHROPIC_API_KEY is not configured, so this is a heuristic read of your text rather than a real extraction.'
      }
    }

    // Each detected ad is classified and stored on its own, so a board
    // screenshot of ten winners becomes ten retrievable patterns rather than
    // one averaged blur. Classification runs off everything known about that
    // ad — the transcribed on-ad copy included — so an image-only reference
    // still lands a real taxonomy tag.
    // A read that never happened must never become Vault knowledge — storing an
    // invented teardown would poison every future retrieval with a design no ad
    // ever used. The sample still renders, clearly flagged, but stays unstored.
    const results = await Promise.all(
      ads.map(async (ad, i) => {
        const visual = ad.visual
        const classifierText = [
          text,
          ad.dna.hook,
          ad.dna.summary,
          ...(visual?.elements.map((e) => e.text).filter(Boolean) ?? []),
        ]
          .filter(Boolean)
          .join('\n')

        // Classified BEFORE the write, not alongside it, so the taxonomy lands
        // in the stored chunk's metadata and the design is retrievable by
        // persona / pain / format later, not just by prose similarity.
        const taxonomy = await classifyTaxonomy(classifierText)
        const stored = live
          ? await storeCreativeDNA(
              ad.dna,
              {
                url: body.url,
                platform: 'Meta Ads',
                // Keep each stored chunk distinguishable when one sheet yields many.
                title: body.title
                  ? ads.length > 1
                    ? `${body.title} — ${ad.label}`
                    : body.title
                  : undefined,
              },
              body.builderId ?? null,
              visual,
              taxonomy,
            )
          : { stored: false, chunks: 0 }

        return {
          label: ad.label || `Ad ${i + 1}`,
          dna: ad.dna,
          visual,
          taxonomy,
          stored: stored.stored,
          chunks: stored.chunks,
        }
      }),
    )

    const first = results[0]!
    return NextResponse.json({
      success: true,
      ads: results,
      adCount: results.length,
      // Back-compat with any caller expecting a single read.
      dna: first.dna,
      visual: first.visual,
      taxonomy: first.taxonomy,
      stored: results.some((r) => r.stored),
      chunks: results.reduce((n, r) => n + r.chunks, 0),
      live,
      reason,
      imageCount: images.length,
      notes,
    })
  } catch (err) {
    console.error('SPARK analyze error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 },
    )
  }
}
