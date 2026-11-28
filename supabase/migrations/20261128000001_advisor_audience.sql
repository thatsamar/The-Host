-- Staged rollout and the /ops foundations panel (docs/foundations.md).
--
-- advisor_active.audience says who gets an advisor's C2: 'owner' (only the
-- owner, recognised by phone number by text and by the /ops sign-in on the
-- website) or 'everyone'. fallback_test_until, while in the future, makes
-- the owner's loads fail on purpose, so the owner can see the fallback; it
-- runs out on its own. last_action and note say what the owner did, and
-- advisor_active_history keeps them with every change, including the
-- audience, the fallback test and each upload.
--
-- Additive and safe to run again. To undo it, run
-- supabase/rollback/20261128000001_advisor_audience.down.sql.
alter table public.advisor_active add column if not exists audience text not null default 'everyone';
alter table public.advisor_active add column if not exists fallback_test_until timestamptz;
alter table public.advisor_active add column if not exists last_action text;
alter table public.advisor_active add column if not exists note text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'advisor_active_audience_check' and conrelid = 'public.advisor_active'::regclass) then
    alter table public.advisor_active add constraint advisor_active_audience_check check (audience in ('owner', 'everyone'));
  end if;
end;
$$;

alter table public.advisor_active_history add column if not exists audience text;
alter table public.advisor_active_history add column if not exists fallback_test_until timestamptz;
alter table public.advisor_active_history add column if not exists action text;
alter table public.advisor_active_history add column if not exists note text;

-- Every change the owner makes is kept; the app's last_loaded_at updates are not changes.
create or replace function public.advisor_active_record() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.architecture is not distinct from old.architecture
     and new.identity_version is not distinct from old.identity_version
     and new.foundation_version is not distinct from old.foundation_version
     and new.layer2_version is not distinct from old.layer2_version
     and new.audience is not distinct from old.audience
     and new.fallback_test_until is not distinct from old.fallback_test_until
     and new.updated_at is not distinct from old.updated_at then
    return new;
  end if;
  insert into public.advisor_active_history (advisor_id, architecture, identity_version, foundation_version, layer2_version, audience, fallback_test_until, action, note, updated_by)
  values (new.advisor_id, new.architecture, new.identity_version, new.foundation_version, new.layer2_version, new.audience, new.fallback_test_until, new.last_action, new.note, new.updated_by);
  return new;
end;
$$;

-- Still only the service role.
revoke all on function public.advisor_active_record() from anon, authenticated, public;
