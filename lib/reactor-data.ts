// Demo intelligence data for the Creative Reactor command center.
//
// Two different things live in this file and they are NOT interchangeable:
//
//   · UNIVERSAL CRAFT (`foundationAssets`, `learnings`) — ad anatomy, copy
//     frameworks, hook construction, compliance, offer framing by awareness
//     stage. True for every business on the platform, so it ships and is
//     retrievable unconditionally.
//
//   · ONE BUSINESS'S DATA (`patterns`, `topHooks`/`topHeadlines`/`topOffers`,
//     `transformations`, `researchOutputs`, `creativeAnalyses`,
//     `vaultCategories`, `recommendations`) — a specific company's winning ads,
//     its clients' margins, its market. Illustrative for demos and screenshots
//     and WRONG for anyone else, so it is gated behind `demoDataEnabled()`
//     (NEXT_PUBLIC_REACTOR_DEMO_DATA=1) on every surface, retrieval included.
//
// If you add to this file, decide which of the two it is first. Anything that
// names an industry, a client, a figure or a market belongs in the second
// group; put it anywhere reachable without the flag and every deployment
// inherits another company's business as its own.

export interface KpiStat {
  label: string
  value: number
  delta: string
  trend: 'up' | 'down' | 'flat'
}

export const reactorKpis: KpiStat[] = [
  { label: 'Knowledge Assets', value: 2847, delta: '+128', trend: 'up' },
  { label: 'Winning Creatives', value: 412, delta: '+19', trend: 'up' },
  { label: 'Winning Hooks', value: 689, delta: '+34', trend: 'up' },
  { label: 'Frameworks', value: 47, delta: '+3', trend: 'up' },
  { label: 'SOPs', value: 31, delta: '+1', trend: 'up' },
  { label: 'Member Wins', value: 538, delta: '+22', trend: 'up' },
  { label: 'Patterns Identified', value: 96, delta: '+7', trend: 'up' },
  { label: 'Campaign Ideas Ready', value: 24, delta: '+5', trend: 'up' },
]

// Neon accent channel names shared with the command-center UI layer.
export type DataAccent = 'blue' | 'cyan' | 'violet' | 'emerald' | 'pink' | 'amber'

export interface AngleStat {
  name: string
  score: number // 0-100 win index
  campaigns: number
  trend: 'up' | 'down' | 'flat'
  delta: string
  accent: DataAccent
}

export const winningAngles: AngleStat[] = [
  { name: 'Profit', score: 94, campaigns: 61, trend: 'up', delta: '4', accent: 'emerald' },
  { name: 'Systems', score: 88, campaigns: 54, trend: 'up', delta: '4', accent: 'cyan' },
  { name: 'Time Freedom', score: 85, campaigns: 47, trend: 'up', delta: '4', accent: 'blue' },
  { name: 'Leadership', score: 79, campaigns: 38, trend: 'flat', delta: '—', accent: 'pink' },
  { name: 'Cashflow', score: 76, campaigns: 33, trend: 'up', delta: '4', accent: 'amber' },
  { name: 'Growth', score: 71, campaigns: 42, trend: 'down', delta: '2', accent: 'violet' },
  { name: 'Team Accountability', score: 68, campaigns: 29, trend: 'up', delta: '3', accent: 'cyan' },
]

export interface PerformanceSignal {
  label: string
  value: string
  metric: string
  pct: number
  accent: DataAccent
}

// Compact performance read-outs along the foot of the Reactor Dashboard.
export const performanceSignals: PerformanceSignal[] = [
  { label: 'Top Performing Platform', value: 'Facebook', metric: 'ROAS 4.7x', pct: 87, accent: 'blue' },
  { label: 'Best Performing Format', value: 'Video', metric: 'Win Rate 68%', pct: 68, accent: 'emerald' },
  { label: 'Optimal Hook Length', value: '8-12 Words', metric: 'Win Rate 72%', pct: 72, accent: 'violet' },
  { label: 'Peak Engagement Time', value: '7PM - 10PM', metric: 'Win Rate 63%', pct: 63, accent: 'amber' },
]

