/**
 * Automatic proven-ad research — the layer that briefs the agents.
 *
 * The Ad Library is the MANUAL half of this source: an operator types a term
 * and studies what comes back. This is the automatic half. Nobody types
 * anything: a submitted brief is read, searches are constructed from it, the
 * strongest still-running ads are shortlisted, and their structure reaches
 * SPARK and ECHO **before** they report to OPUS — which is the only ordering
 * that matters. Evidence that arrives after the concepts are written is not
 * evidence, it is a filing cabinet.
 *
 * It exists because of one line in the orchestrator: when the Vault retrieves
 * nothing, the layers are told to "reason from first principles". On a new
 * account that is every run, and first principles is another way of saying the
 * model's own priors. This fills that gap with live ads that somebody is
 * currently paying to keep running.
 *
 * Three disciplines, all enforced here rather than left to the caller:
 *
 *   1. ELIGIBILITY IS NEVER LOWERED. A reference must be a static image ad,
 *      still listed as active, and running for at least `MIN_DAYS_ACTIVE`
 *      (90). When too few qualify, the SEARCH widens — a broader term, then
 *      every market — and each widening is named in the result. The bar does
 *      not move. A run that cannot find real evidence says so; it does not
 *      quietly hand the agents 4-day-old ads and call them proven.
 *
 *   2. COST IS BOUNDED BEFORE THE FIRST REQUEST. The source bills per returned
 *      row. At most `MAX_STEPS` searches of `PER_STEP` rows — a hard ceiling of
 *      24 billed rows per campaign — and the ladder stops the moment it has
 *      enough. The credits actually spent ride back so the run can report them.
 *
 *   3. A COMPETITOR'S RESULTS ARE NOT OUR CLAIMS. Every evidence block says so
 *      explicitly. These ads are read for STRUCTURE — hook shape, layout,
 *      proof placement, CTA framing. Their numbers, testimonials and named
 *      outcomes belong to the advertiser that ran them, and repeating one as
 *      our own is a compliance failure, not a strong ad.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LADDER EXISTS (measured against the live library, not assumed)
 *
 * Scoped to service businesses in US + AU, static, active, 90+ days running,
 * the library holds ~355 brand-capped matches. Add the free-text phrase
 * "service business lead generation" to that exact search and it returns
 * ZERO — the phrase, not the 90-day rule, is what empties the feed. A narrow
 * query against an already-filtered corpus is the failure mode here.
 *
 * So the ladder searches SHORT (one or two words, matched literally) and falls
 * back to the unqueried, fully-filtered browse, which is where the hundreds of
 * eligible ads actually live. Long phrases are never sent.
 * ---------------------------------------------------------------------------
 */

import { searchProvenAds } from './index'
import { defaultGeo, type IcpFocus } from './icp'
import type { CreditUsage, ProvenAd } from './types'

/* ------------------------------- the bounds ------------------------------- */

/**
 * Minimum days a reference must have been RUNNING. Ninety days is the brief's
 * own bar and it is a real one: an advertiser who has paid to keep a static ad
 * live for a quarter has a creative that works, whatever the vendor's score
 * says. Env-overridable, but never lowered inside a run.
 */
export const MIN_DAYS_ACTIVE = Number(process.env.GETHOOKD_RESEARCH_MIN_DAYS) || 90

/**
 * How far back a reference may have LAUNCHED, in days. Default three years.
 *
 * There is deliberately no maximum AGE on a reference — an ad that has run for
 * two years is the strongest evidence this source can offer, and cutting it
 * off at the Ad Library's 540-day browse window would throw away exactly the
 * ads worth studying. But a bound of some kind is load-bearing, because the
 * source computes run time as (last seen − start date): a 2018 ad nobody ever
 * marked stopped reports ~3,200 days "live", and sorting by duration with no
 * bound returns the oldest rows in the database rather than the best ads.
 *
 * Three years keeps "still running after two years" fully in scope while
 * keeping the zombies out. Set `GETHOOKD_RESEARCH_LAUNCH_WINDOW_DAYS=0` to
 * remove the bound entirely.
 */
const LAUNCH_WINDOW_DAYS = (() => {
  const raw = process.env.GETHOOKD_RESEARCH_LAUNCH_WINDOW_DAYS
  if (raw === undefined || raw.trim() === '') return 1095
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
})()

/** References handed to the agents. More than this is noise in a prompt. */
const SHORTLIST = Number(process.env.GETHOOKD_RESEARCH_SHORTLIST) || 5

/** Below this the briefing is reported as thin rather than presented as proof. */
const MIN_REFERENCES = 3

