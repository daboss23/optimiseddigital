import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { searchKnowledge } from '@/lib/knowledge'
import { learnings } from '@/lib/reactor-data'
import { INTELLIGENCE, INTELLIGENCE_IDS, isIntelligenceId, type IntelligenceId } from '@/lib/agents'
import {
  ORCHESTRATOR_MODEL,
  ORCHESTRATOR_FALLBACK_MODEL,
  SERVER_SIDE_FALLBACK_BETA,
  INTELLIGENCE_MODEL as TIER_INTELLIGENCE_MODEL,
} from '@/lib/models'
import { generateImageWith, imageConfigured, listImageModels, type AspectRatio } from '@/lib/image'
import {
  startVideoJob,
  listVideoModels,
  videoConfigured,
  type GenMode,
} from '@/lib/video'
import { logGeneration } from '@/lib/video/persistence'
import { retrieveWinningConfigs, type WinningConfig } from '@/lib/outcomes'
import { outputTypeOptions, type ReactorInputs, type ProductionBrief, type NeuroScore } from '@/lib/reactor-inputs'
import {
  retrieveNeuroPrinciples,
  scoreConceptsNeuro,
  weakConceptIndices,
  neuroFeedback,
  demoNeuroScore,
} from '@/lib/neuro'
import {
  META_CRAFT_BLOCK,
  adPackageSchema,
  adPackageFeedback,
  demoAdPackage,
  type MetaAdPackage,
} from '@/lib/meta-ads'
import {
  AXIS_TAXONOMY_KEY,
  axisValues,
  coerceTaxonomy,
  describeTaxonomy,
  isolationBlock,
  cloneBlock,
  type IterationAxis,
  type CreativeTaxonomy,
  type CloneReference,
} from '@/lib/taxonomy'
import { bestVisualReferenceFor } from '@/lib/visual-library'

// ORACLE strategic memory injected into OPUS at fire time — past winning
// configurations matching the brief, so generation reuses what worked.
function memoryBlock(configs: WinningConfig[]): string {
  if (configs.length === 0) return ''
  const lines = configs
    .map((c, i) => {
      const parts = [
        `Angle: ${c.angle}`,
        c.audience && `Audience: ${c.audience}`,
        c.awareness && `Awareness: ${c.awareness}`,
        c.offer && `Offer: ${c.offer}`,
        c.creativeStructure && `Creative: ${c.creativeStructure}`,
        c.copyStructure && `Copy: ${c.copyStructure}`,
        typeof c.score === 'number' && `win score ${c.score}`,
      ].filter(Boolean)
      const snippet = c.conceptText ? ` — "${c.conceptText.slice(0, 140)}"` : ''
      return `${i + 1}. ${parts.join(' · ')}${snippet}`
    })
    .join('\n')
  return `\n\nORACLE STRATEGIC MEMORY — past WINNING configurations that match this brief. Reuse what worked (structure, offer framing, proof patterns); adapt, don't copy verbatim:\n${lines}`
}

export const runtime = 'nodejs'
export const maxDuration = 300

// OPUS — the Master Strategist brain (strategy + synthesis) — and the cheaper
// model the intelligence layers (ATLAS/NOVA/SPARK/ECHO/ORACLE) run on.
// Both are defined once in lib/models.ts so a model bump is a single change.
// The orchestrator runs on Claude Fable 5 with Opus 4.8 wired as the fallback
// at two levels: the server-side `fallbacks` param re-serves safety-classifier
// declines inside the same call, and a client-side switch keeps the run alive
// when the org can't use Fable 5 at all (e.g. data-retention requirement).
const OPUS_MODEL = ORCHESTRATOR_MODEL
const OPUS_FALLBACK_MODEL = ORCHESTRATOR_FALLBACK_MODEL
const INTELLIGENCE_MODEL = TIER_INTELLIGENCE_MODEL
// NEURO (Predicted Response pre-test) runs on the cheap intelligence model — it
// is a structured grading pass, not strategy, so it never touches OPUS's budget.
const NEURO_MODEL = INTELLIGENCE_MODEL
// How many times OPUS may be sent back to revise concepts that fail the neural
// pre-test before we ship the best it has. Bounded so cost/turns stay capped.
const MAX_NEURO_REVISIONS = 1
const MAX_TURNS = 12

/**
 * How many empty `submit_concepts` calls are handed back before the run stops.
 * One is a truncated turn worth retrying; two is a model that cannot fit the
 * submission, and burning the remaining turns on it only delays the report.
 */
const MAX_EMPTY_SUBMISSIONS = 1

/* ------------------------------ Run budget -------------------------------- */

/**
 * Wall-clock budget for a single run, in milliseconds.
 *
 * `maxDuration` above is a REQUEST, not a guarantee — the host enforces its own
 * ceiling (Vercel Hobby kills the function at 60s no matter what the route
 * declares). When that happens the SSE stream simply stops: no terminal event,
 * no concepts, the whole run lost. The budget below keeps the run inside a
 * limit we control, so an overrun degrades to partial output instead of
 * vanishing.
 *
 * Default 280s targets the 300s ceiling Vercel serves on EVERY plan, Hobby
 * included, once Fluid compute is on — which it is by default. The old 50s
 * default was written against the pre-Fluid 60s Hobby limit and is now simply
 * wrong on a stock deployment: it forced the fast path (one turn, no revision
 * pass) onto a host with five minutes to spare.
 *
 * The budget only guards the orchestrator LOOP — the NEURO scoring pass runs
 * after the final turn and is not counted — so the default leaves 20s of tail
 * for that scoring to land rather than sitting flush against the ceiling.
 *
 * LOWER it on a host that genuinely kills functions sooner (a legacy 60s
 * plan, a self-hosted runner, a proxy with a shorter idle timeout). Anything
 * under 90s engages the FAST PATH described below:
 *   REACTOR_BUDGET_MS=50000
 */
const RUN_BUDGET_MS = (() => {
  const raw = Number(process.env.REACTOR_BUDGET_MS)
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 280_000
})()

/** Past this share of the budget, OPUS is told to stop exploring and submit. */
const BUDGET_NUDGE_AT = 0.65
/** Past this share, the run closes cleanly with whatever it has. */
const BUDGET_CLOSE_AT = 0.88
/**
 * Ceiling on the preflight briefing as a share of the whole budget.
 *
 * The briefing is three parallel model calls plus retrieval, and on a slow one
 * it used to be allowed to run until the clock was gone — the loop then found
 * no room for even a first turn and the run ended with full intelligence and
 * ZERO ads. Research that costs the entire generation window is not research,
 * it is a failed run, so it is now cut off with the majority of the budget
 * still unspent.
 */
const PREFLIGHT_MAX_SHARE = 0.45

/**
 * FAST PATH — for hosts with a hard short ceiling (Vercel Hobby caps functions
 * at 60s, so the budget can never be raised past it).
 *
 * A default run wants three orchestrator turns (consult → refine → submit) on
 * Fable 5, whose thinking is always on and costs 20-40s per turn. Add the
 * preflight briefing and that is comfortably over a minute — the run times out
 * having produced intelligence but no ads, every time.
 *
 * Under a short budget the run trades exploration depth for actually landing:
 *   - orchestration runs on Opus 4.8, which has no always-on thinking and turns
 *     over several times faster
 *   - OPUS is told from its first message that the preflight evidence IS its
 *     research and to submit immediately
 *   - the NEURO revision pass is dropped, so the first submission ships with
 *     its scores attached rather than costing another full turn
 *
 * Engages off the budget alone — no extra configuration. Setting
 * REACTOR_BUDGET_MS below this line is all a Hobby deployment needs.
 */
const FAST_PATH_UNDER_MS = 90_000
const FAST_PATH = RUN_BUDGET_MS < FAST_PATH_UNDER_MS

/**
 * Rendering a still BLOCKS this route. fal's image path returns the URL inline
 * (video is queued and polled), so each generate_image call parks the whole
 * orchestrator for 15-25s — several of those inside one run is what pushes it
 * past the host's ceiling.
 *
 * The client already renders every visual concept from its production brief
 * once the stream closes (`briefToPrompt` → /api/generate-image), outside this
 * function's budget and with its own per-render window. So by default the agent
 * plans the creative and the client renders it: same brief, same prompt path,
 * no blocking.
 *
 * Set REACTOR_INLINE_IMAGES=1 to hand the tool back to the agent where the host
 * allows genuinely long runs and agent-authored prompts are worth the wait.
 */
const INLINE_IMAGES = process.env.REACTOR_INLINE_IMAGES === '1'

// The Creative Learnings rubric is a static, documented list — it does not change
// within a process, so build the get_learnings tool-result string once and reuse
// it across every run instead of re-mapping the array on each self-critique call.
const LEARNINGS_RUBRIC = learnings
  .map((l) => `• ${l.insight} — ${l.recommendation} (evidence: ${l.evidence})`)
  .join('\n')

// MCP connector (Messages API) beta — lets the coordinator call remote MCP
// tools (Meta Ads) that Anthropic executes server-side.
const MCP_BETA = 'mcp-client-2025-11-20'
const META_ADS_MCP_NAME = 'meta_ads'

// Which Meta Ads MCP backs the live performance feed for a run.
//   'off'       — no Meta Ads tools attached (fire the reactor standalone)
//   'pipeboard' — Pipeboard's hosted MCP (token via `?token=` query param)
//   'meta'      — Meta's first-party Ads MCP at mcp.facebook.com/ads (OAuth bearer)
type MetaProvider = 'off' | 'pipeboard' | 'meta'

/**
 * Isolation-mode configuration — test exactly ONE variable. Additive: when
 * `isolate` is absent the reactor runs today's free-generation path untouched.
 */
interface IsolateInput {
  axis: IterationAxis
  values: string[]
  lockedTaxonomy: CreativeTaxonomy
  notes?: string
}

// A cloned reference's Creative DNA the run reproduces STRUCTURALLY (never
// verbatim) — sourced from a SPARK visual read, a Meta Ad Library ad, or a past
// winner. The shape lives in lib/taxonomy.ts and is shared by the Ad Library UI,
// the SPARK analyzer, the sessionStorage handoff and this payload so it cannot
// drift. Additive — absent = no clone constraint.

interface ReactorRequest {
  angle: string
  inputs?: string[]
  outputs?: string[]
  builderId?: string | null
  videoModel?: string | null
  imageModel?: string | null
  metaProvider?: MetaProvider | null
  reactorInputs?: ReactorInputs
  /** Isolation mode — vary one taxonomy axis, hold the rest fixed. */
  isolate?: IsolateInput | null
  /** Clone mode — reproduce a proven reference's structure. */
  cloneReference?: CloneReference | null
}

interface Concept {
  type: string
  text: string
  basis?: string
  learningCheck?: string
  score?: number
  imageUrl?: string
  productionBrief?: ProductionBrief
  neuro?: NeuroScore
  adPackage?: MetaAdPackage
  // Clone & Iterate — the fixed taxonomy this concept is tagged with, plus the
  // test-attribution IDs that thread the hypothesis through to Meta + ingest.
  taxonomy?: CreativeTaxonomy
  testId?: string
  variantId?: string
  isolatedAxis?: string
}

/* ------------------------- Test-ID attribution ---------------------------- */

// Test IDs thread a hypothesis through concepts → Meta ad names → performance
// ingest so a synced outcome auto-attributes to the variable being tested. A
// test (one isolation run) is RXN-{token}; each concept in it is a variant
// RXN-{token}-A / -B / -C… so ORACLE can compare variants WITHIN a test.
function mintTestId(): string {
  return `RXN-${Date.now().toString(36).slice(-5).toUpperCase()}`
}