export interface HeatRow {
  dimension: string
  cells: number[] // intensity 0-100 across months
}

export const heatmapMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

export const creativeHeatmap: HeatRow[] = [
  { dimension: 'Hooks', cells: [62, 71, 80, 88, 92, 94] },
  { dimension: 'Headlines', cells: [55, 60, 74, 70, 82, 86] },
  { dimension: 'Offers', cells: [48, 52, 58, 77, 81, 79] },
  { dimension: 'Creative Formats', cells: [40, 58, 63, 72, 85, 90] },
  { dimension: 'Transformations', cells: [70, 74, 78, 84, 88, 95] },
  { dimension: 'Patterns', cells: [44, 49, 61, 66, 73, 81] },
]

export interface Recommendation {
  campaign: string
  reason: string
  assetsNeeded: string[]
  suggestedHook: string
  confidence: number
  priority: 'High' | 'Medium' | 'Critical'
}

export const recommendations: Recommendation[] = [
  {
    campaign: 'The Profit Leak Campaign',
    reason:
      'Profitability messaging is outperforming growth messaging by 31% across the last 6 cohorts. Margin language is converting builders faster than revenue language.',
    assetsNeeded: ['Founder Video', 'Static Proof Ad', 'Member Testimonial'],
    suggestedHook:
      "Most builders don't have a revenue problem. They have a profit leak.",
    confidence: 92,
    priority: 'Critical',
  },
  {
    campaign: 'The 45-Hour Owner',
    reason:
      'Time-freedom transformations show the highest emotional resonance and save rate. Identity-shift angle is under-utilized vs demand.',
    assetsNeeded: ['Founder Video', 'Day-in-the-life UGC', 'Carousel Story'],
    suggestedHook:
      'You didn’t build a business. You built a job that pays worse than your foreman.',
    confidence: 87,
    priority: 'High',
  },
  {
    campaign: 'Systems Before Scale',
    reason:
      'Contrarian "stop scaling" angle is breaking pattern fatigue. Strong fit with operations-pain segment from sales calls.',
    assetsNeeded: ['Static Contrarian Ad', 'VSL Opener', 'Whiteboard Video'],
    suggestedHook: 'Scaling a broken business just breaks it faster.',
    confidence: 81,
    priority: 'High',
  },
]

export interface ReactorStatus {
  label: string
  value: number
  total: number
}

export const reactorStatus: ReactorStatus[] = [
  { label: 'Assets Ingested', value: 2847, total: 3000 },
  { label: 'Patterns Extracted', value: 96, total: 120 },
  { label: 'Campaign Concepts Generated', value: 184, total: 200 },
  { label: 'Recommendations Ready', value: 24, total: 24 },
]

/* ----------------------------- Knowledge Vault ---------------------------- */

export interface UploadCard {
  title: string
  accept: string
  icon: string
}

export const uploadCards: UploadCard[] = [
  { title: 'Upload Winning Creative', accept: 'Video / Image', icon: 'Clapperboard' },
  { title: 'Upload Winning Copy', accept: 'Text / Doc', icon: 'FileText' },
  { title: 'Upload Hook Framework', accept: 'Doc / PDF', icon: 'Anchor' },
  { title: 'Upload Creative Framework', accept: 'Doc / PDF', icon: 'LayoutTemplate' },
  { title: 'Upload Offer Framework', accept: 'Doc / PDF', icon: 'Tag' },
  { title: 'Upload VSL Framework', accept: 'Doc / Script', icon: 'Film' },
  { title: 'Upload Creative SOP', accept: 'Doc / PDF', icon: 'ListChecks' },
  { title: 'Upload Client Win', accept: 'Story / Video', icon: 'Trophy' },
  { title: 'Upload Event Content', accept: 'Video / Deck', icon: 'CalendarDays' },
  { title: 'Upload Podcast Transcript', accept: 'Audio / Text', icon: 'Mic' },
  { title: 'Upload Webinar', accept: 'Video / Deck', icon: 'MonitorPlay' },
  { title: 'META Frameworks / SOP', accept: 'Doc / PDF', icon: 'BookOpen' },
]

