-- Minimal shared sophosic-platform contract for the isolated evhost.app migration.
-- validation. This fixture is test-only; production already owns these roles,
-- schemas, and tables.

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

create table if not exists public.workspaces (
  id uuid primary key,
  name text not null default '',
  slug text not null unique
);
create table if not exists public.workspace_users (
  workspace_id uuid not null references public.workspaces(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  primary key (workspace_id, user_id)
);
create table if not exists public.workspace_branding (
  workspace_id uuid not null references public.workspaces(id),
  shop_slug text not null,
  display_name text not null default '',
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, shop_slug)
);
create table if not exists public.onlyevs_vehicles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  shop_slug text not null,
  display_name text not null default '',
  vin text,
  status text not null default 'active'
);
create or replace function public.has_minimum_role(uuid, uuid, text)
returns boolean language sql stable as $$ select true $$;

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