// A, B, … Z, AA, AB… — a spreadsheet-style column label for any test width.
function variantLabel(i: number): string {
  let n = i
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

// Stamp isolation-test attribution + fixed taxonomy onto submitted concepts.
// The isolated axis takes the model's per-concept value (coerced to canonical
// vocab), falling back to the requested test values; every other axis inherits
// the locked config. No-op without an isolate block — free generation untouched.
function tagIsolatedConcepts(concepts: Concept[], isolate: IsolateInput, testId: string): void {
  const key = AXIS_TAXONOMY_KEY[isolate.axis]
  concepts.forEach((c, i) => {
    const testedValue = c.taxonomy?.[key] || isolate.values[i] || isolate.values[0]
    c.taxonomy = coerceTaxonomy({ ...isolate.lockedTaxonomy, ...c.taxonomy, [key]: testedValue })
    c.testId = testId
    c.variantId = `${testId}-${variantLabel(i)}`
    c.isolatedAxis = isolate.axis
  })
}

/* ------------------------------ Meta Ads MCP ------------------------------ */

// Default provider when a run doesn't specify one. Env-overridable so the whole
// platform can be flipped to Meta's first-party MCP without a code change.
function defaultMetaProvider(): MetaProvider {
  return process.env.META_ADS_PROVIDER === 'meta' ? 'meta' : 'pipeboard'
}

// Meta's first-party Ads MCP (mcp.facebook.com/ads). Auth is an OAuth bearer
// token passed via the connector's `authorization_token` field — not a query
// param. Returns null (Meta Ads simply unavailable) when unconfigured.
function metaFirstPartyServer(): Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition | null {
  const token = process.env.META_ADS_ACCESS_TOKEN
  if (!token) return null
  const url = process.env.META_ADS_FIRSTPARTY_URL || 'https://mcp.facebook.com/ads'
  return { type: 'url', name: META_ADS_MCP_NAME, url, authorization_token: token }
}

// Pipeboard's hosted Meta Ads MCP. Token auth via the documented `?token=`
// query param. Returns null (Meta Ads simply unavailable) when unconfigured.
function pipeboardServer(): Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition | null {
  const token = process.env.PIPEBOARD_API_TOKEN
  const baseUrl = process.env.META_ADS_MCP_URL || 'https://meta-ads.mcp.pipeboard.co/'
  if (!token && !process.env.META_ADS_MCP_URL) return null
  const url = token
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : baseUrl
  return { type: 'url', name: META_ADS_MCP_NAME, url }
}

// Resolves the Meta Ads MCP for a run. Honours the per-run provider override
// (so both backends can be tested side by side), falling back to the env
// default. If the requested provider isn't configured, falls back to the other
// configured one rather than running blind — and returns null when neither is.
function metaAdsServer(
  requested?: MetaProvider | null,
): { server: Anthropic.Beta.Messages.BetaRequestMCPServerURLDefinition; provider: MetaProvider } | null {
  const provider = requested ?? defaultMetaProvider()
  if (provider === 'off') return null
  const meta = metaFirstPartyServer()
  const pipeboard = pipeboardServer()

  if (provider === 'meta' && meta) return { server: meta, provider: 'meta' }
  if (provider === 'pipeboard' && pipeboard) return { server: pipeboard, provider: 'pipeboard' }
  // Requested provider unconfigured — use whichever is available.
  if (meta) return { server: meta, provider: 'meta' }
  if (pipeboard) return { server: pipeboard, provider: 'pipeboard' }
  return null
}

/* ------------------------------ SSE plumbing ------------------------------ */

function sse(controller: ReadableStreamDefaultController, event: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
}

/* ------------------------------ Resilience -------------------------------- */

// Anthropic occasionally returns 429 (rate limit) or 529 (overloaded). These are
// transient — retry with exponential backoff instead of failing the whole run.
async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<T> {
  const MAX = 4
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number })?.status
      const retriable = status === 429 || status === 500 || status === 503 || status === 529
      if (!retriable || attempt === MAX) throw err
      const wait = 1000 * 2 ** attempt // 1s, 2s, 4s, 8s
      onRetry?.(attempt + 1, wait)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr
}

/* --------------------------------- Tools ---------------------------------- */

function buildTools(
  useImage: boolean,
  useVideo: boolean,
  useMetaAds: boolean,
): Anthropic.Beta.Messages.BetaToolUnion[] {
  const videoModelIds = listVideoModels()
    .filter((m) => m.configured)
    .map((m) => m.id)
  const configuredImageModels = listImageModels().filter((m) => m.configured)
  const imageModelIds = configuredImageModels.map((m) => m.id)
  const imageModelGuide = configuredImageModels.length
    ? configuredImageModels.map((m) => `${m.id} = ${m.notes}`).join(' ')
    : 'fal-flux = photoreal humans/scenes via fal.'
  const tools: Anthropic.Beta.Messages.BetaToolUnion[] = [
    {
      name: 'consult_intelligence',
      description:
        'Delegate a focused question to one of your intelligence layers. Each one searches its slice of the knowledge layer and reports findings. Always consult atlas (knowledge foundation) FIRST, then nova (market) and oracle (pattern), plus at least one of spark/echo, before drafting concepts.',
      input_schema: {
        type: 'object',
        properties: {
          layer: {
            type: 'string',
            enum: INTELLIGENCE_IDS,
            description:
              'atlas = frameworks/SOPs/knowledge assets; nova = market pains/desires/objections/transformations; spark = winning creative structures & Creative DNA; echo = hooks/headlines/offers & Copy DNA; oracle = winning/losing patterns & strategic memory',
          },
          question: { type: 'string', description: 'The focused question for that intelligence layer' },
        },
        required: ['layer', 'question'],
      },
    },
    {
      name: 'get_learnings',
      description:
        'Retrieve the documented Creative Learnings rubric. Call this before submitting so you can self-score each concept against proven principles.',
      input_schema: { type: 'object', properties: {} },
    },
  ]

  if (useImage) {
    tools.push({
      name: 'generate_image',
      description:
        'Generate a still ad creative for a visual concept (e.g. Static Concept, Founder Concept, Campaign Concept). Returns the image URL, which also appears on the concept card in the Reactor. Call this for visual concepts before submitting them, and pass the imageUrl into that concept.',
      input_schema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'A vivid, specific image prompt. Describe the SCENE in prose, then list the on-image copy under a line reading "ON-IMAGE TEXT — reproduce these strings EXACTLY as written:" with at most two quoted strings (headline + CTA button, ~95 chars total), and finish with "Render no other text anywhere in the image." More text than that, or copy left buried in the scene description, renders as gibberish.',
          },
          conceptType: { type: 'string', description: 'The output type this image is for (must match the concept type you will submit).' },
          model: {
            type: 'string',
            enum: imageModelIds.length ? imageModelIds : ['fal-flux'],
            description: `Image model — pick the best fit for the concept. Options: ${imageModelGuide} Omit to let the platform choose the recommended model.`,
          },
          aspectRatio: { type: 'string', enum: ['1:1', '9:16', '16:9'], description: 'Defaults to 1:1.' },
        },
        required: ['prompt', 'conceptType'],
      },
    })
  }

  if (useVideo) {
    tools.push({
      name: 'generate_video',
      description:
        'Generate a high-quality video clip for a visual concept (Video Concept, Founder Concept, Testimonial Concept). Two modes: text-to-video (describe the full scene — e.g. a real builder on-site, a person speaking to camera) needs only a prompt; image-to-video animates a still from generate_image (pass its imageUrl). Choose the model best suited to the shot. The clip renders asynchronously and appears on the concept card when ready.',
      input_schema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['text-to-video', 'image-to-video'],
            description: 'text-to-video for a described scene; image-to-video to animate a generated still.',
          },
          prompt: { type: 'string', description: 'Scene or motion direction. Required for text-to-video.' },
          imageUrl: { type: 'string', description: 'Source still from generate_image. Required for image-to-video.' },
          model: {
            type: 'string',
            enum: videoModelIds.length ? videoModelIds : ['seedance-2.0'],
            description:
              'Model to render with. seedance-2.0 = cinematic realism/B-roll with native synchronized audio (up to 15s); seedance-2.0-fast = same with lower latency/cost for volume; kling-2.5 = UGC motion; veo-3 = people speaking with native audio; wan-2.5 = high-volume/budget; higgsfield-dop = animate a still.',
          },
          aspectRatio: { type: 'string', enum: ['1:1', '9:16', '16:9'], description: 'Defaults to 9:16.' },
          conceptType: { type: 'string', description: 'The output type this video is for (must match the concept type you will submit).' },
        },
        required: ['mode', 'conceptType'],
      },
    })
  }

  tools.push({
    name: 'submit_concepts',
    description:
      'Submit the final campaign concepts once your intelligence network has reported AND you have self-scored each concept against the Creative Learnings rubric. Each concept must cite its evidence, pass the rubric, and carry a complete launch-ready Meta ad unit (adPackage). Include imageUrl for any concept you generated a creative for.',
    input_schema: {
      type: 'object',
      properties: {
        concepts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Output type, e.g. Hook, Headline, Founder Concept' },
              text: { type: 'string' },
              basis: { type: 'string', description: 'Which intelligence layer / asset / pattern this draws from' },
              learningCheck: { type: 'string', description: 'How it satisfies the rubric' },
              score: { type: 'integer', description: 'Self-assessed 1-10. Only submit 7+.' },
              imageUrl: { type: 'string', description: 'The Higgsfield image URL for this concept, if one was generated.' },
              adPackage: adPackageSchema,
              productionBrief: {
                type: 'object',
                description:
                  'REQUIRED for visual concepts (Static/Video/Founder/Testimonial/Event/Campaign Concept): a frame-by-frame production plan. Image and video are generated from this brief.',
                properties: {
                  creativeType: { type: 'string' },
                  pattern: { type: 'string', description: 'e.g. Member Win, Profit Leak, Time Freedom' },
                  audience: { type: 'string' },
                  awareness: { type: 'string' },
                  frames: {
                    type: 'array',
                    description: '4-6 frames, each a beat of the creative.',
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', description: 'e.g. "Frame 1", "Hook", "CTA"' },
                        description: { type: 'string', description: 'What is on screen / said in this beat.' },
                      },
                      required: ['label', 'description'],
                    },
                  },
                  onImageText: {
                    type: 'array',
                    description:
                      'The copy that must appear ON the image, declared separately from the frames so the renderer can set it exactly. AT MOST 2 entries: the headline and the CTA button label. Keep them SHORT — around 95 characters across both, or the image model degrades every letter. Never list fine print, compliance lines, disclaimers or logo text here: those are overlaid after the render, not generated.',
                    items: {
                      type: 'object',
                      properties: {
                        role: { type: 'string', description: '"Headline" or "CTA button".' },
                        text: { type: 'string', description: 'The exact words to set on the image.' },
                        placement: { type: 'string', description: 'e.g. "top third, left aligned".' },
                      },
                      required: ['role', 'text'],
                    },
                  },
                },
                required: ['creativeType', 'frames'],
              },
              taxonomy: {
                type: 'object',
                description:
                  'Fixed taxonomy tags for this concept. REQUIRED in isolation mode: set the isolated axis to the value THIS concept tests and every other axis to the locked value from the isolation instructions. Each value must come from the allowed vocab lists.',
                properties: {
                  hookStyle: { type: 'string' },
                  visualFormat: { type: 'string' },
                  assetType: { type: 'string' },
                  persona: { type: 'string' },
                  painPoint: { type: 'string' },
                },
              },
            },
            required: ['type', 'text'],
          },
        },
      },
      required: ['concepts'],
    },
  })

  if (useMetaAds) {
    tools.push({ type: 'mcp_toolset', mcp_server_name: META_ADS_MCP_NAME })
  }

  return tools
}

