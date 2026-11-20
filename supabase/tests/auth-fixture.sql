-- Minimal Supabase Auth contract for an isolated PostgreSQL test database.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create schema auth;
create table auth.users (id uuid primary key);

create function auth.uid()
returns uuid language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;

-- Exercise migrations against the broad default table grants some Supabase
-- projects have on public. Phase 1 must narrow these explicitly.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
