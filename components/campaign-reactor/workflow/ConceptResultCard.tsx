'use client'

import { useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  Copy as CopyIcon,
  Download,
  Film,
  Hexagon,
  ImageIcon,
  Loader2,
  Rocket,
  Users,
  Wand2,
  Workflow,
} from 'lucide-react'
import { Pill } from '@/components/reactor/ui'
import { validateAdPackage, type AdComplianceIssue } from '@/lib/meta-ads'
import { modelDisplayName } from '@/lib/model-menu'
import { NEURO_AXES, NEURO_PASS_MARK, type NeuroScore } from '@/lib/reactor-inputs'
import type {
  Concept,
  CreativeState,
  MediaMeta,
  VideoUiState,
} from '@/components/campaign-reactor/ReactorRunContext'

// Non-destructive provider/model chip overlaid on a generated still or clip.
// The asset pixels are never touched, so the downloadable creative stays clean.
function ProviderChip({ model }: { model?: string; provider?: string }) {
  // The gateway a render was routed through is plumbing — the builder sees the
  // MODEL that made the image, and nothing else.
  const name = modelDisplayName(model)
  if (!name) return null
  return (
    <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
      <Hexagon size={9} className="text-glow" />
      <span>{name}</span>
    </span>
  )
}

// One axis of the NEURO predicted-response pre-test, drawn as a 10-segment bar
// (pure Tailwind — no inline widths). Colour bands the score: emerald = strong,
// glow = solid, warning = below the pass mark.
function NeuroBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 8 ? 'bg-success' : value >= NEURO_PASS_MARK ? 'bg-glow' : 'bg-warning'
  return (
    <div className="flex items-center gap-2">
      <span className="w-[4.5rem] shrink-0 text-[10px] uppercase tracking-wide text-white/45">{label}</span>
      <div className="flex flex-1 gap-0.5" aria-hidden>
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < value ? tone : 'bg-white/10'}`} />
        ))}
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] font-medium text-white/70">{value}</span>
    </div>
  )
}

// Meta ad-unit compliance. Errors block launch (Meta truncates the copy, or a
// banned phrase is present); warnings are cosmetic. The orchestrator normally
// revises failures before they ship, but a time-constrained run skips that pass
// — so the card states plainly what is wrong rather than letting a broken unit
// look launch-ready.
function CompliancePanel({ issues }: { issues: AdComplianceIssue[] }) {
  if (issues.length === 0) return null
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const blocking = errors.length > 0
  return (
    <div
      className={`mt-3 rounded-lg border p-2.5 ${
        blocking ? 'border-danger/30 bg-danger/[0.06]' : 'border-warning/30 bg-warning/[0.06]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={12} className={blocking ? 'text-danger' : 'text-warning'} />
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider ${
            blocking ? 'text-danger' : 'text-warning'
          }`}
        >
          {blocking
            ? `Not launch-ready · ${errors.length} issue${errors.length === 1 ? '' : 's'}`
            : `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {[...errors, ...warnings].map((issue, i) => (
          <li key={`${issue.field}-${i}`} className="flex gap-1.5 text-[11px] leading-relaxed text-white/70">
            <span className="text-white/30">·</span>
            <span>
              <span className="uppercase tracking-wide text-white/40">{issue.field}</span>{' '}
              {issue.message}
            </span>
          </li>
        ))}
      </ul>
      {blocking && (
        <p className="mt-1.5 text-[10px] text-white/40">
          Fix in Studio before pushing — Meta will cut or reject this as written.
        </p>
      )}
    </div>
  )
}

// The NEURO predicted-response pre-test block. A TRIBE-inspired estimate of how
// the brain is likely to react to the concept — clearly labelled as a prediction,
// never measured brain data.
function NeuroPanel({ neuro }: { neuro: NeuroScore }) {
  return (
    <div className="mt-2.5 rounded-lg border border-glow/15 bg-glow/[0.04] p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-glow/80">
          <Activity size={11} /> Predicted Response
        </span>
        <Pill tone={neuro.overall >= 8 ? 'success' : neuro.overall >= NEURO_PASS_MARK ? 'primary' : 'warning'}>
          {neuro.overall}/10
        </Pill>
      </div>
      <div className="space-y-1">
        {NEURO_AXES.map(({ key, label }) => (
          <NeuroBar key={key} label={label} value={neuro[key]} />
        ))}
      </div>
      {neuro.reason && (
        <p className="mt-2 text-[11px] text-white/55">
          {neuro.reason}
          {neuro.principle && <span className="text-white/30"> · {neuro.principle}</span>}
        </p>
      )}
      <p className="mt-1 text-[10px] italic text-white/30">
        Estimate from neuromarketing principles — a prediction, not measured brain data.
      </p>
    </div>
  )
}

/**
 * A single generated concept — the finished creative first, then the concept
 * line and the collapsed strategy detail. The ad copy itself is edited in the
 * Studio ("Configure in Studio"), and outcomes are graded by the live Meta
 * performance ingest once the ad has actually run — so neither an ad-unit
 * readout nor a manual outcome logger lives on the card.
 */
