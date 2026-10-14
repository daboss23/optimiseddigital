-- Long documents — PDFs the agents read by STRUCTURE rather than by chunk.
--
-- A 60-page brand book or SOP manual chunked into the vector store loses the
-- one thing that makes it readable: which rule sits under which heading, and
-- which exception belongs to which rule. These documents are indexed by
-- PageIndex instead (lib/documents/), which builds a table-of-contents tree per
-- document and has an LLM reason its way down to the right section.
--
-- This table is the account's ledger of what it has sent there. It is the
-- ONLY way a provider document id is ever reached: the app looks a document up
-- by (account_id, id) and reads provider_doc_id off the row, so no request can
-- name another account's document — the provider id never leaves the server.
--
-- Requires accounts (supabase/schema.tenancy.sql). Run after it.

create table if not exists long_documents (
  id uuid default gen_random_uuid() primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  provider text not null default 'pageindex',
  provider_doc_id text not null,
  name text not null,
  -- queued | processing | completed | failed — the provider's own vocabulary.
  status text not null default 'queued',
  page_count int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_doc_id)
);

create index if not exists long_documents_account_idx on long_documents (account_id, created_at desc);

-- The app reads this table with the service-role key and scopes every query
-- to the session's account. RLS is on so the ANON key, which ships to the
-- browser, cannot read it at all.
alter table long_documents enable row level security;
