-- Undo 20261128000001_advisor_audience.sql. Every advisor on C2 goes back to
-- C2 for everyone (the audience column goes), and the history loses its
-- audience, action and note columns. Put any owner-only advisor on legacy
-- first (the /ops panel's Emergency button) if that matters.
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
revoke all on function public.advisor_active_record() from anon, authenticated, public;
alter table public.advisor_active drop constraint if exists advisor_active_audience_check;
alter table public.advisor_active drop column if exists note;
alter table public.advisor_active drop column if exists last_action;
alter table public.advisor_active drop column if exists fallback_test_until;
alter table public.advisor_active drop column if exists audience;
alter table public.advisor_active_history drop column if exists note;
alter table public.advisor_active_history drop column if exists action;
alter table public.advisor_active_history drop column if exists fallback_test_until;
alter table public.advisor_active_history drop column if exists audience;
