/**
 * The brief's strategic menus — seed options plus whatever ATLAS derived from
 * the connected website.
 *
 * The seeds are the floor and never move: everything the builder already knows
 * stays exactly where it was in the list. Derived entries are appended after
 * them, deduped upstream, and tagged so the UI can show WHY each one appeared
 * (read off the site, or typical for this category of business).
 *
 * Never throws — on any failure the seed menus are returned unchanged, which is
 * the behaviour that existed before derivation.
 */

import { NextResponse } from 'next/server'
import { offerOptions } from '@/lib/reactor-inputs'
import { winningAngles } from '@/lib/reactor-data'
import { getConnectedWebsite } from '@/lib/website-intelligence'
import { toMenuOption, type StrategyMenu, type StrategyMenuOption } from '@/lib/strategy-menu'
import { currentAccount } from '@/lib/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Seed angles carry no directive of their own — the angle name IS the input. */
const seedAngles: StrategyMenuOption[] = winningAngles.map((a) => ({
  label: a.name,
  directive: '',
}))

export async function GET() {
  const menu: StrategyMenu = {
    angles: seedAngles,
    offers: offerOptions,
    businessCategory: '',
    hasDerived: false,
  }

  try {
    const site = await getConnectedWebsite(await currentAccount())
    const derived = site?.strategyOptions
    if (derived) {
      if (derived.angles.length) {
        menu.angles = [...seedAngles, ...derived.angles.map(toMenuOption)]
      }
      if (derived.offers.length) {
        menu.offers = [...offerOptions, ...derived.offers.map(toMenuOption)]
      }
      menu.businessCategory = derived.businessCategory
      menu.hasDerived = derived.angles.length > 0 || derived.offers.length > 0
    }
  } catch (error) {
    console.error('Strategy menu load failed, serving seed options:', error)
  }

  return NextResponse.json({ success: true, data: menu })
}
