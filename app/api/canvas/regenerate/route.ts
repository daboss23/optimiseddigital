import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import { parseModelJson } from '@/lib/parse'
import { getTenant, tenantDescriptor } from '@/lib/tenant'

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
 * Degrades gracefully: with no ANTHROPIC_API_KEY it serves a curated TPB
 * alternate so the canvas always works end to end.
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
  visual:
    'Write a frame-by-frame visual direction for one ad creative (3–5 numbered beats, one line each). Premium, photographic, on-site builder context.',
  scene:
    'Rewrite ONE scene of a multi-scene montage ad: a single vivid beat — what the camera sees plus a one-line on-screen caption or VO. Two sentences maximum.',
  cta: 'Write ONE Meta ad headline (max 40 characters) that converts the argument into the ask. Direct, specific, zero hype.',
}

// Curated TPB alternates — the zero-key path stays useful, never lorem ipsum.
const DEMO_POOL: Record<string, string[]> = {
  hook: [
    'You didn’t buy a business. You bought a job with overtime.',
    '$2.4M turnover. $61K take-home. The maths nobody posts about.',
    'The best builder on site shouldn’t still be on the tools at 51.',
    'Your foreman runs the site. Who runs the business?',
  ],
  message: [
    'The problem was never effort. You out-work everyone you know.\n\nThe problem is the machine: no margin discipline, no second layer of leadership, every decision routed through you.\n\nJason ran the same playbook — 14 months later he’s off the tools, margin up 9 points, and the business runs without his ute in the car park.',
    'Revenue hides the truth. Margin tells it.\n\nWe rebuilt the quoting system, put a real number on every job, and installed a weekly rhythm the team runs without the owner.\n\nSame trucks, same clients — different business inside 12 months.',
  ],
  visual: [
    '1: Pre-dawn — work ute idling, house lights still off.\n2: Site at full speed, owner absent — team running the board.\n3: Close-up — margin dashboard ticking past 24%.\n4: Owner at the school gate, 3:10pm, phone silent.',
    '1: Split screen — invoice stack vs. one clean profit line.\n2: Whiteboard session — the org chart with a second layer of leadership.\n3: Handshake on site — foreman owning the walkthrough.\n4: Wide shot — owner walking off site mid-afternoon.',
  ],
  scene: [
    '5:47am — headlights sweep an empty site; the owner’s ute is first in again. Caption: "Still first in. Still last out."',
    'The foreman runs the morning brief solo; the owner watches from the fence line, coffee in hand. Caption: "The site runs. Finally."',
    'Close on a margin report — 14% crossed out, 24% circled in red pen. Caption: "Same jobs. Different business."',
  ],
  cta: ['Get Off The Tools', 'Fix The Margin First', 'Run It Without You', 'Book A Strategy Call'],
  proof: [
    'Jason — $2.4M residential builder: off the tools in 14 months, margin up 9 points, first full week away from site in six years. His result, documented in the member vault.',
    'Mark went from 70-hour weeks at 11% margin to 45 hours at 24% inside a year of installing the leadership layer. Results are individual and not typical.',
    'Over 500 builders have run this exact margin-first playbook — the vault holds their documented before/after numbers, job by job.',
  ],
}

function demoAlternate(kind: string, current: string): string {
  const pool = DEMO_POOL[kind] ?? DEMO_POOL.hook
  const options = pool.filter((p) => p.trim() !== current.trim())
  return options[Math.floor(Math.random() * options.length)] ?? pool[0]
}

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
    return NextResponse.json({ ok: true, text: demoAlternate(kind, current), demo: true })
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
        `You are the copy chief for ${tenantDescriptor(await getTenant())}. You regenerate exactly ONE part of an ad concept while every other part stays fixed — the rewrite must remain coherent with the strategy constraints and the kept parts. Voice: confident, specific, native to this business and its audience, operator to operator; concrete numbers and named proof over adjectives; no hype, no guru clichés. Never use: "guaranteed", "you will make", "passive income", "get rich", "earn from home". Reply with ONLY a JSON object: {"text":"..."}`,
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
    // Never block the canvas — fall back to a curated alternate.
    return NextResponse.json({ ok: true, text: demoAlternate(kind, current), demo: true })
  }
}
