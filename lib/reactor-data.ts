// Demo intelligence data for the Creative Reactor command center.
//
// Two different things live in this file and they are NOT interchangeable:
//
//   · UNIVERSAL CRAFT (`foundationAssets`, `learnings`) — e-commerce creative
//     anatomy, UGC structure, comparison and review formats, hook
//     construction, compliance, offer framing by awareness stage. True for
//     every brand on the platform, so it ships and is retrievable
//     unconditionally.
//
//   · ONE ILLUSTRATIVE BRAND'S DATA (`patterns`, `topHooks`/`topHeadlines`/
//     `topOffers`, `transformations`, `researchOutputs`, `creativeAnalyses`,
//     `vaultCategories`, `recommendations`) — a sample e-commerce account's
//     winning creative, review language and results. Illustrative for demos
//     and screenshots and WRONG for anyone else, so it is gated behind
//     `demoDataEnabled()` on every surface. Display defaults ON for demos
//     (`=0` turns it off); RETRIEVAL is a separate, strictly opt-in half
//     (`=1`) — see lib/demo-mode.ts.
//
// If you add to this file, decide which of the two it is first. Anything that
// names a product, a customer, a figure or a market belongs in the second
// group; put it anywhere reachable without the flag and every brand on the
// deployment inherits another account's results as its own.

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
  { label: 'Reviews Mined', value: 4210, delta: '+186', trend: 'up' },
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

/**
 * The angle win index on the dashboard — demo display only. The angles the
 * BRIEF offers are `angleSeeds` in lib/reactor-inputs.ts; these carry the same
 * names so the illustration and the menu never disagree.
 */
