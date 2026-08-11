// ATLAS — Website Intelligence. Scans a company's public website, extracts and
// classifies the most useful pages, derives five compact intelligence profiles
// (Brand · Audience · Offer · Messaging · Proof), and stores everything in the
// existing Knowledge Vault (`knowledge_chunks`) under the `website` system so the
// whole agent network can retrieve it. Reuses the existing chunk → Voyage embed →
// pgvector pipeline (`ingestKnowledge`) — no duplicate ingestion machinery.
//
// Everything degrades gracefully: with no Anthropic key the profiles fall back to
// a heuristic read; with no Supabase/Voyage the scan still runs and returns a
// summary, it just isn't persisted.

import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { ingestKnowledge } from '@/lib/knowledge'
import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import { parseModelJson } from '@/lib/parse'
import { INTELLIGENCE_MODEL, ORCHESTRATOR_FALLBACK_MODEL } from '@/lib/models'

// ATLAS synthesises profiles with the bulk model (single-shot, cost-aware).
const MODEL = INTELLIGENCE_MODEL
const UA = 'Mozilla/5.0 (compatible; TPB-ATLAS/1.0; +https://theprobuilder.com)'
const FETCH_TIMEOUT = 12_000
const MAX_REDIRECTS = 4
const MAX_PAGES = 16
const MAX_PAGE_BYTES = 1_500_000
const FETCH_CONCURRENCY = 5
const PROFILE_INPUT_CHARS = 24_000

/* ------------------------------- Public types ----------------------------- */

export type PageType =
  | 'Homepage'
  | 'About'
  | 'Service'
  | 'Product'
  | 'Program'
  | 'Offer'
  | 'Landing Page'
  | 'Testimonial'
  | 'Case Study'
  | 'Success Story'
  | 'FAQ'
  | 'Blog or Resource'
  | 'Contact'
  | 'Other'

export interface WebsitePageInfo {
  url: string
  title: string
  pageType: PageType
}

export interface BrandProfile {
  companyName: string
  industry: string
  businessModel: string
  positioning: string
  valuePropositions: string[]
  differentiators: string[]
  brandVoice: string
  tone: string
  primaryPromises: string[]
  authoritySignals: string[]
  sourceUrls: string[]
}

export interface AudienceProfile {
  primaryAudiences: string[]
  secondaryAudiences: string[]
  customerTypes: string[]
  problems: string[]
  desires: string[]
  outcomes: string[]
  audienceLanguage: string[]
  sourceUrls: string[]
}

export interface OfferProfile {
  products: string[]
  services: string[]
  programs: string[]
  primaryOffer: string
  secondaryOffers: string[]
  leadMagnets: string[]
  events: string[]
  callsToAction: string[]
  pricing: string[]
  guarantees: string[]
  sourceUrls: string[]
}

export interface MessagingProfile {
  themes: string[]
  headlines: string[]
  commonPhrases: string[]
  vocabulary: string[]
  claims: string[]
  emotionalLanguage: string[]
  callsToAction: string[]
  differentiators: string[]
  identityLanguage: string[]
  transformationLanguage: string[]
  sourceUrls: string[]
}

export interface ProofProfile {
  testimonials: string[]
  caseStudies: string[]
  successStories: string[]
  results: string[]
  statistics: string[]
  awards: string[]
  partnerships: string[]
  certifications: string[]
  authoritySignals: string[]
  sourceUrls: string[]
}

export interface WebsiteProfiles {
  brand: BrandProfile
  audience: AudienceProfile
  offer: OfferProfile
  messaging: MessagingProfile
  proof: ProofProfile
}

/** A single brand colour lifted from the site's markup. */
export interface BrandColor {
  hex: string
  /** How often it appeared — a rough proxy for prominence. */
  weight: number
}

/**
 * Visual brand assets read straight from the homepage markup — the logo and
 * the colours the site actually paints with. Nothing is invented: colours are
 * hex values found in the page, the logo is the site's declared icon/og:image.
 */
export interface BrandAssets {
  logoUrl: string | null
  colors: BrandColor[]
}

export interface WebsiteMetrics {
  pagesScanned: number
  pagesIndexed: number
  intelligenceSignals: number
  offersFound: number
  audiencesDetected: number
  proofAssets: number
  profilesCreated: number
}

export interface WebsiteOverview {
  companyName: string
  industry: string
  positioning: string
  primaryAudience: string
  primaryOffer: string
  brandVoice: string
}

export interface WebsiteSummary {
  connected: boolean
  url: string
  domain: string
  lastScanned: string | null
  stored: boolean
  metrics: WebsiteMetrics
  overview: WebsiteOverview
  profiles: WebsiteProfiles
  pages: WebsitePageInfo[]
  /** Logo + colours read from the homepage. Absent on sites scanned before this existed. */
  brandAssets?: BrandAssets
  failedPages: { url: string; reason: string }[]
  /**
   * Profiles whose extraction failed outright, e.g. ["Offer", "Proof"]. Empty
   * on a clean run. A failed extraction and a website that genuinely states
   * nothing both leave fields reading "Not confidently identified" — only this
   * distinguishes them, and only one of the two is worth re-running.
   */
  extractionFailed?: string[]
  /**
   * True when no ANTHROPIC_API_KEY was configured for the scan, so no profile
   * was ever attempted. Pages still index; intelligence does not exist.
   */
  extractionSkipped?: boolean
  /**
   * Profiles that came back empty on this scan and were carried over from the
   * previous scan of the same domain rather than overwritten with blanks,
   * e.g. ["Offer", "Proof"]. A failed extraction must never delete
   * intelligence that was already banked.
   */
  preservedProfiles?: string[]
  /** One-line cause of a failed extraction, e.g. a rejected API key. */
  extractionError?: string
}

/** Streamed analysis events surfaced to the Website Intelligence UI. */
export type AnalyzeEvent =
  | { type: 'progress'; message: string }
  | { type: 'complete'; summary: WebsiteSummary }
  | { type: 'error'; message: string }

const UNKNOWN = 'Not confidently identified'

/* ------------------------------- URL safety ------------------------------- */

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true
  }
  // IPv6 loopback / unique-local / link-local (URL.hostname strips brackets).
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true
  }
  // IPv4 literals in private / loopback / link-local / reserved ranges.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
  }
  return false
}

/** Validate a URL is a public http/https address. Throws a user-facing message. */
export function assertSafeUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('That doesn’t look like a valid website URL.')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only public http and https websites are supported.')
  }
  if (!u.hostname || !u.hostname.includes('.')) {
    throw new Error('Enter a full public website URL, e.g. https://companywebsite.com')
  }
  if (isPrivateHost(u.hostname)) {
    throw new Error('Local and private network addresses are not allowed.')
  }
  return u
}

function rootDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/* --------------------------------- Fetch ---------------------------------- */

interface HttpResult {
  finalUrl: string
  body: string
  contentType: string
}

// Manual redirect following so every hop is re-validated against the SSRF guard.
async function httpGet(url: string, allowTypes: string[]): Promise<HttpResult | null> {
  let current = assertSafeUrl(url).toString()
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res: Response
    try {
      res = await fetch(current, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
    } catch {
      return null
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      let next: URL
      try {
        next = new URL(loc, current)
      } catch {
        return null
      }
      assertSafeUrl(next.toString())
      current = next.toString()
      continue
    }
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (allowTypes.length && !allowTypes.some((t) => contentType.includes(t))) return null
    const body = await res.text()
    return { finalUrl: current, body: body.slice(0, MAX_PAGE_BYTES), contentType }
  }
  return null
}

/* ------------------------------ HTML parsing ------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n))
      } catch {
        return ' '
      }
    })
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function extractTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const fromTitle = t ? stripTags(t).replace(/\s*[|\-–—:]\s*.+$/, '').trim() : ''
  if (fromTitle) return fromTitle.slice(0, 160)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  return h1 ? stripTags(h1).slice(0, 160) : ''
}

/**
 * Read the site's visual brand — logo + colours — from the homepage markup.
 *
 * The logo is the site's own declared icon, preferred most-specific first:
 * og:image → apple-touch-icon → <link rel="icon"> → /favicon.ico. Colours are
 * the hex values the page actually uses (theme-color first, then every #rrggbb
 * in the markup), tallied by frequency and de-duplicated, with pure black and
 * white dropped so the palette reads as brand colour rather than text/paper.
 * Nothing is invented — an absent asset stays null/empty.
 */
