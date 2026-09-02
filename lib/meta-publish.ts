import crypto from 'crypto'
import { ctaLabel, META_CTA_OPTIONS, type MetaAdPackage, type MetaCta } from '@/lib/meta-ads'
import { getTenant } from '@/lib/tenant'
import { getConnectedWebsite } from '@/lib/website-intelligence'
import { currentAccount } from '@/lib/account'

/**
 * Push Creative to Meta — direct Graph API publishing of a configured Studio ad.
 *
 * Creates a real **ad creative** in the connected ad account's creative library
 * (`act_X/adcreatives` with an `object_story_spec`), ready to attach to any ad
 * set in Ads Manager. It deliberately does NOT create a campaign/ad set/ad —
 * budget, audience, and schedule are money decisions that stay with the user;
 * the platform's job is a launch-ready creative, one click from live.
 *
 * Required env: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID.
 * Optional: META_LINK_URL (destination link; falls back to the connected
 *           website, and the push is blocked when there is neither),
 * META_APP_SECRET (adds appsecret_proof), META_API_VERSION (default v19.0).
 *
 * Per CLAUDE.md this module never throws — every failure resolves to a
 * structured `{ ok: false }` result the Studio can render.
 */

const GRAPH_BASE = 'https://graph.facebook.com'
const FETCH_TIMEOUT_MS = 20000

export interface PublishInput {
  /** The configured ad unit from the Studio. */
  pkg: MetaAdPackage
  /** The rendered still (also used as the video thumbnail when both exist). */
  imageUrl?: string
  /** A rendered clip — uploaded to the account, then wrapped in a video creative. */
  videoUrl?: string
  /** Creative-library display name, e.g. the campaign name. */
  name?: string
}

export interface PublishResult {
  ok: boolean
  /** The created creative's id (on success). */
  creativeId?: string
  /** Uploaded video id, when a clip was pushed. */
  videoId?: string
  /** Human-readable failure reason (on failure). */
  error?: string
  /** True when the failure is missing configuration rather than an API error. */
  notConfigured?: boolean
  /** The env vars that still need to be set (when notConfigured). */
  missing?: string[]
}

function apiVersion(): string {
  return process.env.META_API_VERSION || 'v19.0'
}

/**
 * Where a pushed creative sends the click.
 *
 * META_LINK_URL first, then the connected website. There is deliberately NO
 * hard-coded default: this used to fall back to the original tenant's own
 * domain, so any deployment that had not set the env var published live ads —
 * against the customer's ad account, spending the customer's money — that sent
 * every click to a different company's website. `publishMissingEnv` now blocks
 * the push instead, which is a configuration error the operator can fix in a
 * minute rather than a leak they might never notice.
 */
async function linkUrl(): Promise<string> {
  const explicit = process.env.META_LINK_URL?.trim()
  if (explicit) return explicit
  const site = await getConnectedWebsite(await currentAccount()).catch(() => null)
  return site?.url?.trim() || ''
}

function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

/** The env vars publishing needs that aren't set yet. Empty = ready. */
export function publishMissingEnv(): string[] {
  const missing: string[] = []
  if (!process.env.META_ACCESS_TOKEN) missing.push('META_ACCESS_TOKEN')
  if (!process.env.META_AD_ACCOUNT_ID) missing.push('META_AD_ACCOUNT_ID')
  if (!process.env.META_PAGE_ID) missing.push('META_PAGE_ID')
  return missing
}

export function publishConfigured(): boolean {
  return publishMissingEnv().length === 0
}

// Signed, timeout-guarded Graph POST (form-encoded, as the Graph API expects).
async function graphPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new Error('META_ACCESS_TOKEN not configured')

  const body = new URLSearchParams(params)
  body.set('access_token', token)
  const proof = appSecretProof(token)
  if (proof) body.set('appsecret_proof', proof)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${GRAPH_BASE}/${apiVersion()}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    })
    const json = (await res.json()) as { error?: { message?: string; error_user_msg?: string } }
    if (!res.ok || json.error) {
      throw new Error(json.error?.error_user_msg || json.error?.message || `Graph API ${res.status}`)
    }
    return json as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

