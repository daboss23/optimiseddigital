/**
 * E-commerce self-test — the creative-first platform, checked in process.
 *
 * Every assertion here guards a way an e-commerce ad goes wrong AFTER it looks
 * finished: a price nobody published, a discount rounded up, a headline the
 * renderer misspelled, a cure claim burned into pixels, a purchase counted
 * three times, a creative uploaded into somebody else's ad account, an ad that
 * won and can never be traced back to the concept that made it.
 *
 * Nothing here touches the network. Store payloads are captured shapes, and
 * the Graph API is a stub that records what it was sent — a suite that hit a
 * live ad account would upload into it on every run.
 *
 * Run: npx tsx scripts/ecom-selftest.ts
 */

import {
  catalogRangeBlock,
  discountPercent,
  formatPrice,
  inferNiches,
  parseShopifyProducts,
  parseWooProducts,
  productFactsBlock,
  productsFromJsonLd,
  enrichFromPage,
  visionSizedImage,
} from '@/lib/catalog/parse'
import type { Catalog } from '@/lib/catalog/types'
import { csvToKnowledgeText, parseCsv, reviewLines, rowLines } from '@/lib/csv'
import {
  creativeCopyFeedback,
  metaAdName,
  metaAssetName,
  parseTestToken,
  placementFor,
  validateCreativeCopy,
} from '@/lib/meta-ads'
import { missingOnImageText } from '@/lib/neuro'
import { conversions, resultCount, type InsightRow } from '@/lib/meta-graph'
import { assetsOf, gradeAd, purchaseGraded } from '@/lib/meta-ingest'
import { friendlyGraphError, resolveUploadTarget, uploadCreativeToMeta } from '@/lib/meta-publish'
import { angleSeeds, audienceOptions, offerOptions, outputTypeOptions } from '@/lib/reactor-inputs'
import { OFFER_RESULT_RULES } from '@/lib/creative-status'
import { ECOMMERCE_VERTICALS, ICP_FOCUSES, isEcommerceNiche } from '@/lib/gethookd/icp'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } else {
    failures++
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* --------------------------------- fixtures -------------------------------- */

const ORIGIN = 'https://store.example.com'

const SHOPIFY = {
  products: [
    {
      id: 8101,
      title: 'Hydrating Vitamin C Serum',
      handle: 'vitamin-c-serum',
      body_html: '<p>A lightweight <strong>serum</strong> for daily use.</p><script>alert(1)</script>',
      vendor: 'Example',
      product_type: 'Serum',
      tags: ['skincare', 'serum', 'vitamin c'],
      variants: [
        { price: '39.00', compare_at_price: '52.00', available: false },
        { price: '29.00', compare_at_price: '39.00', available: true },
        { price: '49.00', compare_at_price: null, available: true },
      ],
      images: [{ src: '//cdn.shopify.com/s/files/serum.jpg' }, { src: 'https://cdn.shopify.com/s/files/serum-2.jpg' }],
    },
    {
      id: 8102,
      title: 'Daily Moisturiser',
      handle: 'daily-moisturiser',
      body_html: '',
      product_type: 'Moisturizer',
      tags: 'skincare, moisturizer',
      variants: [{ price: '24.00', compare_at_price: '24.00', available: false }],
      images: [],
    },
    { id: 8103, title: 'Gift Card', handle: 'gift-card', variants: [{ price: '50' }], tags: [] },
    { title: '', handle: 'broken' },
  ],
}

const WOO = [
  {
    id: 77,
    name: 'Cold Brew Coffee Kit',
    permalink: 'https://store.example.com/product/cold-brew-kit/',
    short_description: '<p>Everything for cold brew.</p>',
    prices: { price: '2900', regular_price: '3900', currency_code: 'AUD', currency_minor_unit: 2 },
    images: [{ src: 'https://store.example.com/wp-content/uploads/kit.jpg' }],
    categories: [{ name: 'Coffee' }],
    tags: [{ name: 'coffee' }],
    average_rating: '4.60',
    review_count: 128,
    is_in_stock: true,
    variations: [],
  },
  {
    id: 78,
    name: 'Filter Papers',
    permalink: 'https://store.example.com/product/filter-papers/',
    prices: { price: '500', regular_price: '500', currency_code: 'AUD', currency_minor_unit: 2 },
    images: [],
    average_rating: '0',
    review_count: 0,
    is_in_stock: false,
  },
]

const JSONLD_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">{ this is not json }</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Example"},
  {"@type":"Product","name":"Linen Throw","url":"/products/linen-throw","sku":"LT-1",
   "image":[{"@type":"ImageObject","url":"https://store.example.com/img/throw.jpg"}],
   "description":"Stonewashed linen.","brand":{"@type":"Brand","name":"Example"},
   "offers":{"@type":"AggregateOffer","lowPrice":"89.00","priceCurrency":"USD","offers":[
     {"@type":"Offer","price":"89.00","availability":"https://schema.org/InStock"},
     {"@type":"Offer","price":"119.00","availability":"https://schema.org/OutOfStock"}]},
   "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"2140"}}
]}
</script></head><body></body></html>`

async function main() {
  /* ------------------------------ 1. Catalog ------------------------------ */
  console.log('\n1. The catalog is read from the store, never invented')

  const shopify = parseShopifyProducts(SHOPIFY, ORIGIN)
  const serum = shopify.find((p) => p.id === '8101')
  check('Shopify products parse, and a nameless product is dropped', shopify.length === 3, `${shopify.length}`)
  check(
    'the price is the cheapest variant that can be BOUGHT, with ITS compare-at price',
    serum?.price === 29 && serum.compareAtPrice === 39,
    `${serum?.price} / ${serum?.compareAtPrice}`,
  )
  check('the discount is computed, rounded DOWN, never up', discountPercent(serum!) === 25, `${discountPercent(serum!)}`)
  check('scripts are stripped from a description', !/alert/.test(serum?.description ?? ''), serum?.description)
  check('protocol-relative images become absolute', serum?.imageUrl === 'https://cdn.shopify.com/s/files/serum.jpg')
  check('product URLs are built from the handle', serum?.url === `${ORIGIN}/products/vitamin-c-serum`)
  const moist = shopify.find((p) => p.id === '8102')
  check('a compare-at equal to the price is not a sale', moist?.compareAtPrice === null)
  check('availability is read from the variants', moist?.available === false && serum?.available === true)
  check('comma-string tags are split', moist?.tags.join('|') === 'skincare|moisturizer', moist?.tags.join('|'))

  const woo = parseWooProducts(WOO, ORIGIN)
  check('WooCommerce minor units become major units', woo[0]?.price === 29 && woo[0].compareAtPrice === 39)
  check('a WooCommerce rating needs reviews behind it', woo[0]?.rating === 4.6 && woo[1]?.rating === null)
  check('WooCommerce currency is carried', woo[0]?.currency === 'AUD')

  const ld = productsFromJsonLd(JSONLD_PAGE, `${ORIGIN}/products/linen-throw`)
  check('JSON-LD survives a malformed block beside a good one', ld.length === 1, `${ld.length}`)
  check(
    'an AggregateOffer reads its lowest price and currency',
    ld[0]?.price === 89 && ld[0]?.currency === 'USD',
    `${ld[0]?.price} ${ld[0]?.currency}`,
  )
  check('the published rating and count are read', ld[0]?.rating === 4.8 && ld[0]?.reviewCount === 2140)
  check('ImageObject images resolve', ld[0]?.imageUrl === 'https://store.example.com/img/throw.jpg')
  const enriched = enrichFromPage(serum!, { ...ld[0]!, rating: 4.7, reviewCount: 300, currency: 'USD' })
  check(
    'page enrichment adds the rating and currency without overwriting the catalog price',
    enriched.rating === 4.7 && enriched.currency === 'USD' && enriched.price === 29,
  )

  const catalog: Catalog = {
    source: 'shopify',
    storeUrl: ORIGIN,
    syncedAt: '2026-10-14T00:00:00.000Z',
    currency: 'USD',
    products: [enriched, moist!, ...shopify.slice(2)],
    truncated: false,
  }
  const facts = productFactsBlock(enriched, catalog)
  check('the facts block states the published sale', /\$29\.00 — on sale from \$39\.00 \(25% off/.test(facts), facts)
  check('the facts block states the rating as published', /4\.7★ from 300 reviews/.test(facts))
  check('the facts block forbids any figure it does not list', /ONLY figures a creative may state/.test(facts))
  const bare = productFactsBlock({ ...moist!, rating: null, reviewCount: null }, catalog)
  check('no published rating is stated as "do not state one"', /none published — do not state a rating/.test(bare))
  check('a sold-out product forbids an offer on it', /SOLD OUT — do not run an offer/.test(bare))
  check('the range lists only products that can be bought', !/Daily Moisturiser/.test(catalogRangeBlock(catalog)))
  check('formatPrice uses the currency when it has one', formatPrice(29, 'USD') === '$29.00' && formatPrice(29, null) === '29.00')
  check(
    'a Shopify CDN photo is resized for the vision read',
    /width=1024/.test(visionSizedImage('https://cdn.shopify.com/s/files/serum.jpg')),
  )
  check('any other host is left alone', visionSizedImage('https://img.example.com/a.jpg') === 'https://img.example.com/a.jpg')

  check('a skincare catalog researches the skincare vertical', inferNiches(shopify.slice(0, 2)).includes(32), inferNiches(shopify.slice(0, 2)).join(','))
  check('a mixed or thin catalog does not guess a vertical', inferNiches([shopify[2]]).length === 0)
  check('every inferred vertical is an e-commerce niche', inferNiches(shopify).every((n) => isEcommerceNiche(n)))

  /* ------------------------------ 2. CSV --------------------------------- */
  console.log('\n2. Review exports become voice of customer, without the customer')

  const csv = [
    'Reviewer Name,Email,Rating,Title,Body,Product Name',
    'Jane Citizen,jane@example.com,5,Never going back,"I\'ve reordered twice, honestly",Serum',
    'Sam Doe,sam@example.com,4,Good,"Works well.\nWould buy again",Serum',
    'Empty Row,e@example.com,3,,,Serum',
  ].join('\n')
  const rows = parseCsv(csv)
  check('quoted fields with commas and newlines parse', rows.length === 4 && rows[2][4] === 'Works well.\nWould buy again', JSON.stringify(rows[2]))
  const reviews = reviewLines(rows) ?? []
  check('one line per review, rating as stars', reviews[0]?.startsWith('★★★★★ — Never going back'), reviews[0])
  check('empty reviews are skipped', reviews.length === 2, `${reviews.length}`)
  const text = csvToKnowledgeText(csv)
  check('no reviewer name or email is stored', !/Jane|Citizen|example\.com/.test(text), text)
  const survey = rowLines(parseCsv('Customer Name,Email,Product Name,Why did you buy?\nAl Roe,al@x.io,Serum,"Friend recommended it"'))
  check('a survey keeps the product column and drops the person', /Product Name: Serum/.test(survey[0]) && !/Al Roe|al@x/.test(survey[0]), survey[0])

  /* --------------------------- 3. Creative claims ------------------------- */
  console.log('\n3. The words burned into a creative are checked before the render')

  const still = (text: string) => ({ type: 'Static Concept', productionBrief: { onImageText: [{ role: 'Headline', text }] } })
  const errorsOf = (text: string) => validateCreativeCopy(still(text)).filter((i) => i.severity === 'error')
  check('a cure claim is an error', errorsOf('Cures acne in a week').length > 0)
  check('a weight-loss figure is an error', errorsOf('Lose 10 lbs by summer').length > 0)
  check('a personal-attribute question is an error', errorsOf('Do you have acne?').length > 0)
  check('a guaranteed RESULT is an error', errorsOf('Guaranteed results or nothing').length > 0)
  check('a money-back GUARANTEE is an offer, not a claim', errorsOf('30-day money-back guarantee').length === 0)
  check('"dry-cured" sells salami and is not a cure claim', errorsOf('Dry-cured for 90 days').length === 0)
  check('"fat-free" is a product claim, not a personal attribute', errorsOf('Are you tired of fat-free snacks?').length === 0)
  check(
    '"clinically proven" is a warning to verify, not an error',
    validateCreativeCopy(still('Clinically proven formula')).some((i) => i.severity === 'warning') &&
      errorsOf('Clinically proven formula').length === 0,
  )
  const motion = {
    type: 'Video Concept',
    productionBrief: { frames: [{ label: 'Scene 1', description: 'She says: "this cured my insomnia"' }] },
  }
  check('a motion concept is judged on what is said in it', validateCreativeCopy(motion).some((i) => i.field === 'script'))
  check(
    'a still is judged only on its on-image words, not its art direction',
    validateCreativeCopy({ type: 'Static Concept', productionBrief: { frames: [{ label: 'Hero', description: 'cures the 3pm slump' }] } }).length === 0,
  )
  const fb = creativeCopyFeedback([still('Shop the set'), still('Cures dry skin')])
  check('the gate names exactly the failing creative', fb.failingIndices.join(',') === '1', fb.failingIndices.join(','))

  /* ---------------------------- 4. Spelling check ------------------------- */
  console.log('\n4. A misspelled headline is caught by comparison, not opinion')

  check('an exact render passes', missingOnImageText(['Your new everyday favourite'], 'YOUR NEW EVERYDAY\nFAVOURITE').length === 0)
  check('punctuation and case are ignored', missingOnImageText(['20% Off — Today!'], '20% off today').length === 0)
  check(
    'a garbled headline is reported, word for word',
    missingOnImageText(['Not disorganised'], 'NOT DISORGARUSED').join() === 'Not disorganised',
  )

  /* ------------------------------ 5. Naming -------------------------------- */
  console.log('\n5. The test token survives the trip through a media-library filename')

  const name = metaAdName({ variantId: 'RXN-4Z9Q1-B', taxonomy: { hookStyle: 'Question', visualFormat: 'UGC' } as never })
  const file = metaAssetName(name, 'png')
  check('the asset name is filename-safe', /^[A-Za-z0-9 .\-]+$/.test(file), file)
  check('the variant parses back out of the filename', parseTestToken(file)?.variantId === 'RXN-4Z9Q1-B', file)
  check('placement is read off the pixels', placementFor(1080, 1350)?.ratio === '4:5' && placementFor(1080, 1920)?.ratio === '9:16')

  /* -------------------------- 6. Counting purchases ----------------------- */
  console.log('\n6. A purchase is counted once')

  const row: InsightRow = {
    actions: [
      { action_type: 'purchase', value: '10' },
      { action_type: 'omni_purchase', value: '10' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '10' },
      { action_type: 'lead', value: '4' },
      { action_type: 'offsite_conversion.fb_pixel_lead', value: '4' },
    ],
  }
  check('synonymous purchase actions are not summed', resultCount(row, 'purchase') === 10, `${resultCount(row, 'purchase')}`)
  check('conversions are leads plus purchases, each once', conversions(row) === 14, `${conversions(row)}`)

  /* ------------------------------ 7. Grading ------------------------------- */
  console.log('\n7. An e-commerce ad is graded on what its purchases returned')

  const ad = (o: Partial<Parameters<typeof gradeAd>[0]>) => ({
    adId: 'a',
    name: 'x',
    campaign: 'c',
    spend: 500,
    ctr: 1,
    cpl: 0,
    roas: 0,
    conversions: 0,
    purchases: 0,
    cpa: 0,
    impressions: 50000,
    assets: { imageHashes: [], videoIds: [] },
    ...o,
  })
  const cohort = { ctr: 1.2, cpl: 20, roas: 2, cpa: 40, purchasers: 6, size: 8 }
  check('the cohort is purchase-graded once enough ads have purchases', purchaseGraded(cohort))
  check('strong ROAS on enough purchases wins', gradeAd(ad({ roas: 3.1, purchases: 12, cpa: 30 }), cohort) === 'winner')
  check(
    'a high CTR that sells nothing is a LOSER, not a winner',
    gradeAd(ad({ ctr: 4.5, purchases: 0, spend: 300 }), cohort) === 'loser',
  )
  check('under break-even ROAS never wins', gradeAd(ad({ roas: 0.9, purchases: 9, cpa: 20 }), { ...cohort, roas: 0.5 }) !== 'winner')
  check('without purchase signal the account falls back to clicks', gradeAd(ad({ ctr: 2.4 }), { ...cohort, purchasers: 0, size: 2 }) === 'winner')

  /* ---------------------------- 8. Attribution ----------------------------- */
  console.log('\n8. An ad built in Ads Manager traces back to the uploaded asset')

  const flexible = assetsOf({ asset_feed_spec: { images: [{ hash: 'h1' }, { hash: 'h2' }], videos: [{ video_id: 'v1' }] } })
  check('flexible creative assets are all read', flexible.imageHashes.join() === 'h1,h2' && flexible.videoIds.join() === 'v1')
  const carousel = assetsOf({ object_story_spec: { link_data: { child_attachments: [{ image_hash: 'c1' }, { image_hash: 'c2' }] } } })
  check('carousel cards are read', carousel.imageHashes.join() === 'c1,c2')

  /* ------------------------------ 9. Upload -------------------------------- */
  console.log('\n9. The upload lands in the brand’s own media library')

  process.env.META_ACCESS_TOKEN = 'test-token-0000'
  process.env.META_AD_ACCOUNT_ID = 'act_123'
  delete process.env.META_APP_SECRET
  const realFetch = globalThis.fetch
  const sent: { url: string; body: unknown }[] = []
  let graphMode: 'ok' | 'denied' = 'ok'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    sent.push({ url, body: init?.body })
    if (url.startsWith('https://cdn.example.com/')) {
      if (url.includes('blocked')) return new Response('no', { status: 403 })
      return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), { headers: { 'content-type': 'image/png' } })
    }
    if (url.includes('/act_123/adimages')) {
      if (graphMode === 'denied') {
        return new Response(JSON.stringify({ error: { message: '(#200) Requires ads_management permission', code: 200 } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ images: { 'f.png': { hash: 'hash_abc', url: 'https://meta.cdn/f.png' } } }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/act_123/advideos')) {
      return new Response(JSON.stringify({ id: 'vid_9' }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  try {
    const target = await resolveUploadTarget(null)
    check('the env fallback resolves one unambiguous ad account', target.ok && target.target.adAccountId === '123', JSON.stringify(target))

    const up = await uploadCreativeToMeta({ imageUrl: 'https://cdn.example.com/creative.png', name }, null)
    check('an image upload returns the media-library hash', up.ok && up.asset?.imageHash === 'hash_abc', JSON.stringify(up))
    const call = sent.find((s) => s.url.includes('/adimages'))
    const form = call?.body as FormData | undefined
    const filePart = form?.get('filename') as File | null
    check('the image goes up as a multipart file', Boolean(filePart) && filePart!.size === 7)
    check(
      'the filename carries the variant token',
      parseTestToken(filePart?.name)?.variantId === 'RXN-4Z9Q1-B',
      filePart?.name,
    )
    check('the access token rides in the form, never the URL', form?.get('access_token') === 'test-token-0000' && !call!.url.includes('access_token'))

    const vid = await uploadCreativeToMeta(
      { imageUrl: 'https://cdn.example.com/still.png', videoUrl: 'https://cdn.example.com/clip.mp4', name },
      null,
    )
    check('a clip wins over its still and is pulled by Meta from its URL', vid.ok && vid.asset?.videoId === 'vid_9')

    const http = await uploadCreativeToMeta({ imageUrl: 'http://cdn.example.com/creative.png', name }, null)
    check('a non-https creative is refused before anything is sent', !http.ok)
    const priv = await uploadCreativeToMeta({ imageUrl: 'https://127.0.0.1/creative.png', name }, null)
    check('a private address is refused', !priv.ok)

    graphMode = 'denied'
    const denied = await uploadCreativeToMeta({ imageUrl: 'https://cdn.example.com/creative.png', name }, null)
    check(
      'a read-only token is told exactly which permission it lacks',
      !denied.ok && /ads_management/.test(denied.error ?? ''),
      denied.error,
    )
    graphMode = 'ok'
    const cdn = await uploadCreativeToMeta({ imageUrl: 'https://cdn.example.com/blocked.png', name }, null)
    check(
      'a CDN refusal is NOT blamed on the Meta token',
      !cdn.ok && !/ads_management/.test(cdn.error ?? ''),
      cdn.error,
    )
    check('friendlyGraphError leaves a plain error alone', friendlyGraphError(new Error('boom')) === 'boom')
  } finally {
    globalThis.fetch = realFetch
  }

  /* --------------------------- 10. The vocabulary -------------------------- */
  console.log('\n10. The strategy vocabulary is e-commerce end to end')

  check('every seed angle carries its own directive', angleSeeds.every((a) => a.directive.length > 80))
  check(
    'the audience ladder is the funnel a Meta account builds',
    ['Cart abandoners — added, didn’t buy', 'Past purchasers — cross-sell & replenish'].every((l) =>
      audienceOptions.some((o) => o.label === l),
    ),
  )
  check(
    'every offer on the ladder is judged on a result',
    offerOptions.slice(1).every((o) => OFFER_RESULT_RULES.some((r) => r.offer === o.label)),
    offerOptions.slice(1).filter((o) => !OFFER_RESULT_RULES.some((r) => r.offer === o.label)).map((o) => o.label).join(', '),
  )
  check(
    'deliverables are creatives only — no caption-only outputs',
    !outputTypeOptions.some((o) => /hook|headline|vsl/i.test(o)),
  )
  check('e-commerce leads every focus list', ICP_FOCUSES[0]?.id === 'ecommerce')
  check('every vertical chip is labelled', ECOMMERCE_VERTICALS.every((v) => v.label && !/^Niche/.test(v.label)))

  console.log(
    failures === 0
      ? '\n\x1b[32mAll e-commerce checks passed.\x1b[0m\n'
      : `\n\x1b[31m${failures} e-commerce check(s) FAILED.\x1b[0m\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