function extractBrandAssets(html: string, base: URL): BrandAssets {
  const abs = (href: string): string | null => {
    try {
      return new URL(href.trim().replace(/&amp;/g, '&'), base).toString()
    } catch {
      return null
    }
  }
  const attr = (tag: string, name: string): string | null => {
    const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i')
    return tag.match(re)?.[1] ?? null
  }

  // ---- Logo ----
  let logoUrl: string | null = null
  const metaOg = html.match(/<meta[^>]+(?:property|name)\s*=\s*["']og:image["'][^>]*>/i)?.[0]
  const ogContent = metaOg ? attr(metaOg, 'content') : null
  const iconTags = html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/gi) ?? []
  const apple = iconTags.find((t) => /apple-touch-icon/i.test(t))
  const anyIcon = iconTags[0]
  const pick = ogContent || (apple && attr(apple, 'href')) || (anyIcon && attr(anyIcon, 'href')) || null
  logoUrl = pick ? abs(pick) : `${base.origin}/favicon.ico`

  // ---- Colours ----
  const counts = new Map<string, number>()
  const bump = (raw: string) => {
    let hex = raw.toLowerCase()
    if (hex.length === 4) hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    if (!/^#[0-9a-f]{6}$/.test(hex)) return
    // Drop near-black and near-white — those are ink and paper, not brand.
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    if (r > 244 && g > 244 && b > 244) return
    if (r < 12 && g < 12 && b < 12) return
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  const theme = html.match(/<meta[^>]+name\s*=\s*["']theme-color["'][^>]*>/i)?.[0]
  const themeHex = theme ? attr(theme, 'content') : null
  if (themeHex) {
    bump(themeHex)
    bump(themeHex) // weight the declared brand colour above incidental hexes
  }
  let m: RegExpExecArray | null
  const hexRe = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g
  while ((m = hexRe.exec(html)) !== null) bump(m[0])

  const colors: BrandColor[] = Array.from(counts.entries())
    .map(([hex, weight]) => ({ hex, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)

  return { logoUrl, colors }
}

function extractHeadings(html: string): string[] {
  const out: string[] = []
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 40) {
    const t = stripTags(m[1])
    if (t && t.length < 200) out.push(t)
  }
  return out
}

// Readable body text with structural newlines, navigation/boilerplate removed.
function extractContent(html: string): string {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(cleaned)
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractLinks(html: string, base: URL): string[] {
  const out: string[] = []
  const re = /<a\b[^>]*href=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[1].split('#')[0]
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue
    try {
      const u = new URL(raw, base)
      if ((u.protocol === 'http:' || u.protocol === 'https:') && rootDomain(u.hostname) === rootDomain(base.hostname)) {
        u.hash = ''
        out.push(u.toString())
      }
    } catch {
      /* skip malformed */
    }
  }
  return Array.from(new Set(out))
}

/**
 * Fetch a single public page and return cleaned, readable text. Shared with
 * NOVA's market research so every outbound page fetch flows through the same
 * SSRF guard (`assertSafeUrl`, re-checked on each redirect hop) and HTML
 * extraction. Best-effort — returns '' on any failure rather than throwing.
 */
export async function fetchReadablePage(url: string, maxChars = 9000): Promise<string> {
  const res = await httpGet(url, ['text/html', 'text/plain']).catch(() => null)
  if (!res) return ''
  const content = extractContent(res.body)
  if (!content) return ''
  return content.length > maxChars ? content.slice(0, maxChars) : content
}

/* --------------------------- Page discovery ------------------------------- */

// Pages we never want, regardless of how they're linked.
const EXCLUDE_RE =
  /\/(login|signin|sign-in|signup|sign-up|register|account|my-account|dashboard|cart|checkout|basket|order|privacy|terms|tos|cookie|legal|disclaimer|refund|admin|wp-admin|wp-login|wp-json|feed|rss|tag|tags|category|categories|author|search)\b|\.(pdf|jpe?g|png|gif|svg|webp|avif|zip|mp4|mov|mp3|wav|css|js|xml|json|ico|woff2?|ttf|eot)(\?|$)/i

// URL-pattern → page type + priority score. Higher = scanned first.
const PRIORITY: [RegExp, PageType, number][] = [
  [/\/(about|story|who-we-are|our-team|the-team|company|mission)/i, 'About', 9],
  [/\/(pricing|plans|packages|offer|enroll|apply|get-started|book|consult)/i, 'Offer', 9],
  [/\/(program|programme|course|coaching|mentorship|membership|academy|training)/i, 'Program', 8],
  [/\/(service|services|what-we-do|solutions)/i, 'Service', 8],
  [/\/(product|products|shop|store)/i, 'Product', 8],
  [/\/(case-stud|casestud|case_stud)/i, 'Case Study', 8],
  [/\/(success|results|wins|client-results|member-results|transformation)/i, 'Success Story', 8],
  [/\/(testimonial|reviews?|praise)/i, 'Testimonial', 7],
  [/\/(work|portfolio|projects|gallery|builds?|homes?)/i, 'Landing Page', 6],
  [/\/(faq|faqs|questions|help)/i, 'FAQ', 5],
  [/\/(contact|get-in-touch|enquir|inquir)/i, 'Contact', 4],
  [/\/(blog|article|news|resource|guide|insights?|post)/i, 'Blog or Resource', 2],
]

function scoreUrl(url: string): { type: PageType; score: number } {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return { type: 'Other', score: 0 }
  }
  for (const [re, type, score] of PRIORITY) {
    if (re.test(path)) return { type, score }
  }
  // Shallow unknown pages still carry some value; deep ones much less.
  const depth = path.split('/').filter(Boolean).length
  return { type: 'Other', score: depth <= 1 ? 3 : depth === 2 ? 1 : 0 }
}

function normPath(url: string): string {
  try {
    const u = new URL(url)
    return (rootDomain(u.hostname) + u.pathname.replace(/\/+$/, '')).toLowerCase() || rootDomain(u.hostname)
  } catch {
    return url.toLowerCase()
  }
}

/** Sitemap locations declared in robots.txt — where most CMSs actually put it. */
async function sitemapsFromRobots(seed: URL): Promise<string[]> {
  const res = await httpGet(`${seed.origin}/robots.txt`, ['text']).catch(() => null)
  if (!res) return []
  return Array.from(res.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)).map((m) => m[1])
}

async function fetchSitemapUrls(seed: URL): Promise<string[]> {
  // robots.txt first — it is authoritative. The two conventional paths are
  // only guesses, and a site that puts its sitemap anywhere else (very common
  // on WordPress SEO plugins and hosted CMSs) yielded nothing at all.
  const declared = await sitemapsFromRobots(seed).catch(() => [])
  const candidates = [
    ...declared,
    `${seed.origin}/sitemap.xml`,
    `${seed.origin}/sitemap_index.xml`,
    `${seed.origin}/sitemap-index.xml`,
    `${seed.origin}/wp-sitemap.xml`,
    `${seed.origin}/sitemap/sitemap-index.xml`,
  ]
  const found = new Set<string>()
  for (const sm of candidates) {
    const res = await httpGet(sm, ['xml', 'text']).catch(() => null)
    if (!res) continue
    const locs = Array.from(res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1])
    // Sitemap index → fetch a few child sitemaps.
    const childSitemaps = locs.filter((l) => /sitemap.*\.xml/i.test(l)).slice(0, 3)
    for (const child of childSitemaps) {
      const cres = await httpGet(child, ['xml', 'text']).catch(() => null)
      if (cres) {
        for (const m of Array.from(cres.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi))) {
          found.add(m[1])
        }
      }
    }
    for (const l of locs) {
      if (!/sitemap.*\.xml/i.test(l)) found.add(l)
    }
    if (found.size) break
  }
  return Array.from(found).filter((u) => {
    try {
      return rootDomain(new URL(u).hostname) === rootDomain(seed.hostname)
    } catch {
      return false
    }
  })
}

async function discoverPages(seed: URL, homepageHtml: string): Promise<WebsitePageInfo[]> {
  const homeLinks = extractLinks(homepageHtml, seed)
  let sitemap: string[] = []
  try {
    sitemap = await fetchSitemapUrls(seed)
  } catch {
    /* sitemap optional */
  }

  const usable = (urls: string[]) =>
    urls.filter((u) => {
      try {
        return !EXCLUDE_RE.test(new URL(u).pathname)
      } catch {
        return false
      }
    })

  let candidates = Array.from(new Set([...usable(homeLinks), ...usable(sitemap)]))

  // Second hop. Plenty of sites put almost nothing in the homepage nav (or
  // render it client-side) and publish no sitemap — the homepage alone then
  // yields two or three links and the whole scan runs on a corpus too thin to
  // extract anything from. Follow the best few pages we did find and harvest
  // their links before settling.
  if (candidates.length < MAX_PAGES) {
    const hops = candidates
      .map((url) => ({ url, ...scoreUrl(url) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((c) => c.url)
    const fetched = await mapPool(hops, 3, async (url) => {
      const res = await httpGet(url, ['text/html']).catch(() => null)
      if (!res) return [] as string[]
      try {
        return usable(extractLinks(res.body, new URL(res.finalUrl)))
      } catch {
        return [] as string[]
      }
    })
    candidates = Array.from(new Set([...candidates, ...fetched.flat()]))
  }

  // Deep pages used to score 0 and be dropped outright, which discarded real
  // content on any site that nests (/programs/x/y). Everything is eligible now;
  // score still decides the order, so the best pages are scanned first and the
  // long tail only fills remaining slots.
  const scored = candidates
    .map((url) => ({ url, ...scoreUrl(url) }))
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)

  const seen = new Set<string>([normPath(seed.toString())])
  const picked: WebsitePageInfo[] = [{ url: seed.toString(), title: '', pageType: 'Homepage' }]
  for (const c of scored) {
    const key = normPath(c.url)
    if (seen.has(key)) continue
    seen.add(key)
    picked.push({ url: c.url, title: '', pageType: c.type })
    if (picked.length >= MAX_PAGES) break
  }
  return picked
}

/* ----------------------------- Page scanning ------------------------------ */

interface ScannedPage {
  url: string
  title: string
  pageType: PageType
  headings: string[]
  content: string
  contentHash: string
}

// Refine the page type using the actual title/headings once fetched.
function classify(url: string, fallback: PageType, title: string, headings: string[]): PageType {
  if (fallback !== 'Other') return fallback
  const hay = `${title} ${headings.join(' ')}`.toLowerCase()
  if (/testimonial|review|what.*clients say/.test(hay)) return 'Testimonial'
  if (/case study/.test(hay)) return 'Case Study'
  if (/success|results|transformation/.test(hay)) return 'Success Story'
  if (/about|our story|who we are/.test(hay)) return 'About'
  if (/pricing|enrol|apply|get started/.test(hay)) return 'Offer'
  if (/faq|frequently asked/.test(hay)) return 'FAQ'
  return scoreUrl(url).type
}

async function scanPage(info: WebsitePageInfo): Promise<ScannedPage | null> {
  const res = await httpGet(info.url, ['text/html', 'text/plain']).catch(() => null)
  if (!res) return null
  const content = extractContent(res.body)
  if (!content || content.length < 60) return null
  const title = info.pageType === 'Homepage' ? extractTitle(res.body) || info.url : extractTitle(res.body) || info.title || info.url
  const headings = extractHeadings(res.body)
  const pageType = classify(info.url, info.pageType, title, headings)
  const trimmed = content.length > 9000 ? content.slice(0, 9000) : content
  return {
    url: res.finalUrl,
    title,
    pageType,
    headings,
    content: trimmed,
    contentHash: createHash('sha256').update(trimmed).digest('hex').slice(0, 16),
  }
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/* ----------------------------- ATLAS profiles ----------------------------- */

function emptyProfiles(companyName: string, domain: string): WebsiteProfiles {
  return {
    brand: {
      companyName: companyName || domain,
      industry: UNKNOWN,
      businessModel: UNKNOWN,
      positioning: UNKNOWN,
      valuePropositions: [],
      differentiators: [],
      brandVoice: UNKNOWN,
      tone: UNKNOWN,
      primaryPromises: [],
      authoritySignals: [],
      sourceUrls: [],
    },
    audience: {
      primaryAudiences: [],
      secondaryAudiences: [],
      customerTypes: [],
      problems: [],
      desires: [],
      outcomes: [],
      audienceLanguage: [],
      sourceUrls: [],
    },
    offer: {
      products: [],
      services: [],
      programs: [],
      primaryOffer: UNKNOWN,
      secondaryOffers: [],
      leadMagnets: [],
      events: [],
      callsToAction: [],
      pricing: [],
      guarantees: [],
      sourceUrls: [],
    },
    messaging: {
      themes: [],
      headlines: [],
      commonPhrases: [],
      vocabulary: [],
      claims: [],
      emotionalLanguage: [],
      callsToAction: [],
      differentiators: [],
      identityLanguage: [],
      transformationLanguage: [],
      sourceUrls: [],
    },
    proof: {
      testimonials: [],
      caseStudies: [],
      successStories: [],
      results: [],
      statistics: [],
      awards: [],
      partnerships: [],
      certifications: [],
      authoritySignals: [],
      sourceUrls: [],
    },
  }
}

/**
 * Recover an object from JSON that was cut off mid-write (the model hit its
 * output ceiling). Walks the text tracking string/escape state, discards the
 * incomplete tail, and closes whatever structures are still open. Returns null
 * if the result still will not parse — this only ever salvages, never invents.
 */
function salvageJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  if (start === -1) return null

  // Every index at which the text could plausibly be cut and closed — the end
  // of a completed string, number, keyword, or bracket. Collected on one pass,
  // then tried newest-first so the most content survives. Trying candidates
  // rather than committing to a single guess is what recovers the awkward
  // cases, e.g. a cut-off inside a value whose key had already been written.
  const cuts: number[] = []
  let inString = false
  let escaped = false
  let depth = 0

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      if (!inString) cuts.push(i)
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      cuts.push(i)
      if (depth === 0) break
    } else if (ch === ',' || /[0-9a-z]/i.test(ch)) {
      cuts.push(i)
    }
  }

  for (let c = cuts.length - 1; c >= 0; c--) {
    const end = cuts[c]
    if (end <= start) continue
    let body = cleaned.slice(start, end + 1).replace(/[,\s]*$/, '')
    // Re-derive what is still open at this cut point and close it.
    const open: string[] = []
    let s = false
    let esc = false
    for (const ch of body) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        if (s) esc = true
        continue
      }
      if (ch === '"') {
        s = !s
        continue
      }
      if (s) continue
      if (ch === '{' || ch === '[') open.push(ch)
      else if (ch === '}' || ch === ']') open.pop()
    }
    if (s) continue // cut lands inside a string — try an earlier candidate
    // A dangling key ("foo": with no value, or a trailing bare key) cannot be
    // closed meaningfully; drop it and let an earlier cut win.
    if (/[:,]\s*$/.test(body) || /"[^"]*"\s*:\s*$/.test(body)) continue
    for (let i = open.length - 1; i >= 0; i--) body += open[i] === '{' ? '}' : ']'

    try {
      const parsed = JSON.parse(body) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* try an earlier cut */
    }
  }
  return null
}

