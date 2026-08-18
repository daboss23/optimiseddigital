/**
 * The live Meta adapter — not implemented.
 *
 * It is a stub deliberately, and it throws rather than degrading, because a
 * data source that silently returns partial figures is how an operator ends up
 * making a four-hundred-thousand-dollar decision on half an account.
 *
 * Everything above `adapters/` is agnostic to where the data came from, so
 * finishing this is a self-contained job with a hard edge: implement the three
 * methods, change the one import in `adapters/index.ts`, and nothing else in
 * the pipeline moves. The suite asserts that property.
 *
 * What the Graph API has to be asked for, and why each one is not optional:
 *
 * **getCreatives()** — `/act_<id>/insights` at `level=ad` with
 * `time_increment=1` for the daily rows, requesting `spend`, `impressions`,
 * `reach`, `clicks` (outbound), `actions` and `action_values`. Results must be
 * read from the action type the campaign actually optimises for and mapped onto
 * a single `PrimaryResultType` per creative — NOT summed across action types.
 * A blended "conversions" total is the exact ambiguity this pipeline exists to
 * remove, and it cannot be un-blended downstream.
 *
 * **The ranges.** A second insights call per creative WITHOUT `time_increment`,
 * once per evaluation window (`time_range` = the 7 days to `completeThrough`,
 * and the 7 before that), reading `impressions`, `reach` and `frequency`.
 * This call is the reason the adapter is not a one-liner over the existing
 * `lib/meta-graph.ts`: that module returns range-aggregated ads without daily
 * rows, and frequency cannot be reconstructed from daily reach at any level of
 * effort, because reach deduplicates people across days.
 *
 * **getBaselines()** — cohort medians computed from the same ad-level insights,
 * grouped by result type, then offer, then audience temperature, with
 * `creativeCount` and `resultCount` recorded per cohort so the resolver can
 * reject one that is too thin. Cohort attributes come from the ad set targeting
 * and the campaign objective, not from the creative's name.
 *
 * **getMetadata()** — `accountTimezone` from `/act_<id>?fields=timezone_name`,
 * `attributionWindow` from the ad set's `attribution_spec`, `completeThrough`
 * as yesterday in the ACCOUNT's timezone, and `maturityDelayHours` from the
 * longest click window in that spec.
 */

import type { DataSource } from '@/lib/operator/types'

export class MetaAdapterNotImplemented extends Error {
  constructor() {
    super(
      'The live Meta data source is not implemented. It needs ad-level insights at time_increment=1 for daily rows, plus a separate range-level call per evaluation window for deduplicated reach and frequency — see the notes in lib/operator/adapters/meta.ts. The operator runs on the seeded source until then.',
    )
    this.name = 'MetaAdapterNotImplemented'
  }
}

export function createMetaSource(): DataSource {
  return {
    getCreatives: async () => {
      throw new MetaAdapterNotImplemented()
    },
    getBaselines: async () => {
      throw new MetaAdapterNotImplemented()
    },
    getMetadata: async () => {
      throw new MetaAdapterNotImplemented()
    },
  }
}
