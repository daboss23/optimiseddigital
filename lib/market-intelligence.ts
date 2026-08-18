// NOVA — Market Intelligence. The platform's field researcher. NOVA goes to the
// places the market actually talks — Reddit trade communities, YouTube, pro
// forums, reviews — pulls the real conversations, and extracts the psychographic
// profile that drives winning campaigns: what keeps builders up at night, what
// they hate, what they dream about, the exact words they use.
//
// The extracted intelligence is embedded back into the knowledge layer as
// `research` + `transformation` chunks, so OPUS retrieves it on every future run
// (NOVA's systems are `['research','transformation','website']`). This mirrors
// ATLAS (website) and SPARK (creative DNA): fetch → extract → embed → compound.
//
// Everything degrades gracefully. No Anthropic key → a heuristic read. No
// Supabase/Voyage → the profile is returned but not persisted. Never throws on a
// missing key; a failed fetch resolves to an error event, never a crash.

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { ingestKnowledge } from '@/lib/knowledge'
import { getSupabaseAdmin, supabaseUrl } from '@/lib/supabase'
import { fetchReadablePage, assertSafeUrl } from '@/lib/website-intelligence'
import { fetchYouTubeTranscript } from '@/lib/youtube'
import { parseModelJson } from '@/lib/parse'
import { INTELLIGENCE_MODEL } from '@/lib/models'
import { getTenant, tenantDescriptor, type TenantProfile } from '@/lib/tenant'

// NOVA extracts with the bulk model (single-shot, cost-aware) — same tier the
// other intelligence layers run on.
const MODEL = INTELLIGENCE_MODEL

// Cap on how much raw conversation text we feed the extractor per run.
const MAX_EXTRACT_CHARS = 16_000

/* ----------------------------- Source registry ---------------------------- */
// The "most relevant sites" NOVA mines for a trades / construction business
// audience — surfaced in the UI so the builder starts from high-signal places
// instead of a blank box.

export interface NovaSubreddit {
  sub: string
  note: string
}


export interface NovaForum {
  name: string
  url: string
  note: string
}


/* -------------------------------- Types ----------------------------------- */

export type NovaSourceType = 'reddit' | 'youtube' | 'web' | 'text'

export interface NovaResearchInput {
  sourceType: NovaSourceType
  /** Reddit thread / YouTube / web page URL. */
  url?: string
  /** Subreddit name for Reddit search/browse mode (no leading r/). */
  subreddit?: string
  /** Optional keyword to focus a Reddit search. */
  query?: string
  /** Pasted conversation text. */
  text?: string
  /** Optional human label for the source. */
  title?: string
  builderId?: string | null
}

// The psychographic profile NOVA extracts — the builder's brief, in their own
// words. Every field is voice-of-customer, evidenced from the source.
export interface MarketIntelProfile {
  audienceSnapshot: string
  /** Fears / anxieties — what keeps them up at night. */
  keepThemUpAtNight: string[]
  /** Dislikes — what they hate, complain about, rant about. */
  frustrations: string[]
  /** Pains — what is actually broken in their business / life. */
  problems: string[]
  /** Dreams, goals, aspirations — where they want to be. */
  desires: string[]
  /** What brings them joy — pride, wins, what they love. */
  joys: string[]
  /** Beliefs / worldview — what they hold to be true. */
  beliefs: string[]
  /** Objections — distrust, why they don't buy. */
  objections: string[]
  /** Verbatim phrases — the exact language to write hooks in. */
  exactPhrases: string[]
  /** Trigger events — the moment they start looking for a way out. */
  triggerEvents: string[]
  summary: string
}

export interface NovaSourceMeta {
  type: NovaSourceType
  label: string
  url?: string
  /** How many distinct conversations / posts / comments fed the read. */
  itemsAnalyzed: number
}

export interface MarketIntelResult {
  profile: MarketIntelProfile
  source: NovaSourceMeta
  stored: boolean
  chunks: number
}

export type NovaEvent =
  | { type: 'progress'; message: string }
  | { type: 'complete'; result: MarketIntelResult }
  | { type: 'error'; message: string }

interface GatheredSource {
  text: string
  meta: NovaSourceMeta
}

/* -------------------------------- Reddit ---------------------------------- */
// Reddit's public JSON endpoints need no API key — just a descriptive
// User-Agent (the default fetch UA gets rate-limited). NOVA pulls top posts and
// their top comments: the rawest voice-of-customer signal available.

