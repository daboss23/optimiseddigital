/**
 * NEURO — the Predicted Response layer (TRIBE-inspired neural pre-test).
 *
 * TRIBE v2 (Meta) predicts the brain's response to a stimulus before you run it.
 * We can't use that model (CC BY-NC license, and it outputs fMRI voxels, not ad
 * performance), but we CAN port its thesis: score every generated concept on how
 * the human brain is likely to react BEFORE any spend — grounded not in fMRI but
 * in established neuromarketing principles (and, later, in the account's own outcome
 * data).
 *
 * This is a PREDICTION/ESTIMATE, never measured neuroscience. The UI labels it as
 * such. Like the rest of the retrieval layer it degrades gracefully: it never
 * throws, and falls back to curated principles when the Vault has none.
 *
 * Runs on the cheap intelligence model (Sonnet), not OPUS — it is a structured
 * grading pass, exactly the kind of bulk sub-task the intelligence layers use.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { searchKnowledge } from '@/lib/knowledge'
import { parseModelJson } from '@/lib/parse'
import { NEURO_PASS_MARK, type NeuroScore } from '@/lib/reactor-inputs'
import { getTenant, tenantShortName } from '@/lib/tenant'
import { currentAccount } from '@/lib/account'

/** A concept as it reaches the NEURO grader (only the fields it scores on). */
interface ScorableConcept {
  type: string
  text: string
  productionBrief?: {
    frames?: { label: string; description: string }[]
    /** The words burned into the creative — with no caption behind it, this IS the opening. */
    onImageText?: { role?: string; text?: string }[]
  }
}

/** Concept fails the pre-test when its scroll-stop or hook is weak. */
export const NEURO_THRESHOLD = NEURO_PASS_MARK

/**
 * Curated neuromarketing principles — the grounding rubric NEURO scores against
 * when the Vault has nothing more specific. These are established, well-documented
 * effects (not invented), so the estimate is principled even before the account uploads
 * its own neuro-research.
 */
export const NEURO_PRINCIPLES = `ESTABLISHED NEUROMARKETING PRINCIPLES (the grounding rubric):
- Visual salience & pattern-interrupt: attention is allocated to novelty and high-contrast change within the first ~50ms. Openings that break the expected scroll pattern win attention; predictable openings get filtered out pre-consciously.
- Processing fluency / cognitive load: messages that are easy to process feel truer and more likeable (the fluency heuristic). One clear idea per beat beats a crowded frame; complexity taxes attention and suppresses action.
- Emotional valence & arousal: emotionally arousing stimuli are encoded more strongly and drive sharing and action far more than neutral information (the affect heuristic). Flat, purely informational creative under-performs.
- Memory encoding / isolation (Von Restorff) effect: a single distinctive, isolated element is remembered better than a list. One bold figure or one named person beats many competing claims.
- First-3-seconds attentional gating: scroll-stopping requires a concrete, specific, curiosity-opening first beat. Vague or generic openers are gated out before the message lands.
- Specificity & concreteness: concrete numbers and named individuals are processed as more credible and more memorable than abstract claims.
- Self-reference effect: creative that makes the viewer feel personally identified ("seen") is encoded more deeply and recalled better.
- Loss aversion & problem framing: the brain weighs potential losses more heavily than equivalent gains; a sharply framed problem can out-pull a gain promise.`

/**
 * Cross-run cache for the resolved neuro principles. The curated rubric never
 * changes and the Vault's neuro/creative knowledge changes rarely, so re-running
 * the retrieval on every reactor fire is pure waste. We key by angle + builder so
 * two different briefs don't share each other's vault-weighted rubric, and expire
 * entries after a TTL so freshly uploaded knowledge is still picked up within the
 * same server process. Never affects OUTPUT quality — the same principles string
 * the retrieval would have produced, just served from memory.
 */
const NEURO_PRINCIPLES_TTL_MS = 10 * 60 * 1000
const neuroPrinciplesCache = new Map<string, { value: string; at: number }>()

/**
 * Retrieve any account-specific neuromarketing knowledge from the Vault (learning +
 * creative systems), appended to the curated principles. Never throws — returns
 * the curated rubric alone if retrieval is unavailable. Cached per angle+builder
 * across runs (see NEURO_PRINCIPLES_TTL_MS) so the retrieval is skipped on repeat
 * fires without changing the resolved rubric.
 */
