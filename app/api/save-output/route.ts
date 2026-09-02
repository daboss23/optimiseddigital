import { NextRequest, NextResponse } from 'next/server'
import { saveCreativeOutput } from '@/lib/supabase'
import { requireAccount } from '@/lib/account'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const saved = await saveCreativeOutput({
      builder_id: await requireAccount(),
      campaign_angle: body.campaignAngle,
      campaign_goal: body.campaignGoal,
      hooks: body.copy.hooks,
      body_copy: body.copy.bodyVariants,
      ctas: body.copy.ctas,
      final_hook: body.copy.finalHook,
      final_body: body.copy.finalBody,
      final_cta: body.copy.finalCta,
      image_prompt: body.imagePrompt ?? body.copy.imagePrompt ?? '',
      image_url_higgsfield: body.imageUrlHiggsfield ?? null,
      image_url_openai: body.imageUrlOpenai ?? null,
      copy_model: body.copyModel ?? 'claude',
    })

    return NextResponse.json({ success: true, data: saved })
  } catch (error) {
    console.error('Save error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to save output' },
      { status: 500 }
    )
  }
}
