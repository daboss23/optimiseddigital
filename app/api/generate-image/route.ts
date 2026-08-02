import { NextRequest, NextResponse } from 'next/server'
import {
  generateImageDetailed,
  imageConfigured,
  isAsyncImageModel,
  startImageJob,
  pollImageJob,
  type AspectRatio,
} from '@/lib/image'

export const runtime = 'nodejs'
export const maxDuration = 60

// Multi-model still creative (FLUX / fal, Higgsfield Soul).
// Returns null imageUrl on failure (never throws) so the copy stays usable;
// signals demo mode when no image provider key is set. Backward compatible:
// a request with just a prompt renders on the default/best-available model.
export async function POST(request: NextRequest) {
  try {
    if (!imageConfigured()) {
      return NextResponse.json({
        success: false,
        demo: true,
        imageUrl: null,
        error: 'Add FAL_KEY or HF_CREDENTIALS to generate creatives',
      })
    }

    const { prompt, aspectRatio, model } = (await request.json()) as {
      prompt?: string
      aspectRatio?: AspectRatio
      model?: string
    }
    if (!prompt) {
      return NextResponse.json({ success: false, error: 'prompt is required' }, { status: 400 })
    }

    // Kie models render async: start the task and hand the client a taskId to
    // poll. The render then never has to finish inside this one function, so a
    // slow model can't be killed at the host ceiling with the image (and the
    // charged credit) lost. fal/Higgsfield stay on the synchronous path below.
    if (isAsyncImageModel(model)) {
      const job = await startImageJob(model, prompt, aspectRatio ?? '1:1')
      if (job.taskId) {
        return NextResponse.json({
          success: true,
          pending: true,
          taskId: job.taskId,
          model: job.modelId,
          provider: job.provider,
        })
      }
      // Start failed (e.g. Kie rejected) — fall through to the synchronous
      // oven, which will try any other configured provider before giving up.
    }

    const { image, error } = await generateImageDetailed(model, prompt, aspectRatio ?? '1:1')
    if (!image) {
      return NextResponse.json({
        success: false,
        imageUrl: null,
        model: null,
        error: `Image render failed${model ? ` for "${model}"` : ''}. ${
          error ?? 'The provider rejected the request.'
        } (Keys: FLUX → FAL_KEY, Higgsfield → HF_CREDENTIALS as "KEY_ID:KEY_SECRET".)`,
      })
    }
    return NextResponse.json({
      success: true,
      imageUrl: image.imageUrl,
      model: image.modelId,
      provider: image.provider,
    })
  } catch (error) {
    console.error('Image generation error:', error)
    return NextResponse.json(
      { success: false, imageUrl: null, error: 'Failed to generate image' },
      { status: 500 },
    )
  }
}

// Poll an async (Kie) render started by POST: /api/generate-image?taskId=...
// Each call is one fast recordInfo lookup, so the render is retrieved across
// many short requests instead of one long-lived function.
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId')
  if (!taskId) {
    return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 })
  }
  const res = await pollImageJob(taskId)
  if (res.status === 'completed' && res.url) {
    return NextResponse.json({ success: true, status: 'completed', imageUrl: res.url })
  }
  if (res.status === 'failed') {
    return NextResponse.json({ success: false, status: 'failed', error: res.error ?? 'Render failed' })
  }
  return NextResponse.json({ success: true, status: 'pending' })
}
