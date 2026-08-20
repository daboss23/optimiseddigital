import { NextResponse } from 'next/server'
import { generateMuapiImage, muapiEndpointFor, muapiImageConfigured } from '@/lib/image/muapi'
import { muapiVideoConfigured } from '@/lib/video/muapi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Browser-hittable check that MUAPIAPP_API_KEY actually works on the deployed
 * host — no terminal required. Open it on the deployment:
 *
 *   /api/muapi/health            → FREE. Key presence + a live auth probe that
 *                                  starts no generation and spends no credits.
 *   /api/muapi/health?render=1   → spends. Renders one real still (~$0.03 on a
 *                                  live key, $0 on a Sandbox key) and returns
 *                                  the image URL, proving the whole path.
 *   /api/muapi/health?render=1&model=muapi-nano-banana-pro
 *                                → same, on a specific model, which is how you
 *                                  confirm a frontier slug rather than the
 *                                  FLUX.1 Dev fallback.
 *
 * The auth probe asks Muapi for a prediction id that cannot exist. A rejected
 * key answers 401/403; an accepted key answers "no such prediction" — which is
 * exactly the signal we want, at zero cost.
 *
 * Never returns the key itself, only whether one is present and its length.
 * Per project rules this never throws — every failure comes back as JSON.
 */

const API_BASE = process.env.MUAPI_API_BASE || 'https://api.muapi.ai/api/v1'
const PROBE_ID = '00000000-0000-0000-0000-000000000000'
const DEFAULT_RENDER_MODEL = 'muapi-flux-dev'

function muapiKey(): string | undefined {
  return process.env.MUAPIAPP_API_KEY || process.env.MUAPI_API_KEY
}

type AuthProbe = {
  reachable: boolean
  httpStatus?: number
  keyAccepted: boolean | null
  detail: string
}

async function probeAuth(key: string): Promise<AuthProbe> {
  try {
    const res = await fetch(`${API_BASE}/predictions/${PROBE_ID}/result`, {
      headers: { 'x-api-key': key },
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const message = String(body?.message ?? body?.error ?? res.statusText ?? '')

    if (res.status === 401 || res.status === 403) {
      return {
        reachable: true,
        httpStatus: res.status,
        keyAccepted: false,
        detail: `Muapi rejected the key (HTTP ${res.status}${message ? `: ${message}` : ''}). Check for a stray space or newline in the Vercel value, and that it was saved to the environment this deployment runs in.`,
      }
    }

    return {
      reachable: true,
      httpStatus: res.status,
      keyAccepted: true,
      detail:
        'Muapi accepted the key and answered the lookup for a non-existent prediction, which is the expected result. Add ?render=1 to prove a real render end to end.',
    }
  } catch (err) {
    return {
      reachable: false,
      keyAccepted: null,
      detail: `Could not reach ${API_BASE}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const wantsRender = ['1', 'true', 'yes'].includes(
    (url.searchParams.get('render') || '').toLowerCase(),
  )
  const modelId = url.searchParams.get('model') || DEFAULT_RENDER_MODEL

  const key = muapiKey()
  const env = {
    variableSet: Boolean(process.env.MUAPIAPP_API_KEY)
      ? 'MUAPIAPP_API_KEY'
      : Boolean(process.env.MUAPI_API_KEY)
        ? 'MUAPI_API_KEY (fallback name)'
        : null,
    keyPresent: Boolean(key),
    keyLength: key?.length ?? 0,
    // A key pasted with surrounding whitespace authenticates locally and fails
    // in Vercel, and the symptom looks identical to a wrong key.
    keyHasWhitespace: Boolean(key && key.trim() !== key),
    apiBase: API_BASE,
    imageOvenUsesMuapi: muapiImageConfigured(),
    videoOvenUsesMuapi: muapiVideoConfigured(),
  }

  if (!key) {
    return NextResponse.json({
      ok: false,
      env,
      auth: null,
      render: null,
      verdict:
        'No Muapi key is visible to this deployment. In Vercel set MUAPIAPP_API_KEY for the environment you are testing (Production and/or Preview) and REDEPLOY — environment variables are baked in at deploy time, so an existing deployment will not pick up a key added after it was built.',
    })
  }

  const auth = await probeAuth(key)

  let render: {
    requestedModel: string
    endpoint?: string
    ok: boolean
    imageUrl?: string
    error?: string
  } | null = null

  if (wantsRender) {
    const endpoint = muapiEndpointFor(modelId)
    if (!endpoint) {
      render = {
        requestedModel: modelId,
        ok: false,
        error: `Unknown Muapi model id "${modelId}". Use one of the muapi-* ids listed by /api/image/models.`,
      }
    } else {
      const result = await generateMuapiImage(
        modelId,
        'A plain matte charcoal square, centred, studio lighting, no text',
        '1:1',
      )
      render = {
        requestedModel: modelId,
        endpoint,
        ok: Boolean(result.url),
        imageUrl: result.url ?? undefined,
        error: result.error,
      }
    }
  }

  const ok = auth.keyAccepted === true && (!wantsRender || Boolean(render?.ok))

  return NextResponse.json({
    ok,
    env,
    auth,
    render,
    verdict: ok
      ? wantsRender
        ? `Key works and ${modelId} rendered — open the imageUrl above to see the still.`
        : 'Key is accepted by Muapi. Re-open this URL with ?render=1 to confirm a real render (spends one generation, or nothing on a Sandbox key).'
      : render && !render.ok
        ? `The key authenticates but ${modelId} did not render: ${render.error ?? 'unknown error'}. If this is a 404 the endpoint slug has drifted — run "npm run muapi:slugs" and set the printed MUAPI_MODEL_* override in Vercel.`
        : auth.detail,
  })
}