export const winningAngles: AngleStat[] = [
  { name: 'Social Proof', score: 94, campaigns: 61, trend: 'up', delta: '4', accent: 'emerald' },
  { name: 'Problem → Solution', score: 89, campaigns: 54, trend: 'up', delta: '3', accent: 'cyan' },
  { name: 'Us vs Them', score: 86, campaigns: 41, trend: 'up', delta: '5', accent: 'blue' },
  { name: 'Offer-Led', score: 80, campaigns: 47, trend: 'flat', delta: '—', accent: 'amber' },
  { name: 'Quality & Craft', score: 76, campaigns: 33, trend: 'up', delta: '2', accent: 'violet' },
  { name: 'Founder Story', score: 71, campaigns: 22, trend: 'up', delta: '3', accent: 'pink' },
  { name: 'Identity & Lifestyle', score: 68, campaigns: 29, trend: 'down', delta: '2', accent: 'cyan' },
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
  { label: 'Top Performing Placement', value: 'Instagram Reels', metric: 'ROAS 3.9x', pct: 82, accent: 'blue' },
  { label: 'Best Performing Format', value: 'UGC Video', metric: 'Win Rate 64%', pct: 64, accent: 'emerald' },
  { label: 'Optimal Headline Length', value: '4-7 Words', metric: 'Win Rate 71%', pct: 71, accent: 'violet' },
  { label: 'Peak Purchase Window', value: '8PM - 11PM', metric: 'Win Rate 61%', pct: 61, accent: 'amber' },
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
  { dimension: 'Reviews & Proof', cells: [70, 74, 78, 84, 88, 95] },
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
    campaign: 'The Review Wall',
    reason:
      'Review-led statics are converting cart abandoners at 2.3x the account average. Customer language is out-pulling brand language in every retargeting cohort.',
    assetsNeeded: ['Review-Wall Static', 'UGC Testimonial', 'Product-Hero Carousel'],
    suggestedHook: 'I didn’t expect to reorder this fast.',
    confidence: 92,
    priority: 'Critical',
  },
  {
    campaign: 'Us vs The Cheap One',
    reason:
      'Side-by-side comparison statics hold the highest hook rate on cold prospecting and are breaking the fatigue on the product-hero set.',
    assetsNeeded: ['Side-by-Side Static', 'Founder Phone Video', 'Feature Callout Carousel'],
    suggestedHook: 'Why we stopped buying the cheap one.',
    confidence: 87,
    priority: 'High',
  },
  {
    campaign: 'Starter Bundle Push',
    reason:
      'Bundle buyers carry a 41% higher AOV and reorder sooner. The bundle offer is running on a fraction of the spend its demand supports.',
    assetsNeeded: ['Bundle Flat-Lay Static', 'Unboxing UGC', 'Offer Carousel'],
    suggestedHook: 'Everything you need to start, in one box.',
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

/**
 * The Vault's upload tiles. Each one routes to a knowledge system in
 * `app/(platform)/knowledge-vault/UploadGrid.tsx` — keep the titles in step.
 */
export const uploadCards: UploadCard[] = [
  { title: 'Upload Winning Creative', accept: 'Video / Image', icon: 'Clapperboard' },
  { title: 'Upload Customer Reviews', accept: 'CSV / Text', icon: 'Star' },
  { title: 'Upload Product Specs', accept: 'Doc / PDF', icon: 'Package' },
  { title: 'Upload Brand Guidelines', accept: 'Doc / PDF', icon: 'Palette' },
  { title: 'Upload Winning Copy', accept: 'Text / Doc', icon: 'FileText' },
  { title: 'Upload Hook Framework', accept: 'Doc / PDF', icon: 'Anchor' },
  { title: 'Upload Creative Framework', accept: 'Doc / PDF', icon: 'LayoutTemplate' },
  { title: 'Upload Offer Framework', accept: 'Doc / PDF', icon: 'Tag' },
  { title: 'Upload UGC Script', accept: 'Doc / Script', icon: 'Film' },
  { title: 'Upload Creative SOP', accept: 'Doc / PDF', icon: 'ListChecks' },
  { title: 'Upload Customer Survey', accept: 'CSV / Text', icon: 'MessageSquare' },
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
      { name: 'UGC Footage', count: 64 },
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
      { name: 'Offers', count: 96 },
      { name: 'UGC Scripts', count: 58 },
    ],
  },
  {
    group: 'Framework Assets',
    items: [
      { name: 'Hook Frameworks', count: 14 },
      { name: 'Creative Frameworks', count: 12 },
      { name: 'Offer Frameworks', count: 11 },
      { name: 'UGC Frameworks', count: 8 },
    ],
  },
  {
    group: 'SOP Assets',
    items: [
      { name: 'Creative SOPs', count: 9 },
      { name: 'Review Mining SOPs', count: 6 },
      { name: 'UGC Brief SOPs', count: 7 },
      { name: 'Launch SOPs', count: 5 },
    ],
  },
  {
    group: 'Proof Assets',
    items: [
      { name: 'Customer Reviews', count: 4210 },
      { name: 'Testimonials', count: 312 },
      { name: 'UGC Clips', count: 196 },
    ],
  },
  {
    group: 'Product Assets',
    items: [
      { name: 'Product Photos', count: 248 },
      { name: 'Product Specs', count: 41 },
      { name: 'Brand Guidelines', count: 3 },
    ],
  },
]

/* --------------------------- Research Intelligence ------------------------ */

export const internalSources = [
  { name: 'Customer Reviews', count: 4210, signal: 93 },
  { name: 'Support Tickets', count: 1860, signal: 82 },
  { name: 'Post-Purchase Surveys', count: 940, signal: 88 },
  { name: 'Return Reasons', count: 610, signal: 79 },
  { name: 'Customer Interviews', count: 120, signal: 95 },
  { name: 'Email Replies', count: 2300, signal: 64 },
]

export const externalSources = [
  { name: 'Reddit', count: 420, signal: 77 },
  { name: 'TikTok Comments', count: 980, signal: 72 },
  { name: 'Competitor Reviews', count: 612, signal: 84 },
  { name: 'Marketplace Reviews', count: 1440, signal: 81 },
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
      'Bought the cheap version twice and both gave out',
      'Tried three brands and nothing stuck',
      'Too many steps to fit into a busy morning',
      'Never sure which size or variant to pick',
    ],
  },
  {
    type: 'Desires',
    items: [
      'Something that just works, every day',
      'Looks as good as it performs',
      'Feeling like a smart buy, not a splurge',
    ],
  },
  {
    type: 'Objections',
    items: [
      'It’s expensive for what it is',
      'I’ve been burned by brands on Instagram before',
      'What if it doesn’t suit me?',
    ],
  },
  {
    type: 'Beliefs',
    items: [
      'All of these products are basically the same',
      'The ads always look better than the real thing',
      'Online reviews are mostly fake',
    ],
  },
  {
    type: 'Language',
    items: ['"actually worth it"', '"holy grail"', '"obsessed"', '"repurchased three times"'],
  },
  {
    type: 'Market Trends',
    items: [
      'Buyers checking reviews and short-form video before purchase',
      'Repeat categories shifting to bundles and subscriptions',
      'Rising acquisition costs pushing brands toward creative volume',
    ],
  },
]