export async function retrieveNeuroPrinciples(
  angle: string,
  builderId: string | null,
): Promise<string> {
  const cacheKey = `${builderId ?? '_'}::${angle}`
  const cached = neuroPrinciplesCache.get(cacheKey)
  if (cached && Date.now() - cached.at < NEURO_PRINCIPLES_TTL_MS) return cached.value

  try {
    const query = `neuromarketing attention emotion memory hook principles for ${angle} creative`
    const hits = (
      await Promise.all([
        searchKnowledge(query, { system: 'learning', k: 4, builderId }),
        searchKnowledge(query, { system: 'creative', k: 2, builderId }),
      ])
    ).flat()
    const value =
      hits.length === 0
        ? NEURO_PRINCIPLES
        : `${NEURO_PRINCIPLES}\n\nVAULT — uploaded neuro/creative knowledge relevant to this run (weight these heavily):\n${hits
            .map((h) => `- [${h.system}] ${h.title}: ${h.content}`)
            .join('\n')}`
    neuroPrinciplesCache.set(cacheKey, { value, at: Date.now() })
    return value
  } catch {
    return NEURO_PRINCIPLES
  }
}

/* --------------------------------- Scoring -------------------------------- */

const clamp = (n: unknown): number => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 5
  return Math.min(10, Math.max(1, v))
}

function normalize(raw: Partial<NeuroScore>): NeuroScore {
  const attention = clamp(raw.attention)
  const emotion = clamp(raw.emotion)
  const memorability = clamp(raw.memorability)
  const hook = clamp(raw.hook)
  const overall = Math.round(((attention + emotion + memorability + hook) / 4) * 10) / 10
  return {
    attention,
    emotion,
    memorability,
    hook,
    overall,
    reason: typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : 'Predicted response estimate.',
    principle: typeof raw.principle === 'string' && raw.principle.trim() ? raw.principle.trim() : undefined,
  }
}

/** A neutral score used when the model call fails — keeps the run usable. */
function neutralScore(): NeuroScore {
  return { attention: 5, emotion: 5, memorability: 5, hook: 5, overall: 5, reason: 'Pre-test unavailable — defaulted to neutral.' }
}

function conceptLine(c: ScorableConcept, i: number): string {
  const frames = c.productionBrief?.frames?.length
    ? ` | First beat: ${c.productionBrief.frames[0].description}`
    : ''
  // The words a scroller actually reads on the creative. The platform ships
  // no caption, so the on-image headline and offer ARE the opening — grade
  // what ships, not just the concept.
  const words = (c.productionBrief?.onImageText ?? [])
    .map((t) => t?.text?.trim())
    .filter(Boolean)
  const opening = words.length ? ` | On the creative: "${words.join('" / "')}"` : ''
  return `${i}. [${c.type}] ${c.text}${opening}${frames}`
}

/**
 * Score each concept's predicted neural response on Sonnet, grounded in the
 * supplied principles. Returns one NeuroScore per concept, aligned by index.
 * Never throws — returns neutral scores on any failure so the reactor still
 * delivers concepts.
 */
export async function scoreConceptsNeuro(
  anthropic: Anthropic,
  model: string,
  concepts: ScorableConcept[],
  principles: string,
): Promise<NeuroScore[]> {
  if (concepts.length === 0) return []

  const list = concepts.map(conceptLine).join('\n')
  const brand = tenantShortName(await getTenant(await currentAccount()))
  const system = `You are NEURO, the Predicted Response layer of ${brand}'s Creative Intelligence Command Center. You run a neural PRE-TEST on ad concepts: estimate how the human brain is likely to react to each one before any spend, using established neuromarketing principles. You are producing an ESTIMATE, not measured brain data — be calibrated and honest, not flattering.

${principles}

Score each concept on four axes, 1-10:
- attention: scroll-stopping power of the opening (visual salience / pattern-interrupt).
- emotion: emotional pull and arousal (does it make the viewer feel something).
- memorability: how well it will be encoded and recalled an hour later.
- hook: first-3-seconds strength (does the opener earn the next beat).

Be discriminating: reserve 9-10 for genuinely exceptional, use 4-5 for generic/forgettable. Give a single, specific reason (max 18 words) naming the weakness or strength, and the one principle it most leans on.`

  const userMsg = `Score these ${concepts.length} concept(s). Return ONLY a JSON array, one object per concept IN ORDER, each: {"attention":n,"emotion":n,"memorability":n,"hook":n,"reason":"...","principle":"..."}.

${list}`

  try {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 1600,
      // Cache the system prompt: it carries the full neuromarketing principles
      // block (large + identical across every concept batch and every revision
      // pass of a run), so the second+ NEURO call bills its input as a cache
      // read instead of full-price tokens. Same grading, lower input-token time.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    })
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    const parsed = parseModelJson<Partial<NeuroScore>[]>(block?.text ?? '[]')
    const arr = Array.isArray(parsed) ? parsed : []
    return concepts.map((_, i) => (arr[i] ? normalize(arr[i]) : neutralScore()))
  } catch {
    return concepts.map(() => neutralScore())
  }
}

