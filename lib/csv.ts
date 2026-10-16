/**
 * CSV → knowledge text, for the exports an e-commerce brand actually has:
 * review-app exports (one review per row) and survey exports (one response
 * per row).
 *
 * Two jobs, both deliberate:
 *   1. Turn rows into lines a retriever can use. A raw CSV embeds as a wall
 *      of commas; "★★★★★ Never going back — I've reordered twice" is voice
 *      of customer NOVA and ECHO can quote.
 *   2. Leave the customer's identity behind. Names, emails, phone numbers,
 *      addresses and order ids are dropped before anything is stored — the
 *      Vault needs what customers SAID, never who they are, and a knowledge
 *      base that holds PII is a liability nobody asked for.
 *
 * Pure functions, no imports, so the parse route and the selftest share them.
 */

/** RFC 4180-style parse: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}

const BODY = /^(body|review|review[ _-]?(body|text|content)|content|comment|comments|text|message|feedback|answer|response)$/
const RATING = /^(rating|stars?|score|review[ _-]?(rating|score)|product[ _-]?rating)$/
const TITLE = /^(title|review[ _-]?title|headline|subject|summary)$/
/** Columns that identify a person or an order — never stored. */
const PII =
  /name|e-?mail|phone|address|city|zip|postcode|post code|ip\b|ip[ _-]?address|order|customer[ _-]?id|user[ _-]?id|reviewer|author|handle|avatar|picture|photo/
/** …unless the column names the PRODUCT ("Product name", "Variant title"), which is context, not identity. */
const PRODUCT_COLUMN = /product|variant|sku|item/

function isPii(header: string): boolean {
  const h = header.toLowerCase()
  return PII.test(h) && !PRODUCT_COLUMN.test(h)
}

function stars(raw: string): string {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 1 || n > 5) return ''
  return '★'.repeat(n)
}

/**
 * One line per review — rating, title, body — or null when the export does
 * not look like reviews (no body column).
 */
export function reviewLines(rows: string[][]): string[] | null {
  if (rows.length < 2) return null
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const body = header.findIndex((h) => BODY.test(h))
  if (body === -1) return null
  const rating = header.findIndex((h) => RATING.test(h))
  const title = header.findIndex((h) => TITLE.test(h))

  return rows
    .slice(1)
    .map((r) => {
      const text = (r[body] ?? '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      const parts = [
        rating >= 0 ? stars(r[rating] ?? '') : '',
        title >= 0 ? (r[title] ?? '').replace(/\s+/g, ' ').trim() : '',
        text,
      ].filter(Boolean)
      return parts.join(' — ')
    })
    .filter(Boolean)
}

/**
 * Generic rows as "Question: answer" lines, PII columns removed. Used for
 * surveys and anything that is not a review export.
 */
export function rowLines(rows: string[][]): string[] {
  if (rows.length < 2) return rows.map((r) => r.join(' · '))
  const header = rows[0].map((h) => h.trim())
  const keep = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && !isPii(h))
  return rows
    .slice(1)
    .map((r) =>
      keep
        .map(({ h, i }) => {
          const v = (r[i] ?? '').replace(/\s+/g, ' ').trim()
          return v ? `${h}: ${v}` : ''
        })
        .filter(Boolean)
        .join(' · '),
    )
    .filter(Boolean)
}

/** CSV text → readable, PII-free knowledge text, capped at `maxChars`. */
export function csvToKnowledgeText(text: string, maxChars = 8000): string {
  const rows = parseCsv(text)
  const lines = reviewLines(rows) ?? rowLines(rows)
  let out = ''
  let kept = 0
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) break
    out += `${line}\n`
    kept++
  }
  const dropped = lines.length - kept
  return dropped > 0 ? `${out}\n[${dropped} more row(s) not stored — split the export to keep them]` : out.trim()
}
