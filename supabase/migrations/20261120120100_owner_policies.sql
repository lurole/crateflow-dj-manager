begin;

create policy profiles_owner_read on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_owner_update on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy library_tracks_owner on public.library_tracks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy playlist_folders_owner on public.playlist_folders for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy playlists_owner on public.playlists for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy playlist_tracks_owner on public.playlist_tracks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy import_jobs_owner_read on public.import_jobs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy export_jobs_owner_read on public.export_jobs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy provider_connections_owner_read on public.provider_connections for select to authenticated
  using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, delete on public.library_tracks, public.playlist_folders, public.playlists, public.playlist_tracks
  to authenticated;
grant insert (original_title, original_artist, original_remix, display_title, display_artist,
  album, genre, bpm, camelot_key, duration_ms, ownership_status) on public.library_tracks to authenticated;
grant update (display_title, display_artist, album, genre, bpm, camelot_key, duration_ms, ownership_status) on public.library_tracks to authenticated;
grant insert (parent_id, name, position), update (name, position) on public.playlist_folders to authenticated;
grant insert (folder_id, name), update (folder_id, name) on public.playlists to authenticated;
grant insert (playlist_id, library_track_id, position), update (position) on public.playlist_tracks to authenticated;
grant select on public.import_jobs, public.export_jobs to authenticated;
grant select (id, user_id, provider, platform, status, connected_at, expires_at, updated_at)
  on public.provider_connections to authenticated;

create function crateflow_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function crateflow_private.touch_updated_at() from public, anon, authenticated, service_role;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function crateflow_private.touch_updated_at();
create trigger library_tracks_updated_at before update on public.library_tracks
  for each row execute function crateflow_private.touch_updated_at();
create trigger playlist_folders_updated_at before update on public.playlist_folders
  for each row execute function crateflow_private.touch_updated_at();
create trigger playlists_updated_at before update on public.playlists
  for each row execute function crateflow_private.touch_updated_at();
create trigger import_jobs_updated_at before update on public.import_jobs
  for each row execute function crateflow_private.touch_updated_at();
create trigger export_jobs_updated_at before update on public.export_jobs
  for each row execute function crateflow_private.touch_updated_at();
create trigger provider_connections_updated_at before update on public.provider_connections
  for each row execute function crateflow_private.touch_updated_at();

create function crateflow_private.create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;
revoke all on function crateflow_private.create_profile() from public, anon, authenticated, service_role;

create trigger crateflow_auth_user_created after insert on auth.users
  for each row execute function crateflow_private.create_profile();

commit;
