/**
 * Platform Library text handling — pure functions, no I/O.
 *
 * Shared by the owner's upload screen (which unpacks Notion zips in the
 * browser and previews what it found) and the server (which chunks and
 * embeds). Nothing here reads the network or the environment, so the
 * selftest pins it against real export shapes.
 */

/** The longest single document kept — a long SOP manual, not a book. */
export const MAX_DOC_CHARS = 300_000
/** One section's ceiling. Long enough to hold a rule with its reasoning. */
export const MAX_CHUNK_CHARS = 1_400
/** Sections kept per document — beyond this a document is a corpus, not an SOP. */
export const MAX_CHUNKS_PER_DOC = 400

/** Files whose text the browser can read directly. */
const TEXT_EXT = /\.(md|markdown|txt|csv|html?)$/i
/** Files the server extracts (the browser has no PDF text reader). */
const SERVER_EXT = /\.pdf$/i

export function isTextFile(name: string): boolean {
  return TEXT_EXT.test(name)
}

export function needsServerExtraction(name: string): boolean {
  return SERVER_EXT.test(name)
}

export function isZip(name: string): boolean {
  return /\.zip$/i.test(name)
}

/**
 * A readable title from a file name or a path inside a zip.
 *
 * Notion names every exported page `Title <32-hex id>.md` and URL-encodes
 * the folders it nests them in; the id is noise to a reader and the encoding
 * is noise to everyone.
 */
export function cleanTitle(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  let name = base.replace(/\.[^.]+$/, '')
  try {
    name = decodeURIComponent(name)
  } catch {
    /* a stray % is just a character */
  }
  return (
    name
      .replace(/\s+[0-9a-f]{32}$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Untitled'
  )
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
}

/**
 * Notion's HTML export (and any HTML page) as Markdown-ish text: headings
 * kept as `#` lines so the chunker can still find the structure, lists as
 * `- ` items, everything else as paragraphs.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
      return `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Normalise an export into clean Markdown.
 *
 * Images and attachment links are dropped (the agents read words, and a
 * relative path into a zip that no longer exists is not one); a link keeps
 * its text; Notion's empty toggles and divider runs collapse.
 */
export function normaliseText(raw: string, fileName = ''): string {
  const text = /\.html?$/i.test(fileName) ? htmlToText(raw) : raw
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_DOC_CHARS)
}

export interface LibrarySection {
  /** The heading path this text sits under, e.g. "Testing › Budget split". */
  heading: string | null
  content: string
}

/** Split a long block on paragraph boundaries into pieces under the ceiling. */
function splitBlock(text: string, max: number): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  let current = ''
  for (const p of paras) {
    if (p.length > max) {
      if (current) {
        out.push(current)
        current = ''
      }
      // A single paragraph longer than a section: cut on sentence ends.
      let rest = p
      while (rest.length > max) {
        const cut = rest.slice(0, max)
        const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'))
        const at = stop > max * 0.5 ? stop + 1 : max
        out.push(rest.slice(0, at).trim())
        rest = rest.slice(at).trim()
      }
      if (rest) current = rest
      continue
    }
    if (current && current.length + 2 + p.length > max) {
      out.push(current)
      current = p
    } else {
      current = current ? `${current}\n\n${p}` : p
    }
  }
  if (current) out.push(current)
  return out
}

/**
 * Chunk a document by its headings.
 *
 * A flat 1,000-character chunker separates a rule from the heading that says
 * what it is a rule about ("35%" means nothing without "Testing budget").
 * Each section here carries its heading path, and a long section is split on
 * paragraphs inside that path rather than across it.
 */
export function chunkSections(markdown: string, max = MAX_CHUNK_CHARS): LibrarySection[] {
  const lines = markdown.split('\n')
  const path: string[] = []
  const sections: LibrarySection[] = []
  let buffer: string[] = []

  const flush = () => {
    const body = buffer.join('\n').trim()
    buffer = []
    if (!body) return
    const heading = path.filter(Boolean).join(' › ') || null
    for (const piece of splitBlock(body, max)) sections.push({ heading, content: piece })
  }

  for (const line of lines) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      const level = h[1].length
      path.length = level - 1
      path[level - 1] = h[2].replace(/[*_`]/g, '').trim()
      continue
    }
    buffer.push(line)
  }
  flush()
  return sections.slice(0, MAX_CHUNKS_PER_DOC)
}

/** What the upload screen shows for a staged document, before anything is sent. */
export interface StagedDocument {
  title: string
  sourceName: string
  text: string
}

/** Stage one readable file: normalised text and a clean title, or null when empty. */
export function stageText(sourceName: string, raw: string): StagedDocument | null {
  const text = normaliseText(raw, sourceName)
  if (text.replace(/\s+/g, '').length < 40) return null
  // A Notion page's own `# Title` beats a file name when it has one.
  const firstHeading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim()
  return { title: (firstHeading || cleanTitle(sourceName)).slice(0, 200), sourceName, text }
}