/* --------------------------- Review Intelligence -------------------------- */

/**
 * A customer's before-and-after as their reviews tell it. The field names
 * predate the e-commerce platform (`member`), the shape does not: what changed,
 * what it felt like, what it was worth, who they became.
 */
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
    member: 'Verified buyer — repeat customer',
    before: [
      { label: 'Routine', value: '5 products' },
      { label: 'Spend', value: '$140 a month' },
      { label: 'Result', value: 'Inconsistent' },
    ],
    after: [
      { label: 'Routine', value: '2 products' },
      { label: 'Spend', value: '$65 a month' },
      { label: 'Result', value: 'Every day' },
    ],
    type: 'Simplicity + Value',
    emotional: 'Relief from decision fatigue',
    financial: 'Saves about $75 a month',
    identity: 'From trial-and-error to sorted',
    angles: ['Problem → Solution', 'Us vs Them', 'Subscribe & Save'],
  },
  {
    member: 'Verified buyer — bought as a gift, then for themself',
    before: [
      { label: 'Intent', value: 'One-off gift' },
      { label: 'Orders', value: '1' },
      { label: 'Basket', value: 'Single item' },
    ],
    after: [
      { label: 'Intent', value: 'Own routine' },
      { label: 'Orders', value: '4' },
      { label: 'Basket', value: 'Bundle' },
    ],
    type: 'Gifting + Loyalty',
    emotional: 'Delight that turned into habit',
    financial: 'Four orders in six months',
    identity: 'From gift-giver to regular',
    angles: ['Gifting', 'Social Proof', 'Bundle'],
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
    type: 'UGC Unboxing',
    count: 112,
    winRate: 68,
    structure: 'Reaction in the first 2s → product in hand → one benefit shown → offer card',
    visualStyle: 'Phone-shot, natural light, the creator’s own home',
    opening: 'First reaction, mid-unboxing, product on screen',
    cta: 'Shop now',
  },
  {
    type: 'Product-Hero Static',
    count: 188,
    winRate: 61,
    structure: 'Product large → one-line benefit headline → offer strip',
    visualStyle: 'Seamless backdrop in the brand palette, one clean shadow',
    opening: 'The benefit, in the customer’s own words',
    cta: 'Get 20% off',
  },
  {
    type: 'Review-Wall Static',
    count: 74,
    winRate: 66,
    structure: 'Star rating → three short quotes → product',
    visualStyle: 'Clean card layout around the product',
    opening: 'The strongest review, quoted verbatim',
    cta: 'See why they reorder',
  },
  {
    type: 'Us vs Them Static',
    count: 52,
    winRate: 59,
    structure: 'Split frame → three concrete differences → product wins',
    visualStyle: 'Product beside the generic version, ticks against crosses',
    opening: 'The difference the buyer already suspects',
    cta: 'Make the switch',
  },
]

/* ----------------------------- Copy Intelligence -------------------------- */

export interface CopyItem {
  text: string
  metric: string
  angle: string
}

export const topHooks: CopyItem[] = [
  { text: 'I didn’t think it would work. I’ve reordered twice.', metric: '4.4% CTR', angle: 'Social Proof' },
  { text: 'The cheap one lasted a month. This one’s on year two.', metric: '3.9% CTR', angle: 'Us vs Them' },
  { text: 'Your morning routine has too many steps.', metric: '3.5% CTR', angle: 'Problem → Solution' },
  { text: 'We tested 40 materials before we found this one.', metric: '3.1% CTR', angle: 'Quality & Craft' },
]

