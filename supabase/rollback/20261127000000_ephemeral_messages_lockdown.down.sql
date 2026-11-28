-- Undo 20261127000000_ephemeral_messages_lockdown.sql. Not recommended: it
-- makes ephemeral_messages readable and writable again with the public key.
-- Changes no data.
alter table public.ephemeral_messages no force row level security;
alter table public.ephemeral_messages disable row level security;
grant all on table public.ephemeral_messages to anon, authenticated;
grant execute on function public.cleanup_ephemeral_messages() to public;