/**
 * Retry a model call through transient failures. A rate limit or an overloaded
 * upstream used to lose a whole profile silently.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX = 2
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number })?.status
      const retriable = status === 429 || status === 500 || status === 503 || status === 529
      if (!retriable || attempt === MAX) throw err
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
    }
  }
  throw lastErr
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 25)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function asScalar(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || UNKNOWN
}

function mergeProfiles(base: WebsiteProfiles, raw: Record<string, unknown>, sourceUrls: string[]): WebsiteProfiles {
  const b = (raw.brand ?? {}) as Record<string, unknown>
  const a = (raw.audience ?? {}) as Record<string, unknown>
  const o = (raw.offer ?? {}) as Record<string, unknown>
  const m = (raw.messaging ?? {}) as Record<string, unknown>
  const p = (raw.proof ?? {}) as Record<string, unknown>
  return {
    brand: {
      companyName: asScalar(b.companyName) === UNKNOWN ? base.brand.companyName : asScalar(b.companyName),
      industry: asScalar(b.industry),
      businessModel: asScalar(b.businessModel),
      positioning: asScalar(b.positioning),
      valuePropositions: asArray(b.valuePropositions),
      differentiators: asArray(b.differentiators),
      brandVoice: asScalar(b.brandVoice),
      tone: asScalar(b.tone),
      primaryPromises: asArray(b.primaryPromises),
      authoritySignals: asArray(b.authoritySignals),
      sourceUrls,
    },
    audience: {
      primaryAudiences: asArray(a.primaryAudiences),
      secondaryAudiences: asArray(a.secondaryAudiences),
      customerTypes: asArray(a.customerTypes),
      problems: asArray(a.problems),
      desires: asArray(a.desires),
      outcomes: asArray(a.outcomes),
      audienceLanguage: asArray(a.audienceLanguage),
      sourceUrls,
    },
    offer: {
      products: asArray(o.products),
      services: asArray(o.services),
      programs: asArray(o.programs),
      primaryOffer: asScalar(o.primaryOffer),
      secondaryOffers: asArray(o.secondaryOffers),
      leadMagnets: asArray(o.leadMagnets),
      events: asArray(o.events),
      callsToAction: asArray(o.callsToAction),
      pricing: asArray(o.pricing),
      guarantees: asArray(o.guarantees),
      sourceUrls,
    },
    messaging: {
      themes: asArray(m.themes),
      headlines: asArray(m.headlines),
      commonPhrases: asArray(m.commonPhrases),
      vocabulary: asArray(m.vocabulary),
      claims: asArray(m.claims),
      emotionalLanguage: asArray(m.emotionalLanguage),
      callsToAction: asArray(m.callsToAction),
      differentiators: asArray(m.differentiators),
      identityLanguage: asArray(m.identityLanguage),
      transformationLanguage: asArray(m.transformationLanguage),
      sourceUrls,
    },
    proof: {
      testimonials: asArray(p.testimonials),
      caseStudies: asArray(p.caseStudies),
      successStories: asArray(p.successStories),
      results: asArray(p.results),
      statistics: asArray(p.statistics),
      awards: asArray(p.awards),
      partnerships: asArray(p.partnerships),
      certifications: asArray(p.certifications),
      authoritySignals: asArray(p.authoritySignals),
      sourceUrls,
    },
  }
}

/**
 * One extraction per profile.
 *
 * All five profiles used to be extracted in a SINGLE call capped at 3,500
 * output tokens against a ~45-field schema. A content-rich site overruns that,
 * and a truncated response is unparseable — `parseModelJson`'s brace-slice
 * fallback cannot repair an object that was cut off mid-write. The throw was
 * caught, the empty profiles returned, and the UI rendered a total extraction
 * failure as "Not confidently identified" on every field, indistinguishable
 * from a site that genuinely says nothing.
 *
 * Split per profile, each request is a fraction of the schema and nowhere near
 * its ceiling, the five run concurrently (so it is no slower), and one bad
 * response costs that profile only instead of all five.
 */
