-- Ephemeral advisor session messages for generation persistence.
-- Anonymous visitors (no user_id) can have responses continue server-side
-- even if they leave the page, switch apps, or browser suspends the tab.

create table public.ephemeral_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  -- pending: generation in progress
  -- completed: generation finished successfully
  -- failed: generation failed
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  content text not null default '',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ephemeral_messages_session_idx on public.ephemeral_messages (session_id, created_at);
create index ephemeral_messages_status_idx on public.ephemeral_messages (session_id, status);

-- Auto-update updated_at
create trigger ephemeral_messages_updated_at before update on public.ephemeral_messages
  for each row execute function public.set_updated_at();

-- Clean up old sessions (older than 7 days)
create or replace function public.cleanup_ephemeral_messages()
returns void
language plpgsql
as $$
begin
  delete from public.ephemeral_messages
  where created_at < now() - interval '7 days';
end;
$$;