function accountPath(): string {
  const raw = (process.env.META_AD_ACCOUNT_ID ?? '').trim()
  return raw.startsWith('act_') ? raw : `act_${raw}`
}

// The object_story_spec call_to_action block, defaulting to a safe button type.
// The destination is resolved once per publish and passed in, so the button and
// the link_data can never point at different places.
function callToAction(pkg: MetaAdPackage, link: string): Record<string, unknown> {
  const cta = (pkg.cta ?? '').toUpperCase() as MetaCta
  return {
    type: META_CTA_OPTIONS.includes(cta) ? cta : 'LEARN_MORE',
    value: { link },
  }
}

/**
 * Create the ad creative in the connected account. Image ads publish as
 * link_data (picture URL inline); video ads first upload the clip by URL
 * (`advideos` with file_url — Meta pulls it server-side), then wrap it in
 * video_data with the still as the thumbnail.
 */
export async function publishCreativeToMeta(input: PublishInput): Promise<PublishResult> {
  const missing = publishMissingEnv()
  if (missing.length) {
    return {
      ok: false,
      notConfigured: true,
      missing,
      error: `Meta publishing isn't connected yet — set ${missing.join(', ')} in the environment.`,
    }
  }

  const { pkg, imageUrl, videoUrl } = input
  // The name lands in the customer's OWN Ads Manager, next to ads their team
  // made, and it is what the performance ingest reads back. It carried one
  // company's initials on every deployment; it now carries the connected
  // business's, or nothing at all.
  const tenant = await getTenant(await currentAccount()).catch(() => null)
  const prefix = tenant?.companyName?.trim() ? `${tenant.companyName.trim()} Reactor` : 'Reactor'
  const name = input.name?.trim() || `${prefix} — ${pkg.headline || 'Studio ad'}`.slice(0, 90)

  // Resolved once so the button and the link_data can never disagree, and
  // checked before anything is created: a live ad with no destination of its
  // own used to inherit the original tenant's domain.
  const link = await linkUrl()
  if (!link) {
    return {
      ok: false,
      notConfigured: true,
      missing: ['META_LINK_URL'],
      error:
        'This ad has nowhere to send the click — connect a website, or set META_LINK_URL to the destination these ads should point at.',
    }
  }

  try {
    if (videoUrl) {
      if (!imageUrl) {
        return {
          ok: false,
          error:
            'Meta requires a thumbnail for video creatives — generate the still for this concept first, then push again.',
        }
      }
      const upload = await graphPost(`${accountPath()}/advideos`, {
        file_url: videoUrl,
        name,
      })
      const videoId = String(upload.id ?? '')
      if (!videoId) return { ok: false, error: 'Meta accepted the video but returned no id.' }

      const creative = await graphPost(`${accountPath()}/adcreatives`, {
        name,
        object_story_spec: JSON.stringify({
          page_id: process.env.META_PAGE_ID,
          video_data: {
            video_id: videoId,
            image_url: imageUrl,
            title: pkg.headline,
            message: pkg.primaryText,
            link_description: pkg.description || undefined,
            call_to_action: callToAction(pkg, link),
          },
        }),
      })
      return { ok: true, creativeId: String(creative.id ?? ''), videoId }
    }

    if (!imageUrl) {
      return {
        ok: false,
        error: 'No creative to push — generate the image or video for this ad first.',
      }
    }

    const creative = await graphPost(`${accountPath()}/adcreatives`, {
      name,
      object_story_spec: JSON.stringify({
        page_id: process.env.META_PAGE_ID,
        link_data: {
          link,
          message: pkg.primaryText,
          name: pkg.headline,
          description: pkg.description || undefined,
          picture: imageUrl,
          call_to_action: callToAction(pkg, link),
        },
      }),
    })
    return { ok: true, creativeId: String(creative.id ?? '') }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `Meta rejected the ${ctaLabel(pkg)} creative.`,
    }
  }
}
