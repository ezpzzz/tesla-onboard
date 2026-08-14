-- Durable owner-created guest onboarding and manager-safe progress tracking.
-- This migration is intentionally self-contained: production can enable guest
-- onboarding without enabling the deferred Tesla access worker. Public tokens
-- are stored only as SHA-256 hashes; private guest identity/progress stays
-- behind SECURITY DEFINER functions.

create extension if not exists btree_gist with schema extensions;
create schema if not exists private;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_vehicles_workspace_id_id_key'
      and conrelid = 'public.onlyevs_vehicles'::regclass
  ) then
    alter table public.onlyevs_vehicles
      add constraint onlyevs_vehicles_workspace_id_id_key unique (workspace_id, id);
  end if;
end $$;

create table if not exists public.onlyevs_trips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  calendar_candidate_id uuid,
  vehicle_id uuid not null,
  guest_name text not null,
  guest_email text not null,
  timezone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  schedule_version bigint not null default 1 check (schedule_version > 0),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'armed', 'active', 'completed', 'cancelled', 'conflict')),
  public_token_hash text not null,
  token_expires_at timestamptz not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_trips_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete restrict,
  unique (workspace_id, id),
  unique (public_token_hash),
  check (ends_at > starts_at),
  check (token_expires_at >= ends_at),
  check (char_length(guest_name) between 1 and 240),
  check (char_length(guest_email) between 3 and 320),
  check (char_length(timezone) between 1 and 100)
);

create index if not exists onlyevs_trips_workspace_time_idx
  on public.onlyevs_trips (workspace_id, starts_at, ends_at);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_trips_no_active_vehicle_overlap'
      and conrelid = 'public.onlyevs_trips'::regclass
  ) then
    alter table public.onlyevs_trips add constraint onlyevs_trips_no_active_vehicle_overlap
      exclude using gist (
        workspace_id with =,
        vehicle_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status in ('confirmed', 'armed', 'active'));
  end if;
end $$;

create table if not exists private.onlyevs_guest_bindings (
  trip_id uuid primary key,
  workspace_id uuid not null,
  verified_email_hash text not null,
  supabase_user_id uuid,
  tesla_subject_hmac text,
  bound_at timestamptz,
  consented_at timestamptz,
  onboarding_completed_at timestamptz,
  reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_guest_bindings_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade
);

alter table private.onlyevs_guest_bindings
  add column if not exists onboarding_progress jsonb not null default '{}'::jsonb,
  add column if not exists progress_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_guest_bindings_progress_object'
      and conrelid = 'private.onlyevs_guest_bindings'::regclass
  ) then
    alter table private.onlyevs_guest_bindings
      add constraint onlyevs_guest_bindings_progress_object
      check (jsonb_typeof(onboarding_progress) = 'object');
  end if;
end $$;

create or replace function public.create_onlyevs_manual_trip(
  p_workspace_id uuid,
  p_shop_slug text,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_public_token_hash text,
  p_token_expires_at timestamptz
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_shop_slug, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_guest_name, ''))) not between 1 and 240
    or char_length(btrim(coalesce(p_guest_email, ''))) not between 3 and 320
    or position('@' in p_guest_email) < 2
    or char_length(btrim(coalesce(p_timezone, ''))) not between 1 and 100
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or p_starts_at < now() - interval '1 day'
    or p_starts_at > now() + interval '2 years'
    or p_ends_at <= p_starts_at
    or p_ends_at > p_starts_at + interval '90 days'
    or p_token_expires_at < p_ends_at + interval '24 hours' then
    raise exception 'invalid_manual_trip' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.workspace_branding b
    where b.workspace_id = p_workspace_id
      and b.shop_slug = btrim(p_shop_slug)
      and b.features -> 'onlyevs' ->> 'enabled' = 'true'
      and jsonb_typeof(b.features -> 'onlyevs' -> 'publishedAt') = 'number'
  ) then
    raise exception 'guest_onboarding_not_published' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.onlyevs_vehicles v
    where v.workspace_id = p_workspace_id
      and v.shop_slug = btrim(p_shop_slug)
      and v.id = p_vehicle_id
      and v.status = 'active'
  ) then
    raise exception 'active_workspace_vehicle_required' using errcode = '55000';
  end if;

  insert into public.onlyevs_trips (
    workspace_id,
    shop_slug,
    vehicle_id,
    guest_name,
    guest_email,
    timezone,
    starts_at,
    ends_at,
    public_token_hash,
    token_expires_at
  ) values (
    p_workspace_id,
    btrim(p_shop_slug),
    p_vehicle_id,
    btrim(p_guest_name),
    lower(btrim(p_guest_email)),
    btrim(p_timezone),
    p_starts_at,
    p_ends_at,
    p_public_token_hash,
    p_token_expires_at
  ) returning * into trip;

  insert into private.onlyevs_guest_bindings (
    trip_id,
    workspace_id,
    verified_email_hash
  ) values (
    trip.id,
    trip.workspace_id,
    encode(extensions.digest(lower(btrim(p_guest_email)), 'sha256'), 'hex')
  );

  return trip;
