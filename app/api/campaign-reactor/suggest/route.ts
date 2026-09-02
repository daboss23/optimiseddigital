import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import {
  awarenessOptions,
  sophisticationOptions,
  audienceOptions,
  offerOptions,
  type IntelSourceRecommendation,
  type ReactorSuggestion,
} from '@/lib/reactor-inputs'
import { reactorOutputTypes } from '@/lib/reactor-data'
import { ORCHESTRATOR_FALLBACK_MODEL } from '@/lib/models'
import { INTEL_SOURCES, recommendIntelSources } from '@/lib/intelligence-sources'
import { angleEvidence } from '@/lib/outcomes'
import { vaultStats } from '@/lib/knowledge'
import { parseModelJson } from '@/lib/parse'
import { getTenant, tenantDescriptor } from '@/lib/tenant'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'

// The Dynamic Strategy Engine — the coordinator's strategic call made up front.
// Runs on the Opus tier (not Fable 5): this is a single-shot ~500-token pick
// fired while the user types, where Fable's always-on thinking would add
// latency for no strategic gain. The angle is NOT constrained to the base
// categories: NOVA/ORACLE/OPUS can surface a sharper angle the dropdown adopts.
const MODEL = ORCHESTRATOR_FALLBACK_MODEL

// Base strategic categories — a starting vocabulary, not a hard limit.
const angleCategories = ['Profit', 'Systems', 'Time Freedom', 'Leadership', 'Cashflow', 'Growth', 'Team Accountability']
const awarenessLabels = awarenessOptions.slice(1).map((o) => o.label)
const sophisticationLabels = sophisticationOptions.slice(1).map((o) => o.label)
const audienceLabels = audienceOptions.slice(1).map((o) => o.label)
const offerLabels = offerOptions.slice(1).map((o) => o.label)
const deliverableLabels = [...reactorOutputTypes]

interface RawSuggestion {
  angle: string
  angleConfidence: number
  angleReason: string
  awareness: string
  sophistication: string
  audience: string
  offer: string
  deliverables: string[]
  deliverablesReason: string
}

// Heuristic stand-in so the field is always pre-filled — even with no API key or
// a thin brief — keeping the flow unified and never blocking the user.
function fallback(brief: string, angle: string): RawSuggestion {
  const t = brief.toLowerCase()
  const pickAngle =
    angle && !['No Preference', 'Agent decides', ''].includes(angle)
      ? angle
      : /time|freedom|hours|family|weekend/.test(t)
        ? 'Time Freedom'
        : /system|process|sop|chaos|operations?/.test(t)
          ? 'Systems'
          : /scale|grow|growth|lead|pipeline/.test(t)
            ? 'Growth'
            : /profit|margin|keeping nothing|revenue/.test(t)
              ? 'Profit'
              : 'Profit'
  const awareness = /know us|seen|retarget|applied|considered/.test(t)
    ? 'Product-Aware'
    : /compare|coaching|hiring|options?|vs\b/.test(t)
      ? 'Solution-Aware'
      : 'Problem-Aware'
  // Trades-coaching is a heavily pitched market: default to late-stage
  // sophistication, escalating to identity when the brief signals it.
  const sophistication = /identity|tribe|community|belong|who they become|not another hustle/.test(t)
    ? 'Stage 5 — Identity & Tribe'
    : /mechanism|method|system|framework|process|blueprint|roadmap/.test(t)
      ? 'Stage 4 — Better Mechanism'
      : /new to market|first of its kind|never been done|no one else offers/.test(t)
        ? 'Stage 1 — First Claim'
        : 'Stage 4 — Better Mechanism'
  const audience = /retarget|applied|application|sales page|visited/.test(t)
    ? 'Retargeting — visited sales page'
    : /warm|seen|content|follower/.test(t)
      ? 'Warm — saw content, didn’t convert'
      : 'Cold — new audience'
  const offer = /webinar|masterclass|training/.test(t)
    ? 'Webinar / Masterclass'
    : /event|in person|in-person|live/.test(t)
      ? 'Live Event / In-Person'
      : /download|guide|lead magnet|free|pdf/.test(t)
        ? 'Free Lead Magnet'
        : 'Strategy Call / Application'

  // Deliverables follow the medium implied by the brief.
  const wantsUgc = /ugc|testimonial|talking head|spokesperson|creator|selfie/.test(t)
  const wantsVideo = /video|vsl|reel|tiktok|founder video|motion/.test(t)
  const wantsCarousel = /carousel|swipe|multi-?image|slides?/.test(t)
  const wantsImage = /image|static|photo|proof ad|banner/.test(t)
  const set = new Set<string>()
  if (wantsUgc) set.add('UGC Creative')
  if (wantsVideo) set.add('Video Creative')
  if (wantsCarousel) set.add('Carousel Creatives')
  if (wantsImage) set.add('Static Creative')
  // Sensible default when the brief doesn't signal a medium.
  const deliverables = set.size ? Array.from(set) : ['Static Creative', 'Video Creative']

  return {
    angle: pickAngle,
    angleConfidence: 62,
    angleReason: `Best-fit base angle inferred from the brief${pickAngle ? ` — leads with ${pickAngle}.` : '.'}`,
    awareness,
    sophistication,
    audience,
    offer,
    deliverables,
    deliverablesReason: set.size
      ? `Brief signals ${deliverables.join(' + ')} — leading with those.`
      : 'Balanced starter set across static and video creative.',
  }
}

