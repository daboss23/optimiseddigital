'use client'

/**
 * The Creative Ledger — the shelf under the workbench.
 *
 * Everything the Reactor finishes lands here and STAYS here: refresh the page,
 * close the tab, come back tomorrow, and this morning's ads are still on the
 * bench. Before this, a run's creatives lived only in React state and a refresh
 * threw away real work — rendered stills, scored ad packages, complete Meta
 * units.
 *
 * It is a working shelf, not an archive: newest first, grouped by the day it
 * was made, capped and self-pruning. The durable, cross-device record of what
 * WON is still the Vault — a winner marked on a concept card is re-ingested as
 * a pattern. This is what you made, not what worked.
 */

import { useMemo, useState } from 'react'
import { Film, ImageIcon, Layers, Trash2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Panel, PanelHeader, Pill } from '@/components/reactor/ui'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'
import { groupByDay, type LedgerEntry } from '@/lib/creative-ledger'

export function CreativeLedger({ onOpen }: { onOpen: (c: Concept) => void }) {
  const { ledger, removeLedgerEntry, clearLedgerEntries } = useReactorRun()
  const days = useMemo(() => groupByDay(ledger), [ledger])
  // Guard on a destructive action that cannot be undone from the UI.
  const [confirmClear, setConfirmClear] = useState(false)

  // Nothing made yet — the panel stays out of the way entirely rather than
  // showing an empty shelf above the reactor.
  if (!ledger.length) return null

  return (
    <Panel className="mt-6">
      <PanelHeader
        icon={<Layers size={16} />}
        accent="cyan"
        title="Creative Ledger"
        subtitle="Every creative this platform has built, kept across refreshes. Click one to open it in the Studio."
        accessory={
          <div className="flex items-center gap-2">
            <Pill tone="primary">{ledger.length}</Pill>
            {confirmClear ? (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    clearLedgerEntries()
                    setConfirmClear(false)
                  }}
                  className="min-h-[32px] rounded-full border border-danger/40 bg-danger/10 px-3 text-[11px] font-semibold text-danger transition-colors hover:bg-danger/20"
                >
                  Clear everything
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[32px] px-2 text-[11px] font-medium text-white/45 transition-colors hover:text-white/80"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="min-h-[32px] px-2 text-[11px] font-medium text-white/35 transition-colors hover:text-white/70"
              >
                Clear
              </button>
            )}
          </div>
        }
      />

      <div className="space-y-5 p-5">
        {days.map((day) => (
          <div key={day.key}>
            <p className="mb-2.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
              {day.label}
              <span className="h-px flex-1 bg-white/10" />
              <span className="font-medium tracking-normal text-white/25">
                {day.entries.length} creative{day.entries.length === 1 ? '' : 's'}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {day.entries.map((entry) => (
                <LedgerCard
                  key={entry.id}
                  entry={entry}
                  // The render is carried ON the concept. After a refresh the
                  // live media maps are empty, so a concept handed over bare
                  // would open the Studio with no creative — the exact thing
                  // this panel exists to prevent.
                  onOpen={() =>
                    onOpen(
                      entry.imageUrl
                        ? { ...entry.concept, imageUrl: entry.imageUrl }
                        : entry.concept,
                    )
                  }
                  onRemove={() => removeLedgerEntry(entry.id)}
                />
              ))}
            </div>
          </div>
        ))}

        <p className="text-[11px] leading-relaxed text-white/35">
          Stored on this device, so it survives a refresh but does not follow you to another
          browser. The creative files themselves live with the render provider and their links can
          expire — download anything you intend to keep. Marking a concept a winner is what writes
          it into the Vault permanently.
        </p>
      </div>
    </Panel>
  )
}

function LedgerCard({
  entry,
  onOpen,
  onRemove,
}: {
  entry: LedgerEntry
  onOpen: () => void
  onRemove: () => void
}) {
  const isVideo = Boolean(entry.videoUrl)
  const time = new Date(entry.createdAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] transition-colors hover:border-primary/40">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <span className="relative block aspect-square w-full overflow-hidden bg-black/40">
          {isVideo ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={entry.videoUrl} className="h-full w-full object-cover" muted playsInline />
          ) : entry.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.imageUrl}
              alt={entry.concept.type}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-white/20">
              <ImageIcon size={22} />
            </span>
          )}
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-white/70">
            {isVideo ? <Film size={9} /> : <ImageIcon size={9} />}
            {entry.concept.type}
          </span>
          {typeof entry.concept.neuro?.overall === 'number' && (
            <span
              className={cn(
                'absolute right-1.5 top-1.5 rounded-full px-2 py-1 text-[9px] font-bold',
                entry.concept.neuro.overall >= 8
                  ? 'bg-success/85 text-black'
                  : 'bg-black/70 text-white/75',
              )}
            >
              {entry.concept.neuro.overall}/10
            </span>
          )}
          {/* The action is the whole tile; this just makes it legible on hover. */}
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-6 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Wand2 size={10} /> Open in Studio
          </span>
        </span>
        <span className="block px-2.5 py-2">
          <span className="block truncate text-[11px] font-medium text-white/75">
            {entry.campaign || entry.angle || entry.concept.type}
          </span>
          <span className="block truncate text-[10px] text-white/30">
            {time}
            {entry.model ? ` · ${entry.model}` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.concept.type} from the ledger`}
        className="absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white/50 opacity-0 transition-all hover:bg-danger/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}
