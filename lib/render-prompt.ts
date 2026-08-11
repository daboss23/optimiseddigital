/**
 * Render-prompt compiler — turns a production brief into a prompt an image
 * model can actually execute, with the on-image copy spelled correctly.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Reactor's briefs are written for a human art director: every frame is
 * prose, and the ad's words are quoted inside that prose ("Headline (top
 * third): Bold condensed white type on the scrim: '100 BUILDERS SAT DOWN…'").
 * Concatenating those frames into one paragraph — which is what the old
 * `briefToPrompt` did — hands a diffusion model four or five competing text
 * strings buried in description, with no instruction that any of them are
 * literal. The result is the failure mode we shipped: headlines rendered as
 * plausible-looking gibberish, invented words, duplicated fragments, and a
 * bottom strip of pure noise where the compliance fine print was asked for.
 *
 * Image models render text reliably under three conditions, all enforced here:
 *   1. The literal strings are listed separately from the scene, quoted, and
 *      explicitly marked as characters to reproduce.
 *   2. There are FEW of them and they are SHORT. Every additional block, and
 *      every character past roughly one headline plus a button, degrades all of
 *      them — so the compiler renders at most `MAX_RENDERED_TEXT_BLOCKS` inside
 *      a `MAX_RENDERED_TEXT_CHARS` budget.
 *   3. Nothing asks for text that cannot physically render. Fine print,
 *      compliance strips, disclaimers, logo lettering and paragraph subtext are
 *      illegible at ad resolution and always come back as noise, so they are
 *      dropped from the render and reported as overlay copy instead.
 *
 * Anything dropped is returned in `omitted` — it is never silently lost, and
 * the concept's ad package still carries the full, compliant copy for the
 * caption, the Studio overlay and the Meta push.
 *
 * Pure data in / string out (no framework imports) so both the client renderer
 * and the server routes share exactly one prompt path.
 */

import type { ProductionBrief } from '@/lib/reactor-inputs'

/** Marker the image oven looks for to know a render carries literal copy. */
export const ON_IMAGE_TEXT_MARKER = 'ON-IMAGE TEXT'

/** Hard ceiling on how many literal text blocks a still is asked to render. */
export const MAX_RENDERED_TEXT_BLOCKS = 2

/** Combined character budget across those blocks. Past this, text degrades. */
export const MAX_RENDERED_TEXT_CHARS = 95

/** One piece of literal copy destined for (or dropped from) the render. */
export interface OnImageText {
  /** Builder-facing role, e.g. "Headline", "CTA button". */
  role: string
  /** The exact characters to set. */
  text: string
  /** Where it sits, when the brief said so. */
  placement?: string
  /** Why it was left out of the render (present on omitted items only). */
  omittedReason?: string
}

export interface CompiledRenderPrompt {
  /** The prompt to send to the image model. */
  prompt: string
  /** Copy the model is asked to set, in render order. */
  rendered: OnImageText[]
  /** Copy deliberately kept off the render (overlay it in the Studio). */
  omitted: OnImageText[]
}

/* ----------------------------- Classification ----------------------------- */

type TextRole = 'headline' | 'cta' | 'subhead' | 'legal' | 'logo' | 'scene'

const ROLE_PATTERNS: { role: TextRole; re: RegExp }[] = [
  { role: 'legal', re: /compliance|fine print|disclaimer|legal|small print|footnote|results? are/i },
  { role: 'logo', re: /\blogo\b|wordmark|lockup|brand mark/i },
  { role: 'cta', re: /\bcta\b|call to action|button|pill/i },
  { role: 'headline', re: /headline|hook|main text|title|kicker/i },
  { role: 'subhead', re: /sub-?head|sub-?line|support|body copy|caption|proof|chip|badge|sticker|deck|bullet/i },
]

/**
 * What kind of element a brief frame describes.
 *
 * The LABEL is authoritative. The description is consulted only when the frame
 * actually carries quoted copy — otherwise a scene beat that merely mentions
 * the CTA ("single amber accent reserved for the CTA only") would be
 * misclassified as the button and dropped from the scene.
 */