export interface VaultCategory {
  group: string
  items: { name: string; count: number }[]
}

export const vaultCategories: VaultCategory[] = [
  {
    group: 'Creative Assets',
    items: [
      { name: 'Winning Ads', count: 214 },
      { name: 'Winning Videos', count: 137 },
      { name: 'Winning Statics', count: 188 },
      { name: 'Event Footage', count: 42 },
    ],
  },
  {
    // The visual section of the Vault. Starts empty on purpose — it fills from
    // real ads you ingest, and a curated number here would be a design nobody
    // can retrieve.
    group: 'Ad Design DNA',
    items: [{ name: 'Ingested Ad Designs', count: 0 }],
  },
  {
    group: 'Copy Assets',
    items: [
      { name: 'Hooks', count: 689 },
      { name: 'Headlines', count: 421 },
      { name: 'Primary Text', count: 356 },
      { name: 'VSLs', count: 28 },
      { name: 'Webinar Scripts', count: 19 },
    ],
  },
  {
    group: 'Framework Assets',
    items: [
      { name: 'Hook Frameworks', count: 14 },
      { name: 'Creative Frameworks', count: 12 },
      { name: 'Offer Frameworks', count: 11 },
      { name: 'VSL Frameworks', count: 10 },
    ],
  },
  {
    group: 'SOP Assets',
    items: [
      { name: 'Creative SOPs', count: 9 },
      { name: 'Story Mining SOPs', count: 7 },
      { name: 'Content SOPs', count: 8 },
      { name: 'Member Interview SOPs', count: 7 },
    ],
  },
  {
    group: 'Transformation Assets',
    items: [
      { name: 'Client Wins', count: 538 },
      { name: 'Testimonials', count: 312 },
      { name: 'Success Stories', count: 196 },
    ],
  },
  {
    group: 'Authority Assets',
    items: [
      { name: 'Podcasts', count: 88 },
      { name: 'Events', count: 24 },
      { name: 'Webinars', count: 41 },
      { name: 'Presentations', count: 33 },
    ],
  },
]

/* --------------------------- Research Intelligence ------------------------ */

export const internalSources = [
  { name: 'Sales Calls', count: 1240, signal: 91 },
  { name: 'Coaching Calls', count: 860, signal: 84 },
  { name: 'Applications', count: 3100, signal: 72 },
  { name: 'Member Interviews', count: 214, signal: 95 },
  { name: 'Event Recordings', count: 96, signal: 68 },
  { name: 'CRM Notes', count: 5400, signal: 61 },
]

export const externalSources = [
  { name: 'Reddit', count: 420, signal: 77 },
  { name: 'Forums', count: 188, signal: 64 },
  { name: 'Competitors', count: 142, signal: 70 },
  { name: 'Reviews', count: 612, signal: 81 },
  { name: 'YouTube', count: 305, signal: 66 },
]

export interface ResearchOutput {
  type: string
  items: string[]
}

export const researchOutputs: ResearchOutput[] = [
  {
    type: 'Pain Points',
    items: [
      'Working 70+ hour weeks with no exit',
      'Margins eroding despite record revenue',
      'Business cannot run without the owner',
      'Cashflow gaps between progress payments',
    ],
  },
  {
    type: 'Desires',
    items: [
      'Predictable profit on every job',
      'A leadership team that owns outcomes',
      'Weekends back without losing control',
    ],
  },
  {
    type: 'Objections',
    items: [
      "I don't have time to implement systems",
      'My business is different / too custom',
      'Coaching is for builders who are struggling',
    ],
  },
  {
    type: 'Beliefs',
    items: [
      'More revenue will fix the profit problem',
      'Only I can deliver at this quality',
      'Hiring senior people is too expensive',
    ],
  },
  {
    type: 'Language',
    items: ['"flat out"', '"chasing my tail"', '"the wheels fall off"', '"jobs going backwards"'],
  },
  {
    type: 'Market Trends',
    items: [
      'Rising material costs squeezing fixed-price jobs',
      'Skilled-labour shortage driving delays',
      'Shift toward fixed-margin contracts',
    ],
  },
]

