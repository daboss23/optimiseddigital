import { NextRequest, NextResponse } from 'next/server'
import {
  browseKnowledge,
  deleteKnowledge,
  updateKnowledge,
  type KnowledgeSystem,
} from '@/lib/knowledge'

export const runtime = 'nodejs'
export const maxDuration = 30

const VALID_SYSTEMS: KnowledgeSystem[] = [
  'vault',
  'research',
  'transformation',
  'creative',
  'design',
  'copy',
  'pattern',
  'learning',
  'website',
]

// Browse / search the stored knowledge chunks for the Vault library view.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') ?? undefined
    const systemParam = searchParams.get('system')
    const limitParam = searchParams.get('limit')

    const system =
      systemParam && VALID_SYSTEMS.includes(systemParam as KnowledgeSystem)
        ? (systemParam as KnowledgeSystem)
        : undefined
    const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam) || 60)) : 60

    const result = await browseKnowledge({ query, system, limit })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('Vault list error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'List failed' },
      { status: 500 },
    )
  }
}

// Edit a stored chunk in place. Content changes are re-embedded so retrieval
// reflects the correction rather than the superseded text.
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; title?: string; content?: string }
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }
    if (typeof body.content === 'string' && !body.content.trim()) {
      return NextResponse.json(
        { success: false, error: 'Content cannot be empty — delete the chunk instead.' },
        { status: 400 },
      )
    }

    const { reembedded } = await updateKnowledge({
      id: body.id,
      title: body.title,
      content: body.content,
    })
    return NextResponse.json({ success: true, reembedded })
  } catch (err) {
    console.error('Vault update error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Update failed' },
      { status: 500 },
    )
  }
}

// Remove a stored chunk from the knowledge layer.
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    }

    await deleteKnowledge(id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Vault delete error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    )
  }
}