export function ConceptResultCard({
  concept: c,
  index: i,
  image,
  imageMeta,
  video,
  creativeState,
  wantsVideo,
  hasRefs,
  faceCount,
  refVideoCount,
  copied,
  onCopy,
  onAnimate,
  onGenerateUGC,
  onConfigureInStudio,
  onLaunchCanvas,
  onPushToMeta,
}: {
  concept: Concept
  index: number
  image?: string
  imageMeta?: MediaMeta
  video?: VideoUiState
  creativeState?: CreativeState
  wantsVideo: boolean
  hasRefs: boolean
  faceCount: number
  refVideoCount: number
  copied: boolean
  onCopy: () => void
  onAnimate: (image: string) => void
  onGenerateUGC: () => void
  onConfigureInStudio: () => void
  onLaunchCanvas: () => void
  onPushToMeta: () => Promise<{ ok: boolean; message: string }>
}) {
  const creativeBusy = creativeState?.status === 'working' || video?.status === 'rendering'
  const hasCreative = Boolean(image || (video?.status === 'done' && video.url))
  // Validated client-side on every render, so an ad unit that skipped the
  // orchestrator's revision pass still cannot present itself as launch-ready.
  const complianceIssues = validateAdPackage(c.adPackage)
  const blocksLaunch = complianceIssues.some((i) => i.severity === 'error')
  const [push, setPush] = useState<{ status: 'idle' | 'pushing' | 'done' | 'error'; message?: string }>({
    status: 'idle',
  })

  const handlePush = async () => {
    setPush({ status: 'pushing' })
    const res = await onPushToMeta()
    setPush({ status: res.ok ? 'done' : 'error', message: res.message })
  }

  return (
    <div
      className={`glass-hover animate-fade-up stagger-${(i % 8) + 1} rounded-xl border border-border bg-surface/40 p-3 sm:p-4`}
    >
      {/* Up to four actions sit beside the type/score pills. On a narrow
          screen they wrap to their own line instead of squeezing the pills or
          pushing the card into horizontal scroll. */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-2">
          <Pill tone="primary">{c.type}</Pill>
          {typeof c.score === 'number' && (
            <Pill tone={c.score >= 8 ? 'success' : 'warning'}>{c.score}/10</Pill>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {wantsVideo && hasRefs && (
            <button
              type="button"
              onClick={onGenerateUGC}
              disabled={creativeBusy}
              className="flex items-center gap-1 text-[11px] text-white/40 hover:text-cyan disabled:opacity-60"
              title={`Generate with ${faceCount} reference image${faceCount === 1 ? '' : 's'}${refVideoCount ? ` + ${refVideoCount} video${refVideoCount === 1 ? '' : 's'}` : ''} (Seedance 2.0 reference-to-video)`}
            >
              <Users size={12} />
              Generate UGC
            </button>
          )}
          {image && (
            <a
              href={`/api/image/download?url=${encodeURIComponent(image)}&name=${encodeURIComponent(
                `tpb-${c.type}`,
              )}`}
              download
              className="flex items-center gap-1 text-[11px] text-white/40 hover:text-glow"
              title="Download the finished creative as a PNG"
            >
              <Download size={12} />
              Download
            </a>
          )}
          {image && !video && (
            <button
              type="button"
              onClick={() => onAnimate(image)}
              className="flex items-center gap-1 text-[11px] text-white/40 hover:text-cyan"
            >
              <Film size={12} />
              Animate
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 text-[11px] text-white/40 hover:text-glow"
          >
            {copied ? <Check size={12} /> : <CopyIcon size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* The ad creative is the hero — the system renders it automatically once
          the run lands, so the finished ad is the first thing on the card. */}
      {image && (
        <div className="group/creative relative mt-2">
          <ProviderChip model={imageMeta?.model} provider={imageMeta?.provider} />
          {/* The ad itself is the shortcut: clicking the creative opens it in
              the Studio with this exact render already loaded as the ad image. */}
          <button
            type="button"
            onClick={onConfigureInStudio}
            title="Open this creative in the Studio"
            className="block w-full overflow-hidden rounded-lg border border-border transition-colors hover:border-glow/50 focus:outline-none focus-visible:border-glow"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={c.type} className="w-full" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/85 to-transparent px-3 pb-3 pt-8 text-[12px] font-semibold text-white opacity-0 transition-opacity group-hover/creative:opacity-100">
              <Wand2 size={12} /> Open in Studio
            </span>
          </button>
        </div>
      )}
      {/* A render that did not run on the model it was meant to — or ran on one
          that cannot set legible copy — says so. A silent downgrade is exactly
          how an ad ships with a misspelled headline. */}
      {image && imageMeta?.note && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/[0.06] p-2 text-[11px] text-warning">
          {imageMeta.note}
        </p>
      )}
      {video?.status === 'done' && video.url && (
        <div className="relative mt-2">
          <ProviderChip model={video.model} provider={video.provider} />
          <video src={video.url} controls playsInline className="w-full rounded-lg border border-border" />
        </div>
      )}
      {(creativeState?.status === 'working' || video?.status === 'rendering') && !image && (
        <div className="mt-2 grid aspect-video w-full place-items-center rounded-lg border border-border bg-background/40">
          <span className="flex items-center gap-2 text-xs text-cyan">
            <Loader2 size={14} className="animate-spin" />
            {video?.status === 'rendering' ? 'Rendering video creative…' : 'Rendering creative…'}
          </span>
        </div>
      )}
      {image && video?.status === 'rendering' && (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-cyan">
          <Loader2 size={12} className="animate-spin" /> Animating the still into a video…
        </p>
      )}
      {video?.status === 'error' && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/[0.06] p-2 text-[11px] text-warning">
          {video.message || 'Video render failed — check FAL_KEY / HF_CREDENTIALS or try again.'}
        </p>
      )}
      {creativeState?.status === 'error' && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/[0.06] p-2 text-[11px] text-warning">
          {creativeState.message}
        </p>
      )}
      {!hasCreative && !creativeBusy && !creativeState && !video && (
        <div className="mt-2 grid aspect-video w-full place-items-center rounded-lg border border-border bg-background/40">
          <span className="flex items-center gap-2 text-xs text-white/35">
            {wantsVideo ? <Film size={14} /> : <ImageIcon size={14} />}
            Creative renders automatically when an image/video provider is configured.
          </span>
        </div>
      )}

      {/* Advance the creative down the production line: shape it in the Canvas,
          finish it in the Studio, or push the ready ad unit straight to Meta. */}
      {(hasCreative || c.adPackage) && (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={onConfigureInStudio}
            className="fire-btn fire-btn--sm inline-flex w-full items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.14em] text-white"
          >
            <Wand2 size={14} /> Configure in Studio
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onLaunchCanvas}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 transition-colors hover:border-cyan/40 hover:text-cyan"
            >
              <Workflow size={13} /> Creative Canvas
            </button>
            <button
              type="button"
              onClick={handlePush}
              disabled={
                !c.adPackage || blocksLaunch || push.status === 'pushing' || push.status === 'done'
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:hover:border-white/12 disabled:hover:text-white/70"
              title={
                !c.adPackage
                  ? 'No ad package on this concept'
                  : blocksLaunch
                    ? 'This ad unit is not launch-ready — fix the compliance issues in Studio first'
                    : 'Push this ad unit to your Meta creative library'
              }
            >
              {push.status === 'pushing' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : push.status === 'done' ? (
                <Check size={13} />
              ) : (
                <Rocket size={13} />
              )}
              {push.status === 'done' ? 'Pushed' : 'Push to Meta'}
            </button>
          </div>
          {push.status !== 'idle' && push.status !== 'pushing' && push.message && (
            <p
              className={`rounded-lg border p-2 text-[11px] ${
                push.status === 'done'
                  ? 'border-success/30 bg-success/[0.06] text-success'
                  : 'border-warning/30 bg-warning/[0.06] text-warning'
              }`}
            >
              {push.message}
            </p>
          )}
          <p className="text-center text-[10px] text-white/30">
            Push skips the Studio pre-test — finish in Studio first for a NEURO check before spend.
          </p>
        </div>
      )}

      <CompliancePanel issues={complianceIssues} />

      <p className="mt-3 text-[12px] leading-relaxed text-white/55">{c.text}</p>

      {/* The strategy behind the ad — collapsed so the creative stays the hero. */}
      {(c.productionBrief?.frames?.length || c.neuro || c.basis || c.learningCheck) && (
        <details className="group mt-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02]">
          <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/45 transition-colors hover:text-white/70 [&::-webkit-details-marker]:hidden">
            <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
            Why this will convert — strategy, pre-test &amp; grounding
          </summary>
          <div className="space-y-2.5 px-2.5 pb-2.5">
            {c.productionBrief && c.productionBrief.frames?.length > 0 && (
              <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-glow/80">
                  <Film size={11} /> Production Brief
                  {c.productionBrief.pattern && (
                    <span className="font-normal text-white/30">· {c.productionBrief.pattern}</span>
                  )}
                </div>
                <ol className="space-y-1">
                  {c.productionBrief.frames.map((f, fi) => (
                    <li key={fi} className="flex gap-2 text-[11px] text-white/60">
                      <span className="shrink-0 font-mono text-glow/60">{f.label}</span>
                      <span>{f.description}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {(c.basis || c.learningCheck) && (
              <div className="space-y-1 text-[11px] text-white/40">
                {c.basis && (
                  <p>
                    <span className="text-glow/70">Grounded in:</span> {c.basis}
                  </p>
                )}
                {c.learningCheck && (
                  <p>
                    <span className="text-success/70">Rubric:</span> {c.learningCheck}
                  </p>
                )}
              </div>
            )}

            {c.neuro && <NeuroPanel neuro={c.neuro} />}
          </div>
        </details>
      )}
    </div>
  )
}
