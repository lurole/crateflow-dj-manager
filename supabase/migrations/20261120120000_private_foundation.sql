begin;

create schema crateflow_private;
revoke all on schema crateflow_private from public, anon, authenticated, service_role;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 120 and btrim(display_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('spotify', 'musicapi')),
  platform text not null check (platform in ('spotify', 'beatport')),
  external_account_ref text not null check (char_length(external_account_ref) between 1 and 250),
  status text not null check (status in ('connected', 'reauth_required', 'disconnected')),
  connected_at timestamptz not null default now(),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, provider, platform, external_account_ref),
  check (provider <> 'spotify' or platform = 'spotify')
);

create table public.library_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  original_title text not null check (char_length(original_title) between 1 and 500 and btrim(original_title) <> ''),
  original_artist text not null check (char_length(original_artist) between 1 and 500 and btrim(original_artist) <> ''),
  original_remix text check (char_length(original_remix) <= 250),
  display_title text check (char_length(display_title) between 1 and 500),
  display_artist text check (char_length(display_artist) between 1 and 500),
  album text check (char_length(album) <= 500),
  genre text check (char_length(genre) <= 120),
  bpm numeric check (bpm between 40 and 240),
  camelot_key text check (camelot_key ~ '^(1[0-2]|[1-9])[AB]$'),
  duration_ms integer check (duration_ms > 0),
  source text not null default 'manual'
    check (source in ('manual', 'paste', 'csv', 'spotify_track', 'spotify_playlist', 'legacy')),
  ownership_status text not null default 'unknown'
    check (ownership_status in ('unknown', 'cart_reported', 'owned_reported', 'downloaded_reported')),
  match_status text not null default 'pending'
    check (match_status in ('pending', 'matched', 'needs_review', 'failed')),
  spotify_id text check (spotify_id ~ '^[A-Za-z0-9]{22}$'),
  isrc text check (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
  beatport_catalog_id text check (beatport_catalog_id ~ '^[0-9]{1,12}$'),
  musicapi_item_id text check (musicapi_item_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  musicapi_connection_id uuid,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  check ((musicapi_item_id is null) = (musicapi_connection_id is null)),
  foreign key (user_id, musicapi_connection_id) references public.provider_connections (user_id, id)
    on delete no action
);

create table public.playlist_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(name) between 1 and 250 and btrim(name) <> ''),
  position bigint not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  check (parent_id is null or parent_id <> id),
  foreign key (user_id, parent_id) references public.playlist_folders (user_id, id)
    on delete set null (parent_id)
);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id uuid,
  name text not null check (char_length(name) between 1 and 250 and btrim(name) <> ''),
  spotify_playlist_id text check (spotify_playlist_id ~ '^[A-Za-z0-9]{22}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, folder_id) references public.playlist_folders (user_id, id)
    on delete set null (folder_id)
);

create table public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  playlist_id uuid not null,
  library_track_id uuid not null,
  position bigint not null check (position >= 0),
  added_at timestamptz not null default now(),
  unique (playlist_id, position) deferrable initially immediate,
  foreign key (user_id, playlist_id) references public.playlists (user_id, id) on delete cascade,
  foreign key (user_id, library_track_id) references public.library_tracks (user_id, id) on delete cascade
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_type text not null
    check (source_type in ('manual', 'paste', 'csv', 'spotify_track', 'spotify_playlist', 'legacy')),
  idempotency_key uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'partial', 'completed', 'failed', 'canceled', 'needs_review')),
  total_count integer not null default 0 check (total_count >= 0),
  processed_count integer not null default 0 check (processed_count between 0 and total_count),
  error_count integer not null default 0 check (error_count between 0 and processed_count),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  target_provider text not null check (target_provider in ('beatport', 'rekordbox')),
  source_playlist_id uuid,
  provider_connection_id uuid,
  idempotency_key uuid not null,
  provider_playlist_id text check (provider_playlist_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  status text not null default 'requested'
    check (status in ('requested', 'validating', 'writing', 'verifying', 'verified', 'partial', 'unverified', 'failed')),
  requested_count integer not null check (requested_count > 0),
  verified_count integer not null default 0 check (verified_count between 0 and requested_count),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (user_id, source_playlist_id) references public.playlists (user_id, id)
    on delete set null (source_playlist_id),
  foreign key (user_id, provider_connection_id) references public.provider_connections (user_id, id)
    on delete set null (provider_connection_id)
);

create index library_tracks_owner_created_idx on public.library_tracks (user_id, created_at desc, id);
create index library_tracks_owner_spotify_idx on public.library_tracks (user_id, spotify_id) where spotify_id is not null;
create index library_tracks_owner_connection_idx on public.library_tracks (user_id, musicapi_connection_id)
  where musicapi_connection_id is not null;
create index playlist_folders_owner_parent_idx on public.playlist_folders (user_id, parent_id, position);
create index playlists_owner_folder_idx on public.playlists (user_id, folder_id);
create index playlist_tracks_owner_track_idx on public.playlist_tracks (user_id, library_track_id);
create index import_jobs_owner_created_idx on public.import_jobs (user_id, created_at desc, id);
create index export_jobs_owner_created_idx on public.export_jobs (user_id, created_at desc, id);
create index export_jobs_owner_playlist_idx on public.export_jobs (user_id, source_playlist_id)
  where source_playlist_id is not null;
create index export_jobs_owner_connection_idx on public.export_jobs (user_id, provider_connection_id)
  where provider_connection_id is not null;

-- Supabase projects can grant access to new public tables by default.
-- Revoke those grants and activate RLS before making the tables visible.
revoke all on table public.profiles, public.provider_connections, public.library_tracks,
  public.playlist_folders, public.playlists, public.playlist_tracks, public.import_jobs, public.export_jobs
  from public, anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.provider_connections enable row level security;
alter table public.library_tracks enable row level security;
alter table public.playlist_folders enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.import_jobs enable row level security;
alter table public.export_jobs enable row level security;

commit;
