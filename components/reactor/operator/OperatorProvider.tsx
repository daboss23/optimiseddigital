'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ACCOUNT_TIMEZONE,
  operatorDataSource,
  TARGET_COST_PER_RESULT,
} from '@/lib/operator/adapters'
import { daysBetween, dayOf, todayIn } from '@/lib/operator/dates'
import { draftFromProposal, stageDraft } from '@/lib/operator/draft'
import {
  applyDecision,
  askCount,
  learnedDefaults,
  logAsk,
  MAX_ASK_EXCHANGES,
  recordOpening,
  type LearnedDefault,
  type OperatorMemory,
} from '@/lib/operator/memory'
import {
  accountDaily,
  creativeSummaries,
  runOperator,
  type OperatorOutput,
} from '@/lib/operator/operator'
import {
  loadMemory,
  loadNarration,
  narrationKey,
  saveMemory,
  saveNarration,
} from '@/lib/operator/persistence'
import type {
  AskOutput,
  CatchupOutput,
  CreativeSnapshot,
  DataSourceMetadata,
  Decision,
  DismissReason,
  NarratedCard,
  NarrationOutput,
  PerformanceBaseline,
  Proposal,
  ProposalParams,
} from '@/lib/operator/types'

/* ----------------------------------------------------------------------------
   The operator's session.

   The pipeline runs HERE, in the browser, and that is a deliberate choice
   rather than a convenience. Ranking, cooldowns and learned defaults are all
   functions of the decision log, and the decision log is the operator's own —
   it lives in their storage, it never leaves the machine, and no server needs
   to hold a record of what they said no to. The maths is pure TypeScript and
   runs identically either side of the wire.

   Everything recomputes from (source data + decision log) on every change, so
   there is exactly one version of the truth and no card can outlive the data
   that produced it.
---------------------------------------------------------------------------- */

/** Past this many days away, the strip offers a catch-up instead of a remark. */
const AWAY_THRESHOLD_DAYS = 2

export type OpeningState = 'JUST NOW' | 'THIS MORNING' | 'FOLLOWING UP'

export interface Toast {
  id: number
  message: string
  tone: 'success' | 'info'
  /** Optional follow-through, e.g. opening the draft that was just created. */
  action?: { label: string; href: string }
}

export interface OperatorDebug {
  leadReason: string
  model: string | null
  degraded: boolean
  degradedReason?: string
  /** Every numeral Mike used and the field that authorised it. */
  attempts: { failures: { code: string; message: string }[]; resolutionCount: number }[]
  suppressed: { label: string; reason: string }[]
  notes: string[]
}

interface OperatorContextValue {
  ready: boolean
  paused: boolean
  evaluationDate: string
  metadata: DataSourceMetadata | null
  output: OperatorOutput | null
  /** The board, up to three. */
  proposals: Proposal[]
  /** THE selector — header count, Actions Required tile and the queue. */
  actionsRequired: number
  narration: NarrationOutput | null
  narrating: boolean
  /** Which card Mike put first, when it is not the top-ranked one. */
  mikesPickId: string | null
  cardFor: (proposalId: string) => NarratedCard | null
  openingState: OpeningState
  awayDays: number
  needsCatchup: boolean
  catchup: CatchupOutput | null
  catchingUp: boolean
  learned: LearnedDefault[]
  debug: OperatorDebug | null
  toast: Toast | null
  dismissToast: () => void

  approve: (proposal: Proposal, params?: ProposalParams) => void
  dismiss: (proposal: Proposal, reason: DismissReason, note?: string) => void
  snooze: (proposal: Proposal, days: number) => void
  keepWatching: (proposal: Proposal) => void
  togglePause: () => void
  runCatchup: () => Promise<void>
  ask: (proposal: Proposal, question: string) => Promise<AskOutput>
  asksRemaining: (proposalId: string) => number
}

const OperatorContext = createContext<OperatorContextValue | null>(null)

export function useOperator(): OperatorContextValue {
  const ctx = useContext(OperatorContext)
  if (!ctx) throw new Error('useOperator must be used inside <OperatorProvider>')
  return ctx
}

/* --------------------------------- provider -------------------------------- */

