import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import { parseModelJson } from '@/lib/parse'
import { getTenant, tenantDescriptor } from '@/lib/tenant'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'

/**
 * Creative Canvas — precise node regeneration.
 *
 * Regenerates exactly ONE node (a hook, a scene, a CTA …) while holding the
 * rest of the concept constant. The strategy snapshot and the lane's locked
 * neighbours travel with the request so the rewrite stays coherent with the
 * awareness stage, sophistication stage, audience, offer, and brand voice —
 * precision, not a fresh roll of the dice.
 *
 * With no ANTHROPIC_API_KEY the node is left unchanged and the surface says
 * why — it never substitutes copy written for a different business.
 */

interface RegenerateBody {
  kind: string
  title?: string
  current: string
  strategy?: {
    angle?: string
    awareness?: string
    sophistication?: string
    audience?: string
    offer?: string
    offerName?: string
  }
  /** The lane's kept context — locked/approved neighbour nodes, in spine order. */
  context?: string[]
  /** Optional user steer, e.g. "harder on identity, no numbers". */
  direction?: string
}

const KIND_INSTRUCTIONS: Record<string, string> = {
  hook: 'Write ONE scroll-stopping opening line for a Meta ad. Under 125 characters, specific and contrarian, no hype words, no emoji. It must survive the "See more" fold on its own.',
  message:
    'Write the ad’s primary-text body: the argument. 2–4 short paragraphs — mechanism, stakes, and one concrete proof point. Operator-to-operator voice, no fluff.',
  proof:
    'Write ONE proof block for the ad: a named, specific piece of evidence — a member result with concrete figures, a documented win, or a verifiable stat. One or two sentences. The result must be attributed to a named individual as THEIR result, never implied as typical.',
  // Deliberately industry-neutral. "On-site builder context" was hard-coded
  // here, so a node regenerated for a software company, a clinic or an agency
  // came back directing a construction site. The business the ad is for is
  // already named in the system prompt above — the direction takes it from
  // there. The FIRST beat is the subject on purpose: a visual direction that
  // only names copy zones leaves the image model with nothing to photograph.
  visual:
    'Write a frame-by-frame visual direction for one ad creative (3–5 numbered beats, one line each). Beat 1 is the SUBJECT — who or what is in shot, where, in what light, framed how — drawn from this business\'s own world; later beats place the copy on it. Premium and photographic, never decorative stock imagery.',
  scene:
    'Rewrite ONE scene of a multi-scene montage ad: a single vivid beat — what the camera sees plus a one-line on-screen caption or VO. Two sentences maximum.',
  cta: 'Write ONE Meta ad headline (max 40 characters) that converts the argument into the ask. Direct, specific, zero hype.',
}

/**
 * The zero-key path.
 *
 * This used to hand back a pool of finished ad copy — named clients, real
 * margins, a specific trade — written for one company. On any other deployment
 * that is not a placeholder, it is another business's ad appearing inside your
 * campaign, one click from being approved and shipped. A node that regenerated
 * into someone else's proof point is worse than a node that did not regenerate.
 *
 * So without a key the node is left exactly as it was and the caller is told
 * why. `demo: true` still rides on the response, so the canvas can label it.
 */
const NO_KEY_MESSAGE =
  'Set ANTHROPIC_API_KEY to regenerate this node — the canvas will not substitute copy written for another business.'

export async function POST(request: NextRequest) {
  let body: RegenerateBody
  try {
    body = (await request.json()) as RegenerateBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const kind = body.kind in KIND_INSTRUCTIONS ? body.kind : 'hook'
  const current = (body.current ?? '').trim()

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, text: current, demo: true, error: NO_KEY_MESSAGE })
  }

  const s = body.strategy ?? {}
  const strategyLines = [
    s.angle && `Angle: ${s.angle}`,
    s.awareness && `Awareness stage: ${s.awareness}`,
    s.sophistication && `Market sophistication: ${s.sophistication}`,
    s.audience && `Audience: ${s.audience}`,
    s.offer && `Offer: ${s.offer}${s.offerName ? ` — "${s.offerName}"` : ''}`,
  ].filter(Boolean)

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: 500,
      system:
        `You are the copy chief for ${tenantDescriptor(await getTenant(await currentAccount()))}. You regenerate exactly ONE part of an ad concept while every other part stays fixed — the rewrite must remain coherent with the strategy constraints and the kept parts. Voice: confident, specific, native to this business and its audience, operator to operator; concrete numbers and named proof over adjectives; no hype, no guru clichés. Never use: "guaranteed", "you will make", "passive income", "get rich", "earn from home". Reply with ONLY a JSON object: {"text":"..."}`,
      messages: [
        {
          role: 'user',
          content: [
            `PART TO REGENERATE (${body.title ?? kind}): ${KIND_INSTRUCTIONS[kind]}`,
            '',
            strategyLines.length ? `STRATEGY (hard constraints):\n${strategyLines.join('\n')}` : '',
            body.context?.length
              ? `KEPT PARTS OF THIS CONCEPT (do not contradict, do not repeat):\n${body.context.join('\n---\n')}`
              : '',
            body.direction ? `CREATIVE DIRECTION FROM THE USER: ${body.direction}` : '',
            current ? `CURRENT VERSION (produce a genuinely different take, not a paraphrase):\n${current}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    })
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const parsed = parseModelJson<{ text?: string }>(text)
    const out = (parsed.text ?? '').trim()
    if (!out) throw new Error('empty regeneration')
    return NextResponse.json({ ok: true, text: out, demo: false })
  } catch (err) {
    console.error('Canvas regenerate error:', err)
    // Never block the canvas — but never silently swap in copy either. The node
    // keeps what it had and the surface says the regeneration failed, which is
    // recoverable; a node quietly replaced with another business's ad is not.
    return NextResponse.json({
      ok: false,
      text: current,
      demo: false,
      error: 'Regeneration failed — the node is unchanged. Try again.',
    })
  }
}
