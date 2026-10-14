-- Creative Reactor — retrieval upgrade: HNSW + hybrid (semantic + keyword) search
--
-- Run AFTER schema.reactor.sql and schema.tenancy.sql, in the Supabase SQL
-- editor. Safe to re-run. Nothing here changes what an account can see: the
-- tenant filter below is the one in match_knowledge, character for character.
--
-- Three changes, each fixing a measured weakness of pure vector search:
--
--   1. HNSW replaces IVFFlat. IVFFlat with lists = 100 searches ONE list by
--      default (ivfflat.probes = 1) — about 1% of the table — and the tenant
--      filter is applied AFTER that list is read, so a scoped query could come
--      back short or empty while matching rows sat in the other 99 lists. HNSW
--      needs no training, no re-tuning as the Vault grows, and holds recall
--      under a filter far better.
--
--   2. A full-text column. Ad craft lives in exact phrases — "free audit", a
--      dollar figure, an offer name — and an embedding blurs a phrase into its
--      neighbourhood. Keyword search finds the literal string.
--
--   3. match_knowledge_hybrid fuses the two rankings with Reciprocal Rank
--      Fusion (RRF): each row scores 1 / (rrf_k + rank) in every list it
--      appears in. RRF needs no score calibration between a cosine distance and
--      a ts_rank, which are not on the same scale and must never be added
--      directly. The application then hands the fused pool to Voyage's
--      reranker (lib/rerank.ts) and keeps the top k.
--
-- `similarity` is still the cosine similarity, on every row — including rows
-- that only the keyword list found — so anything that reads it means exactly
-- what it meant before.

-- 1. HNSW --------------------------------------------------------------------

drop index if exists knowledge_chunks_embedding_idx;

create index if not exists knowledge_chunks_embedding_hnsw_idx
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- 2. Full text -----------------------------------------------------------------

-- Title weighted above body: a chunk TITLED "Free Audit Offer" is a stronger
-- match for "free audit" than one that mentions it in passing.
alter table knowledge_chunks
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index if not exists knowledge_chunks_search_idx
  on knowledge_chunks using gin (search_tsv);

-- 3. Hybrid retrieval ------------------------------------------------------------

-- The scope predicate is repeated in each branch rather than factored into a
-- shared CTE on purpose: a CTE referenced twice is materialised, and a
-- materialised CTE cannot use the HNSW index — the "optimisation" would turn
-- every search into a full scan computing a distance for every row.
--
-- hnsw.ef_search is raised from 40 so a tenant filter applied after the index
-- scan still leaves a full candidate pool.
create or replace function match_knowledge_hybrid (
  query_embedding vector(1024),
  query_text text,
  match_count int default 24,
  filter_system text default null,
  filter_builder uuid default null,
  rrf_k int default 60
)
returns table (
  id uuid,
  system text,
  category text,
  title text,
  content text,
  metadata jsonb,
  similarity float,
  fused_score float
)
language sql stable
set hnsw.ef_search = 100
as $$
  with semantic as (
    select
      kc.id,
      row_number() over (order by kc.embedding <=> query_embedding) as rank
    from knowledge_chunks kc
    where (filter_system is null or kc.system = filter_system)
      -- Identical to match_knowledge: a null tenant returns GLOBAL rows only.
      and (
        kc.is_global
        or (filter_builder is not null and kc.builder_id = filter_builder)
      )
    order by kc.embedding <=> query_embedding
    limit match_count
  ),
  keyword as (
    select
      kc.id,
      row_number() over (order by ts_rank_cd(kc.search_tsv, q.query) desc) as rank
    from knowledge_chunks kc,
         websearch_to_tsquery('english', coalesce(query_text, '')) as q(query)
    where kc.search_tsv @@ q.query
      and (filter_system is null or kc.system = filter_system)
      and (
        kc.is_global
        or (filter_builder is not null and kc.builder_id = filter_builder)
      )
    order by ts_rank_cd(kc.search_tsv, q.query) desc
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
    kc.id,
    kc.system,
    kc.category,
    kc.title,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) as similarity,
    f.score as fused_score
  from fused f
  join knowledge_chunks kc on kc.id = f.id
  order by f.score desc
  limit match_count;
$$;
