-- Lock the SMS tables to the server. sms_sessions holds conversations and
-- phone numbers, and sms_processed_messages holds phone numbers; both were
-- created without row level security, so with Supabase's default grants the
-- public (anon / publishable) key could read them through the Data API.
-- The app only ever uses the service-role key, which bypasses row level
-- security, so nothing Cinq does changes.
--
-- Safe to run again (each statement is idempotent) and changes no data.
-- To undo it, run supabase/rollback/20261126000002_sms_lockdown.down.sql.
alter table public.sms_sessions enable row level security;
alter table public.sms_processed_messages enable row level security;
revoke all on table public.sms_sessions, public.sms_processed_messages from anon, authenticated;
