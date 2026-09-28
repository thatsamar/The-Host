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
