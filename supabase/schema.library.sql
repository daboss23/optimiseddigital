-- Creative Reactor — the Platform Library
--
-- Run AFTER schema.reactor.sql (it needs the `vector` extension). Safe to re-run.
--
-- The owner's own method — SOPs, frameworks, playbooks — uploaded once and used
-- by the agents for every brand in the matching niche. Brands never see it.
--
-- It lives in its OWN tables, deliberately not in knowledge_chunks:
--
--   · knowledge_chunks is what a brand's Vault lists, counts and edits, and
--     what match_knowledge returns to a brand. A library row there would be
--     one predicate away from a brand's screen. Here no brand-facing query can
--     reach it, because none names these tables (npm run selftest:tenant
--     fails the build if one does).
--   · Its scope is a NICHE, not an account. A library section is shared craft
--     for every brand in a niche — a different shape of question from "which
--     account owns this row", answered by a different predicate.
--
-- Retrieval mirrors match_knowledge_hybrid: semantic + keyword, fused with
-- Reciprocal Rank Fusion, HNSW for the vector half. `similarity` is cosine.

create extension if not exists vector;

create table if not exists library_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Where it came from: the file name, or its path inside an uploaded zip.
  source_name text,
  -- sop | framework | playbook | swipe | other
  kind text not null default 'sop',
  -- Niche keys (lib/library/niches.ts): 'all', 'ecommerce', 'ecom:<id>', …
  niches text[] not null default '{all}',
  chunk_count int not null default 0,
  char_count int not null default 0,
  -- sha-256 of the normalised text: the same SOP uploaded twice is stored once.
  content_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists library_documents_hash_idx on library_documents (content_hash);

create table if not exists library_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references library_documents (id) on delete cascade,
  ord int not null,
  -- The heading path the section sits under ("Testing › Budget split") — a
  -- rule read without its heading loses what it is a rule about.
  heading text,
  content text not null,
  -- Copied from the document so the niche filter runs on the indexed table.
  niches text[] not null,
  embedding vector(1024) not null,
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A')
    || setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored,
  created_at timestamptz not null default now()
);

create index if not exists library_chunks_document_idx on library_chunks (document_id);
create index if not exists library_chunks_niches_idx on library_chunks using gin (niches);
create index if not exists library_chunks_search_idx on library_chunks using gin (search_tsv);
create index if not exists library_chunks_embedding_hnsw_idx
  on library_chunks using hnsw (embedding vector_cosine_ops);

-- Only the service role reads or writes the library. RLS on with no policies
-- means the anon key — which ships to every browser — reads nothing, and the
-- grants are revoked on top so the intent survives a policy added later.
alter table library_documents enable row level security;
alter table library_chunks enable row level security;
revoke all on library_documents from anon, authenticated;
revoke all on library_chunks from anon, authenticated;

-- Retrieval for one brand's niches.
--
--   filter_niches — the brand's keys, always including 'all'. A section
--   matches when its niches overlap them at all (`&&`). An empty array
--   matches nothing.
--
-- The niche predicate is repeated in each branch for the same reason
-- match_knowledge_hybrid repeats its tenant predicate: a CTE referenced twice
-- is materialised and cannot use the HNSW index.
create or replace function match_library (
  query_embedding vector(1024),
  query_text text,
  match_count int default 12,
  filter_niches text[] default '{}',
  rrf_k int default 60
)
returns table (
  id uuid,
  document_id uuid,
  heading text,
  content text,
  niches text[],
  similarity float,
  fused_score float
)
language sql stable
set hnsw.ef_search = 100
as $$
  with semantic as (
    select
      lc.id,
      row_number() over (order by lc.embedding <=> query_embedding) as rank
    from library_chunks lc
    where lc.niches && coalesce(filter_niches, '{}')
    order by lc.embedding <=> query_embedding
    limit match_count
  ),
  keyword as (
    select
      lc.id,
      row_number() over (order by ts_rank_cd(lc.search_tsv, q.query) desc) as rank
    from library_chunks lc,
         websearch_to_tsquery('english', coalesce(query_text, '')) as q(query)
    where lc.search_tsv @@ q.query
      and lc.niches && coalesce(filter_niches, '{}')
    order by ts_rank_cd(lc.search_tsv, q.query) desc
    limit match_count
  ),
  fused as (
    select
      coalesce(s.id, k.id) as id,
      coalesce(1.0 / (rrf_k + s.rank), 0) + coalesce(1.0 / (rrf_k + k.rank), 0) as score
    from semantic s
    full outer join keyword k on k.id = s.id
  )
  select
    lc.id,
    lc.document_id,
    lc.heading,
    lc.content,
    lc.niches,
    1 - (lc.embedding <=> query_embedding) as similarity,
    f.score as fused_score
  from fused f
  join library_chunks lc on lc.id = f.id
  order by f.score desc
  limit match_count;
$$;

-- Postgres grants EXECUTE on every new function to PUBLIC, so revoking from
-- the named roles alone would leave it callable. Only the service role keeps it.
revoke execute on function match_library(vector, text, int, text[], int) from public, anon, authenticated;
grant execute on function match_library(vector, text, int, text[], int) to service_role;