export const topHeadlines: CopyItem[] = [
  { text: 'The last one you’ll need to buy', metric: '3.4x ROAS', angle: 'Us vs Them' },
  { text: '4.8★ from 2,000+ customers', metric: '3.1x ROAS', angle: 'Social Proof' },
  { text: 'Everything you need, one box', metric: '2.8x ROAS', angle: 'Offer-Led' },
]

export const topOffers: CopyItem[] = [
  { text: 'Starter Bundle — save 25% against buying separately', metric: '4.1% CVR', angle: 'Offer-Led' },
  { text: 'Free gift on orders over $60', metric: '3.6% CVR', angle: 'Offer-Led' },
  { text: '20% off your first order', metric: '3.2% CVR', angle: 'Offer-Led' },
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
    name: 'Review Wall Pattern',
    hook: 'I’ve reordered three times.',
    headline: '4.8★ from 2,000+ customers',
    creativeStyle: 'Review-wall static',
    transformation: 'Skeptic → buyer',
    offer: 'Free shipping',
    cta: 'See the reviews',
    notes: 'Highest win index on retargeting. Pairs with cart abandoners.',
    strength: 93,
  },
  {
    name: 'Us vs Them Pattern',
    hook: 'The cheap one lasted a month.',
    headline: 'Built to be the last one',
    creativeStyle: 'Side-by-side comparison static',
    transformation: 'Generic habit → better product',
    offer: 'Full price',
    cta: 'Make the switch',
    notes: 'Breaks fatigue on cold prospecting.',
    strength: 88,
  },
  {
    name: 'Unboxing Pattern',
    hook: 'Okay, the packaging alone…',
    headline: 'Unbox the good stuff',
    creativeStyle: 'Creator UGC unboxing',
    transformation: 'Curious → wants it',
    offer: '20% off first order',
    cta: 'Shop now',
    notes: 'Highest hook rate on Reels.',
    strength: 86,
  },
  {
    name: 'Problem → Product Pattern',
    hook: 'Your routine has too many steps.',
    headline: 'One step. Done.',
    creativeStyle: 'Product-hero static',
    transformation: 'Overwhelmed → simple',
    offer: 'Starter bundle',
    cta: 'Simplify it',
    notes: 'Strongest cold opener.',
    strength: 84,
  },
  {
    name: 'Bundle Pattern',
    hook: 'Everything you need, one box.',
    headline: 'Save 25% on the set',
    creativeStyle: 'Flat-lay bundle static',
    transformation: 'Single item → full set',
    offer: 'Bundle',
    cta: 'Build your set',
    notes: 'Lifts AOV; strongest on past purchasers.',
    strength: 81,
  },
  {
    name: 'Founder Pattern',
    hook: 'I made this because I couldn’t find it.',
    headline: 'Made by someone who needed it',
    creativeStyle: 'Founder phone video',
    transformation: 'Brand-agnostic → brand loyal',
    offer: 'Full price',
    cta: 'Hear the story',
    notes: 'Warms cold audiences before offer-led creative.',
    strength: 78,
  },
]

/* -------------------------- ATLAS foundation assets ----------------------- */

