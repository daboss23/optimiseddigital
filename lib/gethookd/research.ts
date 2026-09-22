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

import { searchProvenAds, CRAFT_ARCHETYPES } from './index'
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

/**
 * How the shortlist splits between the two pools.
 *
 * MARKET is the larger share because it is the one that can be wrong in a way
 * that matters: a craft reference that does not fit teaches a layout nobody
 * uses, while a market reference that does not fit teaches the wrong argument
 * to the wrong buyer.
 */
const MARKET_SHORTLIST = Math.max(1, Math.round(SHORTLIST * 0.6))
const CRAFT_SHORTLIST = Math.max(1, SHORTLIST - MARKET_SHORTLIST)

/** Below this the briefing is reported as thin rather than presented as proof. */
const MIN_REFERENCES = 3

/** Rows requested per rung of the ladder. Every row is billed. */
const PER_STEP = 6

/**
 * Hard ceiling on requests per campaign — the cost bound, before anything runs.
 * Three market rungs plus one craft rung, at PER_STEP rows each: 24 billed
 * rows, the same ceiling as before the pools were split.
 */
const MAX_MARKET_STEPS = 3
const MAX_STEPS = MAX_MARKET_STEPS + 1

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

/**
 * The two things a reference can teach.
 *
 * Splitting them is the whole design: breadth makes the DESIGN better and the
 * COPY worse, so neither "search my niche" nor "search everything" is the
 * right answer on its own.
 */
export type ReferencePool = 'market' | 'craft'

/** One rung of the ladder, kept so the telemetry can show the actual path. */
export interface ResearchStep {
  /** Which pool this rung was filling. */
  pool: ReferencePool
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
  /**
   * ON-MARKET references: ads running in the ICP this brief sits in. They
   * teach WHAT TO SAY and to whom — the argument, the objection, the proof a
   * buyer in this category needs. ECHO sees only these.
   */
  market: ProvenAd[]
  /**
   * CRAFT references: the best-constructed long-running statics in the whole
   * library, regardless of vertical, filtered to the static-ad archetypes.
   * They teach HOW TO BUILD ONE — the layout, the hierarchy, the contrast
   * device. SPARK sees these; ECHO never does.
   *
   * Measured, not assumed. Scoped to the service niches the library holds ~355
   * eligible statics; unscoped it holds ~22,000, and the difference shows in
   * the craft. What does NOT transfer is the persuasion: a DTC ad sells a
   * purchase and a service ad sells a conversation, so handing "Grab our BOGO
   * deal" to a lead-gen campaign is how breadth becomes a liability. Hence two
   * pools rather than one wider one.
   */
  craft: ProvenAd[]
  /** Both pools, market first. For telemetry, banking and dedup only. */
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
  market: [],
  craft: [],
  ads: [],
  steps: [],
  focus: 'all',
  thin: true,
  eligibility: { minDaysActive: MIN_DAYS_ACTIVE, format: 'static image', status: 'active' },
}

/* --------------------------- term construction ---------------------------- */

/**
 * Ordinary English filler. Four letters or more, so the length floor below
 * lets them through — and a search for "need" or "from" is a fully billed
 * search for nothing. Always stripped, from every source.
 */
const FILLER = new Set([
  'also','because','been','before','being','between','both','doing','done','down','each','even',
  'ever','every','from','gets','give','gives','going','have','here','into','just','keep','know',
  'like','made','make','makes','many','most','much','must','only','other','over','own','really',
  'right','same','should','some','such','sure','take','takes','than','that','their','them','then',
  'there','these','thing','things','those','through','under','very','want','wants','well','were',
  'will','would','yours','what','when','where','which','with','work','working','your','they','this',
  'more','need','new','best','high','looking','help','people','drive','reach','scale','sell',
  'selling','buy','target','trust','quality','time',
  // A second pass, all of it seen in real briefs. None of these names a
  // market, and each one is long enough to clear the length floor and short
  // enough on specificity to win a tiebreak it should lose.
  'about','after','again','against','already','always','another','anyone','anything','around',
  'because','better','cannot','could','currently','days','different','does','doesnt','during',
  'else','enough','everything','getting','goes','good','great','hard','having','instead','isnt',
  'itself','less','little','long','month','months','never','nothing','often','once','perhaps',
  'possible','rather','ready','runs','said','says','seen','several','since','someone','something',
  'sometimes','soon','still','stop','thats','them','they','though','together','using','usually',
  'week','weeks','whether','while','whole','without','year','years','yet',
])