/* ----------------------- Transformation Intelligence ---------------------- */

export interface Transformation {
  member: string
  before: { label: string; value: string }[]
  after: { label: string; value: string }[]
  type: string
  emotional: string
  financial: string
  identity: string
  angles: string[]
}

export const transformations: Transformation[] = [
  {
    member: 'Custom Home Builder — VIC',
    before: [
      { label: 'Hours', value: '70 hr weeks' },
      { label: 'Margin', value: '12%' },
      { label: 'Structure', value: 'Owner dependent' },
    ],
    after: [
      { label: 'Hours', value: '45 hr weeks' },
      { label: 'Margin', value: '22%' },
      { label: 'Structure', value: 'Leadership team' },
    ],
    type: 'Profit + Time Freedom',
    emotional: 'Relief from burnout, presence with family',
    financial: '+$340k net profit in 14 months',
    identity: 'From operator to owner',
    angles: ['Profit Leak', 'The 45-Hour Owner', 'Systems Before Scale'],
  },
  {
    member: 'Renovations Co — QLD',
    before: [
      { label: 'Revenue', value: '$2.1M' },
      { label: 'Net', value: '4%' },
      { label: 'Team', value: 'No structure' },
    ],
    after: [
      { label: 'Revenue', value: '$3.4M' },
      { label: 'Net', value: '18%' },
      { label: 'Team', value: 'PM + Estimator' },
    ],
    type: 'Systems + Leadership',
    emotional: 'Confidence, control over the calendar',
    financial: '+$540k net profit, 18% margin',
    identity: 'From foreman to CEO',
    angles: ['Systems Pattern', 'Leadership Story', 'Margin Math'],
  },
]

/* --------------------------- Creative Intelligence ------------------------ */

export interface CreativeAnalysis {
  type: string
  count: number
  winRate: number
  structure: string
  visualStyle: string
  opening: string
  cta: string
}

export const creativeAnalyses: CreativeAnalysis[] = [
  {
    type: 'Founder Video',
    count: 96,
    winRate: 71,
    structure: 'Hook → Contrarian belief → Proof → Mechanism → CTA',
    visualStyle: 'Handheld, on-site, natural light, no captions burn-in',
    opening: 'Direct-to-camera pattern interrupt in first 1.5s',
    cta: 'Soft DM / comment trigger',
  },
  {
    type: 'Static Proof Ad',
    count: 188,
    winRate: 64,
    structure: 'Big number → Member name → 1-line transformation',
    visualStyle: 'Dark bg, bold numerals, single accent color',
    opening: 'Specific profit figure as headline',
    cta: 'Learn the system',
  },
  {
    type: 'Testimonial Video',
    count: 74,
    winRate: 58,
    structure: 'Before pain → Turning point → After result',
    visualStyle: 'Interview framing, b-roll of job sites',
    opening: 'Member states their old hours/margin',
    cta: 'Apply to work with us',
  },
  {
    type: 'Event Video',
    count: 42,
    winRate: 49,
    structure: 'Energy montage → Key insight → Community proof',
    visualStyle: 'High-energy cuts, crowd, stage',
    opening: 'Room reaction shot',
    cta: 'Get on the waitlist',
  },
]

/* ----------------------------- Copy Intelligence -------------------------- */

export interface CopyItem {
  text: string
  metric: string
  angle: string
}