/** Rows requested per rung of the ladder. Every row is billed. */
const PER_STEP = 8

/** Hard ceiling on requests per campaign — the cost bound, before anything runs. */
const MAX_STEPS = 3

/** One advertiser must not teach the whole campaign. */
const MAX_PER_BRAND = 2

/* ------------------------------ the brief in ------------------------------ */

export interface ResearchBrief {
  angle?: string
  /** The written campaign direction, as typed. Mined for terms, never sent whole. */
  brief?: string
  campaignName?: string
  /** Audience TEMPERATURE (cold/warm/retargeting) — strategic, not a search term. */
  audienceType?: string
  offerType?: string
  offerName?: string
  /** What the tenant sells, from the connected website. */
  industry?: string
  /** Who the tenant sells to, from the connected website. */
  audienceDescriptor?: string
  /** Market nouns lifted from the website's audience + offer profiles. */
  keywords?: string[]
  /** Markets to research, CSV of 2-letter codes. Defaults to the deployment's. */
  geo?: string
}

/* ----------------------------- the research out --------------------------- */

/** One rung of the ladder, kept so the telemetry can show the actual path. */
export interface ResearchStep {
  /** Human line for the telemetry feed. */
  label: string
  query: string | null
  /** Rows the source returned and billed for. */
  returned: number
  /** Rows that cleared eligibility. */
  eligible: number
  /** Bounds relaxed on this rung, e.g. ['query', 'markets']. */
  widened: string[]
}

export interface AdResearch {
  configured: boolean
  /** The shortlist, strongest first. Every one clears eligibility. */
  ads: ProvenAd[]
  steps: ResearchStep[]
  focus: IcpFocus
  credits?: CreditUsage
  /** True when the shortlist is thin enough that OPUS must be told so. */
  thin: boolean
  /** Operator-facing explanation. Present whenever anything is less than clean. */
  note?: string
  /** The bar that was applied, reported rather than assumed. */
  eligibility: { minDaysActive: number; format: 'static image'; status: 'active' }
}

const EMPTY: AdResearch = {
  configured: false,
  ads: [],
  steps: [],
  focus: 'all',
  thin: true,
  eligibility: { minDaysActive: MIN_DAYS_ACTIVE, format: 'static image', status: 'active' },
}

/* --------------------------- term construction ---------------------------- */

/**
 * Words that describe MARKETING rather than a MARKET.
 *
 * Every brief is full of them — "leads", "campaign", "offer", "conversions" —
 * and every one of them matches tens of thousands of ads, so searching on one
 * is the same as not searching at all while still being billed per row. What
 * we want out of a brief is the noun that names the business: roofing, dental,
 * solar, skincare, conveyancing.
 */
const GENERIC = new Set([
  // Ordinary English filler. Four letters or more, so the length floor below
  // lets them through — and a search for "need" or "from" is a fully billed
  // search for nothing.
  'also','because','been','before','being','between','both','doing','done','down','each','even',
  'ever','every','from','gets','give','gives','going','have','here','into','just','keep','know',
  'like','made','make','makes','many','most','much','must','only','other','over','own','really',
  'right','same','should','some','such','sure','take','takes','than','that','their','them','then',
  'there','these','thing','things','those','through','under','very','want','wants','well','were',
  'will','would','yours',

  'ad','ads','advert','adverts','advertising','agency','angle','audience','awareness','brand',
  'branding','brief','business','businesses','buy','call','calls','campaign','campaigns','client',
  'clients','cold','company','concept','concepts','content','conversion','conversions','copy',
  'creative','creatives','custom','customer','customers','digital','drive','ecommerce','engine',
  'facebook','feed','free','funnel','generation','google','growth','help','high','hook','hooks',
  'image','images','instagram','launch','lead','leads','learn','local','looking','market',
  'marketing','media','meta','more','need','new','offer','offers','online','optimised','optimized',
  'owner','owners','page','paid','people','performance','platform','post','price','product',
  'products','profit','promo','prospect','prospects','quality','quote','quotes','reach','result',
  'results','retargeting','revenue','roas','sale','sales','scale','sell','selling','service',
  'services','shop','social','solution','solutions','static','store','strategy','system','systems',
  'target','targeting','testimonial','they','this','time','traffic','trust','video','want','warm',
  'website','what','when','where','which','with','work','working','your',
])

function words(text: string | undefined): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GENERIC.has(w))
}

/**
 * The search terms this brief earns, sharpest first, one or two words each.
 *
 * Ordered by where the word came from, because provenance is the best
 * available proxy for specificity: a word the operator put in the offer name
 * or the website's own audience profile names the market; a word that only
 * appears once in a long brief usually does not.
 */
