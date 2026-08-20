/**
 * Find the working Muapi endpoint slugs for the frontier image models.
 *
 * WHY: `lib/image/muapi.ts` maps our model ids to Muapi endpoint paths. Only
 * `flux-dev-image` was ever confirmed; vendor paths drift, and a 404'd frontier
 * slug costs you the model you asked for. FLUX.1 Dev used to catch those falls
 * and render the headline misspelled — it has been removed from the menu, so a
 * wrong slug now surfaces as a reported substitution instead. Every
 * slug is env-overridable precisely so this is fixable without a code change;
 * this script tells you which override to set.
 *
 * USAGE
 *   MUAPIAPP_API_KEY=<key> npx tsx scripts/muapi-slugs.ts
 *
 * COST: a slug that WORKS starts a real generation (~$0.03). At most one per
 * model — it stops probing a model as soon as a candidate is accepted. Use a
 * Muapi **Sandbox** key to spend nothing: sandbox keys return mock data
 * instantly and burn no credits.
 *
 * OUTPUT: paste-ready env lines for Vercel (Project → Settings → Environment
 * Variables), then redeploy.
 */

const API_BASE = process.env.MUAPI_API_BASE || 'https://api.muapi.ai/api/v1'
const KEY = process.env.MUAPIAPP_API_KEY || process.env.MUAPI_API_KEY

/**
 * Candidate paths per model, best guess first.
 *
 * The defaults in `lib/image/muapi.ts` are taken verbatim from Muapi's model
 * index (muapi.ai/llms.txt) and follow no single convention, so each entry here
 * leads with the current default and keeps plausible renames behind it. Run
 * this when a model starts 404ing after a vendor rename — it prints the env
 * override to set.
 */
const CANDIDATES: { envVar: string; label: string; slugs: string[] }[] = [
  {
    envVar: 'MUAPI_MODEL_NANO_BANANA_PRO',
    label: 'Nano Banana Pro',
    slugs: ['nano-banana-pro', 'nano-banana-pro-text-to-image', 'gemini-3-pro-image'],
  },
  {
    envVar: 'MUAPI_MODEL_GPT_IMAGE_2',
    label: 'GPT Image 2',
    slugs: ['gpt-image-2-text-to-image', 'gpt-image-2', 'gpt4o-text-to-image'],
  },
  {
    envVar: 'MUAPI_MODEL_IMAGEN4_ULTRA',
    label: 'Imagen 4 Ultra',
    slugs: ['google-imagen4-ultra', 'google-imagen4', 'google-imagen4-fast'],
  },
  {
    envVar: 'MUAPI_MODEL_NANO_BANANA_2',
    label: 'Nano Banana 2',
    slugs: ['nano-banana-2', 'nano-banana-2-lite', 'nano-banana'],
  },
  {
    envVar: 'MUAPI_MODEL_SEEDREAM',
    label: 'Seedream 5.0 Pro',
    slugs: ['bytedance-seedream-5.0-pro', 'bytedance-seedream-v5.0', 'bytedance-seedream-v4.5', 'bytedance-seedream-v4'],
  },
  {
    envVar: 'MUAPI_MODEL_FLUX_3',
    label: 'FLUX 3',
    slugs: ['flux-3-text-to-image', 'flux-3-dev', 'flux-2-pro'],
  },
  {
    envVar: 'MUAPI_MODEL_FLUX_KONTEXT_MAX',
    label: 'FLUX Kontext',
    slugs: ['flux-kontext-dev-t2i', 'flux-kontext-max', 'flux-kontext-pro'],
  },
  {
    envVar: 'MUAPI_MODEL_MIDJOURNEY',
    label: 'Midjourney V8',
    slugs: ['midjourney-v8', 'midjourney-v7', 'midjourney'],
  },
]