const PROFILE_SPECS: {
  key: keyof WebsiteProfiles
  label: string
  focus: string
  shape: string
}[] = [
  {
    key: 'brand',
    label: 'Brand',
    focus:
      'who this company is, what industry and business model they operate in, how they position themselves, their value propositions, differentiators, voice, tone, promises, and authority signals',
    shape:
      '{"companyName":"","industry":"","businessModel":"","positioning":"","valuePropositions":[],"differentiators":[],"brandVoice":"","tone":"","primaryPromises":[],"authoritySignals":[]}',
  },
  {
    key: 'audience',
    label: 'Audience',
    focus:
      'who the company says it serves — primary and secondary audiences, customer types, the problems they have, what they desire, the outcomes promised, and the exact language used to describe them',
    shape:
      '{"primaryAudiences":[],"secondaryAudiences":[],"customerTypes":[],"problems":[],"desires":[],"outcomes":[],"audienceLanguage":[]}',
  },
  {
    key: 'offer',
    label: 'Offer',
    focus:
      'everything the company sells or offers — products, services, programs, the primary offer, secondary offers, lead magnets, events, calls to action, pricing, and guarantees',
    shape:
      '{"products":[],"services":[],"programs":[],"primaryOffer":"","secondaryOffers":[],"leadMagnets":[],"events":[],"callsToAction":[],"pricing":[],"guarantees":[]}',
  },
  {
    key: 'messaging',
    label: 'Messaging',
    focus:
      'how the company communicates — recurring themes, actual headlines, common phrases, vocabulary, claims, emotional language, calls to action, differentiators, identity language, and transformation language',
    shape:
      '{"themes":[],"headlines":[],"commonPhrases":[],"vocabulary":[],"claims":[],"emotionalLanguage":[],"callsToAction":[],"differentiators":[],"identityLanguage":[],"transformationLanguage":[]}',
  },
  {
    key: 'proof',
    label: 'Proof',
    focus:
      'every proof element the company presents — testimonials, case studies, success stories, results, statistics, awards, partnerships, certifications, and authority signals',
    shape:
      '{"testimonials":[],"caseStudies":[],"successStories":[],"results":[],"statistics":[],"awards":[],"partnerships":[],"certifications":[],"authoritySignals":[]}',
  },
]

/** What actually happened during extraction — reported, never swallowed. */
export interface ProfileExtraction {
  profiles: WebsiteProfiles
  /** Profiles whose extraction failed outright (not "found nothing"). */
  failed: string[]
  /** True when no model key is configured, so nothing was extracted at all. */
  skipped: boolean
  /**
   * The first extraction error, condensed for the builder. "Retry" and "your
   * API key is rejected" are different instructions, and a blank panel gave
   * no way to tell which one applied.
   */
  failureReason?: string
}

/** Condense a model/API error into one line a builder can act on. */
function describeError(err: unknown): string {
  const status = (err as { status?: number })?.status
  const message = err instanceof Error ? err.message : String(err)
  if (status === 401 || status === 403) return 'ANTHROPIC_API_KEY was rejected (401/403) — check the key.'
  if (status === 429) return 'Rate limited by the model API (429) — retry shortly.'
  if (status === 400) return `Model rejected the request (400): ${message.slice(0, 160)}`
  if (status && status >= 500) return `Model API unavailable (${status}) — retry shortly.`
  return message.slice(0, 200)
}

/**
 * The extraction rules every profile shares. Kept byte-identical across all five
 * calls so it sits inside the cached prefix — any per-profile wording in here
 * would break the prefix match and cost five full-price reads of the corpus.
 */
const ATLAS_EXTRACTION_RULES = `You are ATLAS, the Website Intelligence layer for The Professional Builder. You analyse a company's OWN public website and build structured intelligence profiles from it. CRITICAL: do not invent details — only include what the website actually states. Use [] for any list with no evidence and "Not confidently identified" for any unknown scalar. Treat audiences as company-stated (not verified research) and proof as company-provided claims. Be thorough: extract every distinct item the site supports, as short strings. Reply with ONLY a JSON object, no prose, no markdown fences.`

async function extractProfile(
  anthropic: Anthropic,
  spec: (typeof PROFILE_SPECS)[number],
  corpus: string,
  domain: string,
  model: string = MODEL,
): Promise<Record<string, unknown> | null> {
  const response = await withRetry(() =>
    anthropic.messages.create({
      model,
      // Generous headroom: one profile is ~10 fields, so this is far above what
      // even a very rich site produces. Truncation was the original failure.
      max_tokens: 4000,
      // Prompt-cache layout. All five profiles read the SAME scanned corpus —
      // the only thing that differs is which profile to build. So the shared
      // part (rules + domain + corpus) goes FIRST with a cache breakpoint, and
      // the per-profile ask goes after it. Caching is a prefix match, so the
      // per-spec text must never appear before the breakpoint or nothing hits.
      // Previously each call carried the corpus in its user turn behind a
      // spec-specific system prompt: five cold reads of the same ~6k tokens.
      system: [
        {
          type: 'text' as const,
          text: `${ATLAS_EXTRACTION_RULES}\n\nCompany domain: ${domain}\n\nWebsite content:\n"""${corpus}"""`,
          cache_control: { type: 'ephemeral' as const },
        },
        { type: 'text' as const, text: `Build the ${spec.label} profile: ${spec.focus}.` },
      ],
      messages: [
        {
          role: 'user',
          content: `Build the ${spec.label} profile from the website content above.\n\nReturn JSON with exactly this shape:\n${spec.shape}`,
        },
      ],
    }),
  )
  const out = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
  if (!out.trim()) return null
  try {
    return parseModelJson<Record<string, unknown>>(out)
  } catch {
    // A response cut off mid-object still holds most of its fields — recover
    // them rather than discarding the whole profile.
    const salvaged = salvageJsonObject(out)
    if (salvaged) {
      console.warn(`ATLAS ${spec.label} profile: response was truncated, salvaged partial JSON.`)
      return salvaged
    }
    throw new Error(`${spec.label} profile returned unparseable JSON`)
  }
}

