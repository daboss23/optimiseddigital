-- Summit Build Co — AI Creative System
-- Run this in the Supabase SQL editor before using the app.

create table if not exists creative_outputs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  campaign_angle text not null,
  campaign_goal text not null,
  hooks jsonb not null,
  body_copy jsonb not null,
  ctas jsonb not null,
  final_hook text,
  final_body text,
  final_cta text,
  image_prompt text,
  image_url_higgsfield text,
  image_url_openai text,
  copy_model text default 'claude',
  status text default 'draft',
  approved boolean default false
);

create index if not exists creative_outputs_created_at_idx
  on creative_outputs (created_at desc);

-- Row Level Security.
--
-- This table holds generated ads, which on a multi-tenant deployment belong to
-- individual customers. It previously shipped with:
--
--     create policy "Allow anon read access"
--       on creative_outputs for select using (true);
--
-- — a blanket grant to the anon role, which is the key that ships to the
-- browser. Anyone holding it could read every customer's creative. RLS is
-- enabled with NO anon policy instead: the app reads and writes with the
-- service-role key server-side, so it is unaffected, and the public key reads
-- nothing.
--
-- See supabase/schema.tenancy.sql for the tenancy model this sits inside, and
-- for why RLS is the backstop here rather than the mechanism.
alter table creative_outputs enable row level security;