export function researchTerms(brief: ResearchBrief): string[] {
  const scored = new Map<string, number>()
  const add = (text: string | undefined, weight: number) => {
    for (const w of words(text)) scored.set(w, (scored.get(w) ?? 0) + weight)
  }

  // Provenance order: what she named > what the site says she sells > the brief.
  add(brief.offerName, 6)
  add(brief.industry, 5)
  add(brief.audienceDescriptor, 4)
  for (const k of brief.keywords ?? []) add(k, 4)
  add(brief.campaignName, 2)
  add(brief.brief, 2)

  const ranked = Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => w)

  // Two rungs of query, never more: the third rung is the unqueried browse,
  // which is where the eligible corpus actually is.
  return ranked.slice(0, 2)
}

/**
 * Which half of the ICP to research.
 *
 * Read from the brief's own words rather than asked for, because the operator
 * already told us: an offer that books a call is a service ad, an offer that
 * sells a product is an e-commerce ad, and the two are structurally different
 * creative. Unknown stays 'all' rather than guessing — an averaged feed is a
 * worse answer than a wide one.
 */
export function researchFocus(brief: ResearchBrief): IcpFocus {
  const hay = [
    brief.offerType,
    brief.offerName,
    brief.industry,
    brief.audienceDescriptor,
    brief.brief,
    ...(brief.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase()

  const service =
    /\b(call|consult|consultation|application|appointment|booking|quote|audit|clinic|agency|contractor|installer|dental|dentist|legal|lawyer|accountant|coach|coaching|roofing|plumbing|hvac|landscap|solar|salon|spa|fitness|studio|practice|realtor|real estate|mortgage|insurance|b2b|lead magnet|webinar|masterclass)\b/.test(
      hay,
    )
  const ecom =
    /\b(shop|store|cart|checkout|shipping|bundle|sku|dtc|supplement|skincare|apparel|jewel|subscription box|collection|product page|add to cart|restock|sold out)\b/.test(
      hay,
    )

  if (service && !ecom) return 'services'
  if (ecom && !service) return 'ecommerce'
  return 'all'
}

/* ------------------------------- eligibility ------------------------------ */

/**
 * The bar, applied to every row the source returns.
 *
 * Applied HERE rather than trusted to the API on purpose: the source matches
 * `status` against a search index that lags the database, and a filter that is
 * refused by name is dropped by the transport so the request still succeeds.
 * Either can hand back a row that does not meet the bar. Re-checking costs
 * nothing and is the difference between "90+ days" being a promise and being
 * a parameter we happened to send.
 */
export function isEligible(ad: ProvenAd, minDays = MIN_DAYS_ACTIVE): boolean {
  if (ad.format !== 'image') return false
  if (!ad.imageUrl) return false
  if (typeof ad.daysActive !== 'number' || ad.daysActive < minDays) return false
  if (LAUNCH_WINDOW_DAYS !== null && ad.daysActive > LAUNCH_WINDOW_DAYS) return false
  // A reference with no words teaches ECHO nothing and gives OPUS no structure
  // to read. The still alone is a mood board, not evidence.
  return Boolean(ad.title.trim() || ad.body.trim())
}

/* -------------------------------- ranking --------------------------------- */

/**
 * How strongly a row should teach this campaign.
 *
 * Run time leads, and it is the only component that is direct evidence rather
 * than inference: nobody keeps paying for a losing static ad for three months.
 * It is dampened logarithmically so a 900-day ad does not out-rank every
 * relevant 120-day ad in the market we actually asked about.
 */
function score(ad: ProvenAd, terms: string[]): number {
  const days = ad.daysActive ?? 0
  let s = Math.log10(Math.max(days, 1)) * 40

  // The vendor's tier is a weak signal (it is largely derived from duration,
  // which is already counted above), so it breaks ties and nothing more.
  if (typeof ad.performanceScore === 'number') s += ad.performanceScore * 0.08

  // Primary text long enough to carry an argument. An image ad with six words
  // of body gives ECHO no pattern to extract.
  const body = ad.body.trim().length
  if (body >= 120) s += 10
  if (body >= 400) s += 6
  if (ad.title.trim()) s += 4
  if (ad.ctaText?.trim()) s += 2

  // Relevance to the brief's own market language.
  const hay = `${ad.title} ${ad.body}`.toLowerCase()
  for (const t of terms) if (t && hay.includes(t)) s += 14

  return s
}

/**
 * Shortlist, strongest first, with no advertiser allowed to own the briefing.
 *
 * The per-brand cap is applied AFTER scoring rather than asked of the source:
 * the ladder runs several searches and an advertiser running 90 creatives can
 * clear a per-request cap on every one of them.
 */
export function shortlist(ads: ProvenAd[], terms: string[], limit = SHORTLIST): ProvenAd[] {
  const seen = new Set<string>()
  const perBrand = new Map<string, number>()
  const out: ProvenAd[] = []

  for (const ad of [...ads].sort((a, b) => score(b, terms) - score(a, terms))) {
    // Same creative reached by two rungs of the ladder, and the same words run
    // under two ad ids — the source collapses copy variants per request, not
    // across them.
    const copyKey = `${ad.brand}::${ad.title.trim()}::${ad.body.trim().slice(0, 160)}`.toLowerCase()
    if (seen.has(ad.id) || seen.has(copyKey)) continue
    const brandKey = ad.brand.toLowerCase().trim()
    if ((perBrand.get(brandKey) ?? 0) >= MAX_PER_BRAND) continue

    seen.add(ad.id)
    seen.add(copyKey)
    perBrand.set(brandKey, (perBrand.get(brandKey) ?? 0) + 1)
    out.push(ad)
    if (out.length >= limit) break
  }
  return out
}

/* --------------------------------- the run -------------------------------- */

interface Rung {
  label: string
  query: string | null
  geo: string | undefined
  widened: string[]
}

/**
 * Research the proven-ad library for one campaign.
 *
 * Never throws and never blocks a run: a source that is unkeyed, down, out of
 * credits or simply thin returns an `AdResearch` carrying an honest note, and
 * the Reactor briefs its layers exactly as it did before this existed.
 */
export async function researchProvenAds(
  brief: ResearchBrief,
  opts: { shortlist?: number; minDaysActive?: number } = {},
): Promise<AdResearch> {
  const focus = researchFocus(brief)
  const terms = researchTerms(brief)
  const minDays = opts.minDaysActive ?? MIN_DAYS_ACTIVE
  const want = opts.shortlist ?? SHORTLIST
  const geo = (brief.geo ?? defaultGeo()).trim() || undefined

  // The ladder, built before anything runs so the cost ceiling is a property of
  // the plan rather than an outcome. Each rung widens the SEARCH; none of them
  // widens the bar.
  const rungs: Rung[] = [
    ...terms.map((t) => ({ label: `"${t}"`, query: t, geo, widened: [] as string[] })),
    { label: 'the whole eligible market', query: null, geo, widened: ['query'] },
    { label: 'every market', query: null, geo: undefined, widened: ['query', 'markets'] },
  ].slice(0, MAX_STEPS)

  const pool: ProvenAd[] = []
  const steps: ResearchStep[] = []
  let credits: CreditUsage | undefined
  let configured = true
  let failure: string | undefined

  for (const rung of rungs) {
    const res = await searchProvenAds({
      query: rung.query ?? undefined,
      focus,
      format: 'image',
      minDaysActive: minDays,
      launchWindowDays: LAUNCH_WINDOW_DAYS,
      geo: rung.geo,
      limit: PER_STEP,
    })

    configured = res.configured
    if (res.credits) {
      credits = {
        used: (credits?.used ?? 0) + res.credits.used,
        remaining: res.credits.remaining,
      }
    }
    if (!res.configured) return { ...EMPTY, note: res.note, eligibility: EMPTY.eligibility }
    if (!res.ads.length && res.note) failure = res.note

    const eligible = res.ads.filter((a) => isEligible(a, minDays))
    pool.push(...eligible)
    steps.push({
      label: rung.label,
      query: rung.query,
      returned: res.ads.length,
      eligible: eligible.length,
      widened: rung.widened,
    })

    // Enough evidence in hand — stop climbing and stop spending.
    if (shortlist(pool, terms, want).length >= want) break
  }

  const ads = shortlist(pool, terms, want)
  const thin = ads.length < MIN_REFERENCES
  const widened = steps.at(-1)?.widened ?? []

  const notes: string[] = []
  if (!ads.length) {
    notes.push(
      failure ??
        `No static ads in this market have been running ${minDays}+ days in the library right now. The agents are building from the Vault and the brief alone — nothing external was invented to fill the gap.`,
    )
  } else if (thin) {
    notes.push(
      `Only ${ads.length} ad${ads.length === 1 ? '' : 's'} cleared the ${minDays}-day bar, so treat the reference set as direction rather than proof.`,
    )
  }
  if (ads.length && widened.includes('markets')) {
    notes.push('Widened to every market — too few qualified in the markets this account sells into.')
  }

  return {
    configured,
    ads,
    steps,
    focus,
    credits,
    thin,
    note: notes.join(' ') || undefined,
    eligibility: { minDaysActive: minDays, format: 'static image', status: 'active' },
  }
}

/* -------------------------- evidence for the agents ----------------------- */

/**
 * The one rule that rides on every block.
 *
 * Without it the fastest path to a "great" ad is to lift a competitor's
 * numbers, and the result is a compliance failure wearing a proven structure.
 */
const BORROW_RULE =
  'These ads belong to OTHER advertisers. Read them for STRUCTURE — hook shape, how proof is placed, how the offer is framed, how the CTA asks. Never reuse their claims, figures, testimonials, guarantees or brand names: a competitor\'s result is not our result.'

function runLine(ad: ProvenAd): string {
  const bits = [`${ad.daysActive ?? 0} days live`]
  if (ad.performanceTier) bits.push(ad.performanceTier.toLowerCase())
  if (ad.countries.length) bits.push(ad.countries.slice(0, 3).join('/'))
  return bits.join(' · ')
}

/** Copy evidence — what ECHO reads. The words, and how long they have held up. */
export function echoEvidence(research: AdResearch): string {
  if (!research.ads.length) return ''
  const rows = research.ads
    .map((ad, i) => {
      const parts = [
        `${i + 1}. ${ad.brand} — ${runLine(ad)}`,
        ad.title.trim() && `Headline: "${ad.title.trim()}"`,
        ad.body.trim() && `Primary text: "${ad.body.trim().slice(0, 900)}"`,
        ad.ctaText?.trim() && `CTA button: ${ad.ctaText.trim()}`,
      ].filter(Boolean)
      return parts.join('\n')
    })
    .join('\n\n')

  return `LIVE PROVEN COPY — static Meta ads running ${research.eligibility.minDaysActive}+ days in this market right now, pulled from the proven-ad library for THIS brief. ${BORROW_RULE}\n\n${rows}`
}

/** Creative evidence — what SPARK reads. The same ads, read as construction. */
export function sparkEvidence(research: AdResearch): string {
  if (!research.ads.length) return ''
  const rows = research.ads
    .map((ad, i) => {
      const parts = [
        `${i + 1}. ${ad.brand} — ${runLine(ad)}`,
        ad.title.trim() && `On-ad headline: "${ad.title.trim()}"`,
        ad.body.trim() && `Supporting copy: "${ad.body.trim().slice(0, 400)}"`,
        ad.ctaText?.trim() && `CTA: ${ad.ctaText.trim()}`,
        ad.landingPage && `Destination: ${ad.landingPage}`,
      ].filter(Boolean)
      return parts.join('\n')
    })
    .join('\n\n')

  return `LIVE PROVEN STATIC CREATIVE — image ads that have survived ${research.eligibility.minDaysActive}+ days of live spend in this market. Each is a construction that has already earned its scroll-stop. ${BORROW_RULE}\n\n${rows}`
}

/**
 * The block OPUS receives, alongside its network's findings.
 *
 * Deliberately short. OPUS already has SPARK's and ECHO's reads of these same
 * ads; this exists so it can cite the source of a structure and knows the
 * borrowing rule applies to its own drafting, not only to the layers'.
 */
export function provenAdBlock(research: AdResearch): string {
  if (!research.ads.length) {
    return research.note
      ? `\n\nPROVEN-AD RESEARCH: ${research.note} Do not present any concept as validated by external evidence in this run.`
      : ''
  }

  const rows = research.ads
    .map(
      (ad, i) =>
        `${i + 1}. ${ad.brand} · ${runLine(ad)} — "${ad.title.trim() || ad.body.trim().slice(0, 70)}"`,
    )
    .join('\n')

  const caveat = research.thin
    ? ' This set is thin, so lead with the Vault and the brief and use these as direction.'
    : ''

  return `\n\nPROVEN-AD RESEARCH — ${research.ads.length} static Meta ad${
    research.ads.length === 1 ? '' : 's'
  } currently running in this market, every one live for ${research.eligibility.minDaysActive}+ days. SPARK and ECHO have read these and their findings are above.${caveat}\n${rows}\n\n${BORROW_RULE} Where a concept is built on one of these structures, name it in the concept's basis.`
}

/** One line for the telemetry feed — what was searched and what it cost. */
export function researchSummary(research: AdResearch): string {
  const path = research.steps
    .map((s) => `${s.label} → ${s.eligible}/${s.returned}`)
    .join(' · ')
  const spend = research.credits ? ` · ${research.credits.used.toFixed(2)} credits` : ''
  return `${research.ads.length} proven static ad${research.ads.length === 1 ? '' : 's'} (${research.eligibility.minDaysActive}+ days live) · searched ${path}${spend}`
}