async function deriveProfiles(
  pages: ScannedPage[],
  companyName: string,
  domain: string,
): Promise<ProfileExtraction> {
  const base = emptyProfiles(companyName, domain)
  const sourceUrls = pages.map((p) => p.url)
  if (!process.env.ANTHROPIC_API_KEY || pages.length === 0) {
    return { profiles: base, failed: [], skipped: !process.env.ANTHROPIC_API_KEY }
  }

  const corpus = pages
    .map((p) => `## [${p.pageType}] ${p.title}\nURL: ${p.url}\n${p.content.slice(0, 1800)}`)
    .join('\n\n')
    .slice(0, PROFILE_INPUT_CHARS)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const runSpec = async (spec: (typeof PROFILE_SPECS)[number]) => {
    try {
      return { key: spec.key, label: spec.label, raw: await extractProfile(anthropic, spec, corpus, domain) }
    } catch (err) {
      console.error(`ATLAS ${spec.label} profile extraction failed on ${MODEL}:`, err)
      // One more attempt on a different model before writing the profile off.
      // A model-specific outage or an unparseable reply from one tier is not
      // a reason to lose a whole profile — losing all five is how a refresh
      // turned a fully extracted brand into blanks.
      try {
        const raw = await extractProfile(anthropic, spec, corpus, domain, ORCHESTRATOR_FALLBACK_MODEL)
        console.warn(`ATLAS ${spec.label} profile recovered on ${ORCHESTRATOR_FALLBACK_MODEL}.`)
        return { key: spec.key, label: spec.label, raw }
      } catch (fallbackErr) {
        console.error(`ATLAS ${spec.label} profile extraction failed on fallback:`, fallbackErr)
        return { key: spec.key, label: spec.label, raw: null, error: describeError(fallbackErr) }
      }
    }
  }

  // The five profiles share one cached corpus prefix, and a cache entry only
  // becomes readable once the request that writes it has started responding.
  // Firing all five at once means five simultaneous cache MISSES — each pays
  // full price for the same ~6k tokens. So land the first one, then fan the
  // remaining four out in parallel against the warm entry. Costs one call's
  // latency; saves four cold reads of the corpus on every scan.
  //
  // A fallback-model retry inside runSpec writes its own separate cache entry
  // (caches are model-scoped). That is the correct trade: the retry only runs
  // when a profile would otherwise be lost.
  const [first, ...rest] = PROFILE_SPECS
  const results = [await runSpec(first), ...(await Promise.all(rest.map(runSpec)))]

  const merged: Record<string, unknown> = {}
  const failed: string[] = []
  let failureReason: string | undefined
  for (const r of results) {
    if (r.raw) merged[r.key] = r.raw
    else {
      failed.push(r.label)
      failureReason ??= (r as { error?: string }).error
    }
  }

  return { profiles: mergeProfiles(base, merged, sourceUrls), failed, skipped: false, failureReason }
}

/* ------------------------------- Persistence ------------------------------ */

const PROFILE_META: { key: keyof WebsiteProfiles; category: string; title: string }[] = [
  { key: 'brand', category: 'Brand Profile', title: 'Brand Intelligence Profile' },
  { key: 'audience', category: 'Audience Profile', title: 'Audience Profile' },
  { key: 'offer', category: 'Offer Profile', title: 'Offer Profile' },
  { key: 'messaging', category: 'Messaging Profile', title: 'Messaging Profile' },
  { key: 'proof', category: 'Proof Profile', title: 'Proof Profile' },
]

