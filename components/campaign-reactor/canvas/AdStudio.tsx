'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  Atom,
  Check,
  CircleDashed,
  Download,
  Film,
  Hexagon,
  ImageIcon,
  Loader2,
  ScanText,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pill } from '@/components/reactor/ui'
import { NEURO_AXES, NEURO_PASS_MARK, type NeuroScore } from '@/lib/reactor-inputs'
import { modelDisplayName } from '@/lib/model-menu'
import { placementFor, validateCreativeCopy, type Placement } from '@/lib/meta-ads'
import { VARIATION_METHOD_LABEL } from '@/lib/variations'
import { useReactorRun, type Concept } from '@/components/campaign-reactor/ReactorRunContext'

/* -------------------------------------------------------------------------- */
/*  The Launch Bay                                                            */
/*                                                                            */
/*  Where a finished creative is checked and sent to Meta. It replaced the Ad */
/*  Studio's caption editor and mock Facebook feed: the platform makes the    */
/*  creative, not the caption, so this surface is about the PIXELS — which    */
/*  placement they fit, whether the words on them are spelled the way they    */
/*  were written, whether the product reads at thumb size — and about getting */
/*  them into the brand's own ad account, one at a time or a whole run.       */
/* -------------------------------------------------------------------------- */

/**
 * Concepts that can supply a creative (a still or a clip).
 *
 * Type is only the first test. A concept CARRYING a render — reopened from the
 * ledger, or already rendered by the run — is a creative whatever it happens
 * to be called, so the creative the user clicked is always the one that opens.
 */
const isVisualType = (c: Concept) => c.type.includes('Concept')
const carriesMedia = (c: Concept) => Boolean(c.imageUrl || c.videoUrl)
const isVisual = (c: Concept) => isVisualType(c) || carriesMedia(c)

/** What the pre-test route returns. `qc` is present only when the pixels were read. */
interface PretestResult {
  neuro: NeuroScore
  basis: 'creative' | 'plan'
  demo?: boolean
  qc?: {
    readText: string
    textMatches: boolean | null
    missingText: string[]
    productVisible: boolean
    note: string
  }
}

interface Destination {
  configured: boolean
  adAccountId?: string
  reason?: string
}

/* ------------------------------ Small pieces ------------------------------ */

function PretestBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 8 ? 'bg-success' : value >= NEURO_PASS_MARK ? 'bg-glow' : 'bg-warning'
  return (
    <div className="flex items-center gap-2">
      <span className="w-[5rem] shrink-0 text-[10px] uppercase tracking-wide text-white/45">{label}</span>
      <div className="flex flex-1 gap-0.5" aria-hidden>
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < value ? tone : 'bg-white/10'}`} />
        ))}
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] font-medium text-white/70">{value}</span>
    </div>
  )
}

/** One pass/fail line of the media-buyer read. */
function CheckRow({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 text-[11.5px]">
      <span
        className={cn(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
          ok === null ? 'bg-white/10 text-white/40' : ok ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger',
        )}
      >
        {ok === null ? <CircleDashed size={10} /> : ok ? <Check size={10} /> : <X size={10} />}
      </span>
      <span className="min-w-0">
        <span className="font-semibold text-white/80">{label}</span>
        {detail && <span className="block text-white/50">{detail}</span>}
      </span>
    </li>
  )
}

function PretestPanel({ result }: { result: PretestResult }) {
  const { neuro, qc } = result
  return (
    <div className="space-y-3 rounded-xl border border-glow/15 bg-glow/[0.04] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-glow/80">
          <Activity size={11} /> Predicted Response{result.demo ? ' (demo)' : ''}
        </span>
        <Pill tone={neuro.overall >= 8 ? 'success' : neuro.overall >= NEURO_PASS_MARK ? 'primary' : 'warning'}>
          {neuro.overall}/10
        </Pill>
      </div>
      <div className="space-y-1">
        {NEURO_AXES.map(({ key, label }) => (
          <PretestBar key={key} label={label} value={neuro[key]} />
        ))}
      </div>
      {neuro.reason && <p className="text-[11px] text-white/55">{neuro.reason}</p>}

      {qc ? (
        <ul className="space-y-2 border-t border-white/[0.07] pt-3">
          <CheckRow
            ok={qc.textMatches}
            label={
              qc.textMatches === null
                ? 'No on-image words to check'
                : qc.textMatches
                  ? 'Every word on the creative is spelled as written'
                  : 'The words on the creative do not match the brief'
            }
            detail={
              qc.textMatches === false
                ? `Missing or misspelled: “${qc.missingText.join('”, “')}”. Read off the pixels: “${
                    qc.readText || 'no legible text'
                  }”. Regenerate before uploading.`
                : undefined
            }
          />
          <CheckRow
            ok={qc.productVisible}
            label={qc.productVisible ? 'The product reads at thumb size' : 'The product does not read at thumb size'}
          />
          <li className="text-[11px] text-white/55">{qc.note}</li>
        </ul>
      ) : (
        <p className="text-[10px] text-white/40">
          {result.basis === 'plan'
            ? 'Scored the plan, not the pixels — the render was not available to read.'
            : null}
        </p>
      )}
      <p className="text-[10px] italic text-white/30">
        Estimate from neuromarketing principles — a prediction, not measured brain data.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function AdStudio({
  seed,
  onConfigure,
}: {
  seed?: Concept | null
  onConfigure: () => void
}) {
  const {
    concepts,
    generateCreative,
    imageFor,
    imageMetaFor,
    videoFor,
    creativeStateFor,
    uploadFor,
    uploadToMeta,
  } = useReactorRun()

  // The creative the user arrived from belongs here even when the run that
  // made it is gone (reopened from the ledger after a refresh). Seed first,
  // then the run — deduped by text, so the clicked creative leads the rail.
  const sourceConcepts = useMemo(() => {
    const all = seed ? [seed, ...concepts] : concepts
    const seen = new Set<string>()
    return all.filter((c) => (seen.has(c.text) ? false : (seen.add(c.text), true)))
  }, [seed, concepts])
  const visualConcepts = useMemo(() => sourceConcepts.filter(isVisual), [sourceConcepts])

  /* ------------------------------ Selection ------------------------------- */
  const [selected, setSelected] = useState<Concept | null>(null)
  const seedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    // Re-select only when the SOURCE changes, so browsing the rail is never
    // undone by a render landing elsewhere in the run.
    const key = seed ? `seed:${seed.text}` : visualConcepts[0] ? `auto:${visualConcepts[0].text}` : null
    if (!key || seedKeyRef.current === key) return
    seedKeyRef.current = key
    setSelected(
      seed && isVisual(seed)
        ? seed
        : (visualConcepts.find((c) => imageFor(c) || videoFor(c)) ?? visualConcepts[0] ?? null),
    )
    // visualConcepts derives from the run — the inputs below cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, concepts])

  /* --------------------------- Live media for it -------------------------- */
  const image = selected ? imageFor(selected) : undefined
  const imageMeta = selected ? imageMetaFor(selected) : undefined
  const video = selected ? videoFor(selected) : undefined
  const videoUrl = video?.status === 'done' ? video.url : undefined
  const creativeState = selected ? creativeStateFor(selected) : undefined
  const rendering = creativeState?.status === 'working' || video?.status === 'rendering'
  const hasCreative = Boolean(image || videoUrl)
  const upload = selected ? uploadFor(selected) : undefined

  // The placement is read off the PIXELS, not the label: the render may have
  // landed on a model that snapped the ratio.
  const [placement, setPlacement] = useState<Placement | null>(null)
  useEffect(() => setPlacement(null), [image, videoUrl])

  const issues = useMemo(() => (selected ? validateCreativeCopy(selected) : []), [selected])
  const blocking = issues.filter((i) => i.severity === 'error')

  /* ------------------------------ Pre-test -------------------------------- */
  const [pretest, setPretest] = useState<{ status: 'idle' | 'testing' | 'done'; result?: PretestResult }>({
    status: 'idle',
  })
  // A different creative (or a re-render of this one) is a different read.
  useEffect(() => setPretest({ status: 'idle' }), [selected, image, videoUrl])

  const runPretest = useCallback(async () => {
    if (!selected) return
    setPretest({ status: 'testing' })
    try {
      const res = await fetch('/api/studio/pretest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // A clip is read by its plan: there is no single frame to judge.
          imageUrl: videoUrl ? undefined : image,
          conceptType: selected.type,
          conceptText: selected.text,
          onImageText: (selected.productionBrief?.onImageText ?? [])
            .map((t) => t?.text?.trim())
            .filter(Boolean),
        }),
      }).then((r) => r.json())
      if (res.ok && res.neuro) {
        setPretest({
          status: 'done',
          result: { neuro: res.neuro, basis: res.basis ?? 'plan', demo: res.demo, qc: res.qc },
        })
      } else {
        setPretest({ status: 'idle' })
      }
    } catch {
      setPretest({ status: 'idle' })
    }
  }, [selected, image, videoUrl])

  /* ------------------------------ Destination ----------------------------- */
  const [destination, setDestination] = useState<Destination | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/meta/publish')
      .then((r) => r.json())
      .then((d: Destination) => live && setDestination(d))
      .catch(() => live && setDestination({ configured: false, reason: 'Could not check the Meta connection.' }))
    return () => {
      live = false
    }
  }, [])

  /* -------------------------------- Upload -------------------------------- */
  const uploadable = useMemo(
    () =>
      visualConcepts.filter((c) => {
        const v = videoFor(c)
        const hasMedia = Boolean(imageFor(c) || (v?.status === 'done' && v.url))
        const done = uploadFor(c)?.status === 'done'
        return hasMedia && !done && !validateCreativeCopy(c).some((i) => i.severity === 'error')
      }),
    [visualConcepts, imageFor, videoFor, uploadFor],
  )
  const [bulk, setBulk] = useState<{ status: 'idle' | 'uploading' | 'done'; message?: string; ok?: boolean }>({
    status: 'idle',
  })

  const uploadAll = useCallback(async () => {
    setBulk({ status: 'uploading' })
    const summary = await uploadToMeta(uploadable)
    setBulk({
      status: 'done',
      ok: summary.failed === 0 && summary.uploaded > 0,
      message:
        summary.message ??
        `${summary.uploaded} creative${summary.uploaded === 1 ? '' : 's'} uploaded to your Meta media library${
          summary.failed ? ` · ${summary.failed} failed — see each creative for why` : ''
        }.`,
    })
  }, [uploadToMeta, uploadable])

  const uploadOne = useCallback(() => {
    if (selected) void uploadToMeta([selected])
  }, [selected, uploadToMeta])

  /* --------------------------------- Empty -------------------------------- */
  if (visualConcepts.length === 0) {
    return (
      <div className="reactor-panel glass grid min-h-[460px] place-items-center p-8 text-center">
        <div className="max-w-sm">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.03]">
            <Sparkles size={26} className="text-glow/60" />
          </span>
          <h3 className="font-display text-base font-semibold text-white">The Launch Bay is empty</h3>
          <p className="mx-auto mt-1.5 text-sm text-white/45">
            Fire the reactor first — it plans every creative and renders it automatically. Finished
            creatives land here to be checked and uploaded to your Meta ad account.
          </p>
          <button
            type="button"
            onClick={onConfigure}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-glow/30 bg-glow/10 px-5 py-2.5 text-sm font-semibold text-glow transition-colors hover:bg-glow/20"
          >
            <Atom size={14} /> Open the campaign brief
          </button>
        </div>
      </div>
    )
  }

  const status = !selected
    ? { label: 'Pick a creative', tone: 'idle' as const }
    : upload?.status === 'done'
      ? { label: 'In Meta', tone: 'good' as const }
      : blocking.length
        ? { label: 'Needs attention', tone: 'warn' as const }
        : hasCreative
          ? { label: 'Ready to upload', tone: 'good' as const }
          : rendering
            ? { label: 'Rendering', tone: 'idle' as const }
            : { label: 'Not rendered yet', tone: 'idle' as const }

  return (
    <div className="reactor-panel glass overflow-hidden p-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-glow/70">Launch Bay</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
              status.tone === 'good'
                ? 'border-success/30 bg-success/10 text-success'
                : status.tone === 'warn'
                  ? 'border-warning/30 bg-warning/[0.08] text-warning'
                  : 'border-white/12 bg-white/[0.03] text-white/55',
            )}
          >
            {status.tone === 'good' ? (
              <Check size={11} />
            ) : status.tone === 'warn' ? (
              <AlertTriangle size={11} />
            ) : (
              <CircleDashed size={11} />
            )}
            {status.label}
          </span>
        </div>
        <button
          type="button"
          onClick={uploadAll}
          disabled={!destination?.configured || uploadable.length === 0 || bulk.status === 'uploading'}
          title={
            !destination?.configured
              ? destination?.reason || 'Connect Meta first'
              : uploadable.length === 0
                ? 'Every finished creative here is already in Meta, still rendering, or carries a rejected claim'
                : `Upload ${uploadable.length} finished creative${uploadable.length === 1 ? '' : 's'} to your Meta media library`
          }
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-glow/30 bg-glow/10 px-3 py-1.5 text-[11px] font-semibold text-glow transition-colors hover:bg-glow/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {bulk.status === 'uploading' ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          {bulk.status === 'uploading'
            ? 'Uploading…'
            : `Upload all to Meta${uploadable.length ? ` (${uploadable.length})` : ''}`}
        </button>
      </div>
      {bulk.status === 'done' && bulk.message && (
        <p
          className={cn(
            'border-b px-4 py-2 text-[11px]',
            bulk.ok ? 'border-success/20 bg-success/[0.06] text-success' : 'border-warning/20 bg-warning/[0.06] text-warning',
          )}
        >
          {bulk.message}
        </p>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* ------------------------------- Stage ------------------------------ */}
        <section className="space-y-4 border-b border-border p-5 lg:border-b-0 lg:border-r">
          <div className="relative mx-auto max-w-[520px] overflow-hidden rounded-xl border border-white/10 bg-black/40">
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={(e) =>
                  setPlacement(placementFor(e.currentTarget.videoWidth, e.currentTarget.videoHeight))
                }
                className="max-h-[560px] w-full bg-black object-contain"
              />
            ) : image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={selected?.type ?? 'Creative'}
                onLoad={(e) =>
                  setPlacement(placementFor(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))
                }
                className="w-full object-contain"
              />
            ) : (
              <div className="grid aspect-square w-full place-items-center">
                {rendering ? (
                  <span className="flex items-center gap-2 text-[13px] text-cyan">
                    <Loader2 size={16} className="animate-spin" /> Rendering creative…
                  </span>
                ) : (
                  <span className="flex flex-col items-center gap-3 px-6 text-center text-white/40">
                    <ImageIcon size={26} />
                    <span className="text-[12px]">This creative has not rendered yet.</span>
                    {selected && (
                      <button
                        type="button"
                        onClick={() => generateCreative(selected, {})}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-glow/30 bg-glow/10 px-3 py-1.5 text-[11px] font-semibold text-glow transition-colors hover:bg-glow/20"
                      >
                        <ImageIcon size={12} /> Generate this creative
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}
            {(imageMeta?.model || video?.model) && hasCreative && (
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
                <Hexagon size={9} className="text-glow" />
                {modelDisplayName(videoUrl ? video?.model : imageMeta?.model)}
              </span>
            )}
          </div>

          {/* What the pixels fit, and what to do with them */}
          {hasCreative && (
            <div className="mx-auto flex max-w-[520px] flex-wrap items-center justify-between gap-2">
              {placement ? (
                <span className="text-[11px] text-white/55">
                  <span className="font-semibold text-white/80">
                    {placement.ratio} · {placement.label}
                  </span>{' '}
                  — {placement.where}
                </span>
              ) : (
                <span className="text-[11px] text-white/35">Reading the size…</span>
              )}
              {image && !videoUrl ? (
                <a
                  href={`/api/image/download?url=${encodeURIComponent(image)}&name=${encodeURIComponent(
                    `optimised-${selected?.type ?? 'creative'}`,
                  )}`}
                  download
                  className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-glow"
                >
                  <Download size={12} /> Download
                </a>
              ) : videoUrl ? (
                <a
                  href={videoUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-glow"
                >
                  <Download size={12} /> Download
                </a>
              ) : null}
            </div>
          )}
          {imageMeta?.note && image && (
            <p className="mx-auto max-w-[520px] rounded-lg border border-warning/30 bg-warning/[0.06] p-2 text-[11px] text-warning">
              {imageMeta.note}
            </p>
          )}

          {/* The run's creatives — every one can be checked and sent from here */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/60">
              This run · {visualConcepts.length} creative{visualConcepts.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-2">
              {visualConcepts.map((c, i) => {
                const img = imageFor(c)
                const vid = videoFor(c)
                const up = uploadFor(c)
                const active = selected?.text === c.text
                return (
                  <button
                    key={`${c.type}-${i}`}
                    type="button"
                    onClick={() => setSelected(c)}
                    title={c.variationLabel ? `${c.type} · ${c.variationLabel}` : c.type}
                    aria-pressed={active}
                    className={cn(
                      'relative h-16 w-16 overflow-hidden rounded-lg border transition-all',
                      active ? 'border-glow/60 ring-2 ring-glow/35' : 'border-white/12 hover:border-white/30',
                    )}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={c.type} className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-white/[0.03] text-white/35">
                        {/video|testimonial|ugc/i.test(c.type) ? <Film size={16} /> : <ImageIcon size={16} />}
                      </span>
                    )}
                    {vid?.status === 'done' && (
                      <span className="absolute bottom-0.5 left-0.5 grid h-4 w-4 place-items-center rounded bg-black/70 text-white">
                        <Film size={9} />
                      </span>
                    )}
                    {up?.status === 'done' && (
                      <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-success text-black">
                        <Check size={9} />
                      </span>
                    )}
                    {up?.status === 'uploading' && (
                      <span className="absolute inset-0 grid place-items-center bg-black/55">
                        <Loader2 size={14} className="animate-spin text-white" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* ---------------------------- Launch panel -------------------------- */}
        <section className="space-y-4 p-5">
          {selected && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Pill tone="primary">{selected.type}</Pill>
                {selected.variationLabel && selected.variationMethod && (
                  <span className="text-[11px] text-white/55">
                    {VARIATION_METHOD_LABEL[selected.variationMethod]}: {selected.variationLabel}
                  </span>
                )}
              </div>
              <p className="line-clamp-4 text-[12px] leading-relaxed text-white/55">{selected.text}</p>
            </div>
          )}

          {/* Claims — the same gate the orchestrator and the upload route apply */}
          {selected && (
            <div
              className={cn(
                'rounded-xl border p-3',
                blocking.length
                  ? 'border-danger/30 bg-danger/[0.05]'
                  : issues.length
                    ? 'border-warning/25 bg-warning/[0.04]'
                    : 'border-success/20 bg-success/[0.04]',
              )}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
                <ScanText size={11} /> Claims on the creative
              </p>
              {issues.length === 0 ? (
                <p className="mt-1.5 text-[11.5px] text-success">No claim Meta rejects.</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {issues.map((issue, ii) => (
                    <li
                      key={ii}
                      className={cn(
                        'flex items-start gap-1.5 text-[11px]',
                        issue.severity === 'error' ? 'text-danger' : 'text-warning',
                      )}
                    >
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Pre-test the pixels before spend */}
          {pretest.status === 'done' && pretest.result && <PretestPanel result={pretest.result} />}
          <button
            type="button"
            onClick={runPretest}
            disabled={!selected || pretest.status === 'testing' || rendering}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-glow/30 bg-glow/10 px-4 py-2.5 text-[12px] font-semibold text-glow transition-colors hover:bg-glow/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pretest.status === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
            {pretest.status === 'testing'
              ? 'Reading the creative…'
              : pretest.status === 'done'
                ? 'Re-run the pre-test'
                : 'Pre-test this creative — spelling, product read, predicted response'}
          </button>

          {/* Where it goes */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11.5px]">
            {destination === null ? (
              <span className="flex items-center gap-2 text-white/45">
                <Loader2 size={12} className="animate-spin" /> Checking your Meta connection…
              </span>
            ) : destination.configured ? (
              <span className="text-white/60">
                Uploads to ad account{' '}
                <span className="font-mono text-white/85">act_{destination.adAccountId}</span> — into its media
                library, ready to pick when you build the ad. Write the caption in Ads Manager, or let
                Advantage+ text options write it.
              </span>
            ) : (
              <span className="text-warning">
                {destination.reason ?? 'Meta is not connected.'}{' '}
                <Link href="/meta" className="font-semibold underline underline-offset-2 hover:text-white">
                  Connect Meta
                </Link>
              </span>
            )}
          </div>

          {pretest.result?.qc?.textMatches === false && upload?.status !== 'done' && (
            <p className="flex items-start gap-1.5 rounded-xl border border-warning/25 bg-warning/[0.06] p-2.5 text-[11px] text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              The pre-test found words on this creative that do not match the brief. Uploading it ships the
              mistake — regenerate it first.
            </p>
          )}

          <button
            type="button"
            onClick={uploadOne}
            disabled={
              !selected ||
              !hasCreative ||
              blocking.length > 0 ||
              !destination?.configured ||
              upload?.status === 'uploading' ||
              upload?.status === 'done'
            }
            title={blocking.length ? 'This creative carries a claim Meta rejects' : undefined}
            className="fire-btn fire-btn--md inline-flex w-full items-center justify-center gap-2 font-display font-bold uppercase tracking-[0.14em] text-white"
          >
            {upload?.status === 'uploading' ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Uploading to Meta…
              </>
            ) : upload?.status === 'done' ? (
              <>
                <Check size={15} /> In your Meta library
              </>
            ) : (
              <>
                <UploadCloud size={15} /> Upload to Meta
              </>
            )}
          </button>
          {upload && upload.status !== 'uploading' && upload.message && (
            <p
              className={cn(
                'flex items-start gap-1.5 rounded-xl border p-2.5 text-[11px]',
                upload.status === 'done'
                  ? 'border-success/25 bg-success/[0.06] text-success'
                  : 'border-warning/25 bg-warning/[0.06] text-warning',
              )}
            >
              {upload.status === 'done' ? (
                <Check size={12} className="mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              )}
              {upload.message}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
