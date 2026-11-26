-- Operational measurements for Cinq by text: one row per incoming text and
-- one per text Cinq sends. Timings, counts, kinds and statuses only: never a
-- message's words, a photo, a phone number or an error message. A number is
-- stored as a keyed hash (number_key), so requests from one number can be
-- grouped (bursts, overlaps, active numbers) without storing the number.
-- Only the service-role key touches these: row level security is on with no
-- policies, and the public API roles have no grants, so the publishable key
-- can't read them. Rows are deleted after 90 days (src/lib/ops/retention.ts).
--
-- Additive and safe to run again: it only creates what doesn't exist yet and
-- never touches sms_sessions or sms_processed_messages. To undo it, run
-- supabase/rollback/20261126000001_sms_metrics.down.sql.
create table if not exists public.sms_requests (
  message_sid text primary key,
  number_key text not null,
  received_at timestamptz not null,
  -- Filled in when the request ends; still null after a few minutes means it ended in silence.
  finished_at timestamptz,
  has_text boolean not null default false,
  photo_count integer not null default 0,
  -- answered | fallback | stalled | system | duplicate | opted_out | error
  outcome text,
  advisor_id text,
  ack_ms integer,
  still_thinking_ms integer,
  answer_ms integer,
  texts_sent integer not null default 0,
  segments_sent integer not null default 0,
  send_failures integer not null default 0,
  save_failures integer not null default 0,
  -- Model use: one entry per call, {purpose, model, ms, input, output, cache_read, cache_write, searches}.
  model_calls jsonb not null default '[]'::jsonb,
  error_class text
);

create index if not exists sms_requests_received_idx on public.sms_requests (received_at);
create index if not exists sms_requests_number_idx on public.sms_requests (number_key, received_at);

-- Written when Twilio accepts a text, and again by Twilio's delivery reports,
-- which can arrive first: so only the sid is required.
create table if not exists public.sms_outbound (
  sid text primary key,
  request_sid text,
  -- ack | still_thinking | answer | fallback | stalled | system
  kind text,
  segments integer,
  submitted_at timestamptz,
  -- Twilio's latest status: queued | sent | delivered | undelivered | failed …
  status text,
  error_code text,
  status_at timestamptz,
  delivered_at timestamptz
);

create index if not exists sms_outbound_submitted_idx on public.sms_outbound (submitted_at);
create index if not exists sms_outbound_request_idx on public.sms_outbound (request_sid);

alter table public.sms_requests enable row level security;
alter table public.sms_outbound enable row level security;
revoke all on table public.sms_requests, public.sms_outbound from anon, authenticated;