const REDDIT_UA = 'Reactor-NOVA/1.0 (Market Intelligence)'

function sanitizeSubreddit(s: string): string {
  return s.replace(/^\/?(r\/)?/i, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 50)
}

async function redditJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

interface RedditPost {
  title: string
  selftext: string
  permalink: string
  num_comments: number
}

function asPosts(listing: unknown): RedditPost[] {
  const children =
    (listing as { data?: { children?: { kind?: string; data?: Record<string, unknown> }[] } })?.data
      ?.children ?? []
  return children
    .filter((c) => c.kind === 't3')
    .map((c) => ({
      title: String(c.data?.title ?? ''),
      selftext: String(c.data?.selftext ?? ''),
      permalink: String(c.data?.permalink ?? ''),
      num_comments: Number(c.data?.num_comments ?? 0),
    }))
    .filter((p) => p.title)
}

// Walk a comment tree, collecting readable comment bodies (bounded by count and
// depth so a viral thread can't blow the budget).
function collectComments(children: unknown[], out: string[], max: number, depth = 0): void {
  for (const c of children) {
    if (out.length >= max) return
    const node = c as { kind?: string; data?: Record<string, unknown> }
    if (node.kind !== 't1') continue
    const body = String(node.data?.body ?? '').trim()
    if (body && body !== '[deleted]' && body !== '[removed]' && body.length > 1) {
      out.push(body)
    }
    const replies = node.data?.replies as { data?: { children?: unknown[] } } | undefined
    if (depth < 2 && replies?.data?.children?.length) {
      collectComments(replies.data.children, out, max, depth + 1)
    }
  }
}

