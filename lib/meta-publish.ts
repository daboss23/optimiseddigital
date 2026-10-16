import crypto from 'crypto'
import { listAccountIds } from '@/lib/meta-graph'
import { resolveMetaCredentials } from '@/lib/operator/adapters/meta-credentials'
import { assertSafeUrl } from '@/lib/website-intelligence'
import { readCapped, safeFetch } from '@/lib/safe-fetch'
import { metaAssetName } from '@/lib/meta-ads'

/**
 * Upload to Meta — puts a finished creative into the brand's OWN ad account,
 * in its media library, ready to drop into any ad.
 *
 *   image → POST act_X/adimages   (multipart; Meta returns the image hash)
 *   video → POST act_X/advideos   (file_url; Meta pulls the clip itself)
 *
 * WHY THE MEDIA LIBRARY AND NOT AN AD CREATIVE. The platform used to build a
 * full `adcreatives` object — caption, headline, link, CTA — which needed a
 * Page id, a destination URL and copy the brand never saw. The platform now
 * makes the creative, not the caption (see lib/meta-ads.ts), so the upload
 * puts the asset where a media buyer actually builds from: the library their
 * Advantage+ and manual ads both pick creatives out of. It needs a token and
 * an ad account, nothing else.
 *
 * WHOSE AD ACCOUNT. Credentials resolve PER ACCOUNT through
 * `resolveMetaCredentials` — the brand's stored connection first, the
 * deployment env second. The publisher this replaces read the deployment env
 * only, so on a multi-brand deployment every brand's creatives would have been
 * pushed into one ad account. An upload with no unambiguous destination is
 * refused rather than guessed.
 *
 * ATTRIBUTION. Every asset is named with its RXN token (`metaAssetName`), and
 * the route pre-seeds a pending outcome carrying the returned image hash or
 * video id — so an ad built from this asset in Ads Manager, under whatever name
 * the buyer gives it, still grades back to the variant it came from.
 *
 * Per CLAUDE.md this module never throws: every failure resolves to a
 * structured `{ ok: false }` result the Launch Bay renders inline.
 */

const GRAPH_BASE = 'https://graph.facebook.com'
/** Uploads move megabytes, not a JSON page — a read's 6s would cut them off. */
const GRAPH_TIMEOUT_MS = 45_000
const SOURCE_TIMEOUT_MS = 20_000
/** Meta's own ceiling for an ad image. */
const MAX_IMAGE_BYTES = 30 * 1024 * 1024

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface UploadInput {
  /** The rendered still. Uploaded when there is no clip. */
  imageUrl?: string
  /** A rendered clip — uploaded instead of the still when present. */
  videoUrl?: string
  /** The library name, normally `metaAdName(...)` so it leads with the RXN token. */
  name: string
}

export interface UploadedAsset {
  kind: 'image' | 'video'
  /** The name the asset carries in the Meta media library. */
  name: string
  /** Image hash — what an ad's creative references, and what the ingest matches on. */
  imageHash?: string
  /** Meta's own CDN copy of the image. */
  metaUrl?: string
  videoId?: string
}

export interface UploadResult {
  ok: boolean
  /** The ad account the asset landed in, without the act_ prefix. */
  adAccountId?: string
  asset?: UploadedAsset
  error?: string
  /** True when the failure is a missing or ambiguous connection, not an API error. */
  notConfigured?: boolean
}

export interface UploadTarget {
  token: string
  adAccountId: string
  origin: 'settings' | 'env'
}

export type TargetResolution =
  | { ok: true; target: UploadTarget }
  | { ok: false; error: string; notConfigured: boolean }

function apiVersion(): string {
  return process.env.META_API_VERSION || 'v19.0'
}

function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

/**
 * Where this account's uploads go — or why they cannot go anywhere yet.
 *
 * A connection with no chosen account is resolved only when the token can see
 * exactly ONE ad account. With several, picking the first would upload a
 * brand's creatives into whichever account Meta happened to list first.
 */
export async function resolveUploadTarget(accountId: string | null): Promise<TargetResolution> {
  const creds = await resolveMetaCredentials(accountId)
  if (!creds) {
    return {
      ok: false,
      notConfigured: true,
      error: 'Meta isn’t connected for this brand yet — connect an ad account on Meta Intelligence.',
    }
  }
  if (creds.accountId) {
    return { ok: true, target: { token: creds.token, adAccountId: creds.accountId, origin: creds.origin } }
  }
  let ids: string[] = []
  try {
    ids = await listAccountIds(creds.token)
  } catch (err) {
    return { ok: false, notConfigured: true, error: friendlyGraphError(err) }
  }
  if (ids.length === 1) {
    return { ok: true, target: { token: creds.token, adAccountId: ids[0], origin: creds.origin } }
  }
  return {
    ok: false,
    notConfigured: true,
    error:
      ids.length === 0
        ? 'The connected Meta token can see no ad accounts.'
        : `The connected Meta token can see ${ids.length} ad accounts — choose the one to upload to on Meta Intelligence.`,
  }
}

/** Is uploading possible for this account, and into which ad account. */
export async function uploadStatus(accountId: string | null): Promise<{
  configured: boolean
  adAccountId?: string
  origin?: 'settings' | 'env'
  reason?: string
}> {
  const resolved = await resolveUploadTarget(accountId)
  if (!resolved.ok) return { configured: false, reason: resolved.error }
  return { configured: true, adAccountId: resolved.target.adAccountId, origin: resolved.target.origin }
}

