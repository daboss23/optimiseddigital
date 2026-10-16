-- Creative Reactor — multi-tenant lock-down
--
-- Run AFTER schema.reactor.sql and schema.tenancy.sql, in the Supabase SQL
-- editor. Safe to re-run.
--
-- `knowledge_stats()` (schema.reactor.sql) groups EVERY row in the table, so a
-- brand's Vault badge and Agent Network read the size and shape of every other
-- brand's library. The application no longer calls it. This is its scoped
-- replacement: one account's rows, grouped by system and category.
--
-- Until this runs, the application falls back to one head-count per system for
-- the account (lib/knowledge.ts → scopedGroups), which loses only the category
-- breakdown — never the scope.

create or replace function knowledge_stats_scoped (
  filter_builder uuid
)
returns table (
  system text,
  category text,
  count bigint
)
language sql stable
as $$
  select kc.system, kc.category, count(*)::bigint as count
  from knowledge_chunks kc
  -- A null account counts nothing: there is no "everyone" to report on.
  where filter_builder is not null
    and kc.builder_id = filter_builder
  group by kc.system, kc.category
  order by count(*) desc;
$$;

-- The unscoped aggregate stays defined for deployments that still reference
-- it, but neither browser-facing role may call it.
-- PUBLIC holds EXECUTE on every new function by default; revoking from the
-- named roles alone would leave both callable.
revoke execute on function knowledge_stats() from public, anon, authenticated;
revoke execute on function knowledge_stats_scoped(uuid) from public, anon, authenticated;
grant execute on function knowledge_stats() to service_role;
grant execute on function knowledge_stats_scoped(uuid) to service_role;
