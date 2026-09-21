import { redirect } from 'next/navigation'

/**
 * The Ad Library moved into Creative Intelligence.
 *
 * Finding an ad that already works and tearing one down are the same job, so
 * the library now sits beside SPARK on `/creative` rather than in a tab of its
 * own. This route stays as a redirect because links to it exist — the Meta
 * Intelligence board deep-links a creative here — and a bookmark that 404s is
 * a worse outcome than one extra hop.
 */
export default async function AdLibraryRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value) && value[0]) query.set(key, value[0])
  }
  const suffix = query.toString()
  redirect(`/creative${suffix ? `?${suffix}` : ''}#ad-library`)
}