/**
 * The Knowledge-Vault documents ATLAS stands on.
 *
 * Every other intelligence layer has curated documents behind it in the
 * fallback corpus. ATLAS reads the `vault` and `website` systems, which had no
 * curated documents at all — so the layer the platform calls its foundation
 * was the one layer that could never return evidence without a live Supabase +
 * Voyage stack.
 *
 * What ships here is UNIVERSAL E-COMMERCE CREATIVE CRAFT and nothing else:
 * static anatomy, UGC structure, comparison and review formats, hook
 * construction, compliance, offer framing by awareness stage, creative
 * diversity for Meta delivery. That knowledge belongs to the product and is
 * true for every brand on it. It replaced a set written around ad CAPTIONS —
 * the platform now ships the creative without one, so the craft that matters
 * is the craft of the creative itself.
 *
 * Nothing here is filed under `website`: that is where a connected store's
 * real profile lands, and a brand's identity is read from its site, never
 * shipped in the source.
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
    title: 'E-commerce static anatomy — the four zones',
    content:
      'A static e-commerce ad is read in under a second, so it is built in four zones that each do one job. PRODUCT: the real product, large, its label or shape readable at thumb size — the hero of the frame. HEADLINE: the hook — one benefit or one tension in the customer\'s own words, under about eight words. OFFER or PROOF: the second line — the deal stated exactly, or the proof (a star rating, a review, a count) when there is no deal. SPACE: clean negative space so the eye lands on the product first. The caption is written later in Ads Manager; the creative has to sell without it.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'UGC video structure — hook · product · proof · offer',
    content:
      'First two seconds: a reaction, a question or the problem — with the product already on screen. Seconds two to eight: the product in use, one benefit demonstrated rather than described. Seconds eight to fifteen: proof — the creator\'s honest verdict, or a second customer. Close: the offer card. Phone-shot footage, natural light and the creator\'s own space out-pull studio polish with cold audiences.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'Us vs Them — the comparison static',
    content:
      'A split frame or two columns: the product beside the alternative the buyer already uses — the generic version, the old habit, the category default. Three concrete, visible differences, each one true of the product. Name the category, never a competitor brand. The product wins on what the buyer can see, not on adjectives.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'The review wall',
    content:
      'Stack real customer reviews around the product: the star rating, then three short quotes in the customers\' own words, verbatim. Reviews are the native proof of e-commerce and outperform brand claims with warm and retargeting audiences. Use only reviews the brand actually holds — never write one, and never edit one into a stronger claim.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'PAS — Problem · Agitate · Solve, for a product',
    content:
      'Name the everyday frustration, show what putting up with it costs, then show the product ending it — in use, on screen. Best for problem-aware cold traffic. Describe the moment, never the person: an ad that tells the viewer what is wrong with them is rejected by Meta and resented by the reader.',
  },
  {
    system: 'vault',
    category: 'Creative Frameworks',
    title: 'Creative diversity for Meta delivery',
    content:
      'Meta\'s delivery groups near-identical creatives and treats them as a single bet, so ten recolours of one ad buy one test. Diversify on the dimensions that change who an ad reaches: the persona in it, the desire it promises, the format (static, UGC, carousel) and the visual world. Keep a controlled test controlled — change one lever within a format — but make separate concepts genuinely different.',
  },
  {
    system: 'vault',
    category: 'Hook Frameworks',
    title: 'The 4 U\'s — Useful, Unique, Urgent, Ultra-specific',
    content:
      'A strong hook tends to be Useful, Unique, Urgent and Ultra-specific. A concrete detail the brand can stand behind — a material, a count, a timeframe, a real review — outperforms a vague adjective every time. Specificity is credibility: name the thing rather than claiming the category ("premium", "best", "game-changing").',
  },
  {
    system: 'vault',
    category: 'Hook Frameworks',
    title: 'Hook construction checklist',
    content:
      'Four gates every hook must pass. 1. Does it name a specific frustration or desire in the first six words? 2. Is there a concrete detail only this product could supply? 3. Could a competitor run it unchanged — if yes, rewrite it. 4. Does it read at a glance, on a phone, over the product? A hook that fails gate 3 is a category claim, not a campaign.',
  },
  {
    system: 'vault',
    category: 'Creative SOPs',
    title: 'Rules of thumb — building the creative',
    content:
      'Lead with the product or the problem it ends, never the logo. One idea per creative — one benefit, one offer. Specificity equals credibility. On-image copy must read at a glance: two short lines at most. Match the creative to temperature: cold audiences need the product and the problem; warm and retargeting audiences need proof, the offer and the objection answered.',
  },
  {
    system: 'vault',
    category: 'Creative SOPs',
    title: 'Meta compliance guardrails — e-commerce',
    content:
      'No claim that cannot be substantiated: no cures, no guaranteed results, no weight-loss figures. Never assert personal attributes ("Do you have acne?") — speak to the situation, not the person. Before-and-after imagery is restricted for weight loss and for anything sold as changing the body. Prices, discounts, ratings and review counts must be real and current. No fake scarcity or countdowns. No imitation of Meta\'s own interface — no fake play buttons, notifications or checkboxes.',
  },
  {
    system: 'vault',
    category: 'Story Mining SOPs',
    title: 'Mining reviews into creative',
    content:
      'Read reviews for three things: the moment that made them buy (the trigger), the words they use for the benefit (the language), and the doubt they had beforehand (the objection). The trigger becomes the hook, the language becomes the headline, the objection becomes the proof. Quote verbatim and prefer a specific story — the skeptic who reordered — over generic praise.',
  },
  {
    system: 'vault',
    category: 'Offer Frameworks',
    title: 'Offer framing by awareness stage',
    content:
      'Unaware and problem-aware traffic buys the product\'s story before any deal: lead with the problem and the product, keep the offer secondary. Solution-aware traffic is comparing: lead with the difference and the guarantee. Product-aware traffic needs the push — the offer, the free shipping, the reason to buy today. Most-aware traffic needs only the deal and the product. A discount used too early trains buyers to wait for the next one.',
  },
]

/* ----------------------------- Creative Learnings ------------------------- */

