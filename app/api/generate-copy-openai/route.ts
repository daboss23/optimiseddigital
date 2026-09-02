import { NextRequest, NextResponse } from 'next/server'
import { getOpenAI } from '@/lib/openai'
import { resolveBrandMemory } from '@/lib/brand-memory'
import { getSkills } from '@/lib/skills'
import { parseModelJson } from '@/lib/parse'
import { buildFrameworksContext } from '@/lib/frameworks'
import type { CopyOutput } from '@/types'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'

// Comparison copy generator. Kept structurally identical to the Claude route
// so the two outputs can be evaluated side by side from the same brief.
const OPENAI_COPY_MODEL = 'gpt-5.5-2026-04-23'

export async function POST(request: NextRequest) {
  try {
    const openai = getOpenAI()

    const { brief } = await request.json()
    // The tenant comes from the signed session, never from the body — a
    // client-declared tenant is a suggestion, not an identity.
    const accountId = await currentAccount()

    // Same resolution order as the Claude route — the two are compared against
    // each other, so they must be written for the same brand.
    const { memory: brandMemory, brandName } = await resolveBrandMemory(accountId)

    const skills = getSkills(['meta-frameworks', 'hooks-library'])
    const dbFrameworks = await buildFrameworksContext(accountId)
    const frameworksSection = [skills, dbFrameworks].filter(Boolean).join('\n\n---\n\n')

    const systemPrompt = `${brandMemory}

---

## YOUR CREATIVE SKILLS & FRAMEWORKS
${frameworksSection}

---

You are the AI Creative System for ${brandName}.
Respond ONLY with valid JSON. No preamble, no markdown fences. Pure JSON.

Output this exact structure:
{
  "hooks": ["hook1", "hook2", "hook3", "hook4", "hook5"],
  "bodyVariants": ["body1", "body2", "body3"],
  "ctas": ["cta1", "cta2", "cta3"],
  "finalHook": "strongest hook",
  "finalBody": "strongest body",
  "finalCta": "strongest CTA",
  "imagePrompt": "image-generation prompt matching the campaign angle and ${brandName} visual style"
}`

    const completion = await openai.chat.completions.create({
      model: OPENAI_COPY_MODEL,
      max_completion_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate Meta ad copy for ${brandName}.
Campaign Angle: ${brief.angle}
Campaign Goal: ${brief.goal}

Make every line specific to ${brandName} - never generic.`,
        },
      ],
    })

    const responseText = completion.choices[0]?.message?.content || ''
    const copyData = parseModelJson<CopyOutput>(responseText)

    return NextResponse.json({ success: true, data: copyData, model: 'openai' })
  } catch (error) {
    console.error('OpenAI copy generation error:', error)
    return NextResponse.json(
      { success: false, error: 'OpenAI copy generation failed' },
      { status: 500 }
    )
  }
}