function validate(s: Partial<RawSuggestion>, fb: RawSuggestion): RawSuggestion {
  const angle = typeof s.angle === 'string' && s.angle.trim() ? s.angle.trim() : fb.angle
  const conf = Number(s.angleConfidence)
  const deliverables = Array.isArray(s.deliverables)
    ? s.deliverables.filter((d) => deliverableLabels.includes(d))
    : []
  return {
    angle,
    // Angle is intentionally NOT constrained to the base categories.
    angleConfidence: Number.isFinite(conf) ? Math.max(40, Math.min(99, Math.round(conf))) : fb.angleConfidence,
    angleReason: typeof s.angleReason === 'string' && s.angleReason.trim() ? s.angleReason.trim() : fb.angleReason,
    awareness: awarenessLabels.includes(s.awareness ?? '') ? (s.awareness as string) : fb.awareness,
    sophistication: sophisticationLabels.includes(s.sophistication ?? '')
      ? (s.sophistication as string)
      : fb.sophistication,
    audience: audienceLabels.includes(s.audience ?? '') ? (s.audience as string) : fb.audience,
    offer: offerLabels.includes(s.offer ?? '') ? (s.offer as string) : fb.offer,
    deliverables: deliverables.length ? deliverables : fb.deliverables,
    deliverablesReason:
      typeof s.deliverablesReason === 'string' && s.deliverablesReason.trim()
        ? s.deliverablesReason.trim()
        : fb.deliverablesReason,
  }
}

// Map each intelligence source to a factual count from the live (or curated)
// knowledge stats, so the "Selected by AGENT" reason is real, not invented.
function buildIntelSources(
  brief: string,
  deliverables: string[],
  stats: Awaited<ReturnType<typeof vaultStats>>,
  evidence: Awaited<ReturnType<typeof angleEvidence>>,
): IntelSourceRecommendation[] {
  const sum = (re: RegExp) =>
    stats.groups
      .filter((g) => re.test(`${g.system} ${g.category ?? ''}`.toLowerCase()))
      .reduce((n, g) => n + g.count, 0)

  const counts: Record<string, number> = {
    vault: stats.total,
    market: sum(/research|market|signal|insight/),
    creativeDna: sum(/creative|winning|\bad\b|ads|video|static|event footage/),
    copyDna: sum(/copy|hook|headline|primary text|vsl|webinar script/),
    frameworks: sum(/framework/),
    sops: sum(/\bsop\b|sops/),
    strategicMemory: evidence?.winners ?? 0,
  }

  const reasonFor = (id: string): string => {
    const n = counts[id] ?? 0
    switch (id) {
      case 'vault':
        return `${n} relevant assets found`
      case 'market':
        return n ? `${n} research signals available` : 'Market intelligence ready'
      case 'creativeDna':
        return n ? `${n} matching creative patterns found` : 'Creative DNA ready'
      case 'copyDna':
        return n ? `${n} copy assets found` : 'Copy DNA ready'
      case 'frameworks':
        return n ? `${n} frameworks available` : 'Framework Vault ready'
      case 'sops':
        return n ? `${n} SOPs available` : 'SOP Vault ready'
      case 'strategicMemory':
        return evidence?.winners
          ? `${evidence.winners} historical winners matched`
          : 'Strategic memory ready'
      default:
        return 'Available'
    }
  }

  const recSet = new Set<string>(recommendIntelSources(brief, deliverables))
  // ORACLE memory recommends itself whenever it has matching winners.
  if (evidence?.winners) recSet.add('strategicMemory')

  return INTEL_SOURCES.map((s) => ({
    id: s.id,
    recommended: recSet.has(s.id),
    reason: reasonFor(s.id),
  }))
}