export const topHooks: CopyItem[] = [
  { text: "Most builders don't have a revenue problem. They have a profit leak.", metric: '4.2% CTR', angle: 'Profit' },
  { text: 'You built a job that pays worse than your foreman.', metric: '3.8% CTR', angle: 'Time Freedom' },
  { text: 'Scaling a broken business just breaks it faster.', metric: '3.6% CTR', angle: 'Systems' },
  { text: 'Your margin is hiding in plain sight.', metric: '3.3% CTR', angle: 'Cashflow' },
]

export const topHeadlines: CopyItem[] = [
  { text: 'From 12% to 22% margin in 14 months — without taking on more jobs.', metric: '2.1x ROAS', angle: 'Profit' },
  { text: 'The builders working 45-hour weeks aren’t working harder. They’re working different.', metric: '1.9x ROAS', angle: 'Time Freedom' },
  { text: 'Build the team that builds the business.', metric: '1.7x ROAS', angle: 'Leadership' },
]

export const topOffers: CopyItem[] = [
  { text: 'The Profit System Audit — find your leak in 30 minutes.', metric: '38% book rate', angle: 'Profit' },
  { text: 'Leadership Blueprint workshop for builders doing $2M+.', metric: '29% book rate', angle: 'Leadership' },
  { text: 'The 90-Day Systems Sprint.', metric: '24% book rate', angle: 'Systems' },
]

/* ---------------------------- Pattern Intelligence ------------------------ */

export interface Pattern {
  name: string
  hook: string
  headline: string
  creativeStyle: string
  transformation: string
  offer: string
  cta: string
  notes: string
  strength: number
}

export const patterns: Pattern[] = [
  {
    name: 'Profit Pattern',
    hook: "Most builders don't have a revenue problem. They have a profit leak.",
    headline: 'From 12% to 22% margin without taking on more jobs.',
    creativeStyle: 'Static proof ad, bold numerals',
    transformation: 'Low margin → predictable profit',
    offer: 'Profit System Audit',
    cta: 'Find your leak',
    notes: 'Highest win index. Pairs best with member profit numbers.',
    strength: 94,
  },
  {
    name: 'Systems Pattern',
    hook: 'Scaling a broken business just breaks it faster.',
    headline: 'Systems before scale.',
    creativeStyle: 'Whiteboard / founder video',
    transformation: 'Chaos → repeatable operations',
    offer: '90-Day Systems Sprint',
    cta: 'Build your system',
    notes: 'Strong with operations-pain segment.',
    strength: 88,
  },
  {
    name: 'Time Freedom Pattern',
    hook: 'You built a job that pays worse than your foreman.',
    headline: 'The 45-hour owner.',
    creativeStyle: 'Day-in-the-life UGC',
    transformation: '70 hr weeks → 45 hr weeks',
    offer: 'Owner Freedom Roadmap',
    cta: 'Get your time back',
    notes: 'Highest emotional resonance + save rate.',
    strength: 85,
  },
  {
    name: 'Authority Pattern',
    hook: '20 years. 500+ builders. One system.',
    headline: 'The program builders actually finish.',
    creativeStyle: 'Event montage',
    transformation: 'Skeptic → believer',
    offer: 'Waitlist',
    cta: 'See the proof',
    notes: 'Use to warm cold audiences before profit angle.',
    strength: 77,
  },
  {
    name: 'Transformation Pattern',
    hook: 'Same business. Different owner.',
    headline: 'What changed wasn’t the market.',
    creativeStyle: 'Before/after testimonial',
    transformation: 'Owner-dependent → leadership team',
    offer: 'Apply',
    cta: 'Read the story',
    notes: 'Best mid-funnel asset.',
    strength: 82,
  },
  {
    name: 'Contrarian Pattern',
    hook: 'Stop trying to grow.',
    headline: 'The advice that doubled their margin.',
    creativeStyle: 'Founder direct-to-camera',
    transformation: 'Growth obsession → profit focus',
    offer: 'Profit System Audit',
    cta: 'Hear me out',
    notes: 'Breaks pattern fatigue. Rotate in quarterly.',
    strength: 79,
  },
]

/* -------------------------- ATLAS foundation assets ----------------------- */

