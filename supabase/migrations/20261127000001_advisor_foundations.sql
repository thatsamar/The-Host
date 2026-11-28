-- The advisors' private intellectual foundations (docs/foundations.md).
--
-- advisor_layers holds every approved version of each advisor's identity,
-- foundation and experimental second layer, encrypted by the app before it
-- is stored (AES-256-GCM, a key that lives only in the server's settings):
-- this database never holds the text in the clear. A version, once stored,
-- can't be changed (a trigger refuses it); a change is a new version.
-- advisor_active says which architecture and versions each advisor uses;
-- every change to it is kept in advisor_active_history. advisor_events counts
-- fallbacks, unavailability and leak-guard hits: fixed codes, never text.
--
-- Only the service-role key touches these: row level security is on with no
-- policies, and the public API roles have no grants, as for the SMS tables.
-- Additive and safe to run again. To undo it, run
-- supabase/rollback/20261127000001_advisor_foundations.down.sql.
create table if not exists public.advisor_layers (
  id bigint generated always as identity primary key,
  advisor_id text not null,
  layer text not null check (layer in ('identity', 'foundation', 'foundation_l2')),
  version integer not null check (version > 0),
  ciphertext text not null,
  iv text not null,
  tag text not null,
  key_id text not null,
  -- Of the plaintext, checked after decryption.
  sha256 text not null,
  -- Where each part came from (interview, written refinement, AI-assisted, drafting), as recorded in the private source.
  provenance jsonb not null default '{}'::jsonb,
  approved_by text not null,
  approved_at timestamptz not null,
  approval_note text,
  -- approved | retired
  status text not null default 'approved' check (status in ('approved', 'retired')),
  created_at timestamptz not null default now(),
  unique (advisor_id, layer, version)
);

-- A stored version can be retired, never rewritten.
create or replace function public.advisor_layers_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'advisor_layers versions are kept; retire one instead';
  end if;
  if new.advisor_id is distinct from old.advisor_id or new.layer is distinct from old.layer or new.version is distinct from old.version
     or new.ciphertext is distinct from old.ciphertext or new.iv is distinct from old.iv or new.tag is distinct from old.tag
     or new.key_id is distinct from old.key_id or new.sha256 is distinct from old.sha256
     or new.provenance is distinct from old.provenance or new.approved_by is distinct from old.approved_by
     or new.approved_at is distinct from old.approved_at then
    raise exception 'advisor_layers versions are immutable; publish a new version';
  end if;
  return new;
end;
$$;
drop trigger if exists advisor_layers_immutable on public.advisor_layers;
create trigger advisor_layers_immutable before update or delete on public.advisor_layers
  for each row execute function public.advisor_layers_immutable();

create table if not exists public.advisor_active (
  advisor_id text primary key,
  architecture text not null default 'legacy' check (architecture in ('legacy', 'c2')),
  identity_version integer,
  foundation_version integer,
  -- The experimental second layer: null keeps it off.
  layer2_version integer,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  -- Set by the app when C2 last loaded, for the unavailability threshold.
  last_loaded_at timestamptz,
  check (architecture = 'legacy' or (identity_version is not null and foundation_version is not null))
);

create table if not exists public.advisor_active_history (
  id bigint generated always as identity primary key,
  advisor_id text not null,
  architecture text not null,
  identity_version integer,
  foundation_version integer,
  layer2_version integer,
  updated_by text not null,
  changed_at timestamptz not null default now()
);

-- Every configuration change is kept (the app's last_loaded_at updates are not changes).
create or replace function public.advisor_active_record() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.architecture is not distinct from old.architecture
     and new.identity_version is not distinct from old.identity_version
     and new.foundation_version is not distinct from old.foundation_version
     and new.layer2_version is not distinct from old.layer2_version then
    return new;
  end if;
  insert into public.advisor_active_history (advisor_id, architecture, identity_version, foundation_version, layer2_version, updated_by)
  values (new.advisor_id, new.architecture, new.identity_version, new.foundation_version, new.layer2_version, new.updated_by);
  return new;
end;
$$;
drop trigger if exists advisor_active_record on public.advisor_active;
create trigger advisor_active_record after insert or update on public.advisor_active
  for each row execute function public.advisor_active_record();

create table if not exists public.advisor_events (
  id bigint generated always as identity primary key,
  advisor_id text not null,
  at timestamptz not null default now(),
  -- fallback | unavailable | leak_guard
  kind text not null check (kind in ('fallback', 'unavailable', 'leak_guard')),
  -- A fixed reason code (or the channel, for the leak guard).
  reason text
);
create index if not exists advisor_events_at_idx on public.advisor_events (advisor_id, at);

alter table public.advisor_layers enable row level security;
alter table public.advisor_active enable row level security;
alter table public.advisor_active_history enable row level security;
alter table public.advisor_events enable row level security;
revoke all on table public.advisor_layers, public.advisor_active, public.advisor_active_history, public.advisor_events from anon, authenticated;
revoke all on function public.advisor_layers_immutable(), public.advisor_active_record() from anon, authenticated, public;
