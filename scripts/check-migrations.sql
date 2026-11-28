-- Assertions run by check-migrations.sh after the migrations apply.
grant usage on schema public, extensions, storage to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all tables in schema storage to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'home@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'intruder@example.com');

do $$
begin
  assert (select count(*) from public.users) = 2, 'profile rows created';
  assert (select count(*) from public.projects where is_default and name = 'General Design Brain') = 2,
    'default project created per user';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset

do $$
declare
  p uuid;
  c uuid;
begin
  assert (select count(*) from public.projects) = 1, 'user sees only own projects';
  select id into p from public.projects where is_default;
  insert into public.chats (project_id, title) values (p, 't') returning id into c;
  insert into public.messages (chat_id, role, speaker, content) values (c, 'user', 'Amar', 'hi');
  insert into public.messages (chat_id, role, speaker, content) values (c, 'assistant', 'Gio', 'hello');
  begin
    insert into public.messages (chat_id, role, speaker, content) values (c, 'user', 'Gio', 'bad');
    raise exception 'speaker/role constraint missing';
  exception when check_violation then null;
  end;
  begin
    insert into public.messages (chat_id, role, speaker, content) values (c, 'user', 'Someone', 'bad');
    raise exception 'speaker constraint missing';
  exception when check_violation then null;
  end;
  insert into public.settings (key, value) values ('system_prompt', '"x"');
  insert into storage.objects (bucket_id, name) values ('images', '00000000-0000-0000-0000-00000000000a/a.jpg');
  begin
    insert into storage.objects (bucket_id, name) values ('images', '00000000-0000-0000-0000-00000000000b/a.jpg');
    raise exception 'storage policy allowed foreign folder';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) \gset
do $$
begin
  assert (select count(*) from public.chats) = 0, 'other user cannot see chats';
  assert (select count(*) from public.messages) = 0, 'other user cannot see messages';
  assert (select count(*) from public.settings) = 0, 'other user cannot see settings';
  assert (select count(*) from storage.objects) = 0, 'other user cannot see objects';
end $$;

select set_config('request.jwt.claim.sub', '', false) \gset
do $$
begin
  assert (select count(*) from public.projects) = 0, 'no session sees nothing';
end $$;
reset role;

do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert missing is null, 'tables without RLS: ' || coalesce(missing, '');
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset
do $$
declare p uuid;
begin
  select id into p from public.projects where is_default;
  insert into public.rooms (project_id, name) values (p, 'Kitchen');
  begin
    insert into public.rooms (project_id, name) values (p, ' kitchen ');
    raise exception 'duplicate room name allowed';
  exception when unique_violation then null;
  end;
end $$;
reset role;

-- match_chunks runs with the caller's rights: user b never sees user a's chunks.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset
do $$
declare p uuid; n int;
begin
  select id into p from public.projects where is_default;
  insert into public.chunks (project_id, source_type, content, embedding)
    values (p, 'text', 'oak and linen', array_fill(0.1::real, array[1024])::extensions.vector);
  select count(*) into n from public.match_chunks(array_fill(0.1::real, array[1024])::extensions.vector, array[p], 5, 0.0, null);
  assert n = 1, 'owner can match own chunk';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
  select count(*) into n from public.match_chunks(array_fill(0.1::real, array[1024])::extensions.vector, array[p], 5, 0.0, null);
  assert n = 0, 'other user cannot match foreign chunks';
end $$;
reset role;

-- match_memories: approved only, project plus household, and never another user's.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset
do $$
declare p uuid; n int; v extensions.vector := array_fill(0.1::real, array[1024])::extensions.vector;
begin
  select id into p from public.projects where is_default;
  insert into public.memories (project_id, type, content, review_state, embedding) values
    (p, 'material', 'oak', 'approved', v),
    (null, 'budget_philosophy', 'invest in seating', 'approved', v),
    (p, 'material', 'proposed only', 'proposed', v),
    (p, 'material', 'dismissed', 'dismissed', v);
  select count(*) into n from public.match_memories(v, p, 10);
  assert n = 2, 'approved project + household memories only, got ' || n;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
  select count(*) into n from public.match_memories(v, p, 10);
  assert n = 0, 'other user cannot match foreign memories';