/**
 * Words that describe MARKETING rather than a MARKET — but only sometimes.
 *
 * In a client brief they are pure noise: "we want more leads for our roofing
 * campaign" is about ROOFING, and searching "leads" or "campaign" matches tens
 * of thousands of ads while being billed per row. What we want out of that
 * brief is the noun that names the business.
 *
 * But this deployment is a digital marketing agency, and when the campaign is
 * its OWN, these words stop being noise and become the vertical: an offer
 * named "Funnel Build-Out" or an industry of "digital marketing agency" is
 * literally about funnels and agencies. So they are stripped by PROVENANCE
 * rather than outright — see `words()`. Getting this wrong in either direction
 * is expensive: strip them everywhere and the agency can never research its
 * own market; strip them nowhere and every client brief searches "leads".
 */
const TRADE_TERMS = new Set([
  'ad','ads','advert','adverts','advertising','agency','angle','audience','awareness','brand',
  'branding','brief','business','businesses','call','calls','campaign','campaigns','client',
  'clients','cold','company','concept','concepts','content','conversion','conversions','copy',
  'creative','creatives','custom','customer','customers','digital','ecommerce','engine','facebook',
  'feed','free','funnel','funnels','generation','google','growth','hook','hooks','image','images',
  'launch','lead','leads','learn','local','magnet','magnets','market','marketing','media','meta',
  'offer','offers','online','optimised','optimized','owner','owners','page','paid','platform',
  'post','price','product','products','profit','promo','prospect','prospects','quote','quotes',
  'result','results','retargeting','revenue','roas','sale','sales','service','services','shop',
  'social','solution','solutions','static','store','strategy','system','systems','testimonial',
  'traffic','video','website',
])

/**
 * Three-letter terms that genuinely name a market, kept against the length
 * floor. Without these an agency brief loses SEO, PPC and CRM — the exact
 * words that would find the ads worth studying.
 */
const SHORT_MARKET_TERMS = new Set(['seo', 'ppc', 'crm', 'cro', 'b2b', 'b2c', 'dtc', 'ugc'])

/**
 * Pull candidate market nouns out of a piece of text.
 *
 * `trade` says whether marketing vocabulary counts here. It is true only for
 * the high-provenance fields — what the operator NAMED the offer, and what the
 * connected website says the business does — because a word chosen that
 * deliberately is a subject, not filler.
 */