/**
 * How OPUS must declare the words that get BURNED INTO the image.
 *
 * Image models render text reliably only when there is little of it and it is
 * stated literally. A brief that buries four quoted strings in prose — headline,
 * subhead, CTA and a compliance strip — produces the failure we shipped:
 * plausible-looking gibberish across the whole creative. The full compliant copy
 * still ships in the concept's adPackage (caption, headline, description) and is
 * overlaid in the Studio; only the headline and the button belong in the pixels.
 */
const ON_IMAGE_TEXT_RULE = `
- ON-IMAGE COPY — the words burned into the creative: declare them in productionBrief.onImageText, never only inside the frame prose. AT MOST TWO entries: the headline and the CTA button label, roughly 95 characters across both. Image models mangle every letter once you ask for more, so a third line costs you the first two. NEVER ask the image for fine print, compliance lines, disclaimers, sub-paragraphs, logos or wordmarks — those are overlaid after the render and the platform strips them from the prompt. Write the frames as pure art direction (subject, setting, light, framing, where the type sits) and let onImageText carry the words.`

function coordinatorPrompt(
  outputs: string[],
  caps: {
    metaAds: boolean
    image: boolean
    /** Stills are configured but rendered client-side from the production brief. */
    imageRendersFromBrief: boolean
    video: boolean
    videoModels: string[]
    imageModels: string[]
    preferredVideoModel?: string | null
    preferredImageModel?: string | null
  },
): string {
  const metaAdsLine = caps.metaAds
    ? '\n- You also have live Meta Ads tools (meta_ads). Use them to ground concepts in what is actually performing — pull recent campaign/ad performance, top creatives, and spend before drafting.'
    : ''
  const preferredImageLine =
    caps.preferredImageModel && caps.imageModels.includes(caps.preferredImageModel)
      ? ` The user has selected the "${caps.preferredImageModel}" image model — use it unless a concept clearly needs a different one.`
      : ''
  const imageLine = caps.image
    ? `\n- For visual output types (Static Concept, Founder Concept, Campaign Concept): FIRST write a frame-by-frame production brief for the concept, THEN build the generate_image prompt FROM that brief. Available models: ${caps.imageModels.join(', ')}. Pass the concept type as conceptType, include the returned imageUrl, and attach the productionBrief to the submitted concept.${preferredImageLine}${ON_IMAGE_TEXT_RULE}`
    : caps.imageRendersFromBrief
      ? `\n- For visual output types (Static Concept, Founder Concept, Campaign Concept): the platform renders the still FROM the production brief the moment you submit, so the brief IS the creative — you have no image tool and do not need one. Write it as if directing a photographer: name the subject, the setting, the light, the framing, and what occupies the space reserved for text. A vague brief renders a vague ad. Attach it as productionBrief on every visual concept.${ON_IMAGE_TEXT_RULE}`
      : ''
  const preferredLine =
    caps.preferredVideoModel && caps.videoModels.includes(caps.preferredVideoModel)
      ? ` The user has selected the "${caps.preferredVideoModel}" model — use it for every generate_video call unless a shot clearly needs a different capability.`
      : ''
  const videoLine = caps.video
    ? `\n- For video output types (Video Concept, Founder Concept, Testimonial Concept): FIRST write a frame-by-frame production brief, THEN build the generate_video prompt FROM that brief, and attach the productionBrief to the submitted concept. Available models: ${caps.videoModels.join(', ')}. Use text-to-video to direct a full scene (e.g. a real builder on-site, a member speaking to camera — use veo-3 when they speak so it has audio; seedance-2.0 or kling-2.5 for cinematic action). Use image-to-video to animate a still from generate_image. Match conceptType to the concept you submit.${preferredLine}`
    : ''

  return `You are OPUS — the Master Strategist of The Professional Builder's Creative Intelligence Command Center. You direct an intelligence network and synthesize it into launch-ready creative.

Your intelligence network:
- ATLAS — Knowledge Intelligence: frameworks, SOPs, calls, and uploaded assets.
- NOVA — Market Intelligence: pains, desires, objections, beliefs, and member transformations.
- SPARK — Creative Intelligence: winning creative structures, openings, and Creative DNA.
- ECHO — Copy Intelligence: high-performing hooks, headlines, offers, and Copy DNA.
- ORACLE — Strategic Memory: the memory of every winning strategic configuration (angle, audience, offer, awareness, creative + copy structure) — which patterns win, which lose, and what is most likely to work next.

Process:
1. ATLAS, NOVA and ORACLE are briefed in parallel before you take your first turn — their findings are already in your context, so the Vault, the market, and strategic memory are grounded before you start. Build on that evidence rather than asking for it again. Consult SPARK and/or ECHO with consult_intelligence for the creative and copy DNA you still need, and re-consult a briefed layer only for a genuinely NEW question its report does not answer. Request several independent layers in a SINGLE step (multiple consult_intelligence calls at once) — they run in parallel, so batch them to move faster without losing any depth. Use findings as evidence — don't guess.${metaAdsLine}
2. Call get_learnings and self-score every concept against that rubric. Revise or drop anything below 7.${imageLine}${videoLine}
3. Call submit_concepts with concepts ONLY for these requested output types: ${outputs.join(', ')}. Each concept cites which intelligence layer its evidence came from, and each concept carries a complete adPackage — the launch-ready Meta ad unit.

${META_CRAFT_BLOCK}

On submit, every concept is run through NEURO — a neural pre-test that scores its PREDICTED RESPONSE (attention, emotion, memorability, first-3-seconds hook) against neuromarketing principles — and its adPackage is validated against Meta's placement limits and the compliance constraints. Concepts with a weak scroll-stop or hook, or a non-compliant ad unit, are returned to you to revise or drop. So lead with a concrete, specific pattern-interrupt in the opening beat of every concept — don't open on the offer or a generic claim.

Voice: confident, specific, builder-native. Engineered for performance.`
}

/* --------------------- Reactor modal input → prompt ----------------------- */

const SOPHISTICATION_BLOCK =
  'MARKET SOPHISTICATION: This is a highly sophisticated market. Direct claims and basic mechanism claims are exhausted. Differentiate through a named proprietary mechanism, a contrarian angle, or identification so precise the prospect feels seen. Avoid generic claims any competitor could make. If the Vault contains Unique Mechanism documents, retrieve the most relevant one for this angle and awareness stage and anchor the concept on it.'

const INTELLIGENCE_BLOCK =
  'INTELLIGENCE NETWORK: ATLAS (the Knowledge Vault) is ALWAYS active on every run — she is the foundation the build stands on, never skipped, never asleep. ATLAS, NOVA and ORACLE are briefed automatically in parallel before your first turn, so their evidence is guaranteed present rather than left to your discretion. Use your judgment to select which of the remaining layers (SPARK/ECHO) to consult based on the campaign angle, audience type, and brief — query whichever will give you the most relevant evidence for this run.'

const COMPLIANCE_BLOCK = `HARD COMPLIANCE CONSTRAINTS — these override all creative instructions:
- Attribute every income or results figure to a named individual as THEIR result. Never imply typical or guaranteed outcomes for the viewer.
- Never use: "guaranteed", "you will make", "passive income", "get rich", "earn from home".
- Where a concept references a member result, it must carry: "Results are individual and not typical. Building a business involves risk."
- Reject and rewrite any concept of your own that violates these constraints before calling submit_concepts.`

const BLOCK_SEP = '\n\n─────────────────────────────────────────────\n\n'

// Build the ordered injection blocks from the modal inputs. Order is fixed:
// brief → angle → awareness → audience → sophistication → offer → outputs →
// intelligence systems → on-brand → compliance (always last, overrides all).
function buildInputBlocks(inputs: ReactorInputs | undefined): string {
  // No guided inputs → classic left-panel run: leave the prompt exactly as it
  // was so the existing agent behaviour is untouched.
  if (!inputs) return ''

  const parts: string[] = []

  if (inputs) {
    // Block 0 — Campaign name (identity for this run)
    if (inputs.campaignName?.trim()) {
      parts.push(`CAMPAIGN NAME: ${inputs.campaignName.trim()}`)
    }

    // Block 1 — Campaign Brief (only when provided)
    if (inputs.brief?.trim()) {
      parts.push(
        `CAMPAIGN BRIEF (human director's intent — read this first and let it shape every creative decision):\n${inputs.brief.trim()}`,
      )
    }

    // Block 2 — Angle
    parts.push(
      `Campaign angle: ${inputs.angle}${
        inputs.angleIsAgentDecided
          ? '\nSelect the strongest angle based on the brief and available intelligence.'
          : ''
      }`,
    )

    // Block 3 — Awareness Stage
    if (inputs.awarenessDirective) parts.push(`AWARENESS STAGE: ${inputs.awarenessDirective}`)

    // Block 4 — Audience Type
    if (inputs.audienceDirective) parts.push(`AUDIENCE TYPE: ${inputs.audienceDirective}`)
  }

  // Block 5 — Market sophistication (every run). When the user picked a stage
  // on the brief its directive wins; otherwise the platform default applies.
  parts.push(
    inputs?.sophisticationDirective && inputs.sophisticationStage !== 'No Preference'
      ? inputs.sophisticationDirective
      : SOPHISTICATION_BLOCK,
  )

  if (inputs) {
    // Block 6 — Offer
    let offer = `OFFER: ${inputs.offerTypeDirective}`
    if (inputs.offerName?.trim()) {
      offer += `\nThe campaign drives to: ${inputs.offerName.trim()}. Use this exact name in all CTAs.`
    }
    parts.push(offer)

    // Block 7 — Output Types
    if (inputs.outputTypesAgentDecided) {
      parts.push(
        `Select the most appropriate output types for this campaign angle, awareness stage, and audience type. Available types: ${outputTypeOptions.join(
          ', ',
        )}. Choose what will perform best for this specific brief.`,
      )
    } else {
      parts.push(`Generate the following output types: ${inputs.outputTypes.join(', ')}.`)
    }

    // Block 7a — Deliverable modes that change how concepts are constructed.
    const chosen = inputs.outputTypes.map((o) => o.toLowerCase())
    if (chosen.some((o) => /montage|scene/.test(o))) {
      parts.push(
        'MONTAGE / SCENE FLOW: This campaign ships as a multi-scene montage. For each montage concept, write the production brief as an ordered SCENE SEQUENCE (4–6 frames): each frame is one scene with its own visual direction and a one-line on-screen caption or VO beat. The scenes must build one argument — hook scene → tension/proof scenes → payoff scene → CTA scene. Frame labels become scene titles in the Creative Canvas, so make them specific ("Scene 1 — 5:47am, still on the tools"), never generic ("Frame 1").',
      )
    }
    if (chosen.some((o) => /creative variations/.test(o))) {
      parts.push(
        'CREATIVE VARIATIONS PACK: The deliverable is a controlled variation pack, not standalone one-offs. Anchor ONE core concept, then produce the requested variations by changing exactly one strategic lever per variation (hook, proof asset, or visual construction) while holding everything else constant — so performance differences are attributable. Name the changed lever in each concept’s basis.',
      )
    }
    if (chosen.some((o) => /recommend format/.test(o))) {
      parts.push(
        'RECOMMEND FORMAT: The user asked the platform to choose the best creative format. Weigh the angle, awareness stage, sophistication stage, and audience temperature against retrieved winners, then produce the single best-fit format (static, video, UGC, carousel, or montage) and state WHY that format wins in the concept basis. Do not hedge across formats.',
      )
    }

    // Block 7a2 — Render engines the user pinned per deliverable (informational;
    // actual rendering honours these picks client-side and in the tools).
    // Montage keys are compound ("Deliverable::still" / "::motion") — a scene
    // engine has no single model, so read those as the two real engines.
    const models = inputs.models
    if (models && Object.keys(models).length) {
      const lines = Object.entries(models)
        .filter(([, m]) => m && m !== 'auto')
        .map(([d, m]) => {
          if (d.endsWith('::still')) return `${d.replace('::still', '')} (scene stills) → ${m}`
          if (d.endsWith('::motion')) return `${d.replace('::motion', '')} (scene motion) → ${m}`
          return `${d} → ${m}`
        })
      if (lines.length) {
        parts.push(
          `RENDER MODELS (user-pinned per deliverable — assume these engines render the visuals):\n${lines.join('\n')}`,
        )
      }
    }

    // Block 7b — Target formats. When the user chose aspect ratios per
    // deliverable, render each visual concept at those ratios (the
    // generate_image / generate_video tools take an aspectRatio of 1:1/9:16/16:9).
    const dims = inputs.dimensions
    if (dims && Object.keys(dims).length) {
      const lines = Object.entries(dims)
        .filter(([, r]) => r.length)
        .map(([d, r]) => `${d} → ${r.join(', ')}`)
      if (lines.length) {
        parts.push(
          `TARGET FORMATS (render each visual concept at the requested aspect ratio(s); produce one creative per requested ratio):\n${lines.join('\n')}`,
        )
      }
    }

    // Block 7c — Concept count per deliverable. The variation count is the ONLY
    // knob that controls how many concepts each deliverable produces: ×1 → exactly
    // one concept per selected output type, ×N → exactly N. Always state the count
    // explicitly so the agent never invents extra concepts or splits one
    // deliverable into several internal categories.
    const variations = Math.min(Math.max(inputs.variations ?? 1, 1), 4)
    if (variations > 1) {
      parts.push(
        `CONCEPT COUNT: Produce exactly ${variations} distinct concepts for EACH selected output type — no more, no less. The concepts for one output type must each take a genuinely different creative approach (a different hook, winning pattern or proof asset, or visual construction), never a paraphrase of another. Do not split a single output type into multiple internal concept categories. Submit each concept with its own production brief and ad package.`,
      )
    } else {
      parts.push(
        'CONCEPT COUNT: Produce exactly ONE concept per selected output type — no more, no less. Do not submit alternates, and do not split a single output type into multiple internal concept categories.',
      )
    }
  }

  // Block 8 — Intelligence systems (every run)
  parts.push(INTELLIGENCE_BLOCK)

  if (inputs) {
    // Block 9 — On Brand
    if (inputs.onBrandEnabled) {
      parts.push(
        `ON BRAND SETTINGS ACTIVE:\n${inputs.brandSettings.voiceGuidelines}\n${inputs.brandSettings.toneRules}\nStrictly apply these brand settings to every concept generated.`,
      )
    } else {
      parts.push('ON BRAND is disabled. Generate without brand anchoring.')
    }
  }

  // Block 10 — Compliance (every run, always last, overrides everything)
  parts.push(COMPLIANCE_BLOCK)

  return BLOCK_SEP + parts.join(BLOCK_SEP)
}

