'use client'

import { useState } from 'react'
import { Check, Loader2, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOperator } from '@/components/reactor/operator/OperatorProvider'
import {
  accentFor,
  EvidenceRows,
  FieldLabel,
  inputClass,
  isWatch,
  OperatorModal,
  SecondaryButton,
} from '@/components/reactor/operator/shell'
import { DISMISS_REASONS, type DismissReason, type Proposal, type ProposalParams } from '@/lib/operator/types'

/* ----------------------------------------------------------------------------
   The four decisions, plus Ask Mike.

   Each one is a real commitment with a real consequence, so each one asks for
   exactly what it needs and nothing more. Dismiss demands a reason code because
   an unexplained "no" teaches the system nothing and comes straight back in a
   fortnight; the free-text note is optional and is for the human, while the
   code is what feeds the weights.
---------------------------------------------------------------------------- */

/* ---------------------------------- Edit ----------------------------------- */

const FORMATS = ['video', 'static', 'carousel']

export function EditModal({
  open,
  onClose,
  proposal,
}: {
  open: boolean
  onClose: () => void
  proposal: Proposal
}) {
  const { approve } = useOperator()
  const [params, setParams] = useState<ProposalParams>(proposal.params)

  const set = <K extends keyof ProposalParams>(key: K, value: ProposalParams[K]) =>
    setParams((p) => ({ ...p, [key]: value }))

  const save = () => {
    // Saving approves the edited proposal and logs the diff — which is what
    // makes "you have cut this to three, three times running" possible later.
    approve(proposal, params)
    onClose()
  }

  return (
    <OperatorModal
      open={open}
      onClose={onClose}
      accent={accentFor(proposal)}
      title={isWatch(proposal) ? 'Prepare a successor anyway' : 'Edit before approving'}
      subtitle={
        isWatch(proposal)
          ? 'Creates the same draft a confirmed replacement would. For when you trust the rapid window more than Mike does.'
          : 'Saving approves the edited version and records the change.'
      }
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <button type="button" onClick={save} className="brief-cta !w-auto !px-4">
            <Check size={13} />
            Save and approve
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <FieldLabel>Variations</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set('variations', n)}
                className={cn(
                  'min-h-[44px] min-w-[44px] rounded-lg border px-3 font-display text-[13px] font-semibold tabular transition-colors sm:min-h-[38px]',
                  params.variations === n
                    ? 'border-primary/50 bg-primary/10 text-glow'
                    : 'border-border bg-background/40 text-white/60 hover:border-primary/30',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <FieldLabel>Hook direction</FieldLabel>
          <input
            className={inputClass}
            value={params.hookDirection}
            onChange={(e) => set('hookDirection', e.target.value)}
            placeholder="The angle the new creative should carry"
          />
        </label>

        <label className="block">
          <FieldLabel>Format</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set('format', f)}
                className={cn(
                  'min-h-[44px] rounded-lg border px-3.5 text-[12.5px] font-medium capitalize transition-colors sm:min-h-[38px]',
                  params.format === f
                    ? 'border-primary/50 bg-primary/10 text-glow'
                    : 'border-border bg-background/40 text-white/60 hover:border-primary/30',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <FieldLabel>Additional instructions</FieldLabel>
          <textarea
            className={cn(inputClass, 'min-h-[88px] resize-y')}
            value={params.instructions}
            onChange={(e) => set('instructions', e.target.value)}
            placeholder="Anything the brief should carry that is not in the evidence"
          />
        </label>
      </div>
    </OperatorModal>
  )
}

/* --------------------------------- Dismiss --------------------------------- */

export function DismissModal({
  open,
  onClose,
  proposal,
}: {
  open: boolean
  onClose: () => void
  proposal: Proposal
}) {
  const { dismiss } = useOperator()
  const [reason, setReason] = useState<DismissReason | null>(null)
  const [note, setNote] = useState('')

  const confirm = () => {
    if (!reason) return
    dismiss(proposal, reason, note.trim() || undefined)
    onClose()
  }

  return (
    <OperatorModal
      open={open}
      onClose={onClose}
      accent="pink"
      title="Dismiss this recommendation"
      subtitle="The reason is what the system learns from. It will not raise this again for 14 days."
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <SecondaryButton onClick={confirm} disabled={!reason} tone="danger">
            Dismiss
          </SecondaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel>Why</FieldLabel>
          <div className="grid gap-2">
            {DISMISS_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReason(r.id)}
                className={cn(
                  'min-h-[44px] rounded-lg border px-3 text-left text-[13px] font-medium transition-colors',
                  reason === r.id
                    ? 'border-primary/50 bg-primary/10 text-glow'
                    : 'border-border bg-background/40 text-white/70 hover:border-primary/30',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <FieldLabel>Note (optional)</FieldLabel>
          <textarea
            className={cn(inputClass, 'min-h-[72px] resize-y')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For you and Mike. The reason code above is what moves the weighting."
          />
        </label>

        {reason === 'wrong-read-of-data' && (
          <p className="rounded-lg border border-warning/25 bg-warning/[0.05] px-3 py-2.5 text-[12.5px] leading-relaxed text-white/70">
            Marked as a bad read. This weighs {proposal.type} proposals down harder than an ordinary
            dismissal — and it only changes what gets shown first, never whether the underlying
            signal fires.
          </p>
        )}
      </div>
    </OperatorModal>
  )
}

/* --------------------------------- Snooze ---------------------------------- */

const SNOOZE_OPTIONS = [
  { days: 1, label: 'Tomorrow' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
]

export function SnoozeModal({
  open,
  onClose,
  proposal,
}: {
  open: boolean
  onClose: () => void
  proposal: Proposal
}) {
  const { snooze } = useOperator()

  return (
    <OperatorModal
      open={open}
      onClose={onClose}
      accent="amber"
      title="Snooze"
      subtitle="Hidden until then, and it comes back marked as returning rather than as something new."
      footer={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}
    >
      <div className="grid gap-2">
        {SNOOZE_OPTIONS.map((o) => (
          <button
            key={o.days}
            type="button"
            onClick={() => {
              snooze(proposal, o.days)
              onClose()
            }}
            className="min-h-[44px] rounded-lg border border-border bg-background/40 px-3 text-left text-[13px] font-medium text-white/75 transition-colors hover:border-primary/40 hover:text-glow"
          >
            {o.label}
          </button>
        ))}
      </div>
    </OperatorModal>
  )
}

/* -------------------------------- Ask Mike --------------------------------- */

interface Exchange {
  question: string
  answer: string
  evidenceIds: string[]
}

export function AskMikeModal({
  open,
  onClose,
  proposal,
}: {
  open: boolean
  onClose: () => void
  proposal: Proposal
}) {
  const { ask, asksRemaining } = useOperator()
  const [question, setQuestion] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [pending, setPending] = useState(false)

  const remaining = Math.max(0, asksRemaining(proposal.id))
  const exhausted = remaining === 0

  const send = async () => {
    const text = question.trim()
    if (!text || pending || exhausted) return
    setPending(true)
    setQuestion('')
    const result = await ask(proposal, text)
    setExchanges((list) => [
      ...list,
      { question: text, answer: result.answer, evidenceIds: result.evidenceIds ?? [] },
    ])
    setPending(false)
  }

  return (
    <OperatorModal
      open={open}
      onClose={onClose}
      accent={accentFor(proposal)}
      title="Ask Mike"
      subtitle={`About: ${proposal.subjectNames.join(', ')} · ${remaining} of 3 questions left on this card`}
      footer={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}
    >
      <div className="space-y-4">
        {exchanges.map((e, i) => (
          <div key={i} className="space-y-2">
            <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-[13px] text-white/70">
              {e.question}
            </p>
            <p className="text-[13.5px] leading-relaxed text-white/85">{e.answer}</p>
            {e.evidenceIds.length > 0 && (
              <div className="rounded-lg border border-border bg-background/30 p-2.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                  What he is reading
                </p>
                <EvidenceRows
                  evidence={proposal.evidence.filter((ev) => e.evidenceIds.includes(ev.id))}
                  highlighted={e.evidenceIds}
                />
              </div>
            )}
          </div>
        ))}

        {pending && (
          <p className="flex items-center gap-2 text-[13px] text-glow/70">
            <Loader2 size={13} className="animate-spin" />
            Mike is looking at it…
          </p>
        )}

        {exhausted ? (
          <p className="rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-white/55">
            Three questions is the limit on one card. It is a card, not a thread — if it needs more
            than that, the conversation belongs in the evidence rather than in here.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <FieldLabel>Your question</FieldLabel>
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
              className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-lg border border-primary/35 bg-primary/10 text-glow transition-colors hover:border-primary/60 disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </div>
        )}
      </div>
    </OperatorModal>
  )
}
