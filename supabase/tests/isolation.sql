begin;

create function pg_temp.assert_true(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'Failed: %', label;
  end if;
end;
$$;

create function pg_temp.assert_sqlstate(stmt text, expected text)
returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'Expected SQLSTATE % for %', expected, stmt;
exception
  when others then
    if sqlstate is distinct from expected then
      raise exception 'Expected SQLSTATE %, got % for %', expected, sqlstate, stmt;
    end if;
end;
$$;

set local role supabase_auth_admin;
insert into auth.users (id) values
  ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
reset role;

insert into public.provider_connections (id, user_id, provider, platform, external_account_ref, status) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'musicapi', 'beatport', 'ref-a', 'connected'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'musicapi', 'beatport', 'ref-b', 'connected');

insert into public.library_tracks (id, user_id, original_title, original_artist) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Track A', 'Artist A'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Track B', 'Artist B');

insert into public.playlist_folders (id, user_id, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Folder A'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Folder B');

insert into public.playlists (id, user_id, folder_id, name) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Playlist A'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Playlist B');

insert into public.playlist_tracks (user_id, playlist_id, library_track_id, position) values
  ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0),
  ('10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 0);

insert into public.import_jobs (user_id, source_type, idempotency_key) values
  ('10000000-0000-0000-0000-000000000001', 'manual', '60000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'manual', '60000000-0000-0000-0000-000000000001');

insert into public.export_jobs (user_id, target_provider, source_playlist_id, provider_connection_id, idempotency_key, requested_count) values
  ('10000000-0000-0000-0000-000000000001', 'beatport', '50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1),
  ('10000000-0000-0000-0000-000000000002', 'beatport', '50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 1);

select pg_temp.assert_true(
  (select count(*) = 8 and bool_and(c.relrowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),
  'RLS enabled on all eight private tables'
);
select pg_temp.assert_true((select count(*) = 2 from public.profiles), 'account creation creates profiles');
select pg_temp.assert_sqlstate($sql$
  update public.library_tracks set musicapi_connection_id = '20000000-0000-0000-0000-000000000002',
    musicapi_item_id = 'connected-track-a'
  where user_id = '10000000-0000-0000-0000-000000000001'
$sql$, '23503');
update public.library_tracks set musicapi_connection_id = '20000000-0000-0000-0000-000000000001',
  musicapi_item_id = 'connected-track-a' where user_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.assert_sqlstate($sql$
  insert into public.import_jobs (user_id, source_type, idempotency_key)
  values ('10000000-0000-0000-0000-000000000001', 'manual', '60000000-0000-0000-0000-000000000001')
$sql$, '23505');
select pg_temp.assert_sqlstate($sql$
  update public.export_jobs set provider_connection_id = '20000000-0000-0000-0000-000000000002'
  where user_id = '10000000-0000-0000-0000-000000000001'
$sql$, '23503');

set local role anon;
do $$
declare table_name text;
begin
  foreach table_name in array array['profiles', 'provider_connections', 'library_tracks', 'playlist_folders',
    'playlists', 'playlist_tracks', 'import_jobs', 'export_jobs']
  loop
    perform pg_temp.assert_sqlstate(format('select * from public.%I', table_name), '42501');
  end loop;
end;
$$;
reset role;

set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from public.library_tracks), 'missing JWT subject sees no rows');
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles', 'provider_connections', 'library_tracks', 'playlist_folders',
    'playlists', 'playlist_tracks', 'import_jobs', 'export_jobs']
  loop
    execute format(
      'select pg_temp.assert_true(count(*) = 1 and bool_and(user_id = auth.uid()), %L) from public.%I',
      table_name || ' only exposes own rows', table_name
    );
  end loop;
end;
$$;

with changed as (
  update public.library_tracks set display_title = 'Display A'
  where id = '30000000-0000-0000-0000-000000000001' returning id
)
select pg_temp.assert_true(count(*) = 1, 'can update own display metadata') from changed;

with changed as (
  update public.library_tracks set display_title = 'Cross-tenant'
  where id = '30000000-0000-0000-0000-000000000002' returning id
)
select pg_temp.assert_true(count(*) = 0, 'cannot change another user''s track') from changed;

with removed as (
  delete from public.playlists where id = '50000000-0000-0000-0000-000000000002' returning id
)
select pg_temp.assert_true(count(*) = 0, 'cannot delete another user''s playlist') from removed;

select pg_temp.assert_sqlstate($sql$
  insert into public.library_tracks (user_id, original_title, original_artist)
  values ('10000000-0000-0000-0000-000000000002', 'Injected', 'Injected')
$sql$, '42501');
select pg_temp.assert_sqlstate($sql$
  update public.library_tracks set original_title = 'Changed after matching'
$sql$, '42501');
select pg_temp.assert_sqlstate($sql$
  update public.library_tracks set match_status = 'matched'
$sql$, '42501');
select pg_temp.assert_sqlstate($sql$
  insert into public.playlist_tracks (playlist_id, library_track_id, position)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 1)
$sql$, '23503');
select pg_temp.assert_sqlstate($sql$
  insert into public.playlist_tracks (playlist_id, library_track_id, position)
  values ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 1)
$sql$, '23503');
select pg_temp.assert_sqlstate($sql$
  insert into public.playlist_folders (parent_id, name)
  values ('40000000-0000-0000-0000-000000000002', 'Foreign child')
$sql$, '23503');
select pg_temp.assert_sqlstate($sql$
  update public.playlists set folder_id = '40000000-0000-0000-0000-000000000002'
$sql$, '23503');
select pg_temp.assert_sqlstate($sql$
  update public.playlist_folders set parent_id = id
$sql$, '42501');
select pg_temp.assert_sqlstate('select external_account_ref from public.provider_connections', '42501');
select pg_temp.assert_sqlstate('update public.provider_connections set status = ''disconnected''', '42501');
select pg_temp.assert_sqlstate('update public.import_jobs set status = ''completed''', '42501');
select pg_temp.assert_sqlstate('update public.export_jobs set status = ''verified''', '42501');
select pg_temp.assert_sqlstate('select crateflow_private.create_profile()', '42501');

