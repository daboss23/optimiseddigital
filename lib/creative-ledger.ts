/**
 * The Creative Ledger — every finished creative the Reactor has built, kept
 * across refreshes.
 *
 * A run used to live entirely in React state: click away, refresh, or close the
 * tab and the ads were gone. The work was real — a rendered still, a scored ad
 * package, a production brief — and it vanished because nothing wrote it down.
 *
 * The ledger is that write-down. It is deliberately CLIENT-side (localStorage):
 * it survives a refresh, needs no database, and works on a cold platform with no
 * Supabase configured, which is the environment the rest of the Reactor already
 * degrades to. Winners still get promoted into the Vault through `recordOutcome`
 * — that is the durable, cross-device memory. This is the workbench: what you
 * made today, still on the bench tomorrow morning.
 *
 * What is stored is a REFERENCE, not the pixels: the provider's image/video URL
 * plus the concept it belongs to. That keeps entries tiny (a few KB each) and
 * makes "open this in the Studio" work fully after a refresh, because the whole
 * ad package rides along.
 */

import type { Concept } from '@/components/campaign-reactor/ReactorRunContext'

const STORAGE_KEY = 'tpb.creative-ledger.v1'

/**
 * How many creatives the ledger holds before the oldest fall off. High enough
 * to cover weeks of real use, low enough that the whole thing stays well inside
 * a localStorage quota even with long ad packages attached.
 */
export const LEDGER_MAX_ENTRIES = 120

/** Entries older than this are pruned on load. */
export const LEDGER_MAX_AGE_DAYS = 30

export interface LedgerEntry {
  /** Stable id — concept text + media URL, so the same render never doubles up. */
  id: string
  /** Epoch ms the creative landed. */
  createdAt: number
  /** The campaign this came out of, when the brief named one. */
  campaign?: string
  angle?: string
  /** The still, when the creative is an image. */
  imageUrl?: string
  /** The clip, when the creative is a video. */
  videoUrl?: string
  model?: string
  provider?: string
  /** The whole concept — copy, ad package, brief — so the Studio can reopen it. */
  concept: Concept
}

/* ------------------------------- Persistence ------------------------------- */

const isBrowser = () => typeof window !== 'undefined'

/**
 * Read the ledger, newest first, with expired entries dropped.
 *
 * Never throws: a corrupt or foreign value in the key (another tab, an older
 * schema, a user poking at devtools) resolves to an empty ledger rather than
 * taking the page down with it.
 */
export function loadLedger(): LedgerEntry[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - LEDGER_MAX_AGE_DAYS * 86_400_000
    return (parsed as LedgerEntry[])
      .filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          typeof e.createdAt === 'number' &&
          e.createdAt > cutoff &&
          e.concept &&
          typeof e.concept.text === 'string',
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, LEDGER_MAX_ENTRIES)
  } catch {
    return []
  }
}

/**
 * Write the ledger back. A quota failure is survivable — the creative is still
 * on screen for this session — so it is swallowed rather than surfaced as an
 * error the operator can do nothing about.
 */
function saveLedger(entries: LedgerEntry[]): void {
  if (!isBrowser()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LEDGER_MAX_ENTRIES)))
  } catch {
    /* quota or private mode — the session keeps working, it just won't persist */
  }
}

/** The id a creative files under. Same concept + same render = same entry. */
export function ledgerId(conceptText: string, url: string): string {
  return `${conceptText.slice(0, 120)}::${url}`
}

/**
 * File a finished creative. Returns the updated ledger.
 *
 * Idempotent by id, so the render that lands, then re-renders on a model
 * fallback, then gets re-read on a refresh, occupies exactly one row.
 */
export function recordToLedger(entry: LedgerEntry, current = loadLedger()): LedgerEntry[] {
  const next = [entry, ...current.filter((e) => e.id !== entry.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, LEDGER_MAX_ENTRIES)
  saveLedger(next)
  return next
}

export function removeFromLedger(id: string, current = loadLedger()): LedgerEntry[] {
  const next = current.filter((e) => e.id !== id)
  saveLedger(next)
  return next
}

export function clearLedger(): LedgerEntry[] {
  saveLedger([])
  return []
}

/* -------------------------------- Grouping -------------------------------- */

export interface LedgerDay {
  /** 'Today' · 'Yesterday' · 'Thu 7 Aug' */
  label: string
  /** YYYY-MM-DD, stable across renders and safe as a React key. */
  key: string
  entries: LedgerEntry[]
}

const dayKey = (ms: number) => {
  const d = new Date(ms)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Group into days, newest first, with the two most recent days named in the
 * language the operator thinks in rather than as dates.
 */
export function groupByDay(entries: LedgerEntry[]): LedgerDay[] {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 86_400_000)
  const buckets = new Map<string, LedgerEntry[]>()

  for (const e of entries) {
    const k = dayKey(e.createdAt)
    const list = buckets.get(k)
    if (list) list.push(e)
    else buckets.set(k, [e])
  }

  return Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label:
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : new Date(list[0].createdAt).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }),
      entries: list.sort((a, b) => b.createdAt - a.createdAt),
    }))
}