function classifyFrame(label: string, description: string): TextRole {
  for (const { role, re } of ROLE_PATTERNS) {
    if (re.test(label)) return role
  }
  if (!/["“”]/.test(description)) return 'scene'
  for (const { role, re } of ROLE_PATTERNS) {
    if (re.test(description)) return role
  }
  return 'scene'
}

/** Rendering priority — the headline earns the pixels, then the button. */
const RENDER_PRIORITY: TextRole[] = ['headline', 'cta', 'subhead']

/* ------------------------------- Extraction ------------------------------- */

// Straight and typographic double quotes. Single quotes are deliberately NOT
// matched: builder copy is full of apostrophes ("don't", "builders'").
const QUOTED = /["“”]([^"“”]{2,160})["“”]/g

/** Pull every quoted string out of a frame description. */
function quotedStrings(description: string): string[] {
  const out: string[] = []
  // Fresh regex per call: QUOTED is global, so a shared lastIndex would make
  // extraction depend on call order.
  const re = new RegExp(QUOTED.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(description)) !== null) {
    const s = m[1].trim()
    if (s) out.push(s)
  }
  return out
}

/**
 * The frame's visual direction with its literal copy removed — including the
 * lead-in punctuation that introduced it ("Bold condensed white type: <quote>."
 * → "Bold condensed white type"), so no dangling colon survives to be read as
 * more text to set.
 */
function sceneOnly(description: string): string {
  return description
    .replace(new RegExp(QUOTED.source, 'g'), '')
    .replace(/\s*:\s*(?=[.,;]|\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/\.{2,}/g, '.')
    .replace(/[:,;—–-]\s*$/, '')
    .trim()
}

/** A short, human label for a role. */
function roleLabel(role: TextRole): string {
  if (role === 'cta') return 'CTA button'
  if (role === 'headline') return 'Headline'
  if (role === 'subhead') return 'Support line'
  if (role === 'legal') return 'Compliance line'
  if (role === 'logo') return 'Logo lettering'
  return 'Text'
}

/**
 * Collect the ad's literal copy. A brief that declares `onImageText` is taken at
 * its word; otherwise the copy is recovered from the quoted strings the
 * orchestrator wrote into its frames.
 */
function collectText(brief: ProductionBrief): { role: TextRole; item: OnImageText }[] {
  if (brief.onImageText?.length) {
    return brief.onImageText
      .filter((t) => t?.text?.trim())
      .map((t) => {
        const role = classifyFrame(t.role ?? '', t.text ?? '')
        return {
          role: role === 'scene' ? 'headline' : role,
          item: { role: t.role?.trim() || roleLabel(role), text: t.text.trim(), placement: t.placement?.trim() },
        }
      })
  }

  const found: { role: TextRole; item: OnImageText }[] = []
  for (const frame of brief.frames ?? []) {
    const role = classifyFrame(frame.label ?? '', frame.description ?? '')
    const strings = quotedStrings(frame.description ?? '')
    if (!strings.length) continue

    // A frame often quotes its block once and then quotes a word INSIDE it for
    // emphasis ('"NOT DISORGANISED. JUST MISSING ONE SYSTEM." The word "ONE"
    // set in amber'). That second quote is a type treatment, not a second block
    // of copy — counting it as one would burn the CTA's slot and tell the model
    // to set the word twice. Keep the longest string; fold any substring of it
    // into the placement note as the emphasis instruction it actually is.
    const sorted = [...strings].sort((a, b) => b.length - a.length)
    const primary = sorted[0]
    const emphasis = sorted.slice(1).filter((s) => primary.toLowerCase().includes(s.toLowerCase()))
    const separate = sorted.slice(1).filter((s) => !primary.toLowerCase().includes(s.toLowerCase()))

    const direction = sceneOnly(frame.description ?? '')
    const placement = [
      direction || undefined,
      emphasis.length ? `emphasise "${emphasis.join('", "')}" within it` : undefined,
    ]
      .filter(Boolean)
      .join(' — ')

    const label = frame.label?.trim() || roleLabel(role)
    const mapped: TextRole = role === 'scene' ? 'headline' : role
    found.push({ role: mapped, item: { role: label, text: primary, placement: placement || undefined } })
    for (const text of separate) {
      found.push({ role: mapped, item: { role: label, text, placement: direction || undefined } })
    }
  }
  return found
}

/* -------------------------------- Compiler -------------------------------- */

const TYPOGRAPHY_RULE =
  'Set that copy in clean, sharp, correctly-kerned sans-serif type — every letter fully formed, correctly spelled, and legible at thumbnail size.'

const NO_OTHER_TEXT_RULE =
  'Render NO other text anywhere in the image: no extra headlines, no sub-headings, no paragraphs, no fine print or disclaimers, no captions, no labels, no signage, no logos or wordmarks, no watermarks. No invented, misspelled, duplicated or garbled lettering. Every surface not listed above is completely free of text.'

const NO_TEXT_AT_ALL_RULE =
  'Render NO text, lettering, numerals, logos, wordmarks, signage or watermarks anywhere in the image — the copy is overlaid afterwards. Leave clean, uncluttered negative space in the areas reserved for it.'

/** Applied to prompts the compiler did not write, where the copy is unknown. */
const NO_GARBLED_TEXT_RULE =
  'Any lettering in the image must be real, correctly-spelled words set in clean sharp type — no invented, misspelled, duplicated or garbled text, and no fine print, disclaimers or watermarks.'

/**
 * The rule that stops a still being rendered as a storyboard.
 *
 * A production brief is written frame by frame because that is how a VIDEO is
 * directed. Handing that list to a still model reads as a shot list, and the
 * model obliges: five stacked letterbox panels, one per beat, which is not an
 * ad. The still gets ONE beat — the hero frame — and an explicit instruction
 * that the output is a single photograph.
 */
const SINGLE_FRAME_RULE =
  'Render ONE single photographic frame — a single unified composition that fills the entire canvas edge to edge. This is NOT a storyboard, filmstrip, contact sheet, collage, grid, split-screen, before/after pair, or multi-panel layout. No panels, no strips, no borders, no dividing lines, no letterboxing, no stacked scenes.'

/**
 * A headline good enough to burn into a still.
 *
 * Rejects anything past the character budget (long copy renders as mush) and
 * anything that is obviously not ad copy — a placeholder or a sentence of
 * direction that leaked into the headline field.
 */
function usableHeadline(headline: string | undefined): string | undefined {
  const t = headline?.trim()
  if (!t) return undefined
  if (t.length > MAX_RENDERED_TEXT_CHARS) return undefined
  if (/^(tbd|n\/?a|headline|untitled)$/i.test(t)) return undefined
  return t
}

/** The ON-IMAGE TEXT section for a set of blocks the model must set exactly. */
function textBlockFor(rendered: OnImageText[]): string {
  return [
    `${ON_IMAGE_TEXT_MARKER} — reproduce these strings EXACTLY as written, character for character, with no additions, no rewording and no spelling changes:`,
    ...rendered.map(
      (t, i) => `${i + 1}. ${t.role} — "${t.text}"${t.placement ? ` (${t.placement})` : ''}`,
    ),
    TYPOGRAPHY_RULE,
    NO_OTHER_TEXT_RULE,
  ].join('\n')
}

/**
 * Enforce the single-frame discipline on a prompt the compiler did not write.
 *
 * The orchestrator's `generate_image` tool takes a prompt OPUS composed itself,
 * so it never passes through `compileRenderPrompt` and inherits none of its
 * rules — the same brief that renders as one photograph through the compiler
 * can come back as a five-panel filmstrip through the tool. Appending the rule
 * costs nothing and closes that path; it is idempotent, so a prompt that
 * already carries it is returned untouched.
 */
export function enforceSingleFrame(prompt: string): string {
  const p = prompt?.trim() ?? ''
  if (!p) return p
  if (p.includes('NOT a storyboard')) return p
  return `${p}\n\n${SINGLE_FRAME_RULE}\n${NO_GARBLED_TEXT_RULE}`
}

/**
 * Compile a production brief into a render prompt.
 *
 * @param brief    the concept's frame-by-frame plan
 * @param fallback prompt to use when there is no brief (raw concept text)
 * @param opts     `motion` keeps the full frame sequence (video); `headline` is
 *                 the concept's Meta headline, burned into a still when the
 *                 brief forgot to declare any on-image copy
 */
export function compileRenderPrompt(
  brief: ProductionBrief | undefined,
  fallback: string,
  opts: { motion?: boolean; headline?: string } = {},
): CompiledRenderPrompt {
  const motion = opts.motion === true
  const headlineFallback = motion ? undefined : usableHeadline(opts.headline)

  if (!brief?.frames?.length) {
    // Even with no brief a still is an AD: if the concept shipped a Meta
    // headline, burn it in rather than returning a wordless stock photo.
    const rescued = headlineFallback
      ? [{ role: 'Headline', text: headlineFallback, placement: 'upper third, over high-contrast negative space' }]
      : []
    return {
      prompt: [fallback, motion ? '' : SINGLE_FRAME_RULE, rescued.length ? textBlockFor(rescued) : NO_TEXT_AT_ALL_RULE]
        .filter(Boolean)
        .join('\n\n'),
      rendered: rescued,
      omitted: [],
    }
  }

  /* -- 1. Scene: visual direction only, with the copy stripped out. ---------
     Frames that exist to carry copy (headline / subhead / CTA / fine print /
     logo) are excluded entirely: their art direction rides along as the
     `placement` on the text block below. Describing the headline slot twice —
     once as a scene beat and once as literal copy — is itself a cause of
     duplicated and doubled-up lettering in the render. */
  const allScenes = (brief.frames ?? [])
    .map((f) => ({ role: classifyFrame(f.label ?? '', f.description ?? ''), frame: f }))
    .filter(({ role }) => role === 'scene')
    .map(({ frame }, i) => {
      const scene = sceneOnly(frame.description ?? '')
      if (!scene) return null
      const label = frame.label?.trim() || `Frame ${i + 1}`
      return { label, scene }
    })
    .filter(Boolean) as { label: string; scene: string }[]

  /* A still gets ONE beat. Handing a still model five numbered frames reads as
     a shot list and renders as five stacked panels — an ad that is a filmstrip
     is not an ad. The hero frame is the first scene beat: the brief opens on
     the image the ad is built around. The remaining beats belong to the video
     cut of the same concept. Frame labels are dropped too — "Frame 1:" is
     itself an instruction to number the output. */
  const sceneFrames = motion
    ? allScenes.map(({ label, scene }) => `${label}: ${scene}`)
    : allScenes.slice(0, 1).map(({ scene }) => `SCENE: ${scene}`)

  /* -- 2. Copy: prioritised, budgeted, and everything else set aside. ------- */
  const collected = collectText(brief)
  const ordered = [...collected].sort(
    (a, b) => rank(a.role) - rank(b.role),
  )

  const rendered: OnImageText[] = []
  const omitted: OnImageText[] = []
  let charBudget = MAX_RENDERED_TEXT_CHARS
  const seen = new Set<string>()

  for (const { role, item } of ordered) {
    const key = item.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    if (role === 'legal') {
      omitted.push({ ...item, omittedReason: 'Fine print never renders legibly — overlay it in the Studio.' })
      continue
    }
    if (role === 'logo') {
      omitted.push({ ...item, omittedReason: 'Logos are composited, not generated.' })
      continue
    }
    if (rendered.length >= MAX_RENDERED_TEXT_BLOCKS) {
      omitted.push({ ...item, omittedReason: 'Beyond the two text blocks a still can render cleanly.' })
      continue
    }
    if (item.text.length > charBudget) {
      omitted.push({ ...item, omittedReason: 'Past the character budget that keeps type legible.' })
      continue
    }
    charBudget -= item.text.length
    rendered.push(item)
  }

  /* A still that ends up with no copy at all is a stock photograph, not an ad —
     the second half of the filmstrip failure: five wordless panels. The
     orchestrator is told to declare a headline on every image concept, but a
     prompt rule is not a guarantee, so the concept's Meta headline is burned in
     as the floor. Video is exempt: motion carries its message over time. */
  if (!motion && !rendered.length && headlineFallback) {
    rendered.push({
      role: 'Headline',
      text: headlineFallback,
      placement: 'upper third, over high-contrast negative space',
    })
  }

  /* -- 3. Assemble. -------------------------------------------------------- */
  const header = `${brief.creativeType} ad creative for The Professional Builder. Pattern: ${brief.pattern}. Audience: ${brief.audience}. Awareness: ${brief.awareness}.`

  const textBlock = rendered.length ? textBlockFor(rendered) : NO_TEXT_AT_ALL_RULE

  const look = rendered.length
    ? 'Premium, photographic, on-site builder context, high contrast behind every piece of type so it stays readable.'
    : 'Premium, photographic, on-site builder context, high contrast, clean space reserved for the text overlay.'

  const prompt = [header, sceneFrames.join('\n'), motion ? '' : SINGLE_FRAME_RULE, textBlock, look]
    .filter(Boolean)
    .join('\n\n')

  return { prompt, rendered, omitted }
}

function rank(role: TextRole): number {
  const i = RENDER_PRIORITY.indexOf(role)
  return i === -1 ? RENDER_PRIORITY.length : i
}

/**
 * Back-compatible shim for callers that just want the prompt string.
 * (Was `briefToPrompt` in lib/reactor-inputs — same signature, correct output.)
 */
export function briefToPrompt(brief: ProductionBrief | undefined, fallback: string): string {
  return compileRenderPrompt(brief, fallback).prompt
}

/**
 * The motion variant — the same compiler with the full frame sequence intact.
 *
 * A video model is being directed through beats over time, so the shot list is
 * exactly right there; it is only a STILL that has to collapse to one frame.
 */
export function briefToVideoPrompt(brief: ProductionBrief | undefined, fallback: string): string {
  return compileRenderPrompt(brief, fallback, { motion: true }).prompt
}
