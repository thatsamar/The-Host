-- Phase 2: reference library processing and retrieval.

-- ---------------------------------------------------------------------------
-- files: upload + resumable indexing state
-- ---------------------------------------------------------------------------

alter table public.files drop constraint files_status_check;
alter table public.files add constraint files_status_check
  check (status in ('uploading', 'pending', 'processing', 'indexed', 'failed'));
alter table public.files alter column status set default 'uploading';

-- Indexing runs in bounded steps (serverless time limits). `progress` records
-- where the next step resumes: { next_unit, total_units, warnings[] }.
alter table public.files add column progress jsonb not null default '{}'::jsonb;
-- A step holds a short lease so two open tabs never index the same file.
alter table public.files add column lease_until timestamptz;
alter table public.files add column attempts int not null default 0;

create index files_status_idx on public.files (status) where status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- image_assets: where the image came from
-- ---------------------------------------------------------------------------

alter table public.image_assets add column source text not null default 'upload'
  check (source in ('upload', 'pdf_page', 'docx_image', 'chat'));
alter table public.image_assets add column metadata jsonb not null default '{}'::jsonb;
create index image_assets_message_idx on public.image_assets (message_id);

-- ---------------------------------------------------------------------------
-- Units: a file is indexed as numbered units (a PDF page, a .docx image, the
-- body text). Rows record their unit so an interrupted step can be redone
-- cleanly from the first unfinished unit.
-- ---------------------------------------------------------------------------

alter table public.chunks add column unit int not null default 0;
alter table public.image_assets add column unit int;
create index chunks_file_unit_idx on public.chunks (file_id, unit);
create index image_assets_file_unit_idx on public.image_assets (file_id, unit);

-- ---------------------------------------------------------------------------
-- Retrieval. SECURITY INVOKER (the default), so row-level security applies:
-- callers only ever match their own chunks.
-- ---------------------------------------------------------------------------

create or replace function public.match_chunks(
  query_embedding extensions.vector(1024),
  project_ids uuid[],
  match_count int default 8,
  min_similarity float default 0.0,
  prefer_room_id uuid default null
)
returns table (
  id uuid,
  file_id uuid,
  image_asset_id uuid,
  project_id uuid,
  room_id uuid,
  source_type text,
  content text,
  page int,
  metadata jsonb,
  similarity float,
  file_name text,
  project_name text,
  image_storage_path text,
  image_mime_type text
)
language sql
stable
set search_path = ''
as $$
  select
    c.id,
    c.file_id,
    c.image_asset_id,
    c.project_id,
    c.room_id,
    c.source_type,
    c.content,
    c.page,
    c.metadata,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity,
    coalesce(f.name, c.metadata->>'label', 'photo') as file_name,
    p.name as project_name,
    ia.storage_path as image_storage_path,
    ia.mime_type as image_mime_type
  from public.chunks c
  join public.projects p on p.id = c.project_id
  left join public.files f on f.id = c.file_id
  left join public.image_assets ia on ia.id = c.image_asset_id
  where c.embedding is not null
    and c.project_id = any (project_ids)
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  -- A small nudge toward the room being discussed, never enough to bury a
  -- clearly better match from elsewhere.
  order by (c.embedding operator(extensions.<=>) query_embedding)
    - case when prefer_room_id is not null and c.room_id = prefer_room_id then 0.03 else 0 end
  limit match_count;
$$;

grant execute on function public.match_chunks(extensions.vector, uuid[], int, float, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage limits. Large PDFs are fine; the processing pipeline pages through.
-- ---------------------------------------------------------------------------

update storage.buckets set file_size_limit = 52428800 where id = 'files';   -- 50 MB
update storage.buckets set file_size_limit = 10485760 where id = 'images';  -- 10 MB