insert into public.playlist_folders (parent_id, name)
values ('40000000-0000-0000-0000-000000000001', 'Own child');
insert into public.playlist_tracks (playlist_id, library_track_id, position)
values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1);
with shared as (insert into public.playlists (name) values ('Another own playlist') returning id)
insert into public.playlist_tracks (playlist_id, library_track_id, position)
select id, '30000000-0000-0000-0000-000000000001', 0 from shared;
select pg_temp.assert_true(
  (select count(*) = 3 and count(distinct playlist_id) = 2 from public.playlist_tracks),
  'a track can occur more than once and in multiple playlists'
);
select pg_temp.assert_sqlstate($sql$
  insert into public.playlist_tracks (playlist_id, library_track_id, position)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1)
$sql$, '23505');

set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(original_title = 'Track B' and display_title is null) from public.library_tracks),
  'user B retains original own row and cannot observe A'
);
select pg_temp.assert_true((select count(*) = 1 from public.playlist_tracks), 'A did not alter B memberships');

reset role;
delete from auth.users where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select count(*) = 1 from public.profiles), 'deletion removes only its own profile');
select pg_temp.assert_true((select count(*) = 1 from public.provider_connections), 'deletion removes only its own connection');
select pg_temp.assert_true((select count(*) = 1 from public.library_tracks), 'deletion removes only its own track');
select pg_temp.assert_true((select count(*) = 1 from public.playlist_tracks), 'deletion removes only its own memberships');
select pg_temp.assert_true((select count(*) = 1 from public.export_jobs), 'deletion removes only its own export jobs');
rollback;
