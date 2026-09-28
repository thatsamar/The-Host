-- Gio foundation schema.
--
-- Single-household app: one Supabase Auth account shared by Courtney and Amar.
-- Every row carries user_id and every table has row-level security scoped to
-- auth.uid(). Storage buckets are private; objects live under "<user_id>/...".
--
-- Embedding dimension: vector(1024) matches Voyage `voyage-4` at its default
-- output dimension. If you change EMBEDDING_DIMENSION / EMBEDDING_MODEL, write a
-- new migration that alters these columns and re-index (Settings > Files).

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users: profile row mirroring auth.users (one row for the household)
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default 'Courtney & Amar',
  last_speaker text not null default 'Both'
    check (last_speaker in ('Courtney', 'Amar', 'Both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects and rooms
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  location text,
  -- Free-form brief: architecture, place, climate, how the home is used,
  -- constraints. Shown to Gio as PROJECT CONTEXT on every turn.
  brief text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exactly one "General Design Brain" per user.
create unique index projects_one_default_per_user
  on public.projects (user_id) where is_default;
create index projects_user_idx on public.projects (user_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_project_idx on public.rooms (project_id);
-- No two rooms with the same name in one project.
create unique index rooms_unique_name on public.rooms (project_id, lower(trim(name)));

-- ---------------------------------------------------------------------------
-- chats and messages
-- ---------------------------------------------------------------------------

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  title text,
  -- 'app' for chats created here, 'chatgpt' for imported conversations.
  source text not null default 'app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chats_project_idx on public.chats (project_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  speaker text not null check (speaker in ('Courtney', 'Amar', 'Both', 'Gio')),
  -- Plain text of the message (assistant: concatenated text blocks).
  content text not null default '',
  -- Attached images / files: [{ image_asset_id, storage_path, mime_type, name }]
  attachments jsonb not null default '[]'::jsonb,
  -- Model, usage, web sources, retrieved reference ids, stop reason, etc.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint messages_speaker_matches_role check (
    (role = 'assistant' and speaker = 'Gio')
    or (role = 'user' and speaker in ('Courtney', 'Amar', 'Both'))
  )
);
create index messages_chat_idx on public.messages (chat_id, created_at);

-- ---------------------------------------------------------------------------
-- files, image assets, chunks (reference library)
-- ---------------------------------------------------------------------------

create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'indexed', 'failed')),
  error text,
  page_count int,
  chunk_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  indexed_at timestamptz
);
create index files_project_idx on public.files (project_id, created_at desc);

create table public.image_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  -- Set when the image is an uploaded file or a rendered page of one.
  file_id uuid references public.files (id) on delete cascade,
  page int,
  -- Set when the image was attached to a chat message.
  message_id uuid references public.messages (id) on delete set null,
  storage_path text not null,
  mime_type text not null,
  width int,
  height int,
  description text,
  created_at timestamptz not null default now()
);
create index image_assets_project_idx on public.image_assets (project_id);
create index image_assets_file_idx on public.image_assets (file_id);

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  file_id uuid references public.files (id) on delete cascade,
  image_asset_id uuid references public.image_assets (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  source_type text not null check (source_type in ('text', 'visual_description')),
  content text not null,
  page int,
  chunk_index int not null default 0,
  token_count int,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now()
);
create index chunks_project_idx on public.chunks (project_id);
create index chunks_file_idx on public.chunks (file_id);
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- memories, decisions, products
-- ---------------------------------------------------------------------------

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  -- null project_id = household-wide (applies across every project).
  project_id uuid references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  type text not null check (type in (
    'design_preference', 'courtney_preference', 'amar_preference',
    'shared_preference', 'rejected_idea', 'approved_decision',
    'project_constraint', 'budget_philosophy', 'material', 'vendor',
    'dimension', 'paint_color', 'furniture_under_consideration'
  )),
  content text not null check (length(trim(content)) > 0),
  -- Who the memory belongs to, from the message speaker field.
  attributed_to text check (attributed_to in ('Courtney', 'Amar', 'Both')),
  -- Proposed items wait in the right panel; only 'approved' reach Gio.
  review_state text not null default 'approved'
    check (review_state in ('proposed', 'approved', 'dismissed')),
  source_message_id uuid references public.messages (id) on delete set null,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_project_idx on public.memories (project_id, review_state);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  name text not null,
  designer text,
  vendor text,
  url text,
  dimensions text,
  material_color text,
  provenance text check (provenance in ('vintage', 'new', 'antique', 'custom', 'unknown')),
  price_amount numeric(12, 2),
  price_currency text default 'USD',
  price_basis text check (price_basis in ('sourced', 'estimated')),
  price_source_url text,
  placement text,
  rationale text,
  verdict text check (verdict in ('invest', 'save', 'skip')),
  status text not null default 'considering'
    check (status in ('considering', 'approved', 'rejected', 'purchased')),
  image_asset_id uuid references public.image_assets (id) on delete set null,
  source_message_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_project_idx on public.products (project_id);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  detail text,
  status text not null default 'pending'
    check (status in ('approved', 'keep_looking', 'rejected', 'pending')),
  review_state text not null default 'approved'
    check (review_state in ('proposed', 'approved', 'dismissed')),
  product_id uuid references public.products (id) on delete set null,
  source_message_id uuid references public.messages (id) on delete set null,
  decided_by text check (decided_by in ('Courtney', 'Amar', 'Both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decisions_project_idx on public.decisions (project_id, review_state);

-- ---------------------------------------------------------------------------
-- settings: key/value per user (system prompt lives under 'system_prompt')
-- ---------------------------------------------------------------------------

create table public.settings (
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger rooms_updated_at before update on public.rooms
  for each row execute function public.set_updated_at();
create trigger chats_updated_at before update on public.chats
  for each row execute function public.set_updated_at();
create trigger files_updated_at before update on public.files
  for each row execute function public.set_updated_at();
create trigger memories_updated_at before update on public.memories
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger decisions_updated_at before update on public.decisions
  for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- Posting a message bumps the chat so the sidebar sorts by recent activity.
create or replace function public.touch_chat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;

create trigger messages_touch_chat after insert on public.messages
  for each row execute function public.touch_chat();

-- ---------------------------------------------------------------------------
-- New auth user -> profile row + "General Design Brain" project.
-- (The system prompt is written by `npm run bootstrap` and, as a fallback, by
-- the app on first read, so the verbatim prompt has one source of truth in
-- src/lib/gio/default-system-prompt.ts.)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.projects (user_id, name, brief, is_default)
  values (
    new.id,
    'General Design Brain',
    'Household-wide design thinking that applies across every home and project: '
      || 'taste, principles, references and lessons learned.',
    true
  )
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security: every table, owner-only.
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.rooms enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.files enable row level security;
alter table public.image_assets enable row level security;
alter table public.chunks enable row level security;
alter table public.memories enable row level security;
alter table public.products enable row level security;
alter table public.decisions enable row level security;
alter table public.settings enable row level security;

create policy "own profile" on public.users
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'rooms', 'chats', 'messages', 'files', 'image_assets',
    'chunks', 'memories', 'products', 'decisions', 'settings'
  ]
  loop
    execute format(
      'create policy "owner access" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private buckets, objects stored under "<user_id>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('files', 'files', false), ('images', 'images', false)
on conflict (id) do update set public = false;

create policy "own objects: select" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('files', 'images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "own objects: insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('files', 'images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "own objects: update" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('files', 'images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "own objects: delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('files', 'images')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
