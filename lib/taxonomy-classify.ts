// Server-only companion to lib/taxonomy.ts — the Claude-backed classifier that
// tags a piece of creative into the fixed taxonomy. Kept separate from the pure
// taxonomy module so the Anthropic SDK never reaches the client bundle (same
// reason lib/spark.ts is a server module). Consumed by the legacy-outcome
// backfill, cloned-reference tagging, and anywhere a free-text creative needs a
// comparable tag.

import Anthropic from '@anthropic-ai/sdk'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import { parseModelJson } from '@/lib/parse'
import {
  ASSET_TYPES,
  HOOK_STYLES,
  PAIN_POINT_SEEDS,
  PERSONA_SEEDS,
  VISUAL_FORMATS,
  coerceTaxonomy,
  heuristicTaxonomy,
  type CreativeTaxonomy,
} from '@/lib/taxonomy'
import { getTenant, tenantDescriptor } from '@/lib/tenant'

export interface ClassifyOptions {
  /** Extra persona labels (from real runs) the classifier may also choose from. */
  personaOptions?: readonly string[]
  /** Extra pain-point labels the classifier may also choose from. */
  painOptions?: readonly string[]
}

/**
 * Classify a piece of creative (ad copy / transcript / Creative DNA) into the
 * fixed taxonomy. Mirrors lib/spark.ts extractCreativeDNA: single-shot
 * INTELLIGENCE_MODEL, strip fences, NEVER throws — falls back to a heuristic read
 * so the platform always works with no key.
 */
export async function classifyTaxonomy(text: string, opts: ClassifyOptions = {}): Promise<CreativeTaxonomy> {
  const trimmed = text.trim()
  const personas = [...PERSONA_SEEDS, ...(opts.personaOptions ?? [])]
  const pains = [...PAIN_POINT_SEEDS, ...(opts.painOptions ?? [])]

  if (!process.env.ANTHROPIC_API_KEY || trimmed.length < 30) {
    return coerceTaxonomy(heuristicTaxonomy(trimmed || 'creative'))
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: INTELLIGENCE_MODEL,
      max_tokens: 300,
      system: `You are the creative taxonomy classifier for ${tenantDescriptor(await getTenant())}. Tag the creative below with ONE value per axis, each chosen ONLY from the allowed lists. If a persona or pain point genuinely isn't listed, you may return a short new label for those two axes only. Reply with ONLY a JSON object, no prose.

Allowed values:
- hookStyle: ${HOOK_STYLES.join(', ')}
- visualFormat: ${VISUAL_FORMATS.join(', ')}
- assetType: ${ASSET_TYPES.join(', ')}
- persona (or a short new one): ${personas.join(', ')}
- painPoint (or a short new one): ${pains.join(', ')}`,
      messages: [
        {
          role: 'user',
          content: `Creative to classify:\n"""${trimmed.slice(0, 4000)}"""\n\nReturn JSON with exactly these keys: {"hookStyle":"...","visualFormat":"...","assetType":"...","persona":"...","painPoint":"..."}`,
        },
      ],
    })
    const out = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const parsed = parseModelJson<CreativeTaxonomy>(out)
    const fb = heuristicTaxonomy(trimmed)
    return coerceTaxonomy({
      hookStyle: parsed.hookStyle || fb.hookStyle,
      visualFormat: parsed.visualFormat || fb.visualFormat,
      assetType: parsed.assetType || fb.assetType,
      persona: parsed.persona || fb.persona,
      painPoint: parsed.painPoint || fb.painPoint,
    })
  } catch (err) {
    console.error('Taxonomy classification failed, using heuristic:', err)
    return coerceTaxonomy(heuristicTaxonomy(trimmed))
  }
}
