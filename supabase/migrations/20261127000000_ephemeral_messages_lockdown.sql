-- Lock ephemeral_messages to the server. It was created (20261006000001)
-- without row level security, so with Supabase's default grants the public
-- (anon / publishable) key could read and write it through the Data API, and
-- it can hold message text. Nothing in the app has used it since the
-- persistent-answer code was removed (Oct 8, 2026); the server uses the
-- service-role key, which bypasses row level security, so nothing Cinq does
-- changes. The rows are kept: deciding what to do with them is separate.
--
-- Safe to run again (each statement is idempotent) and changes no data.
-- To undo it, run supabase/rollback/20261127000000_ephemeral_messages_lockdown.down.sql.
alter table if exists public.ephemeral_messages enable row level security;
alter table if exists public.ephemeral_messages force row level security;

do $$
begin
  if to_regclass('public.ephemeral_messages') is not null then
    revoke all on table public.ephemeral_messages from anon, authenticated;
  end if;
  if to_regprocedure('public.cleanup_ephemeral_messages()') is not null then
    revoke execute on function public.cleanup_ephemeral_messages() from public, anon, authenticated;
  end if;
end $$;
