import { NextRequest, NextResponse } from 'next/server'
import { facesConfigured, listFaces, uploadFace, type FaceKind } from '@/lib/faces'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const maxDuration = 60

// List the saved face roster. Degrades gracefully: when Supabase isn't
// configured (or a read fails) it returns an empty roster so the UI still works.
export async function GET() {
  if (!facesConfigured()) {
    return NextResponse.json({ success: true, configured: false, faces: [] })
  }
  try {
    const faces = await listFaces(await currentAccount())
    return NextResponse.json({ success: true, configured: true, faces })
  } catch (err) {
    console.error('Faces list error:', err)
    return NextResponse.json({ success: true, configured: true, faces: [] })
  }
}

const MAX_BYTES = 25 * 1024 * 1024 // 25MB

// Upload a reference asset (multipart: file, optional name) → Storage + roster.
export async function POST(request: NextRequest) {
  if (!facesConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Connect Supabase (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) to save a face roster',
      },
      { status: 400 },
    )
  }
  const account = await currentAccount()
  if (!account) {
    return NextResponse.json(
      { success: false, error: 'Sign in to the brand account this roster belongs to.' },
      { status: 401 },
    )
  }
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'File too large (max 25MB)' },
        { status: 400 },
      )
    }

    const contentType = file.type || 'application/octet-stream'
    const kind: FaceKind = contentType.startsWith('video/') ? 'video' : 'image'
    const ext = (file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'png')).toLowerCase()
    const rawName = (form.get('name') as string | null)?.trim()
    const name = rawName || file.name.replace(/\.[^.]+$/, '') || 'Untitled'
    // The account comes from the session. The form used to carry it, which is
    // the client naming its own tenant.
    const bytes = Buffer.from(await file.arrayBuffer())
    const face = await uploadFace({ name, kind, bytes, contentType, ext, builderId: account })
    return NextResponse.json({ success: true, face })
  } catch (err) {
    console.error('Face upload error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 },
    )
  }
}