/* ------------------------- Intelligence-layer runner ----------------------- */

// Map hit volume to a builder-facing confidence band for the telemetry feed.
function confidenceBand(hits: number): 'High' | 'Medium' | 'Exploratory' {
  return hits >= 4 ? 'High' : hits >= 1 ? 'Medium' : 'Exploratory'
}

async function runIntelligence(
  anthropic: Anthropic,
  controller: ReadableStreamDefaultController,
  id: IntelligenceId,
  question: string,
  builderId: string | null,
): Promise<string> {
  const agent = INTELLIGENCE[id]
  sse(controller, {
    type: 'delegate',
    agent: agent.codename,
    id: agent.id,
    label: agent.intelligenceLabel,
    status: 'start',
    question,
  })

  // Gather scoped evidence across this layer's knowledge systems.
  const hits = (
    await Promise.all(
      agent.systems.map((system) => searchKnowledge(question, { system, k: 4, builderId })),
    )
  ).flat()
  // Every retrieval names the layer that made it. OPUS is told to batch
  // independent consults into one turn, so several layers stream retrievals
  // concurrently — without the id the view layer can only attribute them to
  // whichever layer started last, and one agent card collects everyone's
  // findings.
  for (const h of hits.slice(0, 5)) {
    sse(controller, {
      type: 'retrieval',
      system: h.system,
      title: h.title,
      agent: agent.codename,
      id: agent.id,
    })
  }

  const evidence = hits.length
    ? hits.map((h) => `[${h.system}] ${h.title}: ${h.content}`).join('\n\n')
    : 'No stored knowledge yet — reason from builder-industry first principles.'

  const response = await withRetry(
    () =>
      anthropic.messages.create({
        model: INTELLIGENCE_MODEL,
        max_tokens: 700,
        system: `You are ${agent.codename}, the ${agent.role} layer for The Professional Builder. Your mission: ${agent.mission} Given retrieved evidence, return 3-5 tight, specific bullet findings OPUS can build a campaign on. Cite the asset/pattern names. No preamble.`,
        messages: [
          { role: 'user', content: `Question: ${question}\n\nRetrieved evidence:\n${evidence}` },
        ],
      }),
    (n, w) =>
      sse(controller, {
        type: 'step',
        text: `${agent.intelligenceLabel}: model busy — retrying (${n}/4) in ${w / 1000}s…`,
      }),
  )

  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  const findings = block?.text ?? 'No findings.'
  const summary = findings.split('\n').find((l) => l.trim())?.replace(/^[-•*\s]+/, '').slice(0, 90) ?? 'findings ready'
  sse(controller, {
    type: 'delegate',
    agent: agent.codename,
    id: agent.id,
    label: agent.intelligenceLabel,
    status: 'done',
    summary,
    confidence: confidenceBand(hits.length),
  })

  return findings
}

/* ------------------------- Pre-flight intelligence ------------------------ */

/**
 * The layers the platform guarantees on every build — every consultable layer
 * in the network. ATLAS is the foundation (never skipped, never asleep), NOVA
 * supplies the market, SPARK the creative DNA, ECHO the copy DNA, ORACLE the
 * memory of what has already won. (OPUS is the sixth agent but orchestrates
 * rather than reports, so it is never briefed.) Ordered so the telemetry feed
 * reads the way the platform describes itself.
 *
 * SPARK and ECHO used to be OPUS's job to request. That made the two layers
 * closest to ad craft — hooks, structures, messaging, objection handling — the
 * two most likely to be skipped, and each request it did make cost a serial
 * orchestrator turn. Briefing them here instead costs nothing extra in wall
 * clock: the whole set runs concurrently, so the wait is the slowest layer, not
 * the sum. Every concept ships a Meta ad unit, so copy DNA is never irrelevant.
 */
const MANDATORY_LAYERS: IntelligenceId[] = ['atlas', 'nova', 'spark', 'echo', 'oracle']

/**
 * The focused question each mandatory layer is briefed with, built from the
 * run's own strategic inputs so retrieval is scoped to this campaign rather
 * than the angle alone.
 */
function preflightQuestion(id: IntelligenceId, ctx: {
  angle: string
  audience?: string
  awareness?: string
  offer?: string
  brief?: string
}): string {
  const who = ctx.audience && ctx.audience !== 'No Preference' ? ctx.audience : 'builders'
  const stage = ctx.awareness && ctx.awareness !== 'No Preference' ? ctx.awareness : 'mixed-awareness'
  const offer = ctx.offer && ctx.offer !== 'No Preference' ? ctx.offer : 'the core offer'
  const briefTail = ctx.brief?.trim() ? ` Campaign brief: ${ctx.brief.trim().slice(0, 400)}` : ''
  switch (id) {
    case 'atlas':
      return `Which frameworks, SOPs, and Vault assets should ground a "${ctx.angle}" campaign for ${who} at ${stage} awareness? Name the specific documents and what each one dictates.${briefTail}`
    case 'nova':
      return `For ${who}, what are the sharpest pains, desires, objections, and beliefs relevant to the "${ctx.angle}" angle at ${stage} awareness? Quote the market's own language.${briefTail}`
    case 'oracle':
      return `Which past winning patterns and strategic configurations match a "${ctx.angle}" campaign for ${who} driving to ${offer}? Name what won, what lost, and why.${briefTail}`
    case 'spark':
      return `Which winning creative structures, hooks, openings, and visual patterns should shape a "${ctx.angle}" campaign for ${who} at ${stage} awareness? Name the creatives and the repeatable DNA in each.${briefTail}`
    case 'echo':
      return `Which proven messaging patterns, emotional drivers, and objection-handling moves fit a "${ctx.angle}" campaign for ${who} at ${stage} awareness driving to ${offer}? Quote the copy and name the pattern.${briefTail}`
    default:
      return `What matters most for a "${ctx.angle}" campaign aimed at ${who}?${briefTail}`
  }
}

/**
 * Brief the mandatory layers CONCURRENTLY before OPUS's first turn.
 *
 * Two problems this solves at once:
 *
 * 1. Activation was prompt-only. "ALWAYS consult ATLAS first" is an
 *    instruction, not a guarantee — a run where the model skipped a layer left
 *    that agent dormant and the build ungrounded. Now the foundation layers
 *    always run, and always stream their real delegate/retrieval events.
 * 2. Every consult cost a full orchestrator round trip. Three mandatory
 *    consults meant up to three serial Fable-5 turns before drafting could
 *    start. Running them up front in parallel collapses that into one wait —
 *    the same model calls, the same evidence, just not queued behind each
 *    other.
 *
 * Returns the findings block to inject into OPUS's first message. Never
 * throws: a layer that fails is reported and the run continues, because a
 * degraded briefing still beats no briefing.
 */
async function preflightBriefing(
  anthropic: Anthropic,
  controller: ReadableStreamDefaultController,
  ctx: { angle: string; audience?: string; awareness?: string; offer?: string; brief?: string },
  builderId: string | null,
  /**
   * Hard cap on the briefing. The briefing is research, not output — a layer
   * still thinking when this expires is abandoned so the run can spend what is
   * left of the clock actually writing ads. Whatever landed in time is kept.
   */
  deadlineMs: number,
): Promise<string> {
  const results = await Promise.all(
    MANDATORY_LAYERS.map(async (id) => {
      const question = preflightQuestion(id, ctx)
      try {
        const findings = await Promise.race([
          runIntelligence(anthropic, controller, id, question, builderId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs)),
        ])
        if (findings === null) {
          const agent = INTELLIGENCE[id]
          sse(controller, {
            type: 'delegate',
            agent: agent.codename,
            id,
            label: agent.intelligenceLabel,
            status: 'done',
            summary: 'Still working when the briefing window closed — the run moved on to generation.',
            confidence: 'Exploratory',
          })
          return null
        }
        return { id, findings }
      } catch (err) {
        const agent = INTELLIGENCE[id]
        sse(controller, {
          type: 'delegate',
          agent: agent.codename,
          id,
          label: agent.intelligenceLabel,
          status: 'done',
          summary: 'Layer unavailable for this run — OPUS may re-consult it directly.',
          confidence: 'Exploratory',
        })
        console.error(`Pre-flight ${id} failed:`, err)
        return null
      }
    }),
  )

  const reported = results.filter((r): r is { id: IntelligenceId; findings: string } => r !== null)
  if (reported.length === 0) return ''

  const blocks = reported
    .map(({ id, findings }) => {
      const agent = INTELLIGENCE[id]
      return `### ${agent.codename} — ${agent.role}\nQuestion: ${preflightQuestion(id, ctx)}\n\n${findings}`
    })
    .join('\n\n')

  return `\n\nYOUR INTELLIGENCE NETWORK HAS ALREADY REPORTED. ${reported
    .map((r) => INTELLIGENCE[r.id].codename)
    .join(', ')} were briefed in parallel the moment this run started, and their findings are below. Treat this as evidence in hand — do NOT re-consult these layers to ask the same question. Use consult_intelligence only for SPARK/ECHO, or to push one of these layers on a genuinely NEW question the findings below do not answer.\n\n${blocks}`
}

