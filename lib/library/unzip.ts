/**
 * Unpack a Notion (or any) export zip in the BROWSER.
 *
 * Why here and not on the server: a workspace export is routinely hundreds of
 * megabytes, nearly all of it images, and a serverless function will not
 * accept more than 4.5 MB in a request. The browser opens the zip, keeps only
 * the text pages, and sends those — a few hundred kilobytes of the same
 * export.
 *
 * Images are never decompressed (fflate's filter skips them before inflating),
 * nested zips are followed — Notion splits large exports into
 * `Export-…-Part-1.zip` inside the outer zip — and the total text kept is
 * capped so a mis-dropped archive cannot exhaust the tab.
 */

import { unzipSync } from 'fflate'
import { isTextFile, isZip } from './text'

/** Text kept from one dropped archive, across every nested level. */
const MAX_TEXT_BYTES = 25 * 1024 * 1024
/** How deep nested zips are followed. Notion uses one level; two is generous. */
const MAX_DEPTH = 2

export interface UnzippedText {
  /** Path inside the archive, e.g. "Playbooks/Creative Testing 1a2b….md". */
  path: string
  text: string
}

export interface UnzipReport {
  files: UnzippedText[]
  /** Entries left out: images, attachments, anything that is not text. */
  skipped: number
  /** True when the text cap stopped the read early. */
  truncated: boolean
}

function wanted(name: string): boolean {
  if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) return false
  return isTextFile(name) || isZip(name)
}

export function unzipTextFiles(bytes: Uint8Array): UnzipReport {
  const report: UnzipReport = { files: [], skipped: 0, truncated: false }
  const decoder = new TextDecoder('utf-8')
  let kept = 0

  const walk = (data: Uint8Array, prefix: string, depth: number) => {
    const entries = unzipSync(data, {
      filter: (file) => {
        const keep = wanted(file.name) && (isZip(file.name) ? depth < MAX_DEPTH : true)
        if (!keep && !file.name.endsWith('/')) report.skipped += 1
        return keep
      },
    })
    for (const name of Object.keys(entries).sort()) {
      if (report.truncated) return
      const content = entries[name]
      if (isZip(name)) {
        walk(content, `${prefix}${name.replace(/\.zip$/i, '')}/`, depth + 1)
        continue
      }
      if (kept + content.byteLength > MAX_TEXT_BYTES) {
        report.truncated = true
        return
      }
      kept += content.byteLength
      report.files.push({ path: `${prefix}${name}`, text: decoder.decode(content) })
    }
  }

  walk(bytes, '', 0)
  return report
}