/**
 * VIDEO candidates. Same failure mode, worse symptom: `lib/video/registry.ts`
 * maps our video model ids to Muapi endpoint paths, and when the Veo slug
 * 404'd the whole clip failed — the Reactor was told video was unavailable and
 * shipped a STILL for a UGC video ad. The oven now falls across providers, but
 * that costs you the model you asked for, so resolve the real slugs here.
 *
 * The lead slug in each list is CONFIRMED against Muapi's own model index
 * (muapi.ai/llms.txt, pulled 2026-08-11) and is what `lib/video/registry.ts`
 * now defaults to — the invented `veo3` / `kling-pro` / `seedance-pro` /
 * `wan2.2` slugs that shipped a still instead of a UGC video are gone.
 * Remaining entries are plausible renames kept as a safety net for drift.
 */
const VIDEO_CANDIDATES: { envVar: string; label: string; slugs: string[] }[] = [
  {
    envVar: 'MUAPI_VIDEO_VEO31_T2V',
    label: 'Veo 3.1 · text-to-video',
    slugs: ['veo3.1-text-to-video', 'veo3.1-fast-text-to-video', 'veo3-text-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_VEO31_I2V',
    label: 'Veo 3.1 · image-to-video',
    slugs: ['veo3.1-image-to-video', 'veo3.1-fast-image-to-video', 'veo3-image-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_VEO31_R2V',
    label: 'Veo 3.1 · reference-to-video',
    slugs: ['veo3.1-reference-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_VEO4_T2V',
    label: 'Veo 4 · text-to-video',
    slugs: ['veo-4-text-to-video', 'veo4-text-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_VEO4_I2V',
    label: 'Veo 4 · image-to-video',
    slugs: ['veo-4-image-to-video', 'veo4-image-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_SEEDANCE2_T2V',
    label: 'Seedance 2.0 · text-to-video',
    slugs: ['seedance-2-text-to-video', 'seedance-2-t2v', 'seedance-2.1-text-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_SEEDANCE2_I2V',
    label: 'Seedance 2.0 · image-to-video',
    slugs: ['seedance-2-image-to-video', 'seedance-2-i2v', 'seedance-2.1-image-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_SEEDANCE2_R2V',
    label: 'Seedance 2.0 · omni-reference (face library)',
    slugs: ['seedance-2-omni-reference', 'seedance-2-omni-reference-no-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_SEEDANCE2_FAST_T2V',
    label: 'Seedance 2.0 Fast · text-to-video',
    slugs: ['seedance-2-text-to-video-fast', 'seedance-2-mini-text-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_SEEDANCE2_FAST_I2V',
    label: 'Seedance 2.0 Fast · image-to-video',
    slugs: ['seedance-2-image-to-video-fast', 'seedance-2-mini-image-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_SEEDANCE2_FAST_R2V',
    label: 'Seedance 2.0 Fast · omni-reference',
    slugs: ['seedance-2-omni-reference-no-video-fast', 'seedance-2-mini-omni-reference'],
  },
  {
    envVar: 'MUAPI_VIDEO_KLING3_T2V',
    label: 'Kling 3.0 · text-to-video',
    slugs: ['kling-v3.0-pro-text-to-video', 'kling-v3-turbo-pro-text-to-video', 'kling-v2.5-turbo-pro-t2v'],
  },
  {
    envVar: 'MUAPI_VIDEO_KLING3_I2V',
    label: 'Kling 3.0 · image-to-video',
    slugs: ['kling-v3.0-pro-image-to-video', 'kling-v3-turbo-pro-image-to-video', 'kling-v2.5-turbo-pro-i2v'],
  },
  {
    envVar: 'MUAPI_VIDEO_WAN27_T2V',
    label: 'Wan 2.7 · text-to-video',
    slugs: ['wan2.7-text-to-video', 'wan2.6-text-to-video', 'wan2.5-text-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_WAN27_I2V',
    label: 'Wan 2.7 · image-to-video',
    slugs: ['wan2.7-image-to-video', 'wan2.6-image-to-video', 'wan2.5-image-to-video'],
  },
  {
    envVar: 'MUAPI_VIDEO_WAN27_R2V',
    label: 'Wan 2.7 · reference-to-video',
    slugs: ['wan2.7-reference-to-video', 'wan2.1-reference-video'],
  },
]

const PROBE = { prompt: 'a plain grey square', aspect_ratio: '1:1', num_images: 1 }

/**
 * An image-to-video endpoint rejects a payload with no still, which is a 4xx we
 * would misread as "slug does not exist". Probing with a public still keeps the
 * signal clean: 404 means the path is wrong, anything else means it is right.
 */
const I2V_PROBE_IMAGE =
  process.env.MUAPI_PROBE_IMAGE_URL || 'https://picsum.photos/seed/tpbprobe/512/512'

function probeBody(slug: string, kind: 'image' | 'video'): Record<string, unknown> {
  if (kind === 'image') return PROBE
  const body: Record<string, unknown> = { prompt: 'a plain grey square', aspect_ratio: '9:16' }
  if (slug.includes('image-to-video') || slug.includes('i2v')) body.image_url = I2V_PROBE_IMAGE
  // Reference / omni-reference endpoints want a LIST of stills, and reject a
  // payload without one — a 4xx we would otherwise read as "no such slug".
  if (slug.includes('reference')) body.image_urls = [I2V_PROBE_IMAGE]
  return body
}

async function probe(
  slug: string,
  kind: 'image' | 'video' = 'image',
): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const res = await fetch(`${API_BASE}/${slug}`, {
      method: 'POST',
      headers: { 'x-api-key': KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify(probeBody(slug, kind)),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    const id = body?.request_id ?? body?.id
    const detail = String(body?.message ?? body?.error ?? res.statusText ?? '')
    return { ok: res.ok && Boolean(id), status: res.status, detail }
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  if (!KEY) {
    console.error(
      '\nMUAPIAPP_API_KEY is not set.\n\n  MUAPIAPP_API_KEY=<your key> npx tsx scripts/muapi-slugs.ts\n\nUse a Muapi Sandbox key to probe without spending credits.\n',
    )
    process.exit(1)
  }

  const onlyImages = process.argv.includes('--images')
  const onlyVideo = process.argv.includes('--video')
  const menu: { kind: 'image' | 'video'; entries: typeof CANDIDATES }[] = []
  if (!onlyVideo) menu.push({ kind: 'image', entries: CANDIDATES })
  if (!onlyImages) menu.push({ kind: 'video', entries: VIDEO_CANDIDATES })

  console.log(`\nProbing ${API_BASE} …\n`)
  const found: { envVar: string; slug: string }[] = []
  const missing: string[] = []

  for (const { kind, entries } of menu) {
    console.log(`  ── ${kind === 'image' ? 'IMAGE' : 'VIDEO'} models ──`)
    for (const model of entries) {
      let hit: string | null = null
      const tried: string[] = []
      for (const slug of model.slugs) {
        const r = await probe(slug, kind)
        if (r.ok) {
          hit = slug
          break
        }
        tried.push(`${slug} → ${r.status || 'network'}${r.detail ? ` ${r.detail}` : ''}`)
      }
      if (hit) {
        console.log(`  ✓ ${model.label}: ${hit}`)
        found.push({ envVar: model.envVar, slug: hit })
      } else {
        console.log(`  ✗ ${model.label}: none of the candidates worked`)
        tried.forEach((t) => console.log(`      ${t}`))
        missing.push(model.label)
      }
    }
  }

  if (found.length) {
    console.log('\nPaste these into Vercel → Settings → Environment Variables, then redeploy:\n')
    found.forEach((f) => console.log(`${f.envVar}=${f.slug}`))
  }
  if (missing.length) {
    console.log(
      `\nStill unresolved: ${missing.join(', ')}.\nOpen your Muapi dashboard, copy the endpoint path shown for each model, and set its variable by hand.\n`,
    )
  }
  console.log('')
}

main()
