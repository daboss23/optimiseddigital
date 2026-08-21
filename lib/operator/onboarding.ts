/**
 * The hand-off between Mike's first meeting and the first thing to actually do.
 *
 * The welcome introduces him on the dashboard; the next step is Brand
 * Intelligence, because nothing the reactor writes is grounded until a website
 * has been read. Dismissing the welcome therefore ARMS this flag and routes to
 * /brand, where Mike appears once more to say what the screen is for.
 *
 * It lives in its own storage key rather than in `OperatorMemory` on purpose.
 * That payload is schema-versioned and a mismatch DISCARDS it — losing the
 * decision log to add a one-shot onboarding flag would be a bad trade, and the
 * brand page does not mount the operator provider at all, so it could not read
 * that memory without pulling the whole dashboard runtime onto the page.
 *
 * Per browser, like the welcome itself: a new tester on a new machine gets the
 * full first run, and nobody who has already been through it sees it again.
 */

const STORAGE_KEY = 'reactor.operator.brand-onboarding.v1'

const isBrowser = () => typeof window !== 'undefined'

/** Arm the Brand Intelligence greeting. Called when the welcome is dismissed. */
export function armBrandOnboarding(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, 'pending')
  } catch {
    // Private mode / storage disabled. The greeting is a nicety, never a gate:
    // the operator still lands on /brand with the form in front of them.
  }
}

/** Whether the Brand Intelligence greeting is still owed to this browser. */
export function brandOnboardingPending(): boolean {
  if (!isBrowser()) return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'pending'
  } catch {
    return false
  }
}

/** Spend it. Called when the greeting is dismissed, so it never returns. */
export function clearBrandOnboarding(): void {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}