exception
  when exclusion_violation then
    raise exception 'vehicle_schedule_conflict' using errcode = '23P01';
end;
$$;

create or replace function public.get_onlyevs_trip_invitation(p_public_token_hash text)
returns table (
  trip_id uuid,
  workspace_id uuid,
  shop_slug text,
  company_name text,
  vehicle_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.workspace_id,
    t.shop_slug,
    coalesce(nullif(b.display_name, ''), w.name),
    v.display_name,
    t.starts_at,
    t.ends_at,
    t.timezone
  from public.onlyevs_trips t
  join public.workspaces w on w.id = t.workspace_id
  join public.onlyevs_vehicles v
    on v.workspace_id = t.workspace_id and v.id = t.vehicle_id
  left join public.workspace_branding b
    on b.workspace_id = t.workspace_id and b.shop_slug = t.shop_slug
  where t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
    and coalesce(p_public_token_hash, '') ~ '^[0-9a-f]{64}$'
  limit 1;
$$;

create or replace function public.onlyevs_trip_email_matches(
  p_public_token_hash text,
  p_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.onlyevs_trips t
    where t.public_token_hash = p_public_token_hash
      and t.token_expires_at > now()
      and t.status not in ('cancelled', 'conflict')
      and lower(t.guest_email) = lower(btrim(p_email))
  );
$$;

create or replace function public.bind_onlyevs_trip_guest(p_public_token_hash text)
returns table (trip_id uuid, tenant_ref text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
  verified_email text;
begin
  verified_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  if (select auth.uid()) is null or verified_email = '' then
    raise exception 'guest_authentication_required' using errcode = '42501';
  end if;
  select * into trip
  from public.onlyevs_trips t
  where t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
  for update;
  if trip.id is null or lower(trip.guest_email) <> verified_email then
    raise exception 'booking_email_mismatch' using errcode = '42501';
  end if;

  update private.onlyevs_guest_bindings b
  set supabase_user_id = (select auth.uid()),
      bound_at = coalesce(b.bound_at, now()),
      updated_at = now()
  where b.workspace_id = trip.workspace_id and b.trip_id = trip.id
    and (b.supabase_user_id is null or b.supabase_user_id = (select auth.uid()));
  if not found then
    raise exception 'trip_already_bound' using errcode = '42501';
  end if;
  return query select trip.id, trip.workspace_id::text || '~' || trip.shop_slug;
end;
$$;

create or replace function public.update_onlyevs_guest_onboarding_progress(
  p_public_token_hash text,
  p_progress jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_progress) <> 'object'
    or octet_length(p_progress::text) > 16384
    or jsonb_typeof(p_progress -> 'stepId') <> 'string'
    or jsonb_typeof(p_progress -> 'pct') <> 'number'
    or jsonb_typeof(p_progress -> 'isDone') <> 'boolean'
    or jsonb_typeof(p_progress -> 'completed') <> 'array'
    or jsonb_typeof(p_progress -> 'checklist') <> 'object'
    or jsonb_typeof(p_progress -> 'moduleTotal') <> 'number'
    or jsonb_typeof(p_progress -> 'requiredChecklistDone') <> 'number'
    or jsonb_typeof(p_progress -> 'requiredChecklistTotal') <> 'number' then
    raise exception 'invalid_onboarding_progress' using errcode = '22023';
  end if;

  update private.onlyevs_guest_bindings b
  set onboarding_progress = p_progress,
      progress_updated_at = now(),
      onboarding_completed_at = case
        when (p_progress ->> 'isDone')::boolean
          then coalesce(b.onboarding_completed_at, now())
        else b.onboarding_completed_at
      end,
      updated_at = now()
  from public.onlyevs_trips t
  where t.id = b.trip_id
    and t.workspace_id = b.workspace_id
    and t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
    and b.supabase_user_id = (select auth.uid())
    and b.bound_at is not null;
  if not found then
    raise exception 'guest_binding_required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.get_onlyevs_workspace_trip_snapshot(
  p_workspace_id uuid,
  p_shop_slug text
)
returns table (
  id uuid,
  vehicle_id uuid,
  guest_name text,
  guest_email text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  onboarding_progress jsonb,
  progress_updated_at timestamptz,
  guest_bound_at timestamptz,
  onboarding_completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  return query
  select
    t.id,
    t.vehicle_id,
    t.guest_name,
    t.guest_email,
    case
      when t.status in ('cancelled', 'conflict') then t.status
      when t.ends_at <= now() then 'completed'
      when t.starts_at <= now() then 'active'
      else 'confirmed'
    end,
    t.starts_at,
    t.ends_at,
    nullif(b.onboarding_progress, '{}'::jsonb),
    b.progress_updated_at,
    b.bound_at,
    b.onboarding_completed_at
  from public.onlyevs_trips t
  left join private.onlyevs_guest_bindings b
    on b.workspace_id = t.workspace_id and b.trip_id = t.id
  where t.workspace_id = p_workspace_id
    and t.shop_slug = btrim(p_shop_slug)
  order by t.starts_at desc, t.id;
end;
$$;

create or replace function public.rotate_onlyevs_trip_public_token(
  p_trip_id uuid,
  p_public_token_hash text,
  p_token_expires_at timestamptz
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
begin
  select * into trip
  from public.onlyevs_trips t
  where t.id = p_trip_id
  for update;
  if trip.id is null then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(trip.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if trip.status not in ('confirmed', 'armed')
    or trip.ends_at <= now()
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or p_token_expires_at < trip.ends_at + interval '24 hours' then
    raise exception 'trip_link_not_rotatable' using errcode = '55000';
  end if;
  update public.onlyevs_trips t
  set public_token_hash = p_public_token_hash,
      token_expires_at = p_token_expires_at,
      revision = t.revision + 1,
      updated_at = now()
  where t.id = trip.id
  returning * into trip;
  return trip;
end;
$$;

revoke all on function public.create_onlyevs_manual_trip(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.update_onlyevs_guest_onboarding_progress(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_onlyevs_workspace_trip_snapshot(uuid, text)
  from public, anon, authenticated;
revoke all on function public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_onlyevs_trip_invitation(text)
  from public, anon, authenticated;
revoke all on function public.onlyevs_trip_email_matches(text, text)
  from public, anon, authenticated;
revoke all on function public.bind_onlyevs_trip_guest(text)
  from public, anon, authenticated;

grant execute on function public.create_onlyevs_manual_trip(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, timestamptz
) to authenticated;
grant execute on function public.update_onlyevs_guest_onboarding_progress(text, jsonb)
  to authenticated;
grant execute on function public.get_onlyevs_workspace_trip_snapshot(uuid, text)
  to authenticated;
grant execute on function public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz)
  to authenticated;
grant execute on function public.get_onlyevs_trip_invitation(text) to anon, authenticated;
grant execute on function public.onlyevs_trip_email_matches(text, text) to anon, authenticated;
grant execute on function public.bind_onlyevs_trip_guest(text) to authenticated;

grant select on public.onlyevs_trips to authenticated;
alter table public.onlyevs_trips enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'onlyevs_trips'
      and policyname = 'onlyevs_trips_managers_select'
  ) then
    create policy onlyevs_trips_managers_select on public.onlyevs_trips
      for select to authenticated
      using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
  end if;
end $$;

comment on function public.create_onlyevs_manual_trip(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, timestamptz
) is 'Creates one manager-authorized manual trip and private guest onboarding binding.';
comment on function public.update_onlyevs_guest_onboarding_progress(text, jsonb)
  is 'Persists a bounded progress summary only for the authenticated guest bound to the private trip token.';
comment on function public.get_onlyevs_workspace_trip_snapshot(uuid, text)
  is 'Returns manager-visible trip and onboarding progress without exposing private binding identity hashes.';