function persistConfigured(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

function labelize(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

// Human-readable serialization of a profile for embedding/retrieval.
function profileToText(title: string, profile: Record<string, unknown>): string {
  const lines = Object.entries(profile)
    .filter(([k]) => k !== 'sourceUrls')
    .map(([k, v]) => {
      if (Array.isArray(v)) return v.length ? `${labelize(k)}: ${v.join('; ')}` : ''
      return v && v !== UNKNOWN ? `${labelize(k)}: ${v}` : ''
    })
    .filter(Boolean)
  return `${title}\n\n${lines.join('\n')}`
}

// One connected website at a time: clear ALL website chunks before ingesting a
// scan. Makes refresh (same domain) and switching company (new domain) behave
// identically — no leftovers, no duplicates, no cross-company contamination.
async function clearAllWebsites(): Promise<void> {
  if (!persistConfigured()) return
  const { error } = await getSupabaseAdmin()
    .from('knowledge_chunks')
    .delete()
    .eq('system', 'website')
  if (error) throw error
}

/* -------------------------------- Analyze --------------------------------- */

function emptyMetrics(): WebsiteMetrics {
  return {
    pagesScanned: 0,
    pagesIndexed: 0,
    intelligenceSignals: 0,
    offersFound: 0,
    audiencesDetected: 0,
    proofAssets: 0,
    profilesCreated: 0,
  }
}

/**
 * How many real facts a profile carries. `sourceUrls` is bookkeeping and the
 * brand profile's `companyName` is derived from the page title before any model
 * runs — neither is evidence the extraction produced anything, so neither
 * counts. This is the test for "did this profile actually get extracted".
 */
function profileFacts(p: Record<string, unknown>): number {
  return Object.entries(p)
    .filter(([k]) => k !== 'sourceUrls' && k !== 'companyName')
    .reduce((s, [, v]) => s + (Array.isArray(v) ? v.length : v && v !== UNKNOWN ? 1 : 0), 0)
}

function countSignals(profiles: WebsiteProfiles): WebsiteMetrics {
  const arr = (p: Record<string, unknown>) =>
    Object.entries(p)
      .filter(([k]) => k !== 'sourceUrls')
      .reduce((s, [, v]) => s + (Array.isArray(v) ? v.length : v && v !== UNKNOWN ? 1 : 0), 0)
  const offersFound =
    profiles.offer.products.length +
    profiles.offer.services.length +
    profiles.offer.programs.length +
    profiles.offer.secondaryOffers.length +
    (profiles.offer.primaryOffer !== UNKNOWN ? 1 : 0)
  const audiencesDetected =
    profiles.audience.primaryAudiences.length +
    profiles.audience.secondaryAudiences.length +
    profiles.audience.customerTypes.length
  const proofAssets =
    profiles.proof.testimonials.length +
    profiles.proof.caseStudies.length +
    profiles.proof.successStories.length +
    profiles.proof.results.length +
    profiles.proof.statistics.length +
    profiles.proof.awards.length
  const intelligenceSignals =
    arr(profiles.brand as unknown as Record<string, unknown>) +
    arr(profiles.audience as unknown as Record<string, unknown>) +
    arr(profiles.offer as unknown as Record<string, unknown>) +
    arr(profiles.messaging as unknown as Record<string, unknown>) +
    arr(profiles.proof as unknown as Record<string, unknown>)
  // Only profiles that actually carry something count as created. Reporting a
  // flat 5 claimed a full set even when every extraction came back empty.
  const profilesCreated = (
    ['brand', 'audience', 'offer', 'messaging', 'proof'] as (keyof WebsiteProfiles)[]
  ).filter((k) => profileFacts(profiles[k] as unknown as Record<string, unknown>) > 0).length

  return {
    ...emptyMetrics(),
    intelligenceSignals,
    offersFound,
    audiencesDetected,
    proofAssets,
    profilesCreated,
  }
}

function overviewFrom(profiles: WebsiteProfiles): WebsiteOverview {
  return {
    companyName: profiles.brand.companyName,
    industry: profiles.brand.industry,
    positioning: profiles.brand.positioning,
    primaryAudience: profiles.audience.primaryAudiences[0] ?? UNKNOWN,
    primaryOffer: profiles.offer.primaryOffer,
    brandVoice: profiles.brand.brandVoice,
  }
}

/**
 * Run a full website analysis: discover → scan → derive profiles → ingest.
 * Streams polished progress via `emit`. Returns the final summary. The platform
 * keeps ONE connected website at a time: any previously connected site is
 * cleared just before ingest, so a re-scan is a clean refresh and a new URL
 * swaps the company in a single step. The clear runs only after the scan
 * succeeds, so a failed fetch never wipes the existing site. Partial page
 * failures never fail the whole scan.
 */
export async function analyzeWebsite(
  rawUrl: string,
  emit: (e: AnalyzeEvent) => void,
): Promise<WebsiteSummary> {
  emit({ type: 'progress', message: 'ATLAS initialised' })
  const seed = assertSafeUrl(rawUrl)
  const domain = rootDomain(seed.hostname)

  emit({ type: 'progress', message: 'Connecting to website…' })
  const home = await httpGet(seed.toString(), ['text/html', 'text/plain'])
  if (!home) {
    throw new Error('Could not reach that website. Check the address and try again.')
  }

  emit({ type: 'progress', message: 'Discovering useful pages…' })
  const discovered = await discoverPages(new URL(home.finalUrl), home.body)

  emit({ type: 'progress', message: 'Extracting company intelligence…' })
  const scanned = (await mapPool(discovered, FETCH_CONCURRENCY, scanPage)).filter(
    (p): p is ScannedPage => p !== null,
  )
  const failedPages = discovered
    .filter((d) => !scanned.some((s) => normPath(s.url) === normPath(d.url)))
    .map((d) => ({ url: d.url, reason: 'Could not extract readable content' }))

  if (scanned.length === 0) {
    throw new Error('No readable pages could be analysed on this website.')
  }

  emit({ type: 'progress', message: 'Identifying offers…' })
  emit({ type: 'progress', message: 'Analysing audience signals…' })
  emit({ type: 'progress', message: 'Detecting testimonials and proof…' })

  const companyName = extractTitle(home.body) || domain
  let brandAssets = extractBrandAssets(home.body, new URL(home.finalUrl))
  const extraction = await deriveProfiles(scanned, companyName, domain)
  const profiles = extraction.profiles

  // A scan that derives nothing must never erase intelligence that is already
  // banked. This is exactly how a connected site turned into sixteen indexed
  // pages and five blank profiles: the refresh cleared the Vault first, then
  // the extraction came back empty and the blanks were written over the top.
  // Carry every profile the new scan failed to produce across from the last
  // good scan of the same domain, per profile, and say which ones were kept.
  const preservedProfiles: string[] = []
  const previous = await getConnectedWebsite().catch(() => null)
  if (previous && previous.domain === domain) {
    for (const meta of PROFILE_META) {
      const fresh = profiles[meta.key] as unknown as Record<string, unknown>
      const prior = previous.profiles[meta.key] as unknown as Record<string, unknown>
      if (profileFacts(fresh) === 0 && profileFacts(prior) > 0) {
        ;(profiles as unknown as Record<string, unknown>)[meta.key] = prior
        preservedProfiles.push(meta.title.replace(/ Profile$/, '').replace(/^Brand Intelligence$/, 'Brand'))
      }
    }
    // Same rule for the visual assets: a markup read that found no logo or no
    // colours keeps the ones already captured instead of blanking them.
    if (previous.brandAssets) {
      brandAssets = {
        logoUrl: brandAssets.logoUrl ?? previous.brandAssets.logoUrl,
        colors: brandAssets.colors.length ? brandAssets.colors : previous.brandAssets.colors,
      }
    }
  }
  if (preservedProfiles.length > 0) {
    emit({
      type: 'progress',
      message: `Kept previously extracted ${preservedProfiles.join(', ')} intelligence — this scan derived none.`,
    })
  }

  for (const meta of PROFILE_META) {
    emit({ type: 'progress', message: `Building ${meta.title}…` })
  }

  // A failed extraction must never be presented as "the site says nothing".
  // Those are different answers and only one of them is worth a re-run. This
  // surfaces live in the progress feed; it also rides on the summary
  // (`extractionFailed`) so the panel keeps showing it after the run ends.
  if (extraction.skipped) {
    emit({
      type: 'progress',
      message: 'No ANTHROPIC_API_KEY configured — pages indexed, no profiles derived.',
    })
  } else if (extraction.failed.length > 0) {
    emit({
      type: 'progress',
      message: `⚠ ${extraction.failed.join(', ')} intelligence could not be derived — retry with Refresh.`,
    })
  }

  emit({ type: 'progress', message: 'Embedding website knowledge…' })

  const now = new Date().toISOString()
  let stored = false
  let pagesIndexed = 0

  if (persistConfigured()) {
    // Clear any previously connected website first, then re-ingest this scan.
    // A new domain replaces the old company; a re-scan of the same domain is a
    // clean refresh. Runs only after the scan succeeded, so a failed fetch can
    // never wipe the existing site prematurely.
    await clearAllWebsites()

    for (const page of scanned) {
      const result = await ingestKnowledge({
        system: 'website',
        category: 'Website Page',
        title: page.title,
        content: page.content,
        metadata: {
          source_type: 'website',
          intelligence_system: 'website_intelligence',
          domain,
          source_url: page.url,
          page_type: page.pageType,
          category: 'Website Page',
          title: page.title,
          content_hash: page.contentHash,
          last_scanned_at: now,
          derived: false,
        },
      })
      if (result.stored) {
        stored = true
        pagesIndexed += 1
      }
    }

    for (const meta of PROFILE_META) {
      const profile = profiles[meta.key]
      const result = await ingestKnowledge({
        system: 'website',
        category: meta.category,
        title: meta.title,
        content: profileToText(meta.title, profile as unknown as Record<string, unknown>),
        metadata: {
          source_type: 'website',
          intelligence_system: 'website_intelligence',
          domain,
          source_url: seed.toString(),
          page_type: 'Derived Profile',
          category: meta.category,
          title: meta.title,
          content_hash: createHash('sha256')
            .update(JSON.stringify(profile))
            .digest('hex')
            .slice(0, 16),
          last_scanned_at: now,
          derived: true,
          profile,
          // Ride the run's extraction health along with the profile so the
          // panel can still tell "extraction failed" from "the site says
          // nothing" after a page refresh, not only live during the scan.
          extraction_failed: extraction.failed,
          extraction_skipped: extraction.skipped,
          extraction_error: extraction.failureReason ?? null,
          preserved_profiles: preservedProfiles,
          // The brand's visual assets ride on the brand profile chunk, so
          // getConnectedWebsite can read them back without a dedicated row.
          ...(meta.key === 'brand' ? { brand_assets: brandAssets } : {}),
        },
      })
      if (result.stored) stored = true
    }
  }

  const metrics = countSignals(profiles)
  metrics.pagesScanned = scanned.length
  metrics.pagesIndexed = stored ? pagesIndexed : scanned.length

  const summary: WebsiteSummary = {
    connected: true,
    url: seed.toString(),
    domain,
    lastScanned: now,
    stored,
    metrics,
    overview: overviewFrom(profiles),
    profiles,
    pages: scanned.map((p) => ({ url: p.url, title: p.title, pageType: p.pageType })),
    brandAssets,
    failedPages,
    extractionFailed: extraction.failed,
    extractionSkipped: extraction.skipped,
    extractionError: extraction.failureReason,
    preservedProfiles,
  }

  emit({ type: 'progress', message: 'Website Intelligence ready.' })
  emit({ type: 'complete', summary })
  return summary
}

/* ------------------------- Connected-website read ------------------------- */

interface WebsiteRow {
  category: string | null
  title: string
  created_at: string | null
  metadata: Record<string, unknown> | null
}

/** Reconstruct the connected-website summary from stored chunks (panel state). */
export async function getConnectedWebsite(): Promise<WebsiteSummary | null> {
  if (!persistConfigured()) return null
  const { data, error } = await getSupabaseAdmin()
    .from('knowledge_chunks')
    .select('category, title, created_at, metadata')
    .eq('system', 'website')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) {
    console.error('getConnectedWebsite failed:', error)
    return null
  }
  const rows = (data ?? []) as WebsiteRow[]
  if (rows.length === 0) return null

  // MVP supports one connected website — use the most recently scanned domain.
  const domain = String(rows[0].metadata?.domain ?? '')
  if (!domain) return null
  const mine = rows.filter((r) => String(r.metadata?.domain ?? '') === domain)

  const profiles = emptyProfiles(domain, domain)
  let brandAssets: BrandAssets | undefined
  let extractionFailed: string[] = []
  let extractionSkipped = false
  let extractionError: string | undefined
  let preservedProfiles: string[] = []
  for (const meta of PROFILE_META) {
    const row = mine.find((r) => r.metadata?.derived === true && r.category === meta.category)
    const stored = row?.metadata?.profile
    if (stored && typeof stored === 'object') {
      ;(profiles as unknown as Record<string, unknown>)[meta.key] = stored
    }
    const assets = row?.metadata?.brand_assets
    if (meta.key === 'brand' && assets && typeof assets === 'object') {
      brandAssets = assets as BrandAssets
    }
    // Extraction health was written onto every derived chunk by the scan that
    // produced it — read it off whichever profile row we have.
    const failed = row?.metadata?.extraction_failed
    if (Array.isArray(failed) && failed.length) extractionFailed = failed.map(String)
    if (row?.metadata?.extraction_skipped === true) extractionSkipped = true
    const errText = row?.metadata?.extraction_error
    if (typeof errText === 'string' && errText.trim()) extractionError = errText
    const preserved = row?.metadata?.preserved_profiles
    if (Array.isArray(preserved) && preserved.length) preservedProfiles = preserved.map(String)
  }

  // One entry per scanned page URL (non-derived chunks may repeat per chunk).
  const pageMap = new Map<string, WebsitePageInfo>()
  let homepageUrl = ''
  let lastScanned: string | null = null
  for (const r of mine) {
    const url = String(r.metadata?.source_url ?? '')
    const scannedAt = (r.metadata?.last_scanned_at as string) ?? r.created_at
    if (scannedAt && (!lastScanned || scannedAt > lastScanned)) lastScanned = scannedAt
    if (r.metadata?.derived === true) {
      if (!homepageUrl) homepageUrl = url
      continue
    }
    if (url && !pageMap.has(url)) {
      pageMap.set(url, {
        url,
        title: String(r.metadata?.title ?? r.title),
        pageType: (r.metadata?.page_type as PageType) ?? 'Other',
      })
    }
  }
  const pages = Array.from(pageMap.values())
  if (!homepageUrl) homepageUrl = pages.find((p) => p.pageType === 'Homepage')?.url ?? `https://${domain}`

  const metrics = countSignals(profiles)
  metrics.pagesScanned = pages.length
  metrics.pagesIndexed = pages.length

  return {
    connected: true,
    url: homepageUrl,
    domain,
    lastScanned,
    stored: true,
    metrics,
    overview: overviewFrom(profiles),
    profiles,
    pages,
    brandAssets,
    failedPages: [],
    extractionFailed,
    extractionSkipped,
    extractionError,
    preservedProfiles,
  }
}

/** Disconnect a website — remove all of its stored chunks from the Vault. */
export async function disconnectWebsite(domain: string): Promise<void> {
  if (!persistConfigured()) throw new Error('Vector store not configured')
  const root = rootDomain(domain)
  const { error } = await getSupabaseAdmin()
    .from('knowledge_chunks')
    .delete()
    .eq('system', 'website')
    .eq('metadata->>domain', root)
  if (error) throw error
}
