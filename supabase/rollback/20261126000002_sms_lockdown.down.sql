-- Undo 20261126000002_sms_lockdown.sql. Not recommended: it makes the SMS
-- tables readable again with the public key. Changes no data.
alter table public.sms_sessions disable row level security;
alter table public.sms_processed_messages disable row level security;
grant all on table public.sms_sessions, public.sms_processed_messages to anon, authenticated;