async function fetchRedditThread(rawUrl: string, label?: string): Promise<GatheredSource | null> {
  let u: URL
  try {
    u = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (!/(^|\.)reddit\.com$/.test(u.hostname.toLowerCase())) return null
  const clean = `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  const json = await redditJson(`${clean}.json?limit=100&raw_json=1`)
  if (!Array.isArray(json) || json.length < 1) return null

  const posts = asPosts(json[0])
  const post = posts[0]
  if (!post) return null
  const comments: string[] = []
  if (json[1]) collectComments((json[1] as { data?: { children?: unknown[] } })?.data?.children ?? [], comments, 60)

  const text = [
    `THREAD: ${post.title}`,
    post.selftext && `POST: ${post.selftext}`,
    comments.length ? `COMMENTS:\n- ${comments.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    text,
    meta: {
      type: 'reddit',
      label: label || `Reddit · ${post.title.slice(0, 60)}`,
      url: clean,
      itemsAnalyzed: 1 + comments.length,
    },
  }
}

async function fetchRedditSubreddit(
  subreddit: string,
  query: string | undefined,
  timeWindow = 'year',
): Promise<GatheredSource | null> {
  const sub = sanitizeSubreddit(subreddit)
  if (!sub) return null
  const q = query?.trim()
  // Reddit accepts hour/day/week/month/year/all — the sweep uses 'week' for fresh
  // signal, the on-demand path 'year' for the strongest threads of all time.
  const t = /^(hour|day|week|month|year|all)$/.test(timeWindow) ? timeWindow : 'year'

  const listUrl = q
    ? `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=on&sort=relevance&t=${t}&limit=12&raw_json=1`
    : `https://www.reddit.com/r/${sub}/top.json?t=${t}&limit=12&raw_json=1`

  const listing = await redditJson(listUrl)
  const posts = asPosts(listing).slice(0, 10)
  if (posts.length === 0) return null

  // Pull comments from the few most-discussed posts — the richest threads.
  const topByComments = [...posts].sort((a, b) => b.num_comments - a.num_comments).slice(0, 3)
  const sections: string[] = []
  let items = posts.length
  for (const post of posts) {
    sections.push(`THREAD: ${post.title}${post.selftext ? `\n${post.selftext.slice(0, 600)}` : ''}`)
  }
  for (const post of topByComments) {
    if (!post.permalink) continue
    const json = await redditJson(`https://www.reddit.com${post.permalink}.json?limit=50&raw_json=1`)
    if (!Array.isArray(json) || !json[1]) continue
    const comments: string[] = []
    collectComments((json[1] as { data?: { children?: unknown[] } })?.data?.children ?? [], comments, 25)
    if (comments.length) {
      items += comments.length
      sections.push(`COMMENTS on "${post.title.slice(0, 70)}":\n- ${comments.join('\n- ')}`)
    }
  }

  return {
    text: sections.join('\n\n'),
    meta: {
      type: 'reddit',
      label: q ? `r/${sub} · "${q}"` : `r/${sub} · top threads`,
      url: `https://www.reddit.com/r/${sub}/`,
      itemsAnalyzed: items,
    },
  }
}

/* ----------------------------- Source gather ------------------------------ */

async function gatherSource(
  input: NovaResearchInput,
  emit: (e: NovaEvent) => void,
): Promise<GatheredSource | null> {
  const pasted = (input.text ?? '').trim()

  switch (input.sourceType) {
    case 'reddit': {
      if (input.url?.trim()) {
        emit({ type: 'progress', message: 'Reading the Reddit thread + its comments…' })
        const t = await fetchRedditThread(input.url, input.title)
        if (t && t.text.length > 40) return t
        emit({ type: 'progress', message: 'Thread unavailable — trying subreddit search…' })
      }
      if (input.subreddit?.trim()) {
        const sub = sanitizeSubreddit(input.subreddit)
        emit({
          type: 'progress',
          message: input.query?.trim()
            ? `Mining r/${sub} for "${input.query.trim()}"…`
            : `Mining r/${sub} top threads…`,
        })
        const s = await fetchRedditSubreddit(input.subreddit, input.query)
        if (s && s.text.length > 40) return s
      }
      // Reddit can hard-block server IPs — fall back to any pasted text.
      if (pasted.length > 40) {
        return { text: pasted, meta: { type: 'reddit', label: input.title || 'Reddit (pasted)', itemsAnalyzed: 1 } }
      }
      return null
    }

    case 'youtube': {
      if (!input.url?.trim()) return pasted.length > 40 ? { text: pasted, meta: { type: 'youtube', label: input.title || 'YouTube (pasted)', itemsAnalyzed: 1 } } : null
      emit({ type: 'progress', message: 'Pulling the video transcript…' })
      const t = await fetchYouTubeTranscript(input.url)
      if (t.ok && t.content.length > 40) {
        return {
          text: t.content,
          meta: { type: 'youtube', label: input.title || 'YouTube transcript', url: input.url.trim(), itemsAnalyzed: 1 },
        }
      }
      if (pasted.length > 40) {
        return { text: pasted, meta: { type: 'youtube', label: input.title || 'YouTube (pasted)', url: input.url.trim(), itemsAnalyzed: 1 } }
      }
      return null
    }

    case 'web': {
      if (!input.url?.trim()) return pasted.length > 40 ? { text: pasted, meta: { type: 'web', label: input.title || 'Web (pasted)', itemsAnalyzed: 1 } } : null
      let host = ''
      try {
        host = assertSafeUrl(input.url).hostname
      } catch {
        return pasted.length > 40 ? { text: pasted, meta: { type: 'web', label: input.title || 'Web (pasted)', itemsAnalyzed: 1 } } : null
      }
      emit({ type: 'progress', message: `Reading ${host}…` })
      const content = await fetchReadablePage(input.url)
      if (content.length > 40) {
        return {
          text: content,
          meta: { type: 'web', label: input.title || host, url: input.url.trim(), itemsAnalyzed: 1 },
        }
      }
      if (pasted.length > 40) {
        return { text: pasted, meta: { type: 'web', label: input.title || host, url: input.url.trim(), itemsAnalyzed: 1 } }
      }
      return null
    }

    case 'text':
    default:
      if (pasted.length < 40) return null
      return { text: pasted, meta: { type: 'text', label: input.title || 'Pasted conversation', itemsAnalyzed: 1 } }
  }
}

/* ------------------------------ Extraction -------------------------------- */

const EMPTY_PROFILE: MarketIntelProfile = {
  audienceSnapshot: '',
  keepThemUpAtNight: [],
  frustrations: [],
  problems: [],
  desires: [],
  joys: [],
  beliefs: [],
  objections: [],
  exactPhrases: [],
  triggerEvents: [],
  summary: '',
}

function asArray(v: unknown, max = 12): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, max)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

