-- Phase 4: settings, import/export and the ChatGPT importer.

-- ---------------------------------------------------------------------------
-- System prompt history. `settings.system_prompt` stays the live copy; every
-- save and restore also records a version here.
-- ---------------------------------------------------------------------------

create table public.system_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  content text not null,
  -- 'original' | 'edited' | 'restored' | 'reset' | 'imported'
  label text not null default 'edited',
  note text,
  created_at timestamptz not null default now()
);
create index system_prompt_versions_user_idx on public.system_prompt_versions (user_id, created_at desc);

alter table public.system_prompt_versions enable row level security;
create policy "owner access" on public.system_prompt_versions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Imported conversations: where they came from, and memory extraction progress.
-- ---------------------------------------------------------------------------

-- ChatGPT's conversation id, so importing the same export twice is harmless.
alter table public.chats add column external_id text;
create unique index chats_external_id_unique on public.chats (user_id, external_id) where external_id is not null;

-- Memory extraction over imported chats runs in resumable steps.
alter table public.chats add column extraction_status text
  check (extraction_status in ('pending', 'running', 'done', 'failed'));
alter table public.chats add column extraction_next int not null default 0;
alter table public.chats add column extraction_error text;
alter table public.chats add column extraction_lease_until timestamptz;
create index chats_extraction_idx on public.chats (extraction_status) where extraction_status in ('pending', 'running');
