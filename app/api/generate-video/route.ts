import { NextRequest, NextResponse } from 'next/server'
import {
  startVideoJob,
  getVideoJob,
  videoConfigured,
  getVideoModel,
  DEFAULT_VIDEO_MODEL,
  type GenMode,
} from '@/lib/video'
import { logGeneration, updateGeneration } from '@/lib/video/persistence'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const maxDuration = 60

// Start a render on any configured model (Seedance, Kling, Veo, Wan, Higgsfield).
// Returns a requestId + modelId the client polls via GET — renders take minutes,
// longer than this function runs. Backward compatible: an imageUrl with no model
// still works (defaults to image-to-video on the default model).
export async function POST(request: NextRequest) {
  try {
    if (!videoConfigured()) {
      return NextResponse.json({
        success: false,
        demo: true,
        error: 'Add FAL_KEY (Seedance/Kling/Veo/Wan) or HF_CREDENTIALS (Higgsfield) to render video',
      })
    }

    const body = (await request.json()) as {
      prompt?: string
      imageUrl?: string
      imageUrls?: string[]
      videoUrls?: string[]
      model?: string
      mode?: GenMode
      aspectRatio?: '1:1' | '9:16' | '16:9'
      durationSec?: number
    }

    // Infer mode: explicit > reference (faces/videos supplied) > image (still) > text.
    const hasRefs = Boolean(body.imageUrls?.length || body.videoUrls?.length)
    const mode: GenMode =
      body.mode ?? (hasRefs ? 'reference-to-video' : body.imageUrl ? 'image-to-video' : 'text-to-video')
    if (mode === 'image-to-video' && !body.imageUrl) {
      return NextResponse.json(
        { success: false, error: 'imageUrl is required for image-to-video' },
        { status: 400 },
      )
    }
    if (mode === 'reference-to-video' && !hasRefs) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one reference image or video is required for reference-to-video',
        },
        { status: 400 },
      )
    }
    if (mode === 'text-to-video' && !body.prompt) {
      return NextResponse.json(
        { success: false, error: 'prompt is required for text-to-video' },
        { status: 400 },
      )
    }

    const job = await startVideoJob(body.model, {
      prompt: body.prompt,
      imageUrl: body.imageUrl,
      imageUrls: body.imageUrls,
      videoUrls: body.videoUrls,
      mode,
      aspectRatio: body.aspectRatio,
      durationSec: body.durationSec,
    })
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Video render failed to start' },
        { status: 500 },
      )
    }

    await logGeneration({
      builder_id: await currentAccount(),
      model_id: job.modelId,
      provider: job.provider,
      mode,
      prompt: body.prompt ?? null,
      image_url: body.imageUrl ?? null,
      request_id: job.requestId,
      status: job.status,
    })

    return NextResponse.json({ success: true, ...job })
  } catch (error) {
    console.error('Video start error:', error)
    return NextResponse.json({ success: false, error: 'Failed to start video' }, { status: 500 })
  }
}

// Poll a render's status: /api/generate-video?requestId=...&model=seedance-2.0
export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get('requestId')
  const model = request.nextUrl.searchParams.get('model') ?? DEFAULT_VIDEO_MODEL
  const responseUrl = request.nextUrl.searchParams.get('responseUrl')
  if (!requestId) {
    return NextResponse.json({ success: false, error: 'requestId is required' }, { status: 400 })
  }
  if (!getVideoModel(model)) {
    return NextResponse.json({ success: false, error: `Unknown model: ${model}` }, { status: 400 })
  }

  const job = await getVideoJob(model, requestId, responseUrl)
  if (job.status === 'completed' || job.status === 'failed') {
    await updateGeneration(requestId, job)
  }
  return NextResponse.json({ success: true, ...job })
}