async function withEvidence(brief: string, raw: RawSuggestion, demo: boolean): Promise<NextResponse> {
  // ORACLE strategic memory + live knowledge stats — cite real history/assets.
  const [evidence, stats] = await Promise.all([
    angleEvidence(raw.angle).catch(() => null),
    vaultStats().catch(() => ({ live: false, total: 0, groups: [] as { system: string; category: string | null; count: number }[] })),
  ])
  const suggestion: ReactorSuggestion = {
    ...raw,
    evidence,
    intelligenceSources: buildIntelSources(brief, raw.deliverables, stats, evidence),
  }
  return NextResponse.json({ suggestion, demo })
}

export async function POST(request: NextRequest) {
  const { brief = '', angle = 'No Preference' } = (await request.json()) as {
    brief?: string
    angle?: string
  }
  const fb = fallback(brief, angle)

  // No key or nothing to reason over → heuristic pick (still concrete), enriched
  // with whatever ORACLE memory exists.
  if (!process.env.ANTHROPIC_API_KEY || brief.trim().length < 12) {
    return withEvidence(brief, fb, !process.env.ANTHROPIC_API_KEY)
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system:
        `You are OPUS, the Campaign Reactor strategist for ${tenantDescriptor(await getTenant(await currentAccount()))}. Given a brief, name the single strongest campaign ANGLE — a precise, evocative strategic angle that may be sharper than the base categories (examples of the shape, not the subject: "Profit Leak", "Owner Dependency"). Then choose the best-fit awareness stage, market-sophistication stage (Eugene Schwartz — what KIND of claim still lands in this market), audience and offer from the provided lists, and the creative deliverables to produce. Reply with ONLY a JSON object, no prose.`,
      messages: [
        {
          role: 'user',
          content: `Campaign brief:\n"""${brief.trim()}"""\n\nAngle hint: ${angle}\n\nBase angle categories (you may go sharper than these): ${angleCategories.join(' | ')}\nAWARENESS (pick one exact label): ${awarenessLabels.join(' | ')}\nSOPHISTICATION (pick one exact label): ${sophisticationLabels.join(' | ')}\nAUDIENCE (pick one exact label): ${audienceLabels.join(' | ')}\nOFFER (pick one exact label): ${offerLabels.join(' | ')}\nDELIVERABLES (pick the subset that fits the brief's medium): ${deliverableLabels.join(' | ')}\n\nReturn JSON:\n{"angle":"<precise angle name>","angleConfidence":<0-100>,"angleReason":"<one sentence why this angle fits>","awareness":"...","sophistication":"...","audience":"...","offer":"...","deliverables":["...","..."],"deliverablesReason":"<one sentence why these deliverables>"}`,
        },
      ],
    })
    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const parsed = parseModelJson<Partial<RawSuggestion>>(text)
    return withEvidence(brief, validate(parsed, fb), false)
  } catch (err) {
    console.error('Campaign Reactor suggest error:', err)
    return withEvidence(brief, fb, false)
  }
}