export interface Learning {
  insight: string
  /**
   * What stands behind the insight.
   *
   * These used to carry hard figures measured on one company's ad account and
   * shipped to every deployment as the rubric OPUS self-scores against. No
   * other brand ran those creatives, so the numbers were, from their side,
   * invented. A rubric that opens with a fabricated statistic teaches the
   * orchestrator to argue from evidence nobody has.
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
 * Superseded per-run by the brand's own outcomes the moment there are enough
 * of them to mean something (see `resolveCreativeLearnings` in lib/outcomes.ts).
 */
export const learnings: Learning[] = [
  {
    insight: 'A creative earns attention in its first beat or not at all.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Open on the product, the problem it ends or the proof — one concrete, specific pattern-interrupt. Never open on the logo, the offer alone, or a claim any competitor could make.',
  },
  {
    insight: 'Customer proof outperforms brand claims.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Use real reviews, ratings and counts in the customers’ own words, exactly as the brand holds them. "Premium", "best" and "game-changing" are claims, not evidence.',
  },
  {
    insight: 'The product in use beats the product described.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Show the benefit happening — the texture, the fit, the moment it works — rather than listing features. If the creative could be a spec sheet, it is not an ad.',
  },
  {
    insight: 'A creative that could run for a competitor unchanged is not a campaign.',
    evidence: 'Craft principle — not yet measured on this account.',
    recommendation:
      'Test every concept by swapping the brand and product out. If it still reads, the concept carries no proof and belongs to the category, not the brand.',
  },
]

/* --------------------------- Campaign Reactor ----------------------------- */

export const reactorInputs = [
  'Research Intelligence',
  'Review Intelligence',
  'Creative Intelligence',
  'Copy Intelligence',
  'Frameworks',
  'SOPs',
  'Patterns',
]

// The creative deliverables a new campaign can produce. Kept deliberately
// simple for onboarding — the user picks one or all, and every concept carries
// its own on-image copy (there is no separate caption: the platform makes the
// creative, not the caption). The richer internal concept taxonomy (Founder /
// Testimonial / Campaign …) is expanded from these by the reactor route.
export const reactorOutputTypes = [
  'Static Creative',
  'Video Creative',
  'UGC Creative',
  'Carousel Creatives',
  'Montage / Scene Flow',
]

/**
 * The deliverables that render as a still.
 *
 * Kept next to the full list rather than derived from a name match, because
 * "Carousel Creatives" is a still format whose label says neither "static" nor
 * "image", and a regex over these labels would quietly drop it.
 */
export const staticOutputTypes = ['Static Creative', 'Carousel Creatives']

/**
 * Recommend static formats only.
 *
 * This deployment currently ships static Meta ads: the proven-ad research is
 * image-only, the design read needs a still, and a video model that is not
 * keyed produces a concept with nothing under it. So the SYSTEM never proposes
 * a medium it is not set up to deliver — while the operator keeps every format
 * in the brief, because removing the choice would be a different decision than
 * the one taken here.
 *
 * `REACTOR_STATIC_ONLY=false` restores video and UGC to the recommendation the
 * moment the video ovens are wired, with no deploy.
 */
export function staticOnly(): boolean {
  return process.env.REACTOR_STATIC_ONLY !== 'false'
}

/** The deliverables the system may recommend right now. */
export function recommendableOutputTypes(): string[] {
  return staticOnly() ? staticOutputTypes : reactorOutputTypes
}