// Keyword-driven read used when no Anthropic key is configured — proves the
// pipeline end to end and still surfaces real lines from the source.
function heuristicProfile(text: string, meta: NovaSourceMeta): MarketIntelProfile {
  const lines = text
    .split(/\n|(?<=[.!?])\s+/)
    .map((l) => l.replace(/^[-•*\s]+/, '').trim())
    .filter((l) => l.length > 18 && l.length < 240)

  const pick = (re: RegExp, max = 5) =>
    Array.from(new Set(lines.filter((l) => re.test(l)))).slice(0, max)

  return {
    audienceSnapshot: `Voice-of-customer signal from ${meta.label}. Configure ANTHROPIC_API_KEY for NOVA's full psychographic read.`,
    keepThemUpAtNight: pick(/worr|afraid|scared|stress|anxious|can'?t sleep|overwhelm|burn(ed|t) out|drowning/i),
    frustrations: pick(/hate|annoy|frustrat|sick of|tired of|fed up|nightmare|pain in|worst/i),
    problems: pick(/problem|struggl|can'?t|cashflow|cash flow|margin|chasing|late pay|no time|under ?paid/i),
    desires: pick(/want|wish|hope|dream|goal|someday|freedom|retire|scale|grow|more time/i),
    joys: pick(/love|proud|best|enjoy|satisfy|nailed it|finally|win|great feeling/i),
    beliefs: pick(/think|believe|truth is|reality|everyone|nobody|always|never|the thing is/i),
    objections: pick(/scam|waste|too expensive|don'?t trust|skeptic|not worth|tried before|guru/i),
    exactPhrases: lines.slice(0, 8),
    triggerEvents: pick(/finally|last straw|after.*years|when i|the day|hit a wall|breaking point/i),
    summary: lines[0] ?? `Conversations from ${meta.label}.`,
  }
}

/**
 * NOVA's system prompt, addressed to THIS deployment's business rather than a
 * hard-coded one. Naming the wrong industry here is worse than naming none:
 * it makes the model profile the wrong audience with full confidence.
 */
function novaSystemPrompt(tenant: TenantProfile): string {
  const subject = tenantDescriptor(tenant)
  return `You are NOVA, the Market Intelligence layer for ${subject}. You read real customer conversations and extract the psychographic profile that drives winning campaigns. CRITICAL: only extract what the source actually evidences — never invent. Preserve the customer's EXACT words wherever possible; their language is the asset. Use [] for any list with no evidence. Reply with ONLY a JSON object, no prose, no markdown fences.`
}

/**
 * Extract NOVA's psychographic profile from raw conversation text. Uses Claude
 * when configured, otherwise a heuristic read so the pipeline always returns
 * something useful. Never throws.
 */
export async function extractMarketIntel(
  rawText: string,
  meta: NovaSourceMeta,
): Promise<MarketIntelProfile> {
  const text = rawText.slice(0, MAX_EXTRACT_CHARS)
  if (!process.env.ANTHROPIC_API_KEY || text.trim().length < 40) {
    return heuristicProfile(text, meta)
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: novaSystemPrompt(await getTenant()),
      messages: [
        {
          role: 'user',
          content: `Source: ${meta.label} (${meta.type})\n\nReal conversations:\n"""${text}"""\n\nReturn JSON with exactly these keys (each list = short verbatim-style strings, [] when absent):\n{"audienceSnapshot":"one tight sentence on who is talking and their stage","keepThemUpAtNight":[],"frustrations":[],"problems":[],"desires":[],"joys":[],"beliefs":[],"objections":[],"exactPhrases":["the most quotable real lines, verbatim"],"triggerEvents":[],"summary":"2-sentence strategic read for the campaign team"}`,
        },
      ],
    })
    const out = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const raw = parseModelJson<Record<string, unknown>>(out)
    return {
      audienceSnapshot: typeof raw.audienceSnapshot === 'string' ? raw.audienceSnapshot : '',
      keepThemUpAtNight: asArray(raw.keepThemUpAtNight),
      frustrations: asArray(raw.frustrations),
      problems: asArray(raw.problems),
      desires: asArray(raw.desires),
      joys: asArray(raw.joys),
      beliefs: asArray(raw.beliefs),
      objections: asArray(raw.objections),
      exactPhrases: asArray(raw.exactPhrases, 14),
      triggerEvents: asArray(raw.triggerEvents),
      summary: typeof raw.summary === 'string' ? raw.summary : '',
    }
  } catch (err) {
    console.error('NOVA extraction failed, using heuristic read:', err)
    return heuristicProfile(text, meta)
  }
}

/* ------------------------------- Persistence ------------------------------ */

function bullets(label: string, items: string[]): string {
  return items.length ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : ''
}

// Serialize the pains/fears/beliefs side of the profile (the "before" state) for
// the `research` system, and the desires/joys side (the "after") for the
// `transformation` system — the two NOVA reads on every consult.
function researchDoc(profile: MarketIntelProfile, meta: NovaSourceMeta): string {
  return [
    `NOVA Market Intelligence — ${meta.label}`,
    profile.audienceSnapshot && `Audience: ${profile.audienceSnapshot}`,
    bullets('Keeps them up at night', profile.keepThemUpAtNight),
    bullets('Frustrations', profile.frustrations),
    bullets('Problems', profile.problems),
    bullets('Beliefs', profile.beliefs),
    bullets('Objections', profile.objections),
    bullets('Trigger events', profile.triggerEvents),
    bullets('Voice of customer (verbatim)', profile.exactPhrases),
    profile.summary && `Summary: ${profile.summary}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function transformationDoc(profile: MarketIntelProfile, meta: NovaSourceMeta): string {
  return [
    `NOVA Desire & Aspiration Map — ${meta.label}`,
    bullets('Desires, dreams, goals', profile.desires),
    bullets('What brings them joy', profile.joys),
    bullets('Voice of customer (verbatim)', profile.exactPhrases),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Embed the extracted profile into NOVA's knowledge systems. The "before" state
 * (pains/fears/beliefs) lands in `research`; the "after" state (desires/joys) in
 * `transformation`. No-ops gracefully (stored:false) when the vector store
 * isn't configured.
 */
export async function storeMarketIntel(
  profile: MarketIntelProfile,
  meta: NovaSourceMeta,
  builderId: string | null,
  opts: { contentHash?: string } = {},
): Promise<{ stored: boolean; chunks: number }> {
  const metadata = {
    source_type: meta.type,
    intelligence_system: 'market_intelligence',
    agent: 'NOVA',
    source_url: meta.url ?? null,
    source_label: meta.label,
    items_analyzed: meta.itemsAnalyzed,
    content_hash: opts.contentHash ?? null,
    ingested_at: new Date().toISOString(),
    // The structured read rides alongside the prose so the Research dashboard can
    // show what NOVA actually found without re-parsing the embedded document.
    // Retrieval still uses the prose; this is purely the readback surface.
    profile,
  }

  let stored = false
  let chunks = 0

  const research = await ingestKnowledge({
    system: 'research',
    title: `Market Intelligence — ${meta.label}`,
    content: researchDoc(profile, meta),
    category: 'Market Intelligence',
    builderId,
    metadata,
  }).catch(() => ({ stored: false, chunks: 0 }))
  if (research.stored) stored = true
  chunks += research.chunks

  const transformationContent = transformationDoc(profile, meta)
  if (profile.desires.length || profile.joys.length) {
    const transformation = await ingestKnowledge({
      system: 'transformation',
      title: `Desire Map — ${meta.label}`,
      content: transformationContent,
      category: 'Desire & Aspiration',
      builderId,
      metadata,
    }).catch(() => ({ stored: false, chunks: 0 }))
    if (transformation.stored) stored = true
    chunks += transformation.chunks
  }

  return { stored, chunks }
}

/* ------------------------------ Orchestration ----------------------------- */

/**
 * Run NOVA's full research pipeline for one source: gather → extract → embed.
 * Streams polished progress via `emit`. Never throws — failures surface as an
 * `error` event so the caller (SSE route) can close cleanly.
 */
export async function runNovaResearch(
  input: NovaResearchInput,
  emit: (e: NovaEvent) => void,
): Promise<void> {
  emit({ type: 'progress', message: 'NOVA deploying to the field…' })

  let gathered: GatheredSource | null
  try {
    gathered = await gatherSource(input, emit)
  } catch (err) {
    console.error('NOVA gather error:', err)
    gathered = null
  }

  if (!gathered || gathered.text.trim().length < 40) {
    emit({
      type: 'error',
      message:
        'NOVA couldn’t pull enough from that source. Some sites block automated reads — paste the conversation text and she’ll analyse it.',
    })
    return
  }

  emit({ type: 'progress', message: `Reading ${gathered.meta.itemsAnalyzed} conversation signals…` })
  emit({ type: 'progress', message: 'Extracting psychographics — pains, fears, dreams, language…' })
  const profile = await extractMarketIntel(gathered.text, gathered.meta)

  emit({ type: 'progress', message: 'Embedding intelligence into NOVA’s memory…' })
  const { stored, chunks } = await storeMarketIntel(profile, gathered.meta, input.builderId ?? null, {
    contentHash: sourceHash(gathered.text),
  })

  emit({ type: 'progress', message: 'Market Intelligence ready.' })
  emit({ type: 'complete', result: { profile, source: gathered.meta, stored, chunks } })
}

/* ------------------------------ Weekly sweep ------------------------------ */
// NOVA's always-on mode: a scheduled background sweep (Vercel Cron) keeps her
// memory continuously fresh, decoupled from campaign fires. Each run pulls the
// past week's top threads across her core subreddits and embeds the new signal
// — with content-hash dedup so identical threads aren't re-ingested week over
// week. Campaigns then retrieve the latest intelligence instantly.

function sourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 24)
}

function storeReady(): boolean {
  return (
    Boolean(supabaseUrl()) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)
  )
}

// Has NOVA already embedded this exact source content? Keeps the weekly sweep
// from piling duplicates. Best-effort — any failure means "not a duplicate".
async function researchHashExists(hash: string): Promise<boolean> {
  if (!storeReady()) return false
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('knowledge_chunks')
      .select('id')
      .eq('system', 'research')
      .eq('metadata->>content_hash', hash)
      .limit(1)
    if (error) return false
    return (data?.length ?? 0) > 0
  } catch {
    return false
  }
}

// Which subreddits the sweep covers — the curated registry by default, or an
// env override (comma-separated) so the cadence/scope can be tuned per deploy.
function sweepSubs(): string[] {
  const override = process.env.NOVA_SWEEP_SUBS
  if (override?.trim()) {
    return override
      .split(',')
      .map((s) => sanitizeSubreddit(s))
      .filter(Boolean)
  }
  // No built-in list any more: a scheduled sweep with nothing configured would
  // mine one fixed market on every deployment. Set NOVA_SWEEP_SUBS to name the
  // communities worth sweeping for this business.
  return []
}

export interface NovaSweepResult {
  ran: boolean
  window: string
  subsAttempted: number
  sourcesStored: number
  skippedDuplicates: number
  chunks: number
  details: { sub: string; status: 'stored' | 'duplicate' | 'empty' | 'error'; chunks: number }[]
}

/**
 * Run a full background sweep across NOVA's core subreddits. Resilient — one
 * subreddit failing never aborts the run. Returns a per-source summary. Safe to
 * call with no keys (it simply stores nothing).
 */
export async function runNovaSweep(
  opts: { builderId?: string | null; window?: string } = {},
): Promise<NovaSweepResult> {
  const window = opts.window || process.env.NOVA_SWEEP_WINDOW || 'week'
  const subs = sweepSubs()
  const result: NovaSweepResult = {
    ran: true,
    window,
    subsAttempted: 0,
    sourcesStored: 0,
    skippedDuplicates: 0,
    chunks: 0,
    details: [],
  }

  for (const sub of subs) {
    result.subsAttempted += 1
    try {
      const gathered = await fetchRedditSubreddit(sub, undefined, window)
      if (!gathered || gathered.text.trim().length < 80) {
        result.details.push({ sub, status: 'empty', chunks: 0 })
        continue
      }
      const hash = sourceHash(gathered.text)
      if (await researchHashExists(hash)) {
        result.skippedDuplicates += 1
        result.details.push({ sub, status: 'duplicate', chunks: 0 })
        continue
      }
      const profile = await extractMarketIntel(gathered.text, gathered.meta)
      const { stored, chunks } = await storeMarketIntel(profile, gathered.meta, opts.builderId ?? null, {
        contentHash: hash,
      })
      if (stored) result.sourcesStored += 1
      result.chunks += chunks
      result.details.push({ sub, status: stored ? 'stored' : 'empty', chunks })
    } catch (err) {
      console.error(`NOVA sweep failed for r/${sub}:`, err)
      result.details.push({ sub, status: 'error', chunks: 0 })
    }
  }

  return result
}