function words(text: string | undefined, opts: { trade?: boolean } = {}): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      if (!w || FILLER.has(w)) return false
      if (w.length < 4) return SHORT_MARKET_TERMS.has(w)
      return opts.trade ? true : !TRADE_TERMS.has(w)
    })
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
  const add = (text: string | undefined, weight: number, trade = false) => {
    for (const w of words(text, { trade })) {
      // Trade vocabulary is ALLOWED in a high-provenance field but never
      // preferred within it. "Roof Replacement Quote" is about roof
      // replacement; "quote" is the mechanism, and searching it returns every
      // lead-gen ad in the library. Halving it means a real market noun in the
      // same field always outranks it, while "Funnel Build-Out" still finds
      // "funnel" when there is nothing better beside it.
      const isTrade = trade && TRADE_TERMS.has(w)
      // Weighted BELOW a plain noun from the brief body on purpose. An
      // industry of "digital marketing agency" would otherwise supply the two
      // best-scoring words on every one of that agency's campaigns, and every
      // brief would search "marketing, digital" — true of the business, and
      // useless as a way to tell one campaign from another.
      // An acronym that survived the length floor is there because it names a
      // market and nothing else does. It should not then lose a tiebreak to a
      // longer, vaguer word — which is exactly how "Local SEO retainer" came
      // back searching "local".
      const isAcronym = SHORT_MARKET_TERMS.has(w)
      const value = weight * (isTrade ? 0.3 : isAcronym ? 1.5 : 1)
      scored.set(w, (scored.get(w) ?? 0) + value)
    }
  }

  // Provenance order: what she named > what the site says she sells > the
  // brief. The first four allow marketing vocabulary, because a word placed in
  // an offer name or read off the connected website is the subject; the last
  // two do not, because a brief body is full of it by nature.
  add(brief.offerName, 6, true)
  add(brief.industry, 5, true)
  // The offer TYPE is a chosen strategic input, not prose, and it often
  // carries the sharpest noun in the whole brief: "audit", "teardown",
  // "retainer", "webinar". Leaving it out meant an audit campaign searched
  // everything except the word audit.
  add(brief.offerType, 3, true)
  add(brief.audienceDescriptor, 4, true)
  for (const k of brief.keywords ?? []) add(k, 4, true)
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

  // Checked FIRST, and deliberately so. This deployment IS a digital marketing
  // agency, so a brief about funnels, martech or lead generation is most
  // likely the agency's own campaign rather than a client's — and the ads
  // worth studying for it are other agencies, the software and the info
  // offers, not the roofers and dentists it sells TO. A brief that is
  // genuinely a client's names the client's trade, which the services and
  // e-commerce tests below catch.
  const marketing =
    /\b(agency|agencies|marketing|martech|funnel|funnels|clickfunnels|gohighlevel|highlevel|kajabi|kartra|hubspot|mailchimp|klaviyo|activecampaign|convertkit|lead magnet|lead-magnet|opt-?in|landing page|email list|drip|nurture sequence|crm|seo|ppc|paid ads|ad spend|media buying|media buyer|copywriting|course|cohort|mastermind|saas|retainer|white label|white-label|done-for-you|dfy|teardown|ad account|account audit|funnel audit)\b/.test(
      hay,
    )

  const service =
    /\b(call|consult|consultation|application|appointment|booking|quote|audit|clinic|contractor|installer|dental|dentist|legal|lawyer|accountant|coach|coaching|roofing|plumbing|hvac|landscap|solar|salon|spa|fitness|studio|practice|realtor|real estate|mortgage|insurance|webinar|masterclass)\b/.test(
      hay,
    )
  const ecom =
    /\b(shop|store|cart|checkout|shipping|bundle|sku|dtc|supplement|skincare|apparel|jewel|subscription box|collection|product page|add to cart|restock|sold out)\b/.test(
      hay,
    )

  if (marketing && !ecom) return 'marketing'
  if (service && !ecom) return 'services'
  if (ecom && !service && !marketing) return 'ecommerce'
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
export function isEligible(
  ad: ProvenAd,
  minDays = MIN_DAYS_ACTIVE,
  pool: ReferencePool = 'market',
): boolean {
  if (ad.format !== 'image') return false
  if (!ad.imageUrl) return false
  if (typeof ad.daysActive !== 'number' || ad.daysActive < minDays) return false
  if (LAUNCH_WINDOW_DAYS !== null && ad.daysActive > LAUNCH_WINDOW_DAYS) return false
  // A craft reference must carry a HEADLINE, not merely words. The archetype
  // tag does not guarantee construction — the library will happily return an
  // untreated product photo filed under "Features and Benefits", with the same
  // performance tier as a properly built ad beside it. A headline is the
  // cheapest available proof that somebody designed the thing.
  if (pool === 'craft') return Boolean(ad.title.trim())
  // A market reference with no words teaches ECHO nothing and gives OPUS no
  // structure to read. The still alone is a mood board, not evidence.
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
  pool: ReferencePool
  label: string
  query: string | null
  geo: string | undefined
  widened: string[]
}