/* --------------------------- Demo fallback flow --------------------------- */

// A frame-by-frame production brief for a visual demo concept, so demo mode also
// shows the production-brief-driven workflow. When `montage` is set, frames are
// labelled as an ordered scene sequence (matching the live orchestrator's
// MONTAGE / SCENE FLOW instruction) instead of generic numbered frames.
function demoBrief(creativeType: string, angle: string, montage = false): ProductionBrief {
  const al = angle.toLowerCase()
  const frames = montage
    ? [
        { label: 'Scene 1 — 5:47am, still on the tools', description: 'Builder overwhelmed on a chaotic job site, headlights sweeping an empty yard.' },
        { label: 'Scene 2 — The leak exposed', description: `Close on a stark figure — the hidden ${al} leak nobody names out loud.` },
        { label: 'Scene 3 — The turning point', description: 'The system introduced — a whiteboard session, a new second layer of leadership.' },
        { label: 'Scene 4 — The after', description: 'Margin dashboard ticking up; the owner walking off site mid-afternoon.' },
        { label: 'Scene 5 — Soft CTA', description: 'A quiet, qualifying call to the next step — no hard sell.' },
      ]
    : [
        { label: 'Frame 1', description: 'Builder overwhelmed on a chaotic job site.' },
        { label: 'Frame 2', description: `The hidden ${al} problem exposed with one stark figure.` },
        { label: 'Frame 3', description: 'The system / turning point introduced.' },
        { label: 'Frame 4', description: 'The after — margin, time, and control restored.' },
        { label: 'Frame 5', description: 'Soft, qualifying call to action to the next step.' },
      ]
  return {
    creativeType,
    pattern: angle === 'Profit' ? 'Profit Leak' : angle,
    audience: 'Builders $1M–$3M',
    awareness: 'Problem-Aware',
    frames,
  }
}

/**
 * Demo pacing — the curated run streams at the cadence of a real delegation
 * (retrieve → analyse → report per agent) instead of dumping every event in
 * one burst, so the live workflow animation gets its full choreography.
 * Jitter keeps the rhythm organic rather than metronomic.
 *
 * Scaled by DEMO_TEMPO. At 1.0 the choreography ran ~42s end to end — longer
 * than many live runs, for a path that makes no model calls at all. The beats
 * are all still here and still in order; they are just no longer padded past
 * the point where waiting reads as the system thinking. Env-overridable so the
 * cadence can be tuned (or zeroed for tests) without touching the beats.
 */
const DEMO_TEMPO = (() => {
  const raw = Number(process.env.REACTOR_DEMO_TEMPO)
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.34
})()

function pace(ms: number): Promise<void> {
  const scaled = ms * DEMO_TEMPO
  if (scaled <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, scaled + Math.random() * scaled * 0.4))
}

