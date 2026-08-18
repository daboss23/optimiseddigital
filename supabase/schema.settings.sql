-- Platform settings — small, single-instance configuration that belongs to the
-- deployment rather than to the knowledge layer.
--
-- Deliberately a key/value table rather than a column per setting: these are
-- a handful of unrelated blobs (an uploaded logo, the research sources the
-- user curated) that would otherwise each need a migration to add.
--
-- Run in the Supabase SQL editor alongside the other schema files.

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