/**
 * The Knowledge-Vault and connected-website documents ATLAS stands on.
 *
 * Every other intelligence layer has curated documents behind it in the
 * fallback corpus (patterns, copy, transformations, learnings, research,
 * creative analyses). ATLAS reads the `vault` and `website` systems, which had
 * no curated documents at all — so the layer the platform calls its foundation
 * was the one layer that could never return evidence without a live Supabase +
 * Voyage stack.
 *
 * What ships here is UNIVERSAL CRAFT and nothing else: ad anatomy, copy
 * frameworks, hook construction, compliance, offer framing by awareness stage.
 * That knowledge belongs to the product and is true for every business on it.
 *
 * What used to ship alongside it was one specific company's positioning, proof
 * points, audience fears and brand voice, filed under the `website` system —
 * the exact system a connected site's real profile lands in. Any deployment
 * whose vector store was unreachable therefore retrieved another company —
 * a residential builder — as its own identity, and grounded every campaign in
 * it. A tenant's
 * identity is never shipped in the source; it is read from their website.
 *
 * Kept isomorphic (no `fs`) because `lib/knowledge.ts` is imported by client
 * components — reading the markdown at runtime would break the browser bundle.
 */
export interface FoundationAsset {
  system: 'vault' | 'website'
  category: string
  title: string
  content: string
}

export const foundationAssets: FoundationAsset[] = [
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'Meta Ad Anatomy — the three copy slots',
    content:
      'A Meta feed ad has three copy slots that must work together. Hook (primary text, first line): the only line visible before "See more" — it must stop the scroll on its own, one sentence, ideally under 12 words. Body (primary text, remainder): expands the promise, handles the objection, builds belief; under ~150 words in short paragraphs. CTA: the button plus a closing line driving one clear next action. Write the hook to survive alone above the fold.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'PAS — Problem · Agitate · Solve',
    content:
      'Name the reader\'s problem, twist the knife on what it costs them, then resolve it with the brand\'s proof. Best for fear-led angles — money leaking, time lost, a supplier who vanishes, dependence on one person. Pairs with problem-aware and solution-aware traffic.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'BAB — Before · After · Bridge',
    content:
      'Paint the "before" (stress, uncertainty, everything on fire), then the "after" (calm, margin, work finished, time back), and position the mechanism as the bridge between them. Best for aspiration and transformation angles where a named client win supplies the after-state.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'AIDA — Attention · Interest · Desire · Action',
    content:
      'Attention, Interest, Desire, Action. The classic full-arc structure for a colder audience that needs the whole argument inside one ad. Use when the traffic is unaware or problem-aware and no prior context can be assumed.',
  },
  {
    system: 'vault',
    category: 'Hook Frameworks',
    title: 'The 4 U\'s — Useful, Unique, Urgent, Ultra-specific',
    content:
      'A strong hook tends to be Useful, Unique, Urgent and Ultra-specific. A concrete figure the business can actually stand behind — a count, a timeframe, a measured before-and-after — outperforms a vague adjective every time. Specificity is credibility: name the mechanism and the number rather than claiming the category ("trusted", "proven", "no hidden costs").',
  },
  {
    system: 'vault',
    category: 'Hook Frameworks',
    title: 'Hook construction checklist',
    content:
      'Four gates every hook must pass. 1. Does it name a specific fear or desire in the first six words? 2. Is there a concrete number or a detail only this business could supply? 3. Could a competitor run it unchanged — if yes, rewrite it. 4. Is it under ~12 words and readable at a glance? A hook that fails gate 3 is a category claim, not a campaign.',
  },
  {
    system: 'vault',
    category: 'Creative SOPs',
    title: 'Rules of thumb — writing the ad',
    content:
      'Lead with the reader\'s fear or desire, never the company. One idea per ad — do not stack three offers. Specificity equals credibility. Write at a Grade 5–6 reading level with short words and short sentences. Match message to temperature: cold audiences need the problem named, warm and retargeting audiences need the objection crushed and the CTA made obvious.',
  },
  {
    system: 'vault',
    category: 'Creative SOPs',
    title: 'Meta compliance guardrails',
    content:
      'No claims that cannot be substantiated. Avoid before/after framing that implies a guaranteed personal outcome. Do not assert personal attributes about the viewer ("Struggling with debt?") — speak to the situation, not the person\'s identity. No fake countdowns or invented scarcity. Attribute every results figure to a named individual as their result, and carry the not-typical disclaimer wherever a named client\'s result appears.',
  },
  {
    system: 'vault',
    category: 'Story Mining SOPs',
    title: 'Mining a client win into creative',
    content:
      'Pull the before-state in the client\'s own words (what it cost them, the moment it broke), the turning point (which mechanism, applied when), and the after-state with one hard figure. Ship it as: named client, concrete number, the mechanism between the two. Refresh the proof inventory on a schedule — a named client with a real figure outperforms a promise the whole category could make.',
  },
  {
    system: 'vault',
    category: 'Offer Frameworks',
    title: 'Offer framing by awareness stage',
    content:
      'Unaware and problem-aware traffic converts to a low-friction diagnostic (audit, assessment, scorecard) — the offer is clarity, not the program. Solution-aware traffic converts to the mechanism itself, named. Product-aware and most-aware traffic converts to the direct application or call, where the job of the ad is objection removal and urgency, not education.',
  },
]

