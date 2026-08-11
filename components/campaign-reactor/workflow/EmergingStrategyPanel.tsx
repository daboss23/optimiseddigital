'use client'

import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Clock, Database, Layers, Sparkles, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INTELLIGENCE, type IntelligenceId } from '@/lib/agents'
import {
  ACTIVE_STATUSES,
  elapsedLabel,
  reportedAgents,
  type WorkflowState,
} from '@/lib/campaign-reactor/workflow'
import { useReactorRun } from '@/components/campaign-reactor/ReactorRunContext'
import { AGENT_VISUAL } from './visuals'
import { accentClass } from '@/components/reactor/ui'

const SENTINELS = ['no preference', 'agent decides', 'agent decided', '']

function pretty(value?: string): { text: string; pending: boolean } {
  const v = (value ?? '').trim()
  if (!v || SENTINELS.includes(v.toLowerCase())) return { text: 'OPUS deciding', pending: true }
  return { text: v, pending: false }
}

function ConfigRow({ icon, label, value }: { icon: ReactNode; label: string; value?: string }) {
  const { text, pending } = pretty(value)
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/40">
        {icon}
        {label}
      </span>
      <span className={cn('truncate text-right text-xs', pending ? 'italic text-white/35' : 'text-white/80')}>
        {text}
      </span>
    </div>
  )
}

/**
 * What is still happening after the run "finishes".
 *
 * The stream ends when OPUS submits; every still then renders client-side, 20-60s
 * apiece. Without this the panel announced a completed run next to empty concept
 * cards and the wait looked like a hang.
 */
function RenderProgress() {
  const { concepts, imageFor, videoFor, creativeStateFor } = useReactorRun()
  const visual = concepts.filter((c) => creativeStateFor(c) || imageFor(c) || videoFor(c) || c.productionBrief)
  if (!visual.length) return null

  const done = visual.filter((c) => {
    const v = videoFor(c)
    return Boolean(imageFor(c)) || v?.status === 'done'
  }).length
  if (done >= visual.length) return null

  return (
    <p className="col-span-3 border-t border-white/10 pt-2 text-[10px] leading-relaxed text-white/45">
      Rendering creatives · {done} of {visual.length} — stills render after the strategy run, 20-60s
      each. The ads land on the cards as they finish.
    </p>
  )
}

export function EmergingStrategyPanel({
  workflow,
  conceptCount,
}: {
  workflow: WorkflowState
  conceptCount: number
}) {
  const { config, opusPhase, finished, error, retrievals } = workflow
  const ready = opusPhase === 'ready'
  const reads = reportedAgents(workflow)

  const heading = error
    ? 'Reactor Fault'
    : ready
      ? 'Campaign Intelligence Ready'
      : opusPhase === 'idle' || opusPhase === 'initialising'
        ? 'Awaiting Intelligence'
        : 'Emerging Strategy'

  const uniqueAssets = Array.from(new Set(retrievals.map((r) => r.title).filter(Boolean)))

  return (
    <div className="reactor-panel glass p-4">
      <div className="mb-3 flex items-center gap-2 border-b border-white/5 pb-3">
        <Target size={15} className={cn('text-glow', !finished && opusPhase !== 'idle' && 'animate-pulse-glow')} />
        <h3 className="font-display text-[13px] font-bold uppercase tracking-[0.18em] text-white">{heading}</h3>
      </div>

      {/* Campaign direction — locked-in configuration (real run inputs) */}
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">
        Campaign Direction
      </p>
      <div className="divide-y divide-white/5 rounded-lg border border-white/5 bg-white/[0.015] px-3">
        <ConfigRow icon={<Target size={12} />} label="Angle" value={config.angle} />
        <ConfigRow icon={<Layers size={12} />} label="Audience" value={config.audience} />
        <ConfigRow icon={<Sparkles size={12} />} label="Awareness" value={config.awareness} />
        <ConfigRow icon={<Database size={12} />} label="Offer" value={config.offer} />
      </div>

      {/* Intelligence reads, assembled as each layer reports */}
      <div className="mt-3 space-y-2">
        <AnimatePresence initial={false}>
          {reads.map((id: IntelligenceId) => {
            const agent = workflow.agents[id]
            const def = INTELLIGENCE[id]
            const visual = AGENT_VISUAL[id]
            const working = ACTIVE_STATUSES.includes(agent.status)
            return (
              <motion.div
                key={id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                className={cn('intel-read', accentClass[visual.accent])}
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--acc))]" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--acc-hi))]">
                    {def.intelligenceLabel}
                  </span>
                </div>
                <p className="text-[12px] leading-snug text-white/70">
                  {working ? 'Analysing…' : agent.summary || 'Findings delivered.'}
                </p>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {reads.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/35">
            OPUS is bringing the intelligence network online. Findings will assemble here as each
            layer reports.
          </p>
        )}
      </div>

      {/* Proof assets actually consulted */}
      {uniqueAssets.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {uniqueAssets.length} asset{uniqueAssets.length === 1 ? '' : 's'} consulted
          </p>
          <div className="flex flex-wrap gap-1.5">
            {uniqueAssets.slice(0, 6).map((title) => (
              <span
                key={title}
                className="max-w-[12rem] truncate rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/55"
              >
                {title}
              </span>
            ))}
            {uniqueAssets.length > 6 && (
              <span className="rounded-full px-2 py-0.5 text-[10px] text-white/35">
                +{uniqueAssets.length - 6} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Run summary — every metric is measured, none fabricated */}
      {(ready || error) && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className={cn(
            'mt-3 grid grid-cols-3 gap-2 rounded-lg border p-3 text-center',
            error ? 'border-danger/30 bg-danger/[0.05]' : 'border-success/25 bg-success/[0.04]',
          )}
        >
          <div>
            <p className="font-display text-lg font-bold text-white">{conceptCount}</p>
            <p className="text-[9px] uppercase tracking-wider text-white/40">Concepts</p>
          </div>
          <div>
            <p className="font-display text-lg font-bold text-white">{uniqueAssets.length}</p>
            <p className="text-[9px] uppercase tracking-wider text-white/40">Sources</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-1 font-display text-lg font-bold text-white">
              <Clock size={12} className="text-white/40" />
              {elapsedLabel(workflow) ?? '—'}
            </p>
            {/* "Elapsed" read as "time until the ads exist", which it never
                was: stills render in the browser AFTER the stream closes, so a
                21s run could still be 3 minutes from a finished creative. */}
            <p className="text-[9px] uppercase tracking-wider text-white/40">Strategy run</p>
          </div>
          <RenderProgress />
        </motion.div>
      )}
    </div>
  )
}
