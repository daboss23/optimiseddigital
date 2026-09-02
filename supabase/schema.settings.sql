-- Per-account settings — an uploaded logo, curated research sources, the Meta
-- connection.
--
-- Deliberately a key/value table rather than a column per setting: these are
-- a handful of unrelated blobs that would otherwise each need a migration.
--
-- Keyed by (account_id, key). It was keyed by `key` alone, which on a
-- multi-tenant deployment made these ONE SHARED SET: the second customer to
-- upload a logo replaced the first customer's, and `meta.connection` holds a
-- System User access token with write access to an ad account — so whichever
-- customer connected last owned the credential every other customer's ads
-- published through.
--
-- Requires accounts (supabase/schema.tenancy.sql). Run after it.

create table if not exists platform_settings (
  account_id uuid not null references accounts(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, key)
);

create index if not exists platform_settings_account_idx on platform_settings (account_id);

alter table platform_settings enable row level security;