/* ----------------------------- Creative Learnings ------------------------- */

export interface Learning {
  insight: string
  /**
   * What stands behind the insight.
   *
   * These used to carry hard figures — "71% win rate vs 58% across 170
   * creatives" — measured on one company's ad account and shipped to every
   * deployment as the rubric OPUS self-scores against. No other tenant ran
   * those creatives, so the numbers were, from their side, invented. A rubric
   * that opens with a fabricated statistic teaches the orchestrator to argue
   * from evidence nobody has.
   *
   * The floor below therefore claims no measurement at all. Real figures reach
   * the rubric through `resolveCreativeLearnings()`, computed from the
   * account's OWN graded outcomes, and they say how many creatives they rest on.
   */
  evidence: string
  recommendation: string
}

/**
 * The Creative Learnings floor — craft that holds before an account has run
 * anything, stated as principle rather than as measurement.
 *
 * Superseded per-run by the tenant's own outcomes the moment there are enough
 * of them to mean something (see `resolveCreativeLearnings` in lib/outcomes.ts).
 */
export const learnings: Learning[] = [
  {
    insight: 'A creative earns attention in its first beat or not at all.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Open on one concrete, specific pattern-interrupt. Never open on the offer, the brand, or a claim any competitor could make.',
  },
  {
    insight: 'Specific, attributable figures outperform category adjectives.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Lead with a number the business can stand behind and attribute it to a named individual as their result. "Trusted", "proven" and "leading" are claims, not evidence.',
  },
  {
    insight: 'A transformation the reader recognises beats a feature list.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Frame the mechanism inside a before-and-after the audience can place themselves in, rather than describing what the offer includes.',
  },
  {
    insight: 'A creative that could run for a competitor unchanged is not a campaign.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Test every concept by swapping the brand name out. If it still reads, the concept carries no proof and belongs to the category, not the business.',
  },
]

/* --------------------------- Campaign Reactor ----------------------------- */

export const reactorInputs = [
  'Research Intelligence',
  'Transformation Intelligence',
  'Creative Intelligence',
  'Copy Intelligence',
  'Frameworks',
  'SOPs',
  'Patterns',
]

// The creative deliverables a new campaign can produce. Kept deliberately
// simple for onboarding — the user picks one or all, and copy is generated as
// part of every concept. The richer internal concept taxonomy (Founder /
// Testimonial / Campaign …) is expanded from these by the reactor route.
export const reactorOutputTypes = [
  'Static Creative',
  'Video Creative',
  'UGC Creative',
  'Carousel Creatives',
  'Montage / Scene Flow',
]
