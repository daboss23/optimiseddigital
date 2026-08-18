/**
 * Shared shape for the brief's strategic menus (angles + offers).
 *
 * Lives outside the route because a Next.js route module may only export its
 * handlers and config — and because both the server route and the Workbench
 * client need these types.
 */

import type { DirectiveOption } from '@/lib/reactor-inputs'
import type { DerivedOption } from '@/lib/strategy-derive'

export interface StrategyMenuOption extends DirectiveOption {
  /** Absent on seed options. Present on anything ATLAS added from the site read. */
  derived?: { evidence: string; basis: 'site' | 'category' }
}

export interface StrategyMenu {
  angles: StrategyMenuOption[]
  offers: StrategyMenuOption[]
  /** ATLAS's read of the business type, e.g. "B2B marketing agency". */
  businessCategory: string
  /** True when at least one option was derived rather than seeded. */
  hasDerived: boolean
}

export function toMenuOption(d: DerivedOption): StrategyMenuOption {
  return {
    label: d.label,
    directive: d.directive,
    derived: { evidence: d.evidence, basis: d.basis },
  }
}
