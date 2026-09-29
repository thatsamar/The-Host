-- Phase 3: memory proposals, decisions and products.

-- Where a memory or decision came from, and the words that justify it.
alter table public.memories add column source text not null default 'manual'
  check (source in ('extracted', 'manual', 'import'));
alter table public.memories add column evidence text;
alter table public.decisions add column source text not null default 'manual'
  check (source in ('extracted', 'manual', 'import'));
alter table public.decisions add column evidence text;

-- Proposals are listed per chat message in the right panel.
create index memories_source_message_idx on public.memories (source_message_id);
create index decisions_source_message_idx on public.decisions (source_message_id);
create index products_source_message_idx on public.products (source_message_id);

-- ---------------------------------------------------------------------------
-- Memory retrieval: approved memories for a project plus household-wide ones,
-- nearest first. SECURITY INVOKER, so RLS applies.
-- ---------------------------------------------------------------------------

create or replace function public.match_memories(
  query_embedding extensions.vector(1024),
  project_id uuid,
  match_count int default 30
)
returns table (id uuid, similarity float)
language sql
stable
set search_path = ''
as $$
  select m.id, 1 - (m.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.memories m
  where m.review_state = 'approved'
    and m.embedding is not null
    and (m.project_id = match_memories.project_id or m.project_id is null)
  order by m.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$$;

grant execute on function public.match_memories(extensions.vector, uuid, int) to authenticated;
