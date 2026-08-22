/* ----------------------------------------------------------------------------
   Mobile self-test.

   The bug this exists to catch was invisible to every other check in the repo:
   a 16rem tooltip anchored near the right edge of a 390px screen overflowed the
   document, Chrome answered that by WIDENING THE LAYOUT VIEWPORT to 583px, and
   every `position: fixed` overlay on the platform — the nav drawer, the brief
   sheet, Mike's first-run welcome — was then laid out to a box wider than the
   screen and hung off the side of it. Nothing threw. Nothing failed to render.
   The types were fine, the build was clean, and the first thing a new operator
   saw on a phone was a greeting with a third of it off the edge.

   So this measures the page the way a phone does, and asserts the three things
   that were wrong:

     1. The layout viewport equals the visual viewport. `window.innerWidth`
        drifting above the device width IS the bug — the sideways scroll is
        only its most visible symptom.
     2. Nothing overflows the document horizontally.
     3. Every interactive control clears 44px on the axis a thumb misses on.
        The definition triggers are the one exemption: 16px glyphs inside
        sentences that carry their target as an invisible ::after, which this
        verifies by hit-testing the point 14px above each one.

   Plus the interaction the CSS-only tooltip could never do at all: a TAP has
   to open a definition, and the panel has to land inside the screen.

   Needs a running server (`npm run dev`) and Playwright. Playwright is
   deliberately NOT a dependency of this project — it is required lazily here
   so `npm install` stays as light as it was. Install it to run this:

       npm i -D playwright && npx playwright install chromium
       npm run dev            # in another terminal
       npm run selftest:mobile
---------------------------------------------------------------------------- */

/* ----------------------------------------------------------------------------
   The slice of Playwright this script drives.

   Declared here rather than imported, because Playwright is deliberately NOT a
   dependency of this project: its postinstall downloads a ~130MB browser, and
   making every `npm install` and every Vercel build pay that so one audit
   script can typecheck is the wrong trade. The module is loaded through a
   variable specifier below so the compiler does not try to resolve it, and
   bound to these types immediately — so the script is fully checked against a
   contract that is visible right here, rather than being cast to `any` and
   silently drifting from the API it actually calls.
---------------------------------------------------------------------------- */

interface Locator {
  first(): Locator
  count(): Promise<number>
  fill(value: string): Promise<void>
  click(): Promise<void>
  tap(): Promise<void>
  scrollIntoViewIfNeeded(): Promise<void>
}

interface CDPSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

interface Page {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  locator(selector: string): Locator
  waitForURL(predicate: (url: URL) => boolean, options?: { timeout?: number }): Promise<void>
  waitForTimeout(ms: number): Promise<void>
  evaluate<Result>(fn: () => Result): Promise<Result>
  evaluate<Result, Arg>(fn: (arg: Arg) => Result, arg: Arg): Promise<Result>
  close(): Promise<void>
}

interface BrowserContext {
  addInitScript(fn: () => void): Promise<void>
  newPage(): Promise<Page>
  newCDPSession(page: Page): Promise<CDPSession>
  close(): Promise<void>
}

interface Browser {
  newContext(options: {
    viewport: { width: number; height: number }
    isMobile?: boolean
    hasTouch?: boolean
    deviceScaleFactor?: number
  }): Promise<BrowserContext>
  close(): Promise<void>
}

interface ChromiumLauncher {
  launch(options?: { executablePath?: string }): Promise<Browser>
}

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const NAME = process.env.PLATFORM_LOGIN_NAME ?? 'Bamik'
const PASSWORD = process.env.PLATFORM_LOGIN_PASSWORD ?? '1234'

/** The phones worth being right on: a current handset and the smallest one. */
const VIEWPORTS = [
  { label: 'iPhone 14', width: 390, height: 844 },
  { label: 'iPhone SE', width: 375, height: 667 },
]