/* ------------------------- Pre-test on the pixels -------------------------- */

/**
 * What the finished creative actually shows, read off its pixels — the checks
 * a media buyer makes before an upload, done before the spend instead of after.
 */
export interface CreativeQc {
  /** Every word visible on the creative, transcribed as rendered. */
  readText: string
  /**
   * Whether each intended on-image line appears on the creative exactly as
   * written. Compared in code, not judged by the model — a misspelled
   * headline is the single most common way an AI-rendered ad ships broken.
   * Null when the creative was meant to carry no words.
   */
  textMatches: boolean | null
  /** The intended lines that did NOT come back off the pixels intact. */
  missingText: string[]
  /** The product is clearly visible and identifiable at thumb size. */
  productVisible: boolean
  /** One line the operator can act on. */
  note: string
}

export interface CreativePretest {
  neuro: NeuroScore
  qc: CreativeQc
}

/** Case, punctuation and whitespace stripped — what "spelled the same" means here. */
function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9%$£€'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Which intended lines are not on the creative as written. Pure, so the
 * selftest can pin it: the model only transcribes, the verdict is computed.
 */
export function missingOnImageText(intended: string[], readText: string): string[] {
  const read = normaliseText(readText)
  return intended
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !read.includes(normaliseText(t)))
}

/**
 * NEURO, pointed at the RENDER rather than the plan.
 *
 * The in-run pre-test scores the concept before a pixel exists. This one
 * reads the finished creative — what a scroller will actually see — and adds
 * the two checks that decide whether an e-commerce ad is uploadable at all:
 * is every word on it spelled the way it was written, and can you see the
 * product. Never throws: returns null on any failure so the caller can fall
 * back to the plan-based score.
 */
export async function pretestCreative(
  anthropic: Anthropic,
  model: string,
  input: {
    type: string
    text: string
    /** The render to read: base64 when the caller fetched it, else a public URL. */
    image: { mediaType: string; data: string } | { url: string }
    /** The words the brief asked the renderer to set. */
    onImageText: string[]
  },
  principles: string,
): Promise<CreativePretest | null> {
  const brand = tenantShortName(await getTenant(await currentAccount()))
  const system = `You are NEURO, the Predicted Response layer of ${brand}'s Creative Intelligence Command Center. You are pre-testing a FINISHED e-commerce ad creative before any money is spent on it: estimate how a person scrolling a Meta feed on a phone is likely to react to exactly these pixels, using established neuromarketing principles. This is an ESTIMATE, not measured brain data — be calibrated and honest, not flattering.

${principles}

Score four axes, 1-10:
- attention: does it stop the scroll at thumb size (salience, contrast, pattern-interrupt).
- emotion: does it make the viewer feel something.
- memorability: will the product and the one idea be remembered an hour later.
- hook: does the first glance earn the second.

Then read the creative like a media buyer:
- readText: transcribe EVERY word visible on the creative exactly as rendered — including misspellings, broken letters and stray glyphs. Do not correct anything. Empty string if there is no text.
- productVisible: true only if the product itself is clearly visible and identifiable at thumb size.
- note: one sentence (max 20 words) the operator can act on.

Be discriminating: 9-10 is rare, 4-5 is generic.`

  const imageBlock =
    'url' in input.image
      ? { type: 'image' as const, source: { type: 'url' as const, url: input.image.url } }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: input.image.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
            data: input.image.data,
          },
        }

  try {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 900,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            imageBlock,
            {
              type: 'text',
              text: `Creative type: ${input.type}\nConcept: ${input.text}\n\nReturn ONLY JSON: {"attention":n,"emotion":n,"memorability":n,"hook":n,"reason":"...","principle":"...","readText":"...","productVisible":true|false,"note":"..."}`,
            },
          ],
        },
      ],
    })
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    const raw = parseModelJson<
      Partial<NeuroScore> & { readText?: unknown; productVisible?: unknown; note?: unknown }
    >(block?.text ?? '{}')
    if (!raw || typeof raw !== 'object') return null
    const readText = typeof raw.readText === 'string' ? raw.readText.trim() : ''
    const intended = input.onImageText.map((t) => t.trim()).filter(Boolean)
    const missingText = intended.length ? missingOnImageText(intended, readText) : []
    return {
      neuro: normalize(raw),
      qc: {
        readText,
        textMatches: intended.length ? missingText.length === 0 : null,
        missingText,
        productVisible: raw.productVisible === true,
        note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : 'Read complete.',
      },
    }
  } catch {
    return null
  }
}

