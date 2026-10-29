-- SMS sessions and processed-message dedup for Ask Cinq by text.
-- Apply in the Supabase dashboard before the Twilio number goes live.
-- Only the service-role key touches these tables: no grants to anon or
-- authenticated, so no signed-in user is needed and no visitor can read
-- another number's conversation.
create table public.sms_sessions (
  phone_number text primary key,
  opted_in boolean not null default false,
  advisor_id text,
  turns_by_advisor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sms_sessions_updated_at before update on public.sms_sessions
  for each row execute function public.set_updated_at();

create table public.sms_processed_messages (
  message_sid text primary key,
  phone_number text not null,
  created_at timestamptz not null default now()
);

create index sms_processed_messages_phone_idx on public.sms_processed_messages (phone_number, created_at);
