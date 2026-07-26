'use client'

import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { accentClass } from '@/components/reactor/ui'
import { INTELLIGENCE, type IntelligenceId } from '@/lib/agents'
import {
  ACTIVE_STATUSES,
  AGENT_STATUS_LABEL,
  type AgentRuntime,
} from '@/lib/campaign-reactor/workflow'
import { AGENT_VISUAL } from './visuals'

/** Human-readable "current action" for an active layer — no fabricated detail. */
function actionLine(agent: AgentRuntime): string {
  switch (agent.status) {
    case 'retrieving':
      return agent.question ? `Retrieving: ${agent.question}` : 'Retrieving intelligence…'
    case 'analysing':
      return agent.question ? `Analysing: ${agent.question}` : 'Analysing retrieved evidence…'
    case 'reporting':
      return 'Reporting findings to OPUS…'
    case 'complete':
      return agent.summary || 'Findings delivered.'
    case 'error':
      return 'Intelligence unavailable — continuing with available evidence.'
    case 'notRequired':
      return 'Not consulted for this campaign.'
    case 'queued':
      return 'Queued for consultation…'
    default:
      return 'Awaiting delegation.'
  }
}

function StatusBadge({ status }: { status: AgentRuntime['status'] }) {
  const active = ACTIVE_STATUSES.includes(status)
  const tone =
    status === 'complete'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'error'
        ? 'border-danger/40 bg-danger/10 text-danger'
        : active
          ? 'intel-badge--active'
          : 'border-white/10 bg-white/5 text-white/40'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        tone,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'complete'
            ? 'bg-success'
            : status === 'error'
              ? 'bg-danger'
              : active
                ? 'bg-[rgb(var(--acc))] intel-dot-live'
                : 'bg-white/30',
        )}
      />
      {AGENT_STATUS_LABEL[status]}
    </span>
  )
}

export function AgentIntelligenceCard({
  id,
  agent,
  reduced,
  cardRef,
}: {
  id: IntelligenceId
  agent: AgentRuntime
  reduced: boolean
  cardRef?: (el: HTMLDivElement | null) => void
}) {
  const def = INTELLIGENCE[id]
  const visual = AGENT_VISUAL[id]
  const Icon = visual.icon
  const active = ACTIVE_STATUSES.includes(agent.status)
  const complete = agent.status === 'complete'
  const dim = agent.status === 'dormant' || agent.status === 'notRequired' || agent.status === 'queued'
  const findingCount = agent.findings.length
  const topFinding = agent.findings[0]
  // The preview surfaces the top retrieved SOURCE beneath the layer's report.
  // It used to fall back to the summary when a layer had no findings — but the
  // summary is already the action line above, so the card printed the same
  // sentence twice (once in full, once truncated). With no source to show,
  // the report alone is the honest card.
  const previewTitle = topFinding?.title
  const previewLabel = topFinding?.system

  return (
    <div
      ref={cardRef}
      data-state={active ? 'active' : complete ? 'complete' : agent.status === 'error' ? 'error' : 'idle'}
      className={cn('intel-card', accentClass[visual.accent], dim && 'intel-card--dim')}
    >
      {/* Holographic projection layers — HUD frame, scanline texture, sweep */}
      <span aria-hidden className="holo-frame" />
      <span aria-hidden className="holo-scanlines" />
      <span aria-hidden className="holo-rail" />
      {active && !reduced && <span aria-hidden className="holo-sweep" />}
      {active && !reduced && <span aria-hidden className="intel-scan" />}
      {active && !reduced && <span aria-hidden className="intel-emitter" />}

      <div className="relative flex items-start gap-3">
        <span className="intel-icon">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-bold tracking-tight text-white">
                {def.codename}
              </p>
              <p className="truncate text-[11px] font-medium uppercase tracking-wider text-white/45">
                {def.role}
              </p>
            </div>
            <StatusBadge status={agent.status} />
          </div>
        </div>
      </div>

      <p
        className={cn(
          'relative mt-2.5 line-clamp-3 text-[12.5px] leading-snug',
          active ? 'text-[rgb(var(--acc-hi))]' : complete ? 'text-white/70' : 'text-white/40',
        )}
      >
        {actionLine(agent)}
      </p>

      {(previewTitle || findingCount > 0 || agent.confidence) && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative mt-2.5 border-t border-white/5 pt-2"
        >
          {previewTitle && !active && (
            <div className="mb-2">
              {previewLabel && (
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--acc-hi))]/80">
                  {previewLabel}
                </p>
              )}
              <p className="line-clamp-2 text-[12.5px] leading-snug text-white/75">{previewTitle}</p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-[11px] text-white/40">
            {findingCount > 0 ? (
              <span className="font-mono text-[rgb(var(--acc-hi))]">
                {findingCount} source{findingCount === 1 ? '' : 's'} analysed
              </span>
            ) : (
              <span />
            )}
            {agent.confidence && (
              <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {agent.confidence}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </div>
  )
}