interface GraphErrorBody {
  error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number }
}

class GraphError extends Error {
  code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

/**
 * Turn the Graph API's error into the sentence the operator can act on. The
 * two that actually happen on a first upload are a token that can READ the
 * account but not WRITE to it, and a token that has expired.
 */
export function friendlyGraphError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const fromGraph = err instanceof GraphError
  const code = fromGraph ? err.code : undefined
  if (code === 190 || /error validating access token|session has expired|invalid oauth/i.test(message)) {
    return 'The Meta token has expired or been revoked — reconnect Meta on Meta Intelligence.'
  }
  // Only a Graph refusal is read as a permission problem: a creative CDN that
  // answers 403 is not the ad account saying no, and telling the operator to
  // fix their token for it would send them after the wrong thing.
  if (fromGraph && (code === 200 || code === 10 || /ads_management|permission/i.test(message))) {
    return 'The connected Meta token can read this ad account but not upload to it — it needs the ads_management permission.'
  }
  return message || 'Meta rejected the upload.'
}

async function graphPost(path: string, body: FormData | URLSearchParams): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH_BASE}/${apiVersion()}/${path}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  })
  const json = (await res.json().catch(() => ({}))) as GraphErrorBody & Record<string, unknown>
  if (!res.ok || json.error) {
    throw new GraphError(
      json.error?.error_user_msg || json.error?.message || `Graph API ${res.status}`,
      json.error?.code,
    )
  }
  return json
}

/** A public https URL, or a reason it cannot be fetched. */
function safeSource(raw: string | undefined, what: string): { url: string } | { error: string } {
  if (!raw?.trim()) return { error: `No ${what} to upload.` }
  let u: URL
  try {
    u = assertSafeUrl(raw)
  } catch (err) {
    return { error: err instanceof Error ? err.message : `The ${what} URL is not usable.` }
  }
  if (u.protocol !== 'https:') return { error: `Only https ${what} URLs can be uploaded.` }
  return { url: u.toString() }
}

async function uploadImage(target: UploadTarget, imageUrl: string, name: string): Promise<UploadedAsset> {
  // Every redirect hop re-validated — the URL came from a client.
  const fetched = await safeFetch(imageUrl, { timeoutMs: SOURCE_TIMEOUT_MS })
  if (!fetched) throw new Error('The creative could not be fetched.')
  const { res } = fetched
  if (!res.ok) throw new Error(`The creative could not be fetched (${res.status}).`)
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const ext = IMAGE_EXTENSIONS[contentType]
  if (!ext) throw new Error('The creative URL did not return an image Meta accepts (PNG, JPG, WEBP or GIF).')
  const bytes = await readCapped(res, MAX_IMAGE_BYTES)
  if (!bytes) throw new Error('The creative is over Meta’s 30 MB image limit.')
  if (bytes.byteLength === 0) throw new Error('The creative came back empty.')

  const fileName = metaAssetName(name, ext)
  const form = new FormData()
  form.append('access_token', target.token)
  const proof = appSecretProof(target.token)
  if (proof) form.append('appsecret_proof', proof)
  form.append('filename', new Blob([bytes], { type: contentType }), fileName)

  const json = (await graphPost(`act_${target.adAccountId}/adimages`, form)) as {
    images?: Record<string, { hash?: string; url?: string }>
  }
  const first = Object.values(json.images ?? {})[0]
  if (!first?.hash) throw new Error('Meta accepted the image but returned no hash.')
  return { kind: 'image', name: fileName, imageHash: first.hash, metaUrl: first.url }
}

async function uploadVideo(target: UploadTarget, videoUrl: string, name: string): Promise<UploadedAsset> {
  const params = new URLSearchParams({ file_url: videoUrl, name, title: name })
  params.set('access_token', target.token)
  const proof = appSecretProof(target.token)
  if (proof) params.set('appsecret_proof', proof)
  const json = await graphPost(`act_${target.adAccountId}/advideos`, params)
  const videoId = String(json.id ?? '')
  if (!videoId) throw new Error('Meta accepted the video but returned no id.')
  return { kind: 'video', name, videoId }
}

/**
 * Upload one finished creative into the brand's ad account media library.
 *
 * A clip wins over its still: when both exist the motion IS the ad and the
 * still was its source frame. Pass a resolved `target` to reuse one credential
 * lookup across a bulk upload.
 */
export async function uploadCreativeToMeta(
  input: UploadInput,
  accountId: string | null,
  target?: UploadTarget,
): Promise<UploadResult> {
  let resolvedTarget = target
  if (!resolvedTarget) {
    const resolved = await resolveUploadTarget(accountId)
    if (!resolved.ok) return { ok: false, notConfigured: resolved.notConfigured, error: resolved.error }
    resolvedTarget = resolved.target
  }

  const name = input.name.trim() || 'Reactor creative'
  const source = input.videoUrl?.trim()
    ? { kind: 'video' as const, check: safeSource(input.videoUrl, 'video') }
    : { kind: 'image' as const, check: safeSource(input.imageUrl, 'creative') }
  if ('error' in source.check) return { ok: false, error: source.check.error }

  try {
    const asset =
      source.kind === 'video'
        ? await uploadVideo(resolvedTarget, source.check.url, name)
        : await uploadImage(resolvedTarget, source.check.url, name)
    return { ok: true, adAccountId: resolvedTarget.adAccountId, asset }
  } catch (err) {
    return { ok: false, adAccountId: resolvedTarget.adAccountId, error: friendlyGraphError(err) }
  }
}