const ROUTES = [
  '/',
  '/campaign-reactor',
  '/knowledge-vault',
  '/creative',
  '/meta',
  '/network',
  '/brand',
  '/playbook',
  '/research',
  '/recommendations',
  '/ad-library',
]

/** Apple and Material both put the floor here. */
const TOUCH_FLOOR = 44

/**
 * The media features Playwright does NOT emulate.
 *
 * `isMobile` and `hasTouch` do not set `hover` or `pointer`, so every
 * `(hover: none) and (pointer: coarse)` rule in the stylesheet — which is
 * where the whole touch-target floor lives — is inert unless these are forced
 * through CDP. An earlier version of this audit reported the design as
 * failing for that reason alone.
 */
const TOUCH_FEATURES = [
  { name: 'hover', value: 'none' },
  { name: 'pointer', value: 'coarse' },
  { name: 'any-hover', value: 'none' },
  { name: 'any-pointer', value: 'coarse' },
]

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed += 1
    console.log(`  ${green('PASS')}  ${name}`)
  } else {
    failed += 1
    console.log(`  ${red('FAIL')}  ${name}${detail ? `\n        ${dim(detail)}` : ''}`)
  }
}

async function main() {
  // A variable specifier, so the compiler leaves the resolution alone — the
  // whole point is that this module may legitimately not be installed.
  const PLAYWRIGHT = 'playwright'
  let chromium: ChromiumLauncher
  try {
    ;({ chromium } = (await import(PLAYWRIGHT)) as { chromium: ChromiumLauncher })
  } catch {
    console.log(red('\nPlaywright is not installed.'))
    console.log(dim('  npm i -D playwright && npx playwright install chromium\n'))
    process.exit(1)
  }

  /* `executablePath` unset means Playwright uses the Chromium it installed,
     which is the normal case. The override is for environments that ship a
     browser at a fixed path rather than letting Playwright download one. */
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  })

  for (const viewport of VIEWPORTS) {
    console.log(bold(`\n${viewport.label} — ${viewport.width}×${viewport.height}\n`))

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    })
    // Past Mike's first meeting, so the audit measures the platform rather
    // than the transmission in front of it. The welcome has its own checks.
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem(
          'reactor.operator.v1',
          JSON.stringify({
            schemaVersion: 1,
            decisions: [],
            weights: {},
            paused: false,
            mikesNotes: '',
            recentOpenings: [],
            lastSeenAt: null,
            seen: {},
            states: {},
            askLog: [],
            suppressions: {},
            startedAt: new Date().toISOString(),
            welcomedAt: new Date().toISOString(),
          }),
        )
        window.localStorage.removeItem('reactor.operator.brand-onboarding.v1')
      } catch {
        /* a private window with storage denied is not this test's business */
      }
    })

    /* Sign in once; the session cookie belongs to the context, so every page
       opened below arrives already through the gate. */
    const gate = await context.newPage()
    await gate.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await gate.locator('input[type="text"], input[name="name"]').first().fill(NAME)
    await gate.locator('input[type="password"]').first().fill(PASSWORD)
    await gate.locator('button[type="submit"]').first().click()
    await gate.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
    await gate.close()

    for (const route of ROUTES) {
      /* A FRESH page per route. Playwright re-applies its own emulated media
         on navigation, so media forced before a goto does not survive it —
         each route gets a page whose media is set before its one navigation. */
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', {
        media: 'screen',
        features: TOUCH_FEATURES,
      })
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(2500)

      const report = await page.evaluate(
        ({ floor }) => {
          const de = document.documentElement
          const visual = Math.round(window.visualViewport?.width ?? window.innerWidth)

          const small: { tag: string; text: string; w: number; h: number }[] = []
          const selector = 'button, a, input, select, textarea, [role="button"], [role="tab"]'
          document.querySelectorAll(selector).forEach((node) => {
            const el = node as HTMLElement
            const box = el.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) return
            if (box.height >= floor) return

            // A link inside a sentence is not a control with a hit box, it is
            // a word. Giving one a 44px line box tears the paragraph it sits
            // in apart, so the floor deliberately does not apply to it — and
            // `display: inline` is precisely what separates the prose links
            // from the anchors that are dressed as buttons.
            if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return

            // The definition trigger keeps a 16px inline footprint on purpose
            // and carries its target as an invisible ::after, so measure the
            // TARGET rather than the glyph.
            //
            // Two measurements, because neither is sufficient alone. The
            // ::after's own geometry says the box is big enough and works at
            // any scroll position — most of these sit below the fold, where
            // `elementFromPoint` has nothing to return. Hit-testing says
            // nothing is painted OVER that box, which the geometry cannot
            // know, and is only meaningful for a trigger currently on screen.
            if (el.classList.contains('infotip-trigger')) {
              const after = getComputedStyle(el, '::after')
              const grow = Math.abs(parseFloat(after.top) || 0)
              const reach = box.height + grow * 2
              const onScreen =
                box.top >= 0 && box.bottom <= window.innerHeight && box.top - grow >= 0
              const clear = onScreen
                ? document.elementFromPoint(
                    box.left + box.width / 2,
                    box.top + box.height / 2 - Math.min(20, grow + box.height / 2 - 1),
                  ) === el
                : true
              if (after.content !== 'none' && reach >= floor && clear) return
            }

            small.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent ?? '').trim().slice(0, 40),
              w: Math.round(box.width),
              h: Math.round(box.height),
            })
          })

          return {
            layoutWidth: window.innerWidth,
            visualWidth: visual,
            scrollWidth: de.scrollWidth,
            clientWidth: de.clientWidth,
            small,
          }
        },
        { floor: TOUCH_FLOOR },
      )

      check(
        `${route} · layout viewport is the device width`,
        report.layoutWidth === report.visualWidth,
        `window.innerWidth ${report.layoutWidth} vs visual ${report.visualWidth} — something is overflowing the document`,
      )
      check(
        `${route} · no horizontal overflow`,
        report.scrollWidth <= report.clientWidth,
        `scrollWidth ${report.scrollWidth} > clientWidth ${report.clientWidth}`,
      )
      check(
        `${route} · every control clears ${TOUCH_FLOOR}px`,
        report.small.length === 0,
        report.small.map((s) => `${s.tag} "${s.text}" ${s.w}×${s.h}`).join('\n        '),
      )

      /* Definitions have to be reachable by tapping, and land on screen. This
         is the half a CSS-only hover tooltip could not do at all. */
      const trigger = page.locator('.infotip-trigger').first()
      if (await trigger.count()) {
        await trigger.scrollIntoViewIfNeeded()
        await trigger.tap()
        await page.waitForTimeout(250)
        const panel = await page.evaluate(() => {
          const el = document.querySelector('.infotip-panel')
          if (!el) return null
          const b = el.getBoundingClientRect()
          return {
            left: Math.round(b.left),
            right: Math.round(b.right),
            top: Math.round(b.top),
            bottom: Math.round(b.bottom),
            vw: window.innerWidth,
            vh: window.innerHeight,
          }
        })
        check(`${route} · a tap opens the definition`, panel !== null)
        if (panel) {
          check(
            `${route} · the definition lands on screen`,
            panel.left >= 0 && panel.right <= panel.vw && panel.top >= 0 && panel.bottom <= panel.vh,
            JSON.stringify(panel),
          )
        }
      }

      await page.close()
    }

    await context.close()
  }

  await browser.close()

  console.log('\n----------------------------------------------------')
  console.log(green(`PASS: ${passed}`))
  console.log(failed > 0 ? red(`FAIL: ${failed}`) : green(`FAIL: ${failed}`))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(red(`\nMobile self-test could not run: ${String(error)}`))
  console.error(dim(`Is the app running at ${BASE}?`))
  process.exit(1)
})

export {}
