-- Undo 20261126000001_sms_metrics.sql: removes the two measurement tables and
-- their records. Conversations (sms_sessions) and duplicate protection
-- (sms_processed_messages) are untouched. Texting keeps working; recording
-- simply stops until the migration is applied again.
drop table if exists public.sms_outbound;
drop table if exists public.sms_requests;