/* ----------------------------------- Gate --------------------------------- */

/**
 * Indices of concepts that fail the neural pre-test — weak scroll-stop OR weak
 * hook. These are the concepts OPUS is asked to revise or drop (the feedback
 * loop), the same way it must revise anything under the rubric bar.
 */
export function weakConceptIndices(scores: NeuroScore[]): number[] {
  return scores
    .map((s, i) => (Math.min(s.attention, s.hook) < NEURO_THRESHOLD ? i : -1))
    .filter((i) => i >= 0)
}

/**
 * The score below which a concept is worth spending a whole orchestrator turn
 * to rewrite.
 *
 * A revision costs a full round trip — 30-60s of a run that has to finish
 * inside the host's function ceiling. Paying that for a concept sitting at 5
 * against a pass mark of 6 buys a marginal rewrite and risks the run being cut
 * off before anything ships. A concept scoring 3 is genuinely broken and worth
 * the turn.
 *
 * Concepts between this floor and the pass mark are NOT revised — they still
 * ship flagged, carrying their real scores on the card, so nothing is hidden.
 */
export const NEURO_REVISION_FLOOR = 4

/**
 * Indices weak enough to justify the cost of a revision turn. A subset of
 * `weakConceptIndices` — everything here is flagged, not everything flagged is
 * here.
 */
export function revisionWorthyIndices(scores: NeuroScore[]): number[] {
  return scores
    .map((s, i) => (Math.min(s.attention, s.hook) < NEURO_REVISION_FLOOR ? i : -1))
    .filter((i) => i >= 0)
}

/**
 * Build the critique handed back to OPUS as the submit_concepts tool result when
 * concepts fail the pre-test, so it revises with specific neuro guidance.
 */
export function neuroFeedback(
  concepts: ScorableConcept[],
  scores: NeuroScore[],
  weak: number[],
): string {
  const lines = weak.map((i) => {
    const s = scores[i]
    return `- [${concepts[i].type}] "${concepts[i].text.slice(0, 70)}…" — NEURO pre-test: attention ${s.attention}/10, hook ${s.hook}/10. ${s.reason}`
  })
  return `NEURO PRE-TEST: ${weak.length} concept(s) scored below the predicted-response bar (attention or first-3-seconds hook under ${NEURO_THRESHOLD}/10). These will under-stop the scroll:\n${lines.join(
    '\n',
  )}\n\nRevise the openings of these concepts (sharper pattern-interrupt, more concrete/specific first beat) OR replace them, then call submit_concepts again. Keep the concepts that passed.`
}

/* -------------------------------- Demo mode ------------------------------- */

/**
 * A deterministic demo NEURO score derived from a concept's rubric score, so
 * demo mode (no ANTHROPIC_API_KEY) also shows the predicted-response layer.
 */
export function demoNeuroScore(rubricScore: number | undefined, type: string): NeuroScore {
  const base = typeof rubricScore === 'number' ? rubricScore : 7
  const visual = /static|video|founder|testimonial|event|campaign/i.test(type) && /concept/i.test(type)
  const attention = clamp(base + (visual ? 0 : -1))
  const emotion = clamp(base + (visual ? 1 : 0))
  const memorability = clamp(base - 1)
  const hook = clamp(base + (/hook|vsl|video|founder/i.test(type) ? 1 : -1))
  const overall = Math.round(((attention + emotion + memorability + hook) / 4) * 10) / 10
  return {
    attention,
    emotion,
    memorability,
    hook,
    overall,
    reason: visual
      ? 'Strong visual pattern-interrupt; concrete proof aids encoding.'
      : 'Specific, concrete framing carries attention and recall.',
    principle: visual ? 'Visual salience & pattern-interrupt' : 'Specificity & concreteness',
  }
}
