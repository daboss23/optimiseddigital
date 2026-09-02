-- Multi-tenancy — the schema that lets one deployment serve many customers.
--
-- The data model already had a tenant column (`builder_id`, indexed across
-- eight tables). What it did not have was an identity to check a tenant claim
-- against, a way to tell a deliberate platform-wide row from a write that
-- forgot its tenant, or per-account settings. Without those three, the column
-- is decoration: the tenant arrived in the request body and every scoped query
-- was scoped to whatever the caller typed.
--
-- Safe to run on a fresh project and on an existing single-tenant one. Every
-- statement is idempotent and NOTHING HERE DELETES A ROW.
--
-- Supabase will still warn that the query contains destructive operations, and
-- it is right to: the migration renames a table, drops and recreates a primary
-- key constraint, drops one policy, replaces one function, and enables RLS.
-- Those are schema changes, not data loss. Specifically:
--
--   · `builders` is RENAMED to `accounts` — rows, indexes and every foreign key
--     survive a rename; nothing is copied and nothing is dropped.
--   · platform_settings' primary key changes from (key) to (account_id, key).
--     The constraint is replaced; the rows are assigned, not deleted.
--   · The `Allow anon read access` policy on creative_outputs is dropped. It
--     granted the public browser key a read over every generated ad.
--   · RLS is enabled on the tenant tables. The application reads and writes
--     exclusively with the SERVICE ROLE key, which bypasses RLS by design — the
--     anon client is constructed in lib/supabase.ts and never used for a single
--     query — so this closes the public key without touching the app.
--
-- Take a snapshot first regardless. A rename is easy to reverse by hand; being
-- able to restore is easier still.
--
-- Run AFTER schema.sql / schema.platform.sql / schema.reactor.sql /
-- schema.settings.sql, in the Supabase SQL editor.

/* ---------------------------------------------------------------------------
   1. Accounts — the tenant.

   `builders` was the tenant table under an industry-specific name, inherited
   from the deployment this platform was forked from. Renamed rather than
   recreated so existing rows, indexes and every `builder_id` foreign key
   survive the migration intact.
--------------------------------------------------------------------------- */

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'builders')
     and not exists (select 1 from information_schema.tables
                     where table_schema = 'public' and table_name = 'accounts')
  then
    alter table builders rename to accounts;
  end if;
end $$;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  name text not null,
  website text,
  region text,
  brand_voice text,
  serves text,
  offer text,
  proof_points jsonb,
  visual_style text,
  status text default 'active'
);

-- The customer's own slug, used for support and for addressing an account
-- without exposing its uuid.
alter table accounts add column if not exists slug text;
create unique index if not exists accounts_slug_idx on accounts (slug) where slug is not null;

/* ---------------------------------------------------------------------------
   2. Users — who signs in, and which account they belong to.

   This is the piece whose absence made everything else unenforceable. A
   session that carries only a name cannot establish a tenant, so the tenant
   had to be taken on trust from the request body.

   Passwords are stored as PBKDF2-SHA256 (salt + iterations + hash, encoded in
   one string by lib/auth.ts). No bcrypt dependency: Web Crypto is available in
   the edge middleware, the route handlers and the runtime alike, and adding a
   native module for this would break the middleware build.
--------------------------------------------------------------------------- */

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  account_id uuid not null references accounts(id) on delete cascade,
  email text not null,
  name text,
  password_hash text not null,
  role text not null default 'member',   -- 'owner' | 'member'
  last_seen_at timestamptz
);

create unique index if not exists users_email_idx on users (lower(email));
create index if not exists users_account_idx on users (account_id);

/* ---------------------------------------------------------------------------
   3. Knowledge — tell a platform row from an unscoped one.

   `match_knowledge` matched `or kc.builder_id is null`, so ANY row written
   without a tenant was returned to every tenant. That is fine for knowledge the
   platform genuinely owns and catastrophic for a customer write that forgot its
   id — and nothing in a null could tell the two apart. Intent is now explicit.
--------------------------------------------------------------------------- */