/**
 * Research the proven-ad library for one campaign.
 *
 * TWO TRACKS, because the honest answer to "should the search be broader?" is
 * "broader for one thing and narrower for the other":
 *
 *   MARKET — scoped to the ICP this brief sits in, so the argument, the
 *     objection and the proof belong to a buyer who could actually be hers.
 *     Climbs the term ladder, because a short literal term is how relevance
 *     gets into a filtered corpus at all.
 *   CRAFT — the whole library, filtered instead by static-ad ARCHETYPE and
 *     ordered by run time, so breadth buys construction rather than noise.
 *     One search, no term: with ~17,000 eligible rows the longest-running
 *     archetypes are the shortlist, and a term would only narrow it back down.
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
  const geo = (brief.geo ?? defaultGeo()).trim() || undefined
  const wantMarket = opts.shortlist
    ? Math.max(1, Math.round(opts.shortlist * 0.6))
    : MARKET_SHORTLIST
  const wantCraft = opts.shortlist ? Math.max(1, opts.shortlist - wantMarket) : CRAFT_SHORTLIST

  // The ladder, built before anything runs so the cost ceiling is a property
  // of the plan rather than an outcome. Each rung widens the SEARCH; none of
  // them widens the bar.
  const rungs: Rung[] = [
    ...terms.map((t) => ({
      pool: 'market' as const,
      label: `"${t}"`,
      query: t,
      geo,
      widened: [] as string[],
    })),
    { pool: 'market' as const, label: 'the whole eligible market', query: null, geo, widened: ['query'] },
    {
      pool: 'market' as const,
      label: 'every market',
      query: null,
      geo: undefined,
      widened: ['query', 'markets'],
    },
  ].slice(0, MAX_MARKET_STEPS)

  const pools: Record<ReferencePool, ProvenAd[]> = { market: [], craft: [] }
  const steps: ResearchStep[] = []
  let credits: CreditUsage | undefined
  let configured = true
  let failure: string | undefined

  const spend = (used: number | undefined, remaining: number | undefined) => {
    if (used === undefined && remaining === undefined) return
    credits = { used: (credits?.used ?? 0) + (used ?? 0), remaining: remaining ?? credits?.remaining ?? 0 }
  }

  /** One billed search. Returns false when the source itself is unusable. */
  const run = async (rung: Rung, want: number): Promise<boolean> => {
    const res = await searchProvenAds({
      query: rung.query ?? undefined,
      focus,
      format: 'image',
      minDaysActive: minDays,
      launchWindowDays: LAUNCH_WINDOW_DAYS,
      geo: rung.geo,
      limit: PER_STEP,
      // The craft track is the whole library narrowed by CONSTRUCTION rather
      // than by category. Removing the niche filter without the archetypes
      // returns the market at large, most of which is an untreated photo.
      ...(rung.pool === 'craft'
        ? { scope: 'library' as const, creativeCategories: [...CRAFT_ARCHETYPES] }
        : {}),
    })

    configured = res.configured
    spend(res.credits?.used, res.credits?.remaining)
    if (!res.configured) {
      failure = res.note
      return false
    }
    if (!res.ads.length && res.note) failure = res.note

    const eligible = res.ads.filter((a) => isEligible(a, minDays, rung.pool))
    pools[rung.pool].push(...eligible)
    steps.push({
      pool: rung.pool,
      label: rung.label,
      query: rung.query,
      returned: res.ads.length,
      eligible: eligible.length,
      widened: rung.widened,
    })
    return true
  }

  for (const rung of rungs) {
    if (!(await run(rung, wantMarket))) return { ...EMPTY, note: failure }
    // Enough on-market evidence in hand — stop climbing and stop spending.
    if (shortlist(pools.market, terms, wantMarket).length >= wantMarket) break
  }

  // The craft rung always runs, and runs LAST: it is the one search whose
  // result does not depend on anything the market track found, so spending it
  // first would mean paying for it even when the source turns out to be dead.
  await run(
    {
      pool: 'craft',
      label: 'best-built statics, any vertical',
      query: null,
      geo,
      widened: ['query', 'vertical'],
    },
    wantCraft,
  )

  const market = shortlist(pools.market, terms, wantMarket)
  // Craft is ranked WITHOUT the brief's terms: this pool is chosen for how it
  // is built, and rewarding a vertical keyword here would quietly pull it back
  // toward the market pool it exists to complement.
  const craft = shortlist(
    pools.craft.filter((a) => !market.some((m) => m.id === a.id)),
    [],
    wantCraft,
  )
  const ads = [...market, ...craft]
  const thin = ads.length < MIN_REFERENCES
  const marketWidened = steps.filter((s) => s.pool === 'market').at(-1)?.widened ?? []

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
  if (!market.length && craft.length) {
    notes.push(
      'Nothing on-market qualified, so the references carry construction only — no evidence about what this buyer responds to.',
    )
  }
  if (market.length && marketWidened.includes('markets')) {
    notes.push('Widened to every market — too few qualified in the markets this account sells into.')
  }

  return {
    configured,
    market,
    craft,
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

/**
 * Copy evidence — what ECHO reads.
 *
 * ON-MARKET ONLY, and that restriction is the point. Craft references are
 * chosen for how they are BUILT, across every vertical the library holds, and
 * their persuasion does not travel with their layout: a DTC ad sells a
 * purchase in one line and a service ad sells a conversation over five. Feed
 * ECHO the wider pool and it learns "Grab our BOGO deal" for a campaign whose
 * next step is a booked call. Widening this pool is the one widening that
 * makes the ads worse.
 */
export function echoEvidence(research: AdResearch): string {
  if (!research.market.length) return ''
  const rows = research.market
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

  return `LIVE PROVEN COPY — static Meta ads running ${research.eligibility.minDaysActive}+ days IN THIS MARKET right now, pulled from the proven-ad library for THIS brief. ${BORROW_RULE}\n\n${rows}`
}

/**
 * Creative evidence — what SPARK reads. BOTH pools, labelled, because
 * construction is the one thing that does travel between verticals.
 *
 * The two sections are kept apart rather than merged into one ranked list:
 * an averaged set would let SPARK borrow a supplement ad's argument along with
 * its layout, and the whole reason the craft pool is allowed to be broad is
 * that it is read for geometry and nothing else.
 */
export function sparkEvidence(research: AdResearch): string {
  if (!research.ads.length) return ''

  const rows = (ads: ProvenAd[]) =>
    ads
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

  const sections: string[] = []
  if (research.market.length) {
    sections.push(
      `IN THIS MARKET — statics that have survived ${research.eligibility.minDaysActive}+ days of live spend against the buyer this campaign is for. Read these for what earns attention in this category.\n\n${rows(
        research.market,
      )}`,
    )
  }
  if (research.craft.length) {
    sections.push(
      `BEST-BUILT STATICS, ANY VERTICAL — long-running ads in the library's static archetypes (before/after, testimonial, us vs them, facts and stats, reasons why, features and benefits). Read these for CONSTRUCTION ONLY: layout, hierarchy, where the eye lands first, how the contrast device works, how proof is placed on the image. Their products, claims and offers are irrelevant here and must not travel into the concept.\n\n${rows(
        research.craft,
      )}`,
    )
  }

  return `LIVE PROVEN STATIC CREATIVE, in two sets. ${BORROW_RULE}\n\n${sections.join('\n\n')}`
}

/**
 * The block OPUS receives, alongside its network's findings.
 *
 * Deliberately short. OPUS already has SPARK's and ECHO's reads of these same
 * ads; this exists so it can cite the source of a structure, and so the
 * division of labour between the two sets is stated once at the top rather
 * than inferred from the rows.
 */
export function provenAdBlock(research: AdResearch): string {
  if (!research.ads.length) {
    return research.note
      ? `\n\nPROVEN-AD RESEARCH: ${research.note} Do not present any concept as validated by external evidence in this run.`
      : ''
  }

  const list = (ads: ProvenAd[]) =>
    ads
      .map(
        (ad, i) =>
          `${i + 1}. ${ad.brand} · ${runLine(ad)} — "${ad.title.trim() || ad.body.trim().slice(0, 70)}"`,
      )
      .join('\n')

  const sections: string[] = []
  if (research.market.length) {
    sections.push(`IN THIS MARKET (what to say, and to whom):\n${list(research.market)}`)
  }
  if (research.craft.length) {
    sections.push(
      `BEST-BUILT STATICS, ANY VERTICAL (how to build one — construction only, never their claims or offers):\n${list(
        research.craft,
      )}`,
    )
  }

  const caveat = research.thin
    ? ' This set is thin, so lead with the Vault and the brief and use these as direction.'
    : ''

  return `\n\nPROVEN-AD RESEARCH — ${research.ads.length} static Meta ad${
    research.ads.length === 1 ? '' : 's'
  } currently running, every one live for ${research.eligibility.minDaysActive}+ days, in two sets. The first is scoped to this campaign's market and carries the ARGUMENT; the second is drawn from the whole library and carries the CONSTRUCTION, because a layout transfers between categories and a claim does not. SPARK and ECHO have read these and their findings are above.${caveat}\n\n${sections.join(
    '\n\n',
  )}\n\n${BORROW_RULE} Where a concept is built on one of these structures, name it in the concept's basis.`
}

/** One line for the telemetry feed — what was searched and what it cost. */
export function researchSummary(research: AdResearch): string {
  const path = research.steps
    .map((s) => `${s.label} → ${s.eligible}/${s.returned}`)
    .join(' · ')
  const spend = research.credits ? ` · ${research.credits.used.toFixed(2)} credits` : ''
  const mix = `${research.market.length} on-market + ${research.craft.length} best-built`
  return `${research.ads.length} proven static ad${
    research.ads.length === 1 ? '' : 's'
  } (${research.eligibility.minDaysActive}+ days live · ${mix}) · searched ${path}${spend}`
}
