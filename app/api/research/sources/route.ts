/**
 * The places NOVA should mine for this business.
 *
 * There is no built-in list. The old one named trades subreddits and
 * contractor forums on every deployment, which is either exactly right or
 * completely wrong depending on whose platform it is — and the user had no way
 * to change it. Sources now come from two honest places:
 *
 *   - derived: ATLAS's read of the connected website's market
 *   - manual:  sources the user added themselves
 *
 * Empty until one of those has happened. An empty list is the correct answer
 * before a website is connected, not a reason to invent one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getConnectedWebsite } from '@/lib/website-intelligence'
import { getSetting, setSetting, settingsConfigured } from '@/lib/settings'
import { SETTING_RESEARCH_SOURCES } from '@/lib/settings'
import type { DerivedResearchSource } from '@/lib/strategy-derive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ResearchSource extends DerivedResearchSource {
  /** Where it came from — the UI labels manual entries so they can be removed. */
  origin: 'derived' | 'manual'
}

interface StoredSources {
  sources: DerivedResearchSource[]
}

function key(s: { kind: string; label: string }): string {
  return `${s.kind}:${s.label.toLowerCase()}`
}

async function readManual(): Promise<DerivedResearchSource[]> {
  const stored = await getSetting<StoredSources>(SETTING_RESEARCH_SOURCES)
  return Array.isArray(stored?.sources) ? stored.sources : []
}

export async function GET() {
  const manual = await readManual()
  let derived: DerivedResearchSource[] = []
  try {
    derived = (await getConnectedWebsite())?.strategyOptions?.researchSources ?? []
  } catch (error) {
    console.error('Derived research sources unavailable:', error)
  }

  // Manual first: the user chose those deliberately, so they outrank a derived
  // guess, and a manual entry replaces a derived one with the same name.
  const seen = new Set<string>()
  const sources: ResearchSource[] = []
  for (const s of manual) {
    if (seen.has(key(s))) continue
    seen.add(key(s))
    sources.push({ ...s, origin: 'manual' })
  }
  for (const s of derived) {
    if (seen.has(key(s))) continue
    seen.add(key(s))
    sources.push({ ...s, origin: 'derived' })
  }

  return NextResponse.json({
    success: true,
    data: { sources, canEdit: settingsConfigured() },
  })
}

/** Add one source by hand. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const kind =
      body?.kind === 'reddit' || body?.kind === 'forum' || body?.kind === 'web' ? body.kind : null
    const label = typeof body?.label === 'string' ? body.label.trim().replace(/^r\//i, '') : ''
    if (!kind || !label) {
      return NextResponse.json(
        { success: false, error: 'kind and label are required' },
        { status: 400 },
      )
    }

    let url: string | undefined
    if (kind !== 'reddit') {
      const candidate = typeof body.url === 'string' ? body.url.trim() : ''
      if (!/^https?:\/\//i.test(candidate)) {
        return NextResponse.json(
          { success: false, error: 'A forum or web source needs a full https:// URL' },
          { status: 400 },
        )
      }
      url = candidate
    }

    const entry: DerivedResearchSource = {
      kind,
      label,
      url,
      note: typeof body.note === 'string' ? body.note.trim().slice(0, 120) : '',
    }

    const manual = await readManual()
    const next = [entry, ...manual.filter((s) => key(s) !== key(entry))]
    const stored = await setSetting(SETTING_RESEARCH_SOURCES, { sources: next })
    if (!stored) {
      return NextResponse.json(
        { success: false, error: 'Supabase is not configured, so this source cannot be saved.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ success: true, data: entry })
  } catch (error) {
    console.error('Add research source failed:', error)
    return NextResponse.json({ success: false, error: 'Could not add that source' }, { status: 500 })
  }
}

/** Remove a manually added source. Derived ones come back on the next scan. */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') ?? ''
    const label = searchParams.get('label') ?? ''
    if (!kind || !label) {
      return NextResponse.json(
        { success: false, error: 'kind and label are required' },
        { status: 400 },
      )
    }
    const manual = await readManual()
    const next = manual.filter((s) => key(s) !== key({ kind, label }))
    await setSetting(SETTING_RESEARCH_SOURCES, { sources: next })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Remove research source failed:', error)
    return NextResponse.json({ success: false, error: 'Could not remove it' }, { status: 500 })
  }
}