interface SourceData {
  creatives: CreativeSnapshot[]
  baselines: PerformanceBaseline[]
  metadata: DataSourceMetadata
}

export function OperatorProvider({ children }: { children: ReactNode }) {
  // Nothing reads the clock or storage during render — both would differ
  // between the server pass and the client one, and a hydration mismatch on the
  // primary surface of the dashboard is not a subtle bug.
  const [evaluationDate, setEvaluationDate] = useState<string>('')
  const [memory, setMemory] = useState<OperatorMemory | null>(null)
  const [source, setSource] = useState<SourceData | null>(null)
  const [narration, setNarration] = useState<NarrationOutput | null>(null)
  const [narrating, setNarrating] = useState(false)
  const [narrationFresh, setNarrationFresh] = useState(false)
  const [debug, setDebug] = useState<OperatorDebug | null>(null)
  const [catchup, setCatchup] = useState<CatchupOutput | null>(null)
  const [catchingUp, setCatchingUp] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // The previous visit, captured before `lastSeenAt` is stamped forward.
  const previousVisit = useRef<string | null>(null)
  const narrationRequested = useRef<string | null>(null)

  /* -- boot: clock, memory, data ------------------------------------------ */

  useEffect(() => {
    const today = todayIn(ACCOUNT_TIMEZONE)
    const stored = loadMemory()
    previousVisit.current = stored.lastSeenAt

    const nowIso = new Date().toISOString()
    const booted: OperatorMemory = {
      ...stored,
      lastSeenAt: nowIso,
      startedAt: stored.startedAt ?? nowIso,
    }
    saveMemory(booted)

    setEvaluationDate(today)
    setMemory(booted)

    let live = true
    const src = operatorDataSource({ evaluationDate: today })
    Promise.all([src.getCreatives(), src.getBaselines(), src.getMetadata()])
      .then(([creatives, baselines, metadata]) => {
        if (live) setSource({ creatives, baselines, metadata })
      })
      .catch(() => {
        // A data source that cannot be read is reported, never faked. The
        // surface renders its empty state rather than an invented board.
        if (live) setSource(null)
      })
    return () => {
      live = false
    }
  }, [])

  /* -- the pipeline -------------------------------------------------------- */

  const output = useMemo<OperatorOutput | null>(() => {
    if (!memory || !source || !evaluationDate) return null
    return runOperator({
      creatives: source.creatives,
      baselines: source.baselines,
      metadata: source.metadata,
      evaluationDate,
      memory,
      targetCostPerResult: TARGET_COST_PER_RESULT,
    })
  }, [memory, source, evaluationDate])

  const proposals = output?.proposals ?? []
  const boardKey = proposals.map((p) => p.id).join('|')

  /* -- mark what has been raised ------------------------------------------ */

  // Recorded so a paused board keeps showing what was already on it, and so
  // "raised 3 days ago and still open" is a fact rather than a guess.
  useEffect(() => {
    if (!memory || proposals.length === 0) return
    const unseen = proposals.filter((p) => !memory.seen[p.subjectKey])
    if (unseen.length === 0) return
    const now = new Date().toISOString()
    setMemory((current) => {
      if (!current) return current
      const seen = { ...current.seen }
      for (const p of unseen) seen[p.subjectKey] = seen[p.subjectKey] ?? now
      const next = { ...current, seen }
      saveMemory(next)
      return next
    })
    // Keyed on the board rather than on `memory`, or writing `seen` would
    // retrigger the effect that wrote it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey])

  /* -- carry this run's recovery holds forward ---------------------------- */

  useEffect(() => {
    if (!memory || !output || output.recoveries.length === 0) return
    const additions = output.recoveries.filter(
      (r) => memory.suppressions[r.key]?.untilDate !== r.untilDate,
    )
    if (additions.length === 0) return
    setMemory((current) => {
      if (!current) return current
      const suppressions = { ...current.suppressions }
      for (const r of additions) suppressions[r.key] = { untilDate: r.untilDate, note: r.note }
      const next = { ...current, suppressions }
      saveMemory(next)
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output?.recoveries.map((r) => `${r.key}:${r.untilDate}`).join('|')])

  /* -- narration ----------------------------------------------------------- */

  const awayDays = previousVisit.current
    ? Math.max(0, daysBetween(dayOf(previousVisit.current), evaluationDate || dayOf(previousVisit.current)))
    : 0
  const needsCatchup = awayDays >= AWAY_THRESHOLD_DAYS

  useEffect(() => {
    if (!output || !memory || !source || !evaluationDate) return
    if (proposals.length === 0) {
      setNarration(null)
      return
    }

    const key = narrationKey(output.ranking, evaluationDate)
    if (narrationRequested.current === key) return
    narrationRequested.current = key

    // His words about this exact board, from earlier in the session. Reusing
    // them is not just cheaper — regenerating produces subtly different
    // language about identical evidence, which reads as him changing his mind
    // for no reason anyone can see.
    const cached = loadNarration(key)
    if (cached) {
      setNarration(cached.output)
      setNarrationFresh(false)
      return
    }

    const controller = new AbortController()
    setNarrating(true)

    fetch('/api/operator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        mode: 'session',
        session: {
          proposals: output.candidates,
          ranking: output.ranking,
          account: {
            recentDaily: accountDaily(output.evaluated, output.maturity),
            baselines: source.baselines,
            activeCreatives: creativeSummaries(output.evaluated),
          },
          metadata: source.metadata,
          relationship: output.relationship,
          mikesNotes: memory.mikesNotes,
          recentOpenings: memory.recentOpenings,
        },
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.output) return
        const written = new Date().toISOString()
        setNarration(data.output)
        setNarrationFresh(true)
        setDebug({
          leadReason: data.output.leadReason ?? '',
          model: data.model ?? null,
          degraded: Boolean(data.degraded),
          degradedReason: data.degradedReason,
          attempts: (data.attempts ?? []).map(
            (a: { failures?: { code: string; message: string }[]; resolutions?: Record<string, unknown[]> }) => ({
              failures: a.failures ?? [],
              resolutionCount: Object.values(a.resolutions ?? {}).reduce(
                (s, list) => s + (Array.isArray(list) ? list.length : 0),
                0,
              ),
            }),
          ),
          suppressed: output.suppressed.map((s) => ({
            label: `${s.proposal.type} · ${s.proposal.subjectNames.join(', ')}`,
            reason: s.reason,
          })),
          notes: output.notes,
        })
        saveNarration({ key, output: data.output, degraded: Boolean(data.degraded), writtenAt: written })

        // His running note and his opening both persist — that continuity is
        // the cheapest thing in this build and does more for the sense of a
        // continuous person than any amount of prompt engineering.
        setMemory((current) => {
          if (!current) return current
          const next = recordOpening(
            { ...current, mikesNotes: data.output.sessionNote || current.mikesNotes },
            data.output.openingRemark ?? null,
          )
          saveMemory(next)
          return next
        })
      })
      .catch(() => {
        // Aborted or offline — the computed cards are already on screen.
      })
      .finally(() => setNarrating(false))

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, evaluationDate])

  /* -- decisions ----------------------------------------------------------- */

  const commit = useCallback((decision: Decision) => {
    setMemory((current) => {
      if (!current) return current
      const next = applyDecision(current, decision)
      saveMemory(next)
      return next
    })
  }, [])

  const tagsOf = useCallback(
    (proposal: Proposal) =>
      Array.from(
        new Set(
          proposal.subjectIds.flatMap(
            (id) => source?.creatives.find((c) => c.id === id)?.tags ?? [],
          ),
        ),
      ),
    [source],
  )

  const showToast = useCallback((toastValue: Omit<Toast, 'id'>) => {
    setToast({ ...toastValue, id: Date.now() })
  }, [])

  const cardFor = useCallback(
    (proposalId: string): NarratedCard | null =>
      narration?.cards.find((c) => c.proposalId === proposalId) ?? null,
    [narration],
  )

  const approve = useCallback(
    (proposal: Proposal, params?: ProposalParams) => {
      const edited = params && JSON.stringify(params) !== JSON.stringify(proposal.params)
      const finalParams = params ?? proposal.params
      const narrated = cardFor(proposal.id)

      // The assertion lives inside `stageDraft`: if this ever resolves to
      // anything that could mutate the account, it throws here rather than
      // shipping.
      const href = stageDraft(
        draftFromProposal(proposal, finalParams, narrated ?? undefined),
      )

      commit({
        proposalId: proposal.id,
        subjectKey: proposal.subjectKey,
        type: proposal.type,
        subjectIds: proposal.subjectIds,
        subjectTags: tagsOf(proposal),
        strengthTier: proposal.strength.tier,
        action: edited ? 'edited' : 'approved',
        edits: edited ? finalParams : undefined,
        decidedAt: new Date().toISOString(),
      })

      showToast({
        message: 'Approved — draft created',
        tone: 'success',
        action: { label: 'Open the brief', href },
      })
    },
    [cardFor, commit, showToast, tagsOf],
  )

  const dismiss = useCallback(
    (proposal: Proposal, reason: DismissReason, note?: string) => {
      commit({
        proposalId: proposal.id,
        subjectKey: proposal.subjectKey,
        type: proposal.type,
        subjectIds: proposal.subjectIds,
        subjectTags: tagsOf(proposal),
        strengthTier: proposal.strength.tier,
        action: 'dismissed',
        reasonCode: reason,
        note,
        decidedAt: new Date().toISOString(),
      })
      showToast({ message: 'Dismissed — Mike will not raise it again for a fortnight', tone: 'info' })
    },
    [commit, showToast, tagsOf],
  )

  const snooze = useCallback(
    (proposal: Proposal, days: number) => {
      const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
      commit({
        proposalId: proposal.id,
        subjectKey: proposal.subjectKey,
        type: proposal.type,
        subjectIds: proposal.subjectIds,
        subjectTags: tagsOf(proposal),
        strengthTier: proposal.strength.tier,
        action: 'snoozed',
        snoozedUntil: until,
        decidedAt: new Date().toISOString(),
      })
      showToast({ message: `Snoozed until ${until}`, tone: 'info' })
    },
    [commit, showToast, tagsOf],
  )

  /**
   * Keep watching — sets the check-back and creates NOTHING.
   *
   * This is the whole reason WATCH is a separate state. It is recorded as a
   * snooze to the review date so the card comes back on its own, and it never
   * touches the draft path.
   */
  const keepWatching = useCallback(
    (proposal: Proposal) => {
      const days = proposal.params.reviewInDays ?? 3
      snooze(proposal, days)
      showToast({
        message: `Watching — back in ${days} ${days === 1 ? 'day' : 'days'}. No draft created.`,
        tone: 'info',
      })
    },
    [snooze, showToast],
  )

  const togglePause = useCallback(() => {
    setMemory((current) => {
      if (!current) return current
      const next = { ...current, paused: !current.paused }
      saveMemory(next)
      return next
    })
  }, [])

  /* -- Ask Mike ------------------------------------------------------------ */

  const asksRemaining = useCallback(
    (proposalId: string) => (memory ? Math.max(0, MAX_ASK_EXCHANGES - askCount(memory, proposalId)) : 0),
    [memory],
  )

  const ask = useCallback(
    async (proposal: Proposal, question: string): Promise<AskOutput> => {
      if (!memory || !output || !source) {
        return { answer: 'Mike is still loading the account.', evidenceIds: [] }
      }

      setMemory((current) => {
        if (!current) return current
        const next = logAsk(current, {
          proposalId: proposal.id,
          proposalType: proposal.type,
          strengthTier: proposal.strength.tier,
          question,
          askedAt: new Date().toISOString(),
        })
        saveMemory(next)
        return next
      })

      try {
        const response = await fetch('/api/operator', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'ask',
            ask: {
              proposal,
              question,
              exchanges: [],
              metadata: source.metadata,
              relationship: output.relationship,
              mikesNotes: memory.mikesNotes,
              ranking: output.ranking,
            },
          }),
        })
        const data = await response.json()
        return (data?.output as AskOutput) ?? { answer: 'No answer came back.', evidenceIds: [] }
      } catch {
        return {
          answer: 'Could not reach Mike just then. The evidence rows are the whole of the read.',
          evidenceIds: [],
        }
      }
    },
    [memory, output, source],
  )

  /* -- catch-up ------------------------------------------------------------ */

  const runCatchup = useCallback(async () => {
    if (!memory || !output || !source || catchingUp) return
    setCatchingUp(true)
    try {
      const response = await fetch('/api/operator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'catchup',
          catchup: {
            awayDays,
            lastSeenAt: previousVisit.current ?? new Date().toISOString(),
            since: {
              spend: output.evaluated.reduce((s, e) => s + e.signals.totalSpend, 0),
              primaryResultsByType: output.evaluated.reduce<Record<string, number>>((acc, e) => {
                acc[e.signals.primaryResultType] =
                  (acc[e.signals.primaryResultType] ?? 0) + e.signals.totalPrimaryResults
                return acc
              }, {}),
              creativesChanged: output.recoveries.map((r) => ({
                creativeId: r.creativeId,
                name: r.creativeName,
                change: r.note,
              })),
              proposalsExpired: output.suppressed
                .filter((s) => s.reason.includes('cooldown') || s.reason.includes('dismissed'))
                .map((s) => s.proposal),
              proposalsSuperseded: [],
              newSignals: output.proposals,
            },
            metadata: source.metadata,
            mikesNotes: memory.mikesNotes,
            relationship: output.relationship,
          },
        }),
      })
      const data = await response.json()
      if (data?.output) {
        setCatchup(data.output as CatchupOutput)
        setMemory((current) => {
          if (!current) return current
          const next = recordOpening(
            { ...current, mikesNotes: data.output.sessionNote || current.mikesNotes },
            data.output.briefing ?? null,
          )
          saveMemory(next)
          return next
        })
      }
    } catch {
      setCatchup({
        briefing: 'Could not reach Mike for the catch-up. The board below is current either way.',
        evidenceIds: [],
        sessionNote: memory.mikesNotes,
      })
    } finally {
      setCatchingUp(false)
    }
  }, [awayDays, catchingUp, memory, output, source])

  /* -- derived ------------------------------------------------------------- */

  const openingState = useMemo<OpeningState>(() => {
    const remark = narration?.openingRemark ?? ''
    const history = [
      ...(output?.relationship.openHistory ?? []),
      ...(output?.relationship.editPatterns ?? []),
    ]
    // "Following up" is earned by actually referencing something they did, not
    // asserted because it is the second visit.
    const references = history.some((entry) => {
      const words = entry
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 4)
      return words.some((w) => remark.toLowerCase().includes(w))
    })
    if (references) return 'FOLLOWING UP'
    return narrationFresh ? 'JUST NOW' : 'THIS MORNING'
  }, [narration, narrationFresh, output])

  const mikesPickId = useMemo(() => {
    if (!narration?.leadProposalId || proposals.length === 0) return null
    return narration.leadProposalId !== proposals[0].id ? narration.leadProposalId : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration?.leadProposalId, boardKey])

  // Mike's lead leads. The maths ranked them; he decides what matters today.
  const ordered = useMemo(() => {
    const lead = narration?.leadProposalId
    if (!lead) return proposals
    const first = proposals.find((p) => p.id === lead)
    return first ? [first, ...proposals.filter((p) => p.id !== lead)] : proposals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration?.leadProposalId, boardKey])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const value = useMemo<OperatorContextValue>(
    () => ({
      ready: Boolean(output && memory),
      paused: memory?.paused ?? false,
      evaluationDate,
      metadata: source?.metadata ?? null,
      output,
      proposals: ordered,
      actionsRequired: ordered.length,
      narration,
      narrating,
      mikesPickId,
      cardFor,
      openingState,
      awayDays,
      needsCatchup,
      catchup,
      catchingUp,
      learned: memory ? learnedDefaults(memory) : [],
      debug,
      toast,
      dismissToast: () => setToast(null),
      approve,
      dismiss,
      snooze,
      keepWatching,
      togglePause,
      runCatchup,
      ask,
      asksRemaining,
    }),
    [
      approve,
      ask,
      asksRemaining,
      awayDays,
      cardFor,
      catchingUp,
      catchup,
      debug,
      dismiss,
      evaluationDate,
      keepWatching,
      memory,
      mikesPickId,
      narrating,
      narration,
      needsCatchup,
      openingState,
      ordered,
      output,
      runCatchup,
      snooze,
      source,
      toast,
      togglePause,
    ],
  )

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>
}
