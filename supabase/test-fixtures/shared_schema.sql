-- Minimal Supabase platform primitives for isolated evhost.app migration
-- validation. The EVhost application tables are created by evhost_core.sql.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
create or replace function storage.foldername(text)
returns text[] language sql immutable as $$
  select string_to_array($1, '/')
$$;

grant usage on schema public, auth, storage, extensions to anon, authenticated;