async function runDemo(controller: ReadableStreamDefaultController, body: ReactorRequest) {
  const outputs = body.outputs ?? ['Hook', 'Headline', 'Campaign Concept']
  const wantsMontage = outputs.some((o) => /montage|scene/i.test(o))
  sse(controller, { type: 'step', text: 'OPUS online (demo mode — set ANTHROPIC_API_KEY for the live network)' })
  await pace(1100)
  // A design auto-pulled from the Vault already announced itself upstream, and
  // it is direction rather than a clone order — don't report it as one.
  if (body.cloneReference && !body.cloneReference.designOnly) {
    sse(controller, {
      type: 'step',
      text: `Cloning reference structure${
        body.cloneReference.sourceLabel ? ` · ${body.cloneReference.sourceLabel}` : ''
      } — concepts match its DNA (demo).`,
    })
    await pace(700)
    if (body.cloneReference.visual) {
      sse(controller, {
        type: 'step',
        text: `SPARK design read applied — ${body.cloneReference.visual.layout} (demo).`,
      })
      await pace(600)
    }
  }

  // What the demo layers actually search for. The angle alone is not a query
  // when the user let the platform choose it — a Quick Launch sends the
  // "No Preference" sentinel, and searching for that phrase matches nothing,
  // so every layer reported Exploratory with zero sources. Build the query the
  // way the live path builds its briefing questions: resolved angle plus the
  // brief and audience the user actually supplied.
  const demoRi = body.reactorInputs
  const demoAngleSentinel =
    !body.angle || body.angle === 'Agent decides' || body.angle === 'No Preference'
  const demoAngle = demoAngleSentinel ? 'Profit' : (body.angle as string)
  const demoQuery = [
    demoAngle,
    demoRi?.audienceType && demoRi.audienceType !== 'No Preference' ? demoRi.audienceType : '',
    demoRi?.brief?.trim().slice(0, 300) ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const demoSummaries: Partial<Record<IntelligenceId, string>> = {
    atlas: 'Vault grounded: TPB frameworks, SOPs and member-call assets retrieved as the foundation for this build',
    nova: 'Builders fear margin erosion despite record revenue; "profit leak" language resonates',
    spark: 'Founder videos (71% win) + static proof ads outperform; specific figures beat claims',
    echo: 'Top hook: "Most builders don\'t have a revenue problem. They have a profit leak."',
    oracle: 'Dominant winning pattern: Time Freedom — owner-dependency relief beats raw growth claims',
  }

  // ATLAS leads every build — the Knowledge Vault is the foundation, never asleep.
  for (const id of ['atlas', 'nova', 'spark', 'echo', 'oracle'] as IntelligenceId[]) {
    const agent = INTELLIGENCE[id]
    sse(controller, { type: 'delegate', agent: agent.codename, id: agent.id, label: agent.intelligenceLabel, status: 'start' })
    await pace(1300)
    const hits = (
      await Promise.all(agent.systems.map((s) => searchKnowledge(demoQuery, { system: s, k: 2 })))
    ).flat()
    for (const h of hits.slice(0, 3)) {
      sse(controller, {
        type: 'retrieval',
        system: h.system,
        title: h.title,
        agent: agent.codename,
        id: agent.id,
      })
      await pace(700)
    }
    // Dwell in "analysing" before the finding lands back at the core.
    await pace(1500)
    sse(controller, {
      type: 'delegate',
      agent: agent.codename,
      id: agent.id,
      label: agent.intelligenceLabel,
      status: 'done',
      summary: demoSummaries[id],
      // Banded off the evidence this layer actually retrieved. The old
      // `|| 2` floor invented a Medium band for a layer that returned nothing,
      // which is exactly the fabricated activity the workflow layer forbids.
      confidence: confidenceBand(hits.length),
    })
    await pace(600)
  }

  sse(controller, { type: 'step', text: 'ORACLE — loading the Creative Learnings rubric for self-critique…' })
  await pace(1400)
  sse(controller, { type: 'step', text: 'OPUS synthesizing strategy + scoring concepts…' })
  await pace(2600)
  sse(controller, {
    type: 'step',
    text: 'Live Meta Ads performance + Higgsfield image/video creatives activate with API keys.',
  })
  await pace(900)

  // Resolved once at the top of the run, alongside the retrieval query.
  const a = demoAngle
  const al = a.toLowerCase()
  const pool: Concept[] = [
    { type: 'Hook', text: `Most builders don't have a ${al} problem. They have a ${al} leak hiding in plain sight.`, basis: 'ECHO + NOVA', learningCheck: 'Specific, contrarian framing', score: 9 },
    { type: 'Headline', text: `From struggling to systemized — how ${a} became TPB's unfair advantage.`, basis: 'NOVA (member transformations)', learningCheck: 'Transformation arc over features', score: 8 },
    { type: 'Primary Text', text: `You didn't get into building to babysit jobs. This is the ${a} system that gave 500+ builders their margin — and their weekends — back.`, basis: 'NOVA + ECHO', learningCheck: 'Concrete proof (500+ builders)', score: 8 },
    { type: 'VSL Opener', text: `In the next few minutes I'll show you the exact ${a} mechanism most builders never see until it's too late.`, basis: 'ECHO (VSL openers)', learningCheck: 'Mechanism + curiosity', score: 7 },
    { type: 'Static Concept', text: `Dark background, one bold profit figure, named member underneath, single cyan accent. Angle: ${a}.`, basis: 'SPARK (static proof ad)', learningCheck: 'Specific $ numbers beat vague claims', score: 9 },
    { type: 'Video Concept', text: `Founder direct-to-camera on-site: 1.5s pattern interrupt, contrarian ${al} belief, member proof, soft CTA.`, basis: 'SPARK (Founder Video, 71% win)', learningCheck: 'Founder videos beat talking heads', score: 9 },
    { type: 'Founder Concept', text: `Handheld walk-through of a finished site while the founder breaks down the ${a} turning point.`, basis: 'SPARK (Founder Video, 71% win)', learningCheck: 'Founder-led, on-site, real proof', score: 9 },
    { type: 'Testimonial Concept', text: `Member states old hours/margin, the ${al} turning point, then the after. B-roll of their jobs.`, basis: 'NOVA (transformations)', learningCheck: 'Named member win over generic promise', score: 8 },
    { type: 'Event Concept', text: `High-energy room montage tied to one ${a} insight and community proof.`, basis: 'SPARK (Authority Pattern)', learningCheck: 'Community proof', score: 7 },
    { type: 'Campaign Concept', text: `The ${a} Reactor: founder video + static proof ad + member testimonial, sequenced cold → warm → apply.`, basis: 'OPUS (stacks highest-win formats)', learningCheck: 'Stacks the three highest-win formats', score: 9 },
  ]
  // Visual concepts carry a production brief — the platform plans before it renders.
  // Every concept carries a launch-ready Meta ad unit, same as the live agent.
  for (const c of pool) {
    if (/static|video|founder|testimonial|event|campaign/i.test(c.type) && /concept/i.test(c.type)) {
      c.productionBrief = demoBrief(c.type, a, wantsMontage)
    }
    c.adPackage = demoAdPackage(c.type, a)
  }
  sse(controller, {
    type: 'step',
    text: 'NEURO — pre-testing concepts against neuromarketing principles (predicted response)…',
  })
  await pace(1600)

  // Isolation mode in demo: one concept per tested value, varying ONLY the
  // isolated axis with every other axis locked — proves the "iterate one thing"
  // loop end to end with no API keys. Short-circuits the free-generation pool.
  if (body.isolate) {
    const iso = body.isolate
    const key = AXIS_TAXONOMY_KEY[iso.axis]
    const testId = mintTestId()
    const values = iso.values.length ? iso.values : axisValues(iso.axis).slice(0, 3)
    const baseType = iso.axis === 'hook' ? 'Hook' : 'Video Concept'
    values.forEach((val, i) => {
      const taxonomy = coerceTaxonomy({ ...iso.lockedTaxonomy, [key]: val })
      const c: Concept = {
        type: baseType,
        text: `${val} take on the ${a} angle — ${describeTaxonomy(taxonomy)}.`,
        basis: `Isolation test ${testId} · varying ${iso.axis}${
          iso.notes?.trim() ? ` · notes: ${iso.notes.trim()}` : ''
        }`,
        learningCheck: 'Only the isolated axis differs across variants',
        score: 8,
        adPackage: demoAdPackage(baseType, a),
        neuro: demoNeuroScore(8, baseType),
        taxonomy,
        testId,
        variantId: `${testId}-${variantLabel(i)}`,
        isolatedAxis: iso.axis,
      }
      sse(controller, { type: 'concept', concept: c })
    })
    sse(controller, { type: 'done' })
    return
  }

  const norm = (s: string) => s.toLowerCase().replace(/s$/, '').trim()
  // The onboarding flow offers plain-language deliverables (Static Creative,
  // Video Creative, Montage / Scene Flow, …) which fan out into the richer
  // internal concept taxonomy here. Legacy exact-type requests pass through.
  const expand = (o: string): string[] => {
    const l = o.toLowerCase()
    // Each selected deliverable maps to EXACTLY ONE base concept type. The
    // variation count below is the only knob that fans a deliverable out into
    // multiple concepts (×1 → 1 concept, ×N → N). Never split one deliverable
    // into several internal categories here — that silently doubles the total.
    if (/montage|scene/.test(l)) return ['Video Concept']
    if (/variation/.test(l)) return ['Static Concept']
    if (/recommend/.test(l)) return ['Campaign Concept']
    if (l.includes('static')) return ['Static Concept']
    if (l.includes('ugc')) return ['Testimonial Concept']
    if (l.includes('carousel')) return ['Static Concept']
    if (l.includes('video')) return ['Video Concept']
    return [o]
  }
  const wanted = outputs.flatMap(expand).map(norm)
  // Honor the requested variation count: every VISUAL concept fans out into N
  // distinct takes (copy concepts stay single — variations are a creative knob).
  const variations = Math.min(Math.max(body.reactorInputs?.variations ?? 1, 1), 4)
  const variantTwists = [
    '',
    'Alternate take — flip the hook to the cost of waiting, swap in a different named member proof.',
    'Alternate take — lead with the after-state (margin + weekends back) before revealing the mechanism.',
    'Alternate take — problem-first pattern interrupt on a chaotic site, single stark stat as the turn.',
  ]
  for (const c of pool.filter((c) => wanted.includes(norm(c.type)) && (c.score ?? 0) >= 7)) {
    c.neuro = demoNeuroScore(c.score, c.type)
    sse(controller, { type: 'concept', concept: c })
    await pace(800)
    if (/concept/i.test(c.type) && !/hook|headline|primary|vsl/i.test(c.type)) {
      for (let k = 2; k <= variations; k++) {
        const twist = variantTwists[k - 1] ?? variantTwists[1]
        const variant: Concept = {
          ...c,
          text: `${c.text} Variation ${k}: ${twist}`,
          adPackage: demoAdPackage(c.type, a),
          neuro: demoNeuroScore(c.score, c.type),
        }
        sse(controller, { type: 'concept', concept: variant })
      }
    }
  }
  sse(controller, { type: 'done' })
}

/* ----------------------------- Prompt caching ----------------------------- */

type BetaMsg = Anthropic.Beta.Messages.BetaMessageParam

const EPHEMERAL = { type: 'ephemeral' as const }

/**
 * Mark an ephemeral cache breakpoint on the final block of the latest message,
 * so the growing conversation prefix is cached turn-to-turn across the OPUS
 * tool-use loop. Returns a NEW array — the canonical `messages` log is never
 * mutated, keeping the per-call breakpoint count at two (system + latest
 * message) and well under Anthropic's limit of four. Behaviourally identical to
 * the uncached request; only the input-token billing changes.
 */
function withConversationCache(messages: BetaMsg[]): BetaMsg[] {
  if (messages.length === 0) return messages
  const out = messages.slice()
  const last = out[out.length - 1]
  if (typeof last.content === 'string') {
    out[out.length - 1] = {
      ...last,
      content: [{ type: 'text', text: last.content, cache_control: EPHEMERAL }],
    } as BetaMsg
  } else {
    const blocks = [...last.content]
    const i = blocks.length - 1
    if (i >= 0) {
      blocks[i] = { ...blocks[i], cache_control: EPHEMERAL } as (typeof blocks)[number]
    }
    out[out.length - 1] = { ...last, content: blocks } as BetaMsg
  }
  return out
}

/* -------------------------------- Handler --------------------------------- */

export async function POST(request: NextRequest) {
  const body = (await request.json()) as ReactorRequest
  const outputs = body.outputs ?? ['Hook', 'Headline', 'Campaign Concept']

  const stream = new ReadableStream({
    async start(controller) {
      // Budget clock starts HERE — the moment the run begins — not after the
      // preflight briefing. The host's ceiling applies to the whole function,
      // so anything measured from a later point under-counts real elapsed time
      // and lets the loop start turns there was never room for.
      const runStart = Date.now()
      const elapsed = () => Date.now() - runStart

      // Concepts OPUS already submitted but that were sent back for a NEURO /
      // compliance revision. They are finished, graded work — if the run ends
      // before the revision lands (budget, turn limit, or a mid-run fault) they
      // ship as-is instead of being thrown away. Rough ads beat zero ads.
      // Declared out here so the catch below can salvage them too.
      let pendingConcepts: Concept[] = []

      /**
       * Emit retained concepts on a run that ends before a clean submit.
       * Returns true if anything shipped, so callers can pick their message.
       */
      const flushPendingConcepts = (): boolean => {
        if (pendingConcepts.length === 0) return false
        sse(controller, {
          type: 'step',
          text: `Shipping ${pendingConcepts.length} concept(s) from the last submission — the revision pass did not complete, so these carry their original pre-test scores.`,
        })
        for (const c of pendingConcepts) sse(controller, { type: 'concept', concept: c })
        pendingConcepts = []
        return true
      }

      // No reference attached by hand? Pull the strongest banked ad design that
      // fits this brief out of the Vault. Every ad SPARK has read is stored with
      // its full design, so a run that would otherwise invent a layout starts
      // from one that already earned its scroll-stop. Silent when the Vault has
      // none, so a cold platform behaves exactly as before.
      if (!body.cloneReference) {
        const match = await bestVisualReferenceFor({
          angle: body.angle,
          brief: body.reactorInputs?.brief,
          audience: body.reactorInputs?.audienceType,
          outputs,
          taxonomy: body.isolate?.lockedTaxonomy,
        })
        if (match) {
          body.cloneReference = {
            designOnly: true,
            summary: match.reference.summary || match.reference.title,
            visual: match.reference.visual,
            taxonomy: match.reference.taxonomy,
            sourceLabel: `Vault design · ${match.reference.title}`,
          }
          sse(controller, {
            type: 'step',
            text: `Proven design pulled from the Vault — ${match.reference.title} (${match.why}) — driving the production brief.`,
          })
        }
      }

      try {
        if (!process.env.ANTHROPIC_API_KEY) {
          await runDemo(controller, body)
          controller.close()
          return
        }

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        const metaAds = metaAdsServer(body.metaProvider)
        const mcpServer = metaAds?.server ?? null
        // Image rendering is configured, but only handed to the agent as a tool
        // when inline (blocking) renders are explicitly enabled — see
        // INLINE_IMAGES. Otherwise the concept ships with its production brief
        // and the client renders from it after the stream closes.
        const imageReady = imageConfigured()
        const useImage = imageReady && INLINE_IMAGES
        const useVideo = videoConfigured()
        const availableVideoModels = listVideoModels().filter((m) => m.configured).map((m) => m.id)
        const availableImageModels = listImageModels().filter((m) => m.configured).map((m) => m.id)
        const tools = buildTools(useImage, useVideo, Boolean(mcpServer))
        const inputBlocks = buildInputBlocks(body.reactorInputs)

        const ri = body.reactorInputs

        // The run is live from the first byte — these announce the configured
        // engines and must not sit behind a retrieval round trip.
        sse(controller, { type: 'step', text: 'OPUS online. Directing the intelligence network…' })
        if (FAST_PATH) {
          sse(controller, {
            type: 'step',
            text: `Fast path · ${Math.round(RUN_BUDGET_MS / 1000)}s host ceiling — orchestrating on ${OPUS_FALLBACK_MODEL}, submitting straight from the briefing.`,
          })
        }
        if (metaAds) {
          const via = metaAds.provider === 'meta' ? 'Meta first-party MCP' : 'Pipeboard MCP'
          sse(controller, { type: 'step', text: `Live Meta Ads performance feed connected · ${via}.` })
        }
        if (imageReady) {
          sse(controller, {
            type: 'step',
            text: useImage
              ? `Image engine ready · models: ${availableImageModels.join(', ')}`
              : `Image engine ready · models: ${availableImageModels.join(', ')} · stills render from each production brief as concepts land`,
          })
        }
        if (useVideo) sse(controller, { type: 'step', text: `Video engine ready · models: ${availableVideoModels.join(', ')}` })
        sse(controller, {
          type: 'step',
          text: `Briefing ${MANDATORY_LAYERS.map((id) => INTELLIGENCE[id].codename).join(' · ')} in parallel…`,
        })

        // ORACLE's memory lookup and the mandatory-layer briefing are
        // independent, so they run against the same wall clock instead of
        // queueing. Neither can fail the run.
        const [winningConfigs, briefing] = await Promise.all([
          // ORACLE retrieves matching past winners and feeds them into OPUS's
          // reasoning — the Reactor reuses what worked instead of starting cold.
          retrieveWinningConfigs({
            angle: ri?.angle ?? body.angle,
            audience: ri?.audienceType,
            awareness: ri?.awarenessStage,
            offer: ri?.offerType,
          })
            .then((configs) => {
              if (configs.length > 0) {
                // A step, NOT a second ORACLE delegate report. The memory
                // lookup runs alongside ORACLE's own preflight consult, so
                // emitting it as a delegate produced two Strategic Memory
                // cards for one layer — and whichever landed last overwrote
                // the other's confidence, so a failed consult could downgrade
                // a successful memory hit to "Layer unavailable / Exploratory".
                sse(controller, {
                  type: 'step',
                  text: `ORACLE memory · retrieved ${configs.length} matching historical winner${configs.length === 1 ? '' : 's'} — feeding configurations into generation.`,
                })
              }
              return configs
            })
            .catch(() => [] as WinningConfig[]),
          preflightBriefing(
            anthropic,
            controller,
            {
              angle: ri?.angle ?? body.angle,
              audience: ri?.audienceType,
              awareness: ri?.awarenessStage,
              offer: ri?.offerType,
              brief: ri?.brief,
            },
            body.builderId ?? null,
            Math.max(8_000, RUN_BUDGET_MS * PREFLIGHT_MAX_SHARE - elapsed()),
          ).catch(() => ''),
        ])
        const oracleMemory = memoryBlock(winningConfigs)

        const angleClause =
          !body.angle || body.angle === 'Agent decides' || body.angle === 'No Preference'
            ? 'Select the strongest campaign angle from the brief and intelligence'
            : `Design campaign concepts for the "${body.angle}" angle`
        // Short-ceiling hosts cannot afford the consult → refine → submit arc.
        // The preflight briefing above already carries ATLAS, NOVA and ORACLE's
        // findings, so the evidence is in hand — say so, and ask for the submit
        // on this turn rather than letting OPUS open with more retrieval.
        const fastClause = FAST_PATH
          ? ' TIME-CONSTRAINED RUN: the intelligence briefing above is your research — it is complete and already grounded. Do NOT open with consult_intelligence. Call submit_concepts on this turn, covering every requested output type, citing the briefing as your evidence. Only consult a layer if a concept genuinely cannot be written without it.'
          : ''
        const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
          {
            role: 'user',
            content: `${angleClause}. Active intelligence inputs: ${(body.inputs ?? []).join(', ') || 'all'}. Requested output types: ${outputs.join(', ')}.${briefing}${fastClause}`,
          },
        ]

        // Built once: identical across every turn, so the cached prefix (tools +
        // this system prompt) is reused for the life of the run instead of being
        // re-billed at full input price on each of the up-to-12 turns.
        // Clone & Isolation clauses — additive prompt blocks. When both are
        // absent the prompt is byte-for-byte today's free-generation prompt.
        const cloneClause = body.cloneReference ? BLOCK_SEP + cloneBlock(body.cloneReference) : ''
        const isolationClause = body.isolate ? BLOCK_SEP + isolationBlock(body.isolate) : ''
        const systemPrompt =
          coordinatorPrompt(outputs, {
            metaAds: Boolean(mcpServer),
            image: useImage,
            imageRendersFromBrief: imageReady && !useImage,
            video: useVideo,
            videoModels: availableVideoModels,
            imageModels: availableImageModels,
            preferredVideoModel: body.videoModel ?? null,
            preferredImageModel: body.imageModel ?? null,
          }) + inputBlocks + oracleMemory + cloneClause + isolationClause

        // One test ID per isolation run — stamped onto every submitted concept so
        // outcomes attribute back to which single variable was under test.
        const runTestId = body.isolate ? mintTestId() : ''
        if (body.cloneReference && !body.cloneReference.designOnly) {
          sse(controller, {
            type: 'step',
            text: `Cloning reference structure${
              body.cloneReference.sourceLabel ? ` · ${body.cloneReference.sourceLabel}` : ''
            } — concepts will match its DNA.`,
          })
          if (body.cloneReference.visual) {
            const v = body.cloneReference.visual
            sse(controller, {
              type: 'step',
              text: `SPARK design read applied — ${v.layout} · ${v.palette
                .slice(0, 3)
                .map((c) => c.hex)
                .join(' ')} · driving the production brief.`,
            })
          }
        }
        if (body.isolate) {
          sse(controller, {
            type: 'step',
            text: `Isolation test ${runTestId} — varying ${body.isolate.axis} across ${body.isolate.values.length} value(s), all else locked.`,
          })
        }

        // NEURO (Predicted Response pre-test) run state: the grounding rubric is
        // retrieved once and reused across any revision, and a bounded counter
        // caps how many times OPUS is sent back to fix weak-scoring concepts.
        // Warm the retrieval NOW — the moment the run starts — so it resolves in
        // parallel with the agent's intelligence loop + copy generation instead
        // of adding a serial wait at submit time. It's cached across runs too, so
        // repeat fires resolve instantly. Errors are swallowed inside the helper.
        const neuroPrinciplesPromise = retrieveNeuroPrinciples(body.angle ?? '', body.builderId ?? null)
        let neuroRevisions = 0

        // Run budget. The host can kill this function without warning, which
        // ends the stream mid-sentence and loses everything the run produced.
        // Staying inside a limit we control means an overrun is something we
        // report and close on, not something that happens to us. The clock
        // itself starts at the top of `start()` so preflight counts against it.
        const overNudge = () => elapsed() > RUN_BUDGET_MS * BUDGET_NUDGE_AT
        let nudged = false
        // A turn already in flight cannot be cancelled, so the budget has to be
        // spent BEFORE starting one. Tracking the slowest turn seen lets the
        // loop stop while there is still room for the turn it is about to run —
        // a fixed percentage alone would happily start a 30s turn with 8s left.
        let slowestTurnMs = 0
        const cannotFitAnotherTurn = () =>
          elapsed() > RUN_BUDGET_MS * BUDGET_CLOSE_AT ||
          elapsed() + slowestTurnMs > RUN_BUDGET_MS

        // The model actually driving this run. Starts on the orchestrator tier
        // (Fable 5); if the org can't run it at all (400 on every request when
        // the 30-day data-retention requirement isn't met, 403/404 on access),
        // the run switches to Opus 4.8 once and continues — the platform never
        // dies on model eligibility.
        // Under a short host ceiling, orchestrate on the fallback tier from the
        // start: Fable 5's always-on thinking cannot turn over fast enough to
        // reach submit_concepts inside the budget.
        let opusModel: string = FAST_PATH ? OPUS_FALLBACK_MODEL : OPUS_MODEL
        let fallbackAnnounced = false
        // Submissions that arrived with nothing in them. Bounded so a model
        // stuck in a truncation loop ends the run with a real error rather than
        // burning every turn.
        let emptySubmissions = 0

        // The briefing already spent the clock — there is room for exactly one
        // turn, so ask for the submission on it rather than letting OPUS open
        // with retrieval it will never get to use.
        if (overNudge()) {
          nudged = true
          sse(controller, {
            type: 'step',
            text: 'Briefing used the run’s time budget — OPUS is submitting straight from the evidence in hand.',
          })
          // Appended to the opening message rather than pushed as a second user
          // turn — nothing has been sent yet, so this is one instruction, not a
          // conversation.
          const first = messages[0]
          if (typeof first.content === 'string') {
            first.content += ' TIME BUDGET REACHED BEFORE GENERATION. Do not consult any layer. Call submit_concepts on this turn with the strongest concepts you can write from the briefing above, covering every requested output type. Partial, grounded work shipped beats a perfect run that never lands.'
          }
        }

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          // Out of time before another round trip could land — stop here and
          // report it, rather than starting a turn the host will cut short.
          //
          // The FIRST turn is exempt. This guard exists so the run degrades to
          // partial output instead of being killed mid-stream, but skipping
          // turn 0 skips the only turn that can produce an ad — the run then
          // ends with a complete intelligence briefing and zero concepts, which
          // is the one outcome the budget was supposed to prevent. If the clock
          // is already spent, ask for the concepts anyway: a submission that
          // lands late still ships, and one that never happens cannot.
          if (turn > 0 && cannotFitAnotherTurn()) {
            const shipped = flushPendingConcepts()
            sse(controller, {
              type: shipped ? 'step' : 'error',
              ...(shipped
                ? {
                    text: `The run hit its ${Math.round(RUN_BUDGET_MS / 1000)}s time limit during the revision pass. The concepts above are real but did not clear the pre-test — review them, or raise REACTOR_BUDGET_MS to give the revision room to finish.`,
                  }
                : {
                    message: `The run hit its ${Math.round(RUN_BUDGET_MS / 1000)}s time limit before OPUS submitted concepts. The intelligence below is real and complete — retry, or lower the variation count to give generation more room. (Raise REACTOR_BUDGET_MS if your hosting plan allows longer functions.)`,
                  }),
            })
            sse(controller, { type: 'done' })
            controller.close()
            return
          }

          const onFable = opusModel !== OPUS_FALLBACK_MODEL
          const betas: string[] = []
          const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
            model: opusModel,
            // A submit_concepts call carries several full concepts — each with a
            // production brief, a rubric basis and a complete Meta adPackage.
            // At 4000 the model ran out of room mid-array, the tool_use block
            // came back truncated, and its `concepts` parsed as EMPTY: the run
            // then validated "0 package(s)", pre-tested nothing, and shipped a
            // successful-looking run with no ads. Room to finish the array is
            // cheaper than a run that produces nothing.
            max_tokens: 16_000,
            system: [{ type: 'text', text: systemPrompt, cache_control: EPHEMERAL }],
            tools,
            messages: withConversationCache(messages),
          }
          if (mcpServer) {
            params.mcp_servers = [mcpServer]
            betas.push(MCP_BETA)
          }
          // Server-side safety fallback: a Fable 5 classifier decline is
          // re-served by Opus 4.8 inside the same call instead of failing the run.
          if (onFable) {
            params.fallbacks = [{ model: OPUS_FALLBACK_MODEL }]
            betas.push(SERVER_SIDE_FALLBACK_BETA)
          }
          if (betas.length) params.betas = betas

          let response: Anthropic.Beta.Messages.BetaMessage
          const turnStart = Date.now()
          try {
            response = await withRetry(
              () => anthropic.beta.messages.create(params),
              (n, w) =>
                sse(controller, {
                  type: 'step',
                  text: `Claude is busy (overloaded) — retrying (${n}/4) in ${w / 1000}s…`,
                }),
            )
            // Feeds the "can another turn fit?" estimate above.
            slowestTurnMs = Math.max(slowestTurnMs, Date.now() - turnStart)
          } catch (err) {
            // Eligibility errors on the orchestrator model (org retention config,
            // model access) — switch to the fallback tier and redo this turn.
            const status = (err as { status?: number })?.status
            if (onFable && (status === 400 || status === 403 || status === 404)) {
              sse(controller, {
                type: 'step',
                text: `Orchestrator model unavailable for this org — continuing on ${OPUS_FALLBACK_MODEL}.`,
              })
              opusModel = OPUS_FALLBACK_MODEL
              turn--
              continue
            }
            throw err
          }

          // Safety-fallback telemetry: a `fallback` block marks a mid-run model
          // switch; sticky-served turns carry no block, so also check usage.
          const fallbackServed =
            response.content.some((b) => b.type === 'fallback') ||
            (response.usage.iterations ?? []).some((it) => it.type === 'fallback_message')
          if (fallbackServed && !fallbackAnnounced) {
            fallbackAnnounced = true
            sse(controller, {
              type: 'step',
              text: `Safety classifiers declined a step — continued seamlessly on ${response.model}.`,
            })
          }

          // Whole chain refused (Fable 5 and the fallback both declined) — end
          // the run cleanly instead of parsing empty content.
          if (response.stop_reason === 'refusal') {
            sse(controller, {
              type: 'error',
              message:
                'The request was declined by safety classifiers on every available model. Reword the brief and fire again.',
            })
            controller.close()
            return
          }

          messages.push({ role: 'assistant', content: response.content })

          // Surface server-side Meta Ads (MCP) tool activity in the telemetry feed.
          for (const block of response.content) {
            if (block.type === 'mcp_tool_use') {
              sse(controller, { type: 'retrieval', system: 'meta-ads', title: block.name })
            }
          }

          // Server-side tool loop paused — re-send to let it resume.
          if (response.stop_reason === 'pause_turn') continue

          // The turn hit the token ceiling. Any tool call in it is incomplete,
          // so this is reported rather than left to look like a normal turn —
          // a truncated submit_concepts is the failure mode that produced runs
          // with full intelligence and no ads.
          const truncated = response.stop_reason === 'max_tokens'
          if (truncated) {
            sse(controller, {
              type: 'step',
              text: 'OPUS hit the token ceiling mid-write — the turn was cut off before it finished.',
            })
          }

          const toolUses = response.content.filter(
            (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use',
          )
          if (toolUses.length === 0) break

          /**
           * Resolve one non-terminal tool call. Every tool handled here is
           * independent of its siblings in the same turn: a retrieval, a static
           * rubric read, or a render kicked off from a prompt the model already
           * holds. A render that animates a still necessarily references an
           * imageUrl from an EARLIER turn's tool_result, so nothing in a single
           * turn depends on anything else in it.
           */
          const runIndependentTool = async (
            tu: Anthropic.Beta.Messages.BetaToolUseBlock,
          ): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam> => {
            if (tu.name === 'consult_intelligence') {
              const { layer, question } = tu.input as { layer: string; question: string }
              if (!isIntelligenceId(layer)) {
                return {
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: 'Unknown intelligence layer',
                  is_error: true,
                }
              }
              const findings = await runIntelligence(
                anthropic,
                controller,
                layer,
                question,
                body.builderId ?? null,
              )
              return { type: 'tool_result', tool_use_id: tu.id, content: findings }
            }

            if (tu.name === 'get_learnings') {
              sse(controller, { type: 'step', text: 'ORACLE — loading the Creative Learnings rubric for self-critique…' })
              return { type: 'tool_result', tool_use_id: tu.id, content: LEARNINGS_RUBRIC }
            }

            if (tu.name === 'generate_image') {
              const { prompt, conceptType, aspectRatio, model } = tu.input as {
                prompt: string
                conceptType?: string
                aspectRatio?: AspectRatio
                model?: string
              }
              sse(controller, {
                type: 'step',
                text: `Generating still creative via ${model ?? 'default model'}${conceptType ? ` · ${conceptType}` : ''}…`,
              })
              const result = await generateImageWith(model, prompt, aspectRatio ?? '1:1')
              if (!result) {
                return {
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: JSON.stringify({ imageUrl: null, note: 'image generation unavailable' }),
                }
              }
              sse(controller, {
                type: 'media',
                mediaType: 'image',
                conceptType: conceptType ?? '',
                model: result.modelId,
                provider: result.provider,
                url: result.imageUrl,
              })
              return {
                type: 'tool_result',
                tool_use_id: tu.id,
                content: JSON.stringify({ imageUrl: result.imageUrl, model: result.modelId }),
              }
            }

            if (tu.name === 'generate_video') {
              const { mode, prompt, imageUrl, model, aspectRatio, conceptType } = tu.input as {
                mode: GenMode
                prompt?: string
                imageUrl?: string
                model?: string
                aspectRatio?: AspectRatio
                conceptType?: string
              }
              sse(controller, {
                type: 'step',
                text: `Rendering ${mode} via ${model ?? 'default model'}${conceptType ? ` · ${conceptType}` : ''}…`,
              })
              // 4:5 is a stills-only ratio (Meta's tall feed); no video model
              // renders it, so a request for it falls back to the nearest
              // vertical rather than being passed through and rejected.
              const videoRatio = aspectRatio === '4:5' ? '9:16' : aspectRatio
              const started = await startVideoJob(model, { mode, prompt, imageUrl, aspectRatio: videoRatio })
              if (!started) {
                return {
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: JSON.stringify({ requestId: null, note: 'video generation unavailable' }),
                }
              }
              await logGeneration({
                builder_id: body.builderId ?? null,
                model_id: started.modelId,
                provider: started.provider,
                mode,
                prompt: prompt ?? null,
                image_url: imageUrl ?? null,
                request_id: started.requestId,
                status: started.status,
              })
              sse(controller, {
                type: 'media',
                mediaType: 'video',
                conceptType: conceptType ?? '',
                model: started.modelId,
                provider: started.provider,
                requestId: started.requestId,
                status: started.status,
                responseUrl: started.responseUrl,
              })
              return {
                type: 'tool_result',
                tool_use_id: tu.id,
                content: JSON.stringify({
                  requestId: started.requestId,
                  model: started.modelId,
                  status: started.status,
                  note: 'video is rendering; it will appear on the concept card when ready',
                }),
              }
            }

            return { type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool', is_error: true }
          }

          // Everything except the terminal submit runs concurrently — four
          // stills used to render one after another, each waiting on the last.
          // Same calls, same results, one wall clock. `submit_concepts` stays
          // outside because it gates the run and can end it.
          const independentUses = toolUses.filter((tu) => tu.name !== 'submit_concepts')
          const settled = await Promise.all(independentUses.map(runIndependentTool))
          const resultById = new Map(settled.map((r) => [r.tool_use_id, r]))

          // Replayed in the order the model asked, so the transcript reads the
          // way the model wrote it.
          const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = []
          for (const tu of toolUses) {
            const done = resultById.get(tu.id)
            if (done) {
              results.push(done)
              continue
            }
            if (tu.name === 'submit_concepts') {
              const concepts = (tu.input as { concepts?: Concept[] }).concepts ?? []

              // An empty submission is a FAILED submission, never a finished
              // run. It happens when the turn is cut off mid-array (see the
              // max_tokens note above) — the tool call arrives with nothing in
              // it. Shipping that closed the stream on a "complete" run with
              // zero ads, which is indistinguishable to the operator from the
              // platform silently not working. Hand it back and ask again.
              if (concepts.length === 0) {
                emptySubmissions += 1
                if (emptySubmissions > MAX_EMPTY_SUBMISSIONS) {
                  sse(controller, {
                    type: 'error',
                    message:
                      'OPUS submitted an empty set of concepts twice — the run is stopping rather than reporting success with no ads. The intelligence above is real; fire again, and if it repeats, reduce the number of formats or variations so each submission fits in one turn.',
                  })
                  sse(controller, { type: 'done' })
                  controller.close()
                  return
                }
                sse(controller, {
                  type: 'step',
                  text: `Submission arrived empty${
                    truncated ? ' (the turn was cut off mid-write)' : ''
                  } — asking OPUS to resubmit.`,
                })
                results.push({
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  is_error: true,
                  content: `submit_concepts was called with an EMPTY concepts array, so nothing shipped.${
                    truncated
                      ? ' Your previous turn was cut off before the array finished — write FEWER concepts per call and keep each one tighter so the whole call fits in one turn.'
                      : ''
                  } Call submit_concepts again with at least one complete concept covering the requested output types.`,
                })
                continue
              }

              // Meta ad-unit compliance gate — Meta's placement limits + TPB's
              // hard compliance phrases, enforced in code before anything ships.
              const compliance = adPackageFeedback(concepts)
              sse(controller, {
                type: 'step',
                text: `Validating Meta ad units · ${concepts.length} package(s)${
                  compliance.failingIndices.length
                    ? ` · ${compliance.failingIndices.length} non-compliant`
                    : ' · all launch-ready'
                }`,
              })

              // NEURO — neural pre-test: estimate the predicted response of each
              // concept before it ships. Grounded in neuromarketing principles
              // (retrieved once, reused across any revision).
              sse(controller, {
                type: 'step',
                text: 'NEURO — pre-testing concepts against neuromarketing principles (predicted response)…',
              })
              const neuroPrinciples = await neuroPrinciplesPromise
              const scores = await scoreConceptsNeuro(anthropic, NEURO_MODEL, concepts, neuroPrinciples)
              const weak = weakConceptIndices(scores)
              const avg = (k: 'attention' | 'hook') =>
                scores.length
                  ? Math.round((scores.reduce((s, x) => s + x[k], 0) / scores.length) * 10) / 10
                  : 0
              sse(controller, {
                type: 'step',
                text: `NEURO pre-test complete · avg attention ${avg('attention')}/10 · avg hook ${avg('hook')}/10${
                  weak.length ? ` · ${weak.length} below bar` : ' · all passed'
                }`,
              })

              // Under a short ceiling a revision costs a whole extra turn the
              // run does not have — ship the first submission with its scores
              // attached and let the flagged numbers speak for themselves.
              const revisionBudget = FAST_PATH ? 0 : MAX_NEURO_REVISIONS
              const needsRevision = weak.length > 0 || compliance.failingIndices.length > 0
              if (needsRevision && neuroRevisions < revisionBudget) {
                // Step 5 — hand the weak scores / compliance failures back to
                // OPUS so it revises (or drops), same as the rubric self-critique.
                // Both gates share one bounded revision pass to cap cost.
                neuroRevisions += 1
                // Retain this submission before handing it back. It is finished,
                // scored work; if the revision never lands (budget, turn limit,
                // fault) these ship rather than vanishing.
                concepts.forEach((c, i) => {
                  c.neuro = scores[i]
                })
                if (body.isolate) tagIsolatedConcepts(concepts, body.isolate, runTestId)
                pendingConcepts = concepts
                sse(controller, {
                  type: 'step',
                  text: `${
                    weak.length
                      ? `NEURO flagged ${weak.length} concept(s) for weak scroll-stop / hook`
                      : ''
                  }${weak.length && compliance.failingIndices.length ? ' · ' : ''}${
                    compliance.failingIndices.length
                      ? `${compliance.failingIndices.length} ad unit(s) non-compliant`
                      : ''
                  } — OPUS revising…`,
                })
                const feedbackParts: string[] = []
                if (weak.length > 0) feedbackParts.push(neuroFeedback(concepts, scores, weak))
                if (compliance.failingIndices.length > 0) feedbackParts.push(compliance.feedback)
                results.push({
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: feedbackParts.join('\n\n'),
                })
              } else {
                // Passed the pre-test (or revision budget spent) — attach the
                // predicted-response score to each concept and ship.
                concepts.forEach((c, i) => {
                  c.neuro = scores[i]
                })
                // Isolation mode: stamp taxonomy + test/variant IDs so the
                // outcome loop can attribute a win to the single varied axis.
                if (body.isolate) tagIsolatedConcepts(concepts, body.isolate, runTestId)
                for (const c of concepts) sse(controller, { type: 'concept', concept: c })
                sse(controller, { type: 'done' })
                controller.close()
                return
              }
            }
          }
          messages.push({ role: 'user', content: results })

          // Past the nudge line, stop the exploring. OPUS gets one plain
          // instruction to land what it has — sent once, alongside the tool
          // results it was already going to read, so it costs no extra turn.
          if (!nudged && overNudge()) {
            nudged = true
            sse(controller, {
              type: 'step',
              text: 'Time budget reached — OPUS is finalising and submitting now.',
            })
            messages.push({
              role: 'user',
              content:
                'TIME BUDGET REACHED. Stop consulting and stop refining. Call submit_concepts NOW with the strongest concepts you can write from the evidence already in hand, covering every requested output type. Partial, grounded work shipped beats a perfect run that never lands.',
            })
          }
        }

        if (!flushPendingConcepts()) {
          sse(controller, {
            type: 'step',
            text: 'Coordinator reached its turn limit without submitting concepts.',
          })
        }
        sse(controller, { type: 'done' })
        controller.close()
      } catch (err) {
        console.error('Campaign Reactor error:', err)
        const status = (err as { status?: number })?.status
        const rawMessage = err instanceof Error ? err.message : ''

        // A key is configured but the account is out of credit (or otherwise
        // can't bill) — the live run can't proceed. Rather than hard-faulting,
        // honour the platform's "always works end to end" rule and fall back to
        // the curated demo intelligence so the canvas still fills. Matches the
        // missing-key fallback at the top of the handler.
        const isBilling =
          status === 402 ||
          /credit balance is too low|billing|insufficient (?:quota|funds|credit)|exceeded your (?:current )?quota|payment required/i.test(
            rawMessage,
          )
        if (isBilling) {
          try {
            sse(controller, {
              type: 'step',
              text: 'Live Anthropic credit unavailable — switching to demo intelligence so the run completes. Add credit in Plans & Billing for the live OPUS network.',
            })
            await runDemo(controller, body)
            controller.close()
            return
          } catch (demoErr) {
            console.error('Campaign Reactor demo fallback error:', demoErr)
          }
        }

        // A submission already in hand outlives the fault that interrupted its
        // revision — ship it and close cleanly rather than reporting nothing.
        if (flushPendingConcepts()) {
          sse(controller, {
            type: 'step',
            text: 'The revision pass faulted after concepts were submitted — the concepts above are the last complete set and did not clear the pre-test.',
          })
          sse(controller, { type: 'done' })
          controller.close()
          return
        }

        const message =
          status === 529 || status === 503
            ? 'Claude is temporarily overloaded. Please fire the reactor again in a moment.'
            : status === 429
              ? 'Rate limit reached. Wait a few seconds and fire the reactor again.'
              : err instanceof Error
                ? err.message
                : 'Reactor failed'
        sse(controller, { type: 'error', message })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
