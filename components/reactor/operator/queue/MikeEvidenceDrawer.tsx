'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { ArrowUpRight, Loader2, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import { FieldLabel, inputClass } from '@/components/reactor/operator/shell'
import { STRENGTH_LABELS, strengthExplanation } from '@/lib/operator/strength'
import { RESULT_LABELS } from '@/lib/creative-status'
import { FAMILY_LABEL, type MikeQueueItem } from '@/lib/operator/queue'
import type { Evidence } from '@/lib/operator/types'

/* ----------------------------------------------------------------------------
   The evidence drawer.

   Everything Mike used, available on demand and nowhere near the default
   reading path. A right-side panel on desktop, a bottom sheet on a phone.

   This is for VERIFICATION. It is not a second copy of the recommendation with
   more adjectives, so the recommendation appears once at the top and then the
   drawer gets on with showing the numbers, the windows they were measured over
   and the cohort they were measured against.
---------------------------------------------------------------------------- */

const DIRECTION_CLASS: Record<Evidence['direction'], string> = {
  good: 'text-success',
  bad: 'text-danger',
  neutral: 'text-white/85',
}

function EvidenceItem({ evidence, cited }: { evidence: Evidence; cited: boolean }) {
  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2.5',
        cited ? 'border-primary/25 bg-primary/[0.04]' : 'border-border bg-background/30',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 break-words text-[11.5px] font-medium uppercase tracking-[0.08em] text-white/50">
          {evidence.label}
        </span>
        <span
          className={cn(
            'ml-auto break-words text-right font-display text-[13.5px] font-bold tabular',
            DIRECTION_CLASS[evidence.direction],
          )}
        >
          {evidence.displayValue}
        </span>
      </div>
      {evidence.comparisonValue && (
        <p className="mt-1 text-[12px] leading-relaxed text-white/55">{evidence.comparisonValue}</p>
      )}
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/30">
        {/* Underscores are not break opportunities, so a long evidence id with
            nowhere to wrap sets the sheet's minimum width on a phone. */}
        <span className="break-all font-mono">{evidence.id}</span>
        {evidence.source.provisional && (
          <span className="font-medium text-warning/80">Inside the attribution window</span>
        )}
      </p>
    </li>
  )
}

/* -------------------------------- Ask Mike --------------------------------- */

function AskMike({ item }: { item: MikeQueueItem }) {
  const { ask, asksRemaining } = useOperator()
  const [question, setQuestion] = useState('')
  const [exchanges, setExchanges] = useState<{ question: string; answer: string }[]>([])
  const [pending, setPending] = useState(false)

  const remaining = Math.max(0, asksRemaining(item.proposal.id))

  const send = async () => {
    const text = question.trim()
    if (!text || pending || remaining === 0) return
    setPending(true)
    setQuestion('')
    const result = await ask(item.proposal, text)
    setExchanges((list) => [...list, { question: text, answer: result.answer }])
    setPending(false)
  }

  return (
    <div className="space-y-3">
      {exchanges.map((e, i) => (
        <div key={i} className="space-y-1.5">
          <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[12.5px] text-white/60">
            {e.question}
          </p>
          <p className="text-[13.5px] leading-relaxed text-white/85">{e.answer}</p>
        </div>
      ))}

      {pending && (
        <p className="flex items-center gap-2 text-[13px] text-glow/70">
          <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
          Mike is looking at it…
        </p>
      )}

      {remaining === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-white/45">
          Three questions is the limit on one decision. Past that, the answer is in the evidence
          above rather than in another sentence.
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <FieldLabel>Ask Mike ({remaining} left)</FieldLabel>
            <input
              className={inputClass}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send()
              }}
              placeholder="What would change your mind on this?"
              disabled={pending}
            />
          </label>
          <button
            type="button"
            onClick={() => void send()}
            disabled={pending || !question.trim()}
            aria-label="Send question"
            className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-lg border border-primary/35 bg-primary/10 text-glow transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 disabled:opacity-40 motion-reduce:transition-none"
          >
            <Send size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

/* --------------------------------- drawer ---------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function MikeEvidenceDrawer({
  item,
  onClose,
}: {
  item: MikeQueueItem | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item || !mounted) return null

  const { proposal, narrated } = item
  const cited = new Set(narrated?.evidenceIds ?? [])
  const resultType = proposal.evidence.find((e) => e.source.baselineKey)?.source.baselineKey
    ?.primaryResultType
  const resultWord = resultType
    ? RESULT_LABELS[resultType].many
    : 'results'
  const baselineKey = proposal.evidence.find((e) => e.source.baselineKey)?.source.baselineKey

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end">
      <button
        type="button"
        aria-label="Close evidence"
        onClick={onClose}
        className="absolute inset-0 bg-background/85 backdrop-blur-md"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Evidence for ${item.creativeName}`}
        className={cn(
          'glass shadow-panel relative flex w-full min-w-0 max-w-full flex-col border-l border-border',
          // Bottom sheet on a phone, side drawer from tablet up.
          'mt-auto max-h-[88dvh] rounded-t-2xl sm:mt-0 sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              {FAMILY_LABEL[item.family]} · evidence
            </p>
            <h2 className="mt-1 font-display text-[16px] font-semibold leading-snug text-white">
              {item.title}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-white/50">{item.creativeName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background/40 text-white/50 transition-colors hover:border-primary/40 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-5 py-4">
          <Section title="Why">
            <p className="text-[13.5px] leading-relaxed text-white/80">
              {narrated?.reasoning || proposal.fallback.reasoning}
            </p>
          </Section>

          <Section title={`Evidence · ${proposal.evidence.length} items`}>
            <ul className="space-y-2">
              {proposal.evidence.map((e) => (
                <EvidenceItem key={e.id} evidence={e} cited={cited.has(e.id)} />
              ))}
            </ul>
          </Section>

          <Section title="Comparison">
            <dl className="space-y-1.5 rounded-lg border border-border bg-background/30 px-3 py-2.5 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-white/45">Cohort</dt>
                <dd className="min-w-0 break-words text-right text-white/80">
                  {baselineKey
                    ? [
                        baselineKey.audienceTemperature,
                        baselineKey.offerType,
                        RESULT_LABELS[baselineKey.primaryResultType].many,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'no cohort specific enough to compare against'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/45">Windows</dt>
                <dd className="text-right text-white/80">
                  3 complete days vs prior 3 · 7 vs prior 7
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-white/45">Subjects</dt>
                <dd className="min-w-0 break-words text-right text-white/80">
                  {proposal.subjectNames.join(', ')}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Confidence">
            <p className="text-[13px] leading-relaxed text-white/75">
              <span className="font-semibold text-white">
                {STRENGTH_LABELS[proposal.strength.tier]}
              </span>{' '}
              — {strengthExplanation(proposal.strength, resultWord)}
            </p>
            {proposal.strength.reasons.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-[12.5px] text-white/50">
                {proposal.strength.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-white/25" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Ask Mike">
            <AskMike item={item} />
          </Section>

          <Link
            href="/meta"
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[12.5px] font-medium text-white/70 transition-colors hover:border-primary/40 hover:text-glow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 motion-reduce:transition-none"
          >
            Open the full performance record
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
