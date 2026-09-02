import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { searchKnowledge, type KnowledgeSystem } from '@/lib/knowledge'
import { parseModelJson } from '@/lib/parse'
import { ORCHESTRATOR_FALLBACK_MODEL } from '@/lib/models'
import type { StrategicIntelligence } from '@/lib/reactor-inputs'
import { getTenant, tenantDescriptor } from '@/lib/tenant'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'

// OPUS synthesizes the strategic read. Runs on the Opus tier (not Fable 5) —
// a single-shot synthesis where responsiveness beats marginal reasoning depth;
// the full Fable 5 tool-use loop lives in the reactor route.
const MODEL = ORCHESTRATOR_FALLBACK_MODEL

interface IntelRequest {
  brief?: string
  angle?: string
  awareness?: string
  audience?: string
  offer?: string
  builderId?: string | null
}

// One scoped retrieval per intelligence layer. Returns the top hits (works in
// demo mode via the curated corpus, and live via pgvector).
async function gather(query: string, system: KnowledgeSystem, builderId: string | null) {
  try {
    return await searchKnowledge(query, { system, k: 3, builderId })
  } catch {
    return []
  }
}

const firstLine = (s: string, max = 160) =>
  s.replace(/\s+/g, ' ').trim().slice(0, max) || ''

export async function POST(request: NextRequest) {
  const {
    brief = '',
    angle = 'Agent decides',
    awareness = 'Problem-Aware',
    offer = 'Strategy Call / Application',
    builderId = null,
  } = (await request.json()) as IntelRequest

  const angleIsSentinel = angle === 'Agent decides' || angle === 'No Preference'
  const seed = `${angleIsSentinel ? '' : angle} ${brief}`.trim() || 'builder profit time freedom systems'

  // NOVA (research + transformation), SPARK (creative), ECHO (copy), ORACLE
  // (pattern), ATLAS (vault) — retrieved in parallel so the panel stays fast.
  const [research, transformation, creative, copy, pattern, vault] = await Promise.all([
    gather(`${seed} pain struggle problem cost`, 'research', builderId),
    gather(`${seed} desire goal outcome freedom`, 'transformation', builderId),
    gather(`${seed} winning creative structure opening`, 'creative', builderId),
    gather(`${seed} hook headline offer message`, 'copy', builderId),
    gather(seed, 'pattern', builderId),
    gather(seed, 'vault', builderId),
  ])

  const systemsWithHits = [research, transformation, creative, copy, pattern].filter(
    (h) => h.length > 0,
  ).length
  const confidenceScore = Math.min(94, 52 + systemsWithHits * 8 + (vault.length ? 4 : 0))
  const confidence: StrategicIntelligence['confidence'] =
    confidenceScore >= 80 ? 'High' : confidenceScore >= 64 ? 'Medium' : 'Exploratory'

  // Deterministic read straight from retrieval — always populated, no model call.
  const deterministic: StrategicIntelligence = {
    awareness,
    primaryPain: research[0] ? firstLine(research[0].content) : 'Margin erosion and owner dependency despite strong revenue.',
    primaryDesire: transformation[0]
      ? firstLine(transformation[0].content)
      : 'A systemized business that runs without the owner on the tools.',
    primaryPattern: pattern[0]?.category || pattern[0]?.title || 'Time Freedom',
    recommendedCreativeStructure: creative[0]
      ? firstLine(creative[0].content)
      : 'Founder direct-to-camera: pattern interrupt → contrarian belief → named member proof → soft CTA.',
    recommendedCopyStructure: copy[0]
      ? firstLine(copy[0].content)
      : 'Contrarian hook → agitate the real cost → mechanism → named proof → clear next step.',
    recommendedOfferPositioning: `${offer} — qualify hard, pre-frame as selective, carry named proof.`,
    knowledgeAssetsConsulted: vault.map((h) => h.title).slice(0, 4),
    researchSourcesConsulted: [...research, ...transformation].map((h) => h.title).slice(0, 4),
    confidence,
    confidenceScore,
  }

  // No key or thin brief → the deterministic read is the answer.
  if (!process.env.ANTHROPIC_API_KEY || brief.trim().length < 12) {
    return NextResponse.json({ intelligence: deterministic, demo: !process.env.ANTHROPIC_API_KEY })
  }

  // With a key + a real brief, let OPUS sharpen the prose fields against the
  // retrieved evidence. Consulted lists + confidence stay deterministic.
  try {
    const digest = [
      ['Market (pains)', research],
      ['Market (desires)', transformation],
      ['Creative', creative],
      ['Copy', copy],
      ['Patterns', pattern],
    ]
      .map(([label, hits]) => {
        const h = hits as { title: string; content: string }[]
        return `${label}: ${h.length ? h.map((x) => `${x.title} — ${firstLine(x.content, 120)}`).join(' | ') : 'no stored evidence'}`
      })
      .join('\n')

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system:
        `You are OPUS, Master Strategist for ${tenantDescriptor(await getTenant(await currentAccount()))}. From the brief and retrieved evidence, present the strategic read a senior strategist would give. Be specific and native to this business and its audience. Reply with ONLY a JSON object, no prose.`,
      messages: [
        {
          role: 'user',
          content: `Campaign brief:\n"""${brief.trim()}"""\nAngle: ${angle}\nAwareness: ${awareness}\nOffer: ${offer}\n\nRetrieved evidence:\n${digest}\n\nReturn JSON with these exact keys, each a single tight sentence/phrase:\n{"primaryPain":"...","primaryDesire":"...","primaryPattern":"...","recommendedCreativeStructure":"...","recommendedCopyStructure":"...","recommendedOfferPositioning":"..."}`,
        },
      ],
    })
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const synth = parseModelJson<Partial<StrategicIntelligence>>(text)

    return NextResponse.json({
      intelligence: {
        ...deterministic,
        primaryPain: synth.primaryPain || deterministic.primaryPain,
        primaryDesire: synth.primaryDesire || deterministic.primaryDesire,
        primaryPattern: synth.primaryPattern || deterministic.primaryPattern,
        recommendedCreativeStructure:
          synth.recommendedCreativeStructure || deterministic.recommendedCreativeStructure,
        recommendedCopyStructure:
          synth.recommendedCopyStructure || deterministic.recommendedCopyStructure,
        recommendedOfferPositioning:
          synth.recommendedOfferPositioning || deterministic.recommendedOfferPositioning,
      } satisfies StrategicIntelligence,
    })
  } catch (err) {
    console.error('Strategic Intelligence synthesis error:', err)
    return NextResponse.json({ intelligence: deterministic })
  }
}
