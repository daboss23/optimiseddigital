-- Creative Reactor — Clone & Iterate taxonomy analytics (OPTIONAL)
--
-- The app already reads and writes the fixed creative taxonomy and test IDs
-- INSIDE the existing `campaign_outcomes.concept` jsonb (under
-- concept.attributes.taxonomy / .testId), following this codebase's convention of
-- folding structured attributes into jsonb so no migration is required. Demo mode
-- and every runtime path work WITHOUT running this file.
--
-- This migration is purely for humans/BI who want to GROUP BY taxonomy in raw
-- SQL. The columns are GENERATED (always in sync with the jsonb the app writes),
-- so there is nothing extra for the application to populate. Idempotent — safe to
-- run more than once. Run in the Supabase SQL editor.

-- One value per axis, extracted from the concept jsonb the Reactor already writes.
alter table campaign_outcomes
  add column if not exists taxonomy jsonb
  generated always as (concept -> 'attributes' -> 'taxonomy') stored;

-- The isolation test a concept ran under (e.g. "RXN-42") and the variant within
-- it (e.g. "RXN-42-B"), so results attribute back to the hypothesis being tested.
alter table campaign_outcomes
  add column if not exists test_id text
  generated always as (concept -> 'attributes' ->> 'testId') stored;

alter table campaign_outcomes
  add column if not exists variant_id text
  generated always as (concept -> 'attributes' ->> 'variantId') stored;

-- Which single axis a test isolated — the "we changed only this" dimension.
alter table campaign_outcomes
  add column if not exists isolated_axis text
  generated always as (concept -> 'attributes' ->> 'isolatedAxis') stored;

create index if not exists campaign_outcomes_taxonomy_idx
  on campaign_outcomes using gin (taxonomy);

create index if not exists campaign_outcomes_test_id_idx
  on campaign_outcomes (test_id);

-- Example: which hook style wins, by verdict, within tests that isolated the hook.
--   select taxonomy ->> 'hookStyle' as hook_style,
--          count(*) filter (where verdict in ('winner','high_performer')) as wins,
--          count(*) as total
--   from campaign_outcomes
--   where isolated_axis = 'hook'
--   group by 1 order by wins desc;
