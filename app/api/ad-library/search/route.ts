import { NextResponse } from 'next/server'
import { searchProvenAds, gethookdConfigured, isIcpFocus } from '@/lib/gethookd'
import type { AdFormat, ProvenAd, ProvenAdQuery, ProvenAdResult } from '@/lib/gethookd'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ad Library search — proven ads for this deployment's ICP.
 *
 * PRIMARY: GetHookd. A real corpus of running Meta creative with performance
 * tiers, run-time, transcripts and signed stills, scoped to the two categories
 * this platform sells into (service businesses and e-commerce). Every row can
 * go straight to SPARK for a design read, because the still is a fetchable URL.
 *
 * FALLBACK: Meta's own ads_archive, kept for deployments with no GetHookd key.
 * Full commercial-ad search there is broadly available only for EU-targeted ads
 * (DSA transparency); elsewhere it commonly returns political/issue ads or
 * nothing. It is behind GetHookd for exactly that reason, and it still reports
 * its own limits rather than pretending.
 *
 * Never throws. An empty feed always carries a `note` saying why, so the
 * paste-to-clone path stays the obvious next move.
 *
 * Query: q, focus (services|ecommerce|all), format, tier, geo, limit, page.
 */

const GRAPH_BASE = 'https://graph.facebook.com'
const FETCH_TIMEOUT_MS = 15000

interface ArchiveAd {
  id?: string
  page_name?: string
  ad_creative_bodies?: string[]
  ad_creative_link_titles?: string[]
  ad_snapshot_url?: string
  ad_delivery_start_time?: string
}

function daysActive(start?: string): number | undefined {
  if (!start) return undefined
  const t = Date.parse(start)
  if (Number.isNaN(t)) return undefined
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000))
}

function isFormat(v: string): v is AdFormat | 'all' {
  return v === 'image' || v === 'video' || v === 'carousel' || v === 'all'
}

function isTier(v: string): v is NonNullable<ProvenAdQuery['tier']> {
  return v === 'winning' || v === 'proven' || v === 'all'
}

/* ------------------------- Meta ads_archive fallback ----------------------- */

async function metaArchive(q: string, country: string, limit: number): Promise<ProvenAdResult> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    return {
      configured: false,
      source: 'none',
      ads: [],
      hasMore: false,
      note: 'No ad source is connected. Add GETHOOKD_API_KEY to browse the proven-ad library — paste an ad below to clone it in the meantime.',
    }
  }
  if (!q) {
    return {
      configured: true,
      source: 'meta-archive',
      ads: [],
      hasMore: false,
      note: 'Meta Ad Library search needs a search term. Connect GetHookd to browse by category instead.',
    }
  }

  const version = process.env.META_API_VERSION || 'v19.0'
  const params = new URLSearchParams({
    search_terms: q,
    ad_reached_countries: JSON.stringify([country]),
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    fields:
      'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time',
    limit: String(limit),
    access_token: token,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${GRAPH_BASE}/${version}/ads_archive?${params.toString()}`, {
      signal: controller.signal,
    })
    const json = (await res.json()) as { data?: ArchiveAd[]; error?: { message?: string } }
    if (!res.ok || json.error) {
      return {
        configured: true,
        source: 'meta-archive',
        ads: [],
        hasMore: false,
        note:
          json.error?.message ||
          `Ad Library API returned ${res.status}. Commercial-ad search is limited outside the EU — connect GetHookd, or paste an ad below to clone it.`,
      }
    }
    const ads: ProvenAd[] = (json.data ?? []).map((a) => ({
      id: `meta-${a.id ?? crypto.randomUUID()}`,
      brand: a.page_name ?? 'Advertiser',
      title: (a.ad_creative_link_titles ?? [])[0] ?? '',
      body: (a.ad_creative_bodies ?? []).join('\n').trim(),
      format: 'other',
      shareUrl: a.ad_snapshot_url,
      daysActive: daysActive(a.ad_delivery_start_time),
      platforms: ['facebook'],
      countries: [country],
      focus: null,
    }))
    return {
      configured: true,
      source: 'meta-archive',
      ads,
      hasMore: false,
      note: ads.length
        ? 'Meta Ad Library results — copy only, no creative or performance data. Connect GetHookd for the full read.'
        : `No ads returned for "${q}" in ${country}. Commercial-ad search via the API is limited outside the EU — connect GetHookd, or paste an ad below to clone it.`,
    }
  } catch (err) {
    return {
      configured: true,
      source: 'meta-archive',
      ads: [],
      hasMore: false,
      note:
        err instanceof Error && err.name === 'AbortError'
          ? 'Ad Library search timed out. Paste an ad below to clone it instead.'
          : 'Ad Library search is unavailable right now. Paste an ad below to clone it instead.',
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------------------------- route --------------------------------- */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const limit = Math.min(Number(searchParams.get('limit')) || 12, 24)
  const page = Math.max(Number(searchParams.get('page')) || 1, 1)

  const rawFocus = searchParams.get('focus') ?? 'all'
  const rawFormat = searchParams.get('format') ?? 'all'
  const rawTier = searchParams.get('tier') ?? 'proven'
  const geo = (searchParams.get('geo') ?? '').trim()

  if (!gethookdConfigured()) {
    const country = (geo.split(',')[0] || 'AU').trim().toUpperCase()
    return NextResponse.json(await metaArchive(q, country, limit))
  }

  const result = await searchProvenAds({
    query: q,
    focus: isIcpFocus(rawFocus) ? rawFocus : 'all',
    format: isFormat(rawFormat) ? rawFormat : 'all',
    tier: isTier(rawTier) ? rawTier : 'proven',
    geo: geo || undefined,
    limit,
    page,
  })

  return NextResponse.json(result)
}