alter table knowledge_chunks add column if not exists is_global boolean not null default false;
create index if not exists knowledge_chunks_builder_idx on knowledge_chunks (builder_id);
create index if not exists knowledge_chunks_global_idx on knowledge_chunks (is_global) where is_global;

comment on column knowledge_chunks.builder_id is
  'The account this chunk belongs to. NEVER null for customer content — an unscoped write is a leak, not a global row. Platform-owned rows set is_global instead.';

-- Retrieval, re-cut so a null tenant can never widen the result set.
--
--   · filter_builder set  → that account's rows, plus explicitly global ones.
--   · filter_builder null → global rows ONLY.
--
-- The second case is the important change. It used to return EVERY row in the
-- table: an unscoped call was not a narrow query, it was the widest possible
-- one, and three of the seven call sites made it.
create or replace function match_knowledge (
  query_embedding vector(1024),
  match_count int default 8,
  filter_system text default null,
  filter_builder uuid default null
)
returns table (
  id uuid,
  system text,
  category text,
  title text,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    kc.id,
    kc.system,
    kc.category,
    kc.title,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  where (filter_system is null or kc.system = filter_system)
    and (
      kc.is_global
      or (filter_builder is not null and kc.builder_id = filter_builder)
    )
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

/* ---------------------------------------------------------------------------
   4. Settings — per account, not per deployment.

   `platform_settings` was keyed by `key` alone, so the uploaded logo, the Meta
   connection token and the curated research sources were ONE shared set: the
   second customer to upload a logo replaced the first customer's, and the Meta
   token that published their ads belonged to whoever connected last.
--------------------------------------------------------------------------- */

alter table platform_settings add column if not exists account_id uuid references accounts(id) on delete cascade;

-- Existing rows predate tenancy and belong to whoever has been using this
-- deployment. They are ASSIGNED, never dropped.
--
-- An earlier draft deleted the rows that could not be assigned — the case where
-- no account exists yet — which on a working single-tenant install would have
-- thrown away the uploaded logo, the curated research sources and the stored
-- Meta connection. That is a token with write access to an ad account, and
-- re-connecting it is not a two-minute job. So the operator account is created
-- FIRST when none exists, and every orphan row is assigned to it. Nothing in
-- this migration deletes a row.
insert into accounts (name, slug)
select 'My brand', 'operator'
where not exists (select 1 from accounts)
  and exists (select 1 from platform_settings where account_id is null);

update platform_settings
   set account_id = coalesce(
         (select id from accounts where slug = 'operator' limit 1),
         (select id from accounts order by created_at limit 1)
       )
 where account_id is null;

alter table platform_settings alter column account_id set not null;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'platform_settings'
      and constraint_type = 'PRIMARY KEY' and constraint_name = 'platform_settings_pkey'
  ) then
    alter table platform_settings drop constraint platform_settings_pkey;
  end if;
end $$;

alter table platform_settings add primary key (account_id, key);

/* ---------------------------------------------------------------------------
   5. Row-level security.

   Honest about what this does and does not buy. The application connects with
   the SERVICE ROLE key, which bypasses RLS by design, so RLS is not the
   mechanism that separates customers — the account resolved from the session
   is, and `npm run selftest:tenant` is what holds that in place.

   What RLS is for here is the anon key, which ships to the browser. The only
   policy in the schema was `Allow anon read access` on creative_outputs: a
   blanket grant that let anyone holding the public key read every customer's
   generated ads. It is dropped, and every tenant table gets RLS enabled with
   no anon policy, so the public key reads nothing.

   To make RLS a true second line of defence, the app would move to Supabase
   Auth and policies would compare `auth.jwt() ->> 'account_id'` to the row's
   account. That is a larger change than this migration and is noted rather
   than half-done: a policy that cannot be enforced is theatre.
--------------------------------------------------------------------------- */

drop policy if exists "Allow anon read access" on creative_outputs;

do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'users', 'knowledge_chunks', 'platform_settings',
    'creative_outputs', 'campaign_outcomes', 'media_generations', 'faces',
    'frameworks', 'insights', 'results', 'learnings'
  ]
  loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('alter table %I enable row level security', t);
    end if;
  end loop;
end $$;
