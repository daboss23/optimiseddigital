/**
 * Server-side owner check — reads the owner cookie for the current request.
 *
 * Split from lib/owner.ts so that module stays free of `next/headers` and can
 * be exercised by the selftest directly.
 */

import { cookies } from 'next/headers'
import { OWNER_COOKIE, verifyOwnerToken } from '@/lib/owner'

/** Is this request signed in as the platform owner? Never throws. */
export async function isOwnerRequest(): Promise<boolean> {
  try {
    const jar = await cookies()
    return await verifyOwnerToken(jar.get(OWNER_COOKIE)?.value)
  } catch {
    return false
  }
}
