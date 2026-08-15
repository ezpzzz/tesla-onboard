-- Standalone evhost.app tenant, membership, branding, and fleet foundation.
-- These objects replace the shared Sophosic platform tables that the first
-- evhost release consumed. Infrastructure secrets remain outside this schema.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table if not exists public.workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(name)) between 1 and 160),
  check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$')
);

create table if not exists public.workspace_users (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('member', 'staff', 'manager', 'admin', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_users_user_idx
  on public.workspace_users (user_id, workspace_id);

create table if not exists public.workspace_branding (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null unique,
  display_name text not null,
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, shop_slug),
  check (char_length(btrim(display_name)) between 1 and 160),
  check (shop_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$')
);

create table if not exists public.onlyevs_vehicles (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  display_name text not null,
  model text not null,
  trim text not null default '',
  year integer not null check (year between 2008 and 2100),
  color text not null,
  shifter text not null default 'screen' check (shifter in ('stalk', 'screen', 'console')),
  license_plate text,
  vin text,
  return_charge_level_pct integer check (return_charge_level_pct between 0 and 100),
  notes text not null default '',
  wheel_type text,
  interior text,
  tesla_interior_code text,
  tesla_paint_code text,
  tesla_spec_source text check (tesla_spec_source is null or tesla_spec_source = 'fleet-api'),
  tesla_imported_spec jsonb check (tesla_imported_spec is null or jsonb_typeof(tesla_imported_spec) = 'object'),
  tesla_import_key text,
  status text not null default 'active' check (status in ('active', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (char_length(btrim(shop_slug)) between 1 and 160),
  check (char_length(btrim(display_name)) between 1 and 240),
  check (char_length(btrim(model)) between 1 and 120),
  check (char_length(trim) <= 120),
  check (char_length(btrim(color)) between 1 and 120),
  check (license_plate is null or char_length(license_plate) <= 32),
  check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  check (char_length(notes) <= 4000),
  check (wheel_type is null or char_length(wheel_type) <= 160),
  check (interior is null or char_length(interior) <= 160),
  check (tesla_import_key is null or char_length(tesla_import_key) <= 240)
);
create unique index if not exists onlyevs_vehicles_workspace_vin_unique_idx
  on public.onlyevs_vehicles (workspace_id, vin) where vin is not null;
create unique index if not exists onlyevs_vehicles_workspace_import_unique_idx
  on public.onlyevs_vehicles (workspace_id, tesla_import_key) where tesla_import_key is not null;
create index if not exists onlyevs_vehicles_workspace_shop_idx
  on public.onlyevs_vehicles (workspace_id, shop_slug, created_at, id);

-- A migration can stage a workspace before its owner first signs in to the
-- new project. Only the SHA-256 email digest is retained; a verified Supabase
-- email can claim the workspace once and receives an owner membership.
create table if not exists private.evhost_workspace_claims (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  email_hash text not null unique check (email_hash ~ '^[0-9a-f]{64}$'),
  claimed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create or replace function public.has_minimum_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_required_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_users wu
    where wu.workspace_id = p_workspace_id
      and wu.user_id = p_user_id
      and case wu.role
        when 'member' then 0
        when 'staff' then 1
        when 'manager' then 2
        when 'admin' then 3
        when 'owner' then 4
        else -1
      end >= case p_required_role
        when 'member' then 0
        when 'staff' then 1
        when 'manager' then 2
        when 'admin' then 3
        when 'owner' then 4
        else 100
      end
  );
$$;

create or replace function public.bootstrap_evhost_workspace()
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  user_email text;
  v_email_hash text;
  claimed_workspace uuid;
  workspace_row public.workspaces;
  display_name text;
  generated_slug text;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select w.* into workspace_row
  from public.workspaces w
  join public.workspace_users wu on wu.workspace_id = w.id
  where wu.user_id = v_user_id
  order by wu.created_at, w.id
  limit 1;
  if workspace_row.id is not null then return workspace_row; end if;

  select lower(u.email),
         coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), 'My EVhost')
  into user_email, display_name
  from auth.users u where u.id = v_user_id;
  if coalesce(user_email, '') = '' then
    raise exception 'verified_email_required' using errcode = '42501';
  end if;
  v_email_hash := encode(extensions.digest(user_email, 'sha256'), 'hex');

  select c.workspace_id into claimed_workspace
  from private.evhost_workspace_claims c
  where c.email_hash = v_email_hash
    and (c.claimed_by is null or c.claimed_by = v_user_id)
  for update;
  if claimed_workspace is not null then
    insert into public.workspace_users (workspace_id, user_id, role)
    values (claimed_workspace, v_user_id, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner', updated_at = now();
    update private.evhost_workspace_claims
    set claimed_by = v_user_id, claimed_at = coalesce(claimed_at, now())
    where workspace_id = claimed_workspace;
    select * into workspace_row from public.workspaces where id = claimed_workspace;
    return workspace_row;
  end if;

  generated_slug := 'evhost-' || left(replace(v_user_id::text, '-', ''), 12);
  insert into public.workspaces (name, slug)
  values (display_name, generated_slug)
  returning * into workspace_row;
  insert into public.workspace_users (workspace_id, user_id, role)
  values (workspace_row.id, v_user_id, 'owner');
  return workspace_row;
end;
$$;

create or replace function public.touch_evhost_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_evhost_vehicle()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger touch_evhost_workspaces before update on public.workspaces
  for each row execute function public.touch_evhost_record();
create trigger touch_evhost_workspace_users before update on public.workspace_users
  for each row execute function public.touch_evhost_record();
create trigger touch_evhost_workspace_branding before update on public.workspace_branding
  for each row execute function public.touch_evhost_record();
create trigger touch_evhost_vehicles before update on public.onlyevs_vehicles
  for each row execute function public.touch_evhost_vehicle();

revoke all on function public.has_minimum_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bootstrap_evhost_workspace() from public, anon, authenticated;
grant execute on function public.has_minimum_role(uuid, uuid, text) to authenticated;
grant execute on function public.bootstrap_evhost_workspace() to authenticated;

revoke all on public.workspaces, public.workspace_users,
  public.workspace_branding, public.onlyevs_vehicles from public, anon, authenticated;
grant select, update on public.workspaces to authenticated;
grant select on public.workspace_users to authenticated;
grant select, insert, update, delete on public.workspace_branding to authenticated;
grant select on public.workspace_branding to anon;
grant select, insert, update, delete on public.onlyevs_vehicles to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_users enable row level security;
alter table public.workspace_branding enable row level security;
alter table public.onlyevs_vehicles enable row level security;

create policy evhost_workspaces_members_select on public.workspaces
  for select to authenticated
  using ((select public.has_minimum_role(id, (select auth.uid()), 'member')));
create policy evhost_workspaces_owners_update on public.workspaces
  for update to authenticated
  using ((select public.has_minimum_role(id, (select auth.uid()), 'owner')))
  with check ((select public.has_minimum_role(id, (select auth.uid()), 'owner')));
create policy evhost_workspace_users_self_select on public.workspace_users
  for select to authenticated using (user_id = (select auth.uid()));
create policy evhost_branding_managers_all on public.workspace_branding
  for all to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')))
  with check ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy evhost_branding_public_published on public.workspace_branding
  for select to anon
  using (jsonb_typeof(features #> '{onlyevs,publishedAt}') = 'number');
create policy evhost_vehicles_managers_all on public.onlyevs_vehicles
  for all to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')))
  with check ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));

revoke all on table private.evhost_workspace_claims from public, anon, authenticated;

comment on function public.bootstrap_evhost_workspace()
  is 'Claims one staged evhost workspace by verified email hash or creates a new tenant on first owner sign-in.';
comment on table private.evhost_workspace_claims
  is 'One-time owner migration claims; stores only a SHA-256 normalized email digest.';