end $$;
reset role;

-- Prompt history is private, and imported chats can't be duplicated.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) \gset
do $$
declare p uuid;
begin
  insert into public.system_prompt_versions (content, label) values ('v1', 'original');
  select id into p from public.projects where is_default;
  insert into public.chats (project_id, title, source, external_id, extraction_status) values (p, 'x', 'chatgpt', 'chatgpt:1', 'pending');
  begin
    insert into public.chats (project_id, title, source, external_id) values (p, 'y', 'chatgpt', 'chatgpt:1');
    raise exception 'duplicate external id allowed';
  exception when unique_violation then null;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
  assert (select count(*) from public.system_prompt_versions) = 0, 'other user cannot see prompt history';
end $$;
reset role;

-- The advisors' private foundations: the public roles see nothing and can
-- write nothing, even with table grants (row level security, no policies);
-- a stored version can't be changed or deleted; configuration changes are
-- kept in the history.
insert into public.advisor_layers (advisor_id, layer, version, ciphertext, iv, tag, key_id, sha256, approved_by, approved_at)
  values ('tony', 'identity', 1, 'c', 'i', 't', 'k1', 's', 'owner', now());
insert into public.advisor_active (advisor_id, architecture, identity_version, foundation_version, updated_by)
  values ('tony', 'c2', 1, 1, 'owner');
update public.advisor_active set last_loaded_at = now() where advisor_id = 'tony';
update public.advisor_active set architecture = 'legacy', updated_by = 'owner' where advisor_id = 'tony';
do $$
begin
  assert (select count(*) from public.advisor_active_history) = 2, 'history keeps each configuration change, not load times';
  begin
    update public.advisor_layers set ciphertext = 'changed' where advisor_id = 'tony';
    raise exception 'stored version was changed';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    delete from public.advisor_layers where advisor_id = 'tony';
    raise exception 'stored version was deleted';
  exception when raise_exception then
    if sqlerrm not like '%kept%' then raise; end if;
  end;
  update public.advisor_layers set status = 'retired' where advisor_id = 'tony';
end $$;

-- Staged rollout (20261128000001): the audience and the fallback test are recorded with their action and note; only 'owner' or 'everyone'.
update public.advisor_active set architecture = 'c2', audience = 'owner', last_action = 'activate', note = 'rehearsal', updated_at = now() + interval '1 second' where advisor_id = 'tony';
update public.advisor_active set fallback_test_until = now() + interval '10 minutes', last_action = 'fallback_test_on', updated_at = now() + interval '2 seconds' where advisor_id = 'tony';
update public.advisor_active set last_loaded_at = now() where advisor_id = 'tony';
do $$
begin
  assert (select count(*) from public.advisor_active_history) = 4, 'history keeps the audience and fallback test changes, not load times';
  assert (select audience from public.advisor_active_history where action = 'activate') = 'owner', 'history keeps the audience';
  assert (select note from public.advisor_active_history where action = 'activate') = 'rehearsal', 'history keeps the note';
  begin
    update public.advisor_active set audience = 'friends' where advisor_id = 'tony';
    raise exception 'an unknown audience was accepted';
  exception when check_violation then null;
  end;
end $$;

set role anon;
do $$
begin
  assert (select count(*) from public.advisor_layers) = 0, 'anon reads no foundation';
exception when insufficient_privilege then null;
end $$;
reset role;

set role authenticated;
do $$
begin
  assert (select count(*) from public.advisor_layers) = 0, 'a signed-in user reads no foundation';
  assert (select count(*) from public.advisor_active) = 0, 'a signed-in user reads no configuration';
  assert (select count(*) from public.advisor_events) = 0, 'a signed-in user reads no events';
  begin
    insert into public.advisor_active (advisor_id, architecture, updated_by) values ('gio', 'legacy', 'intruder');
    raise exception 'a signed-in user changed a configuration';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
