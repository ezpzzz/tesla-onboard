-- EVhost guest trip portal, resendable private capabilities, structured
-- handoff locations, and durable reminder delivery limits.

alter table public.onlyevs_calendar_candidates
  add column if not exists location text;

alter table public.onlyevs_trips
  add column if not exists pickup_location text,
  add column if not exists return_location text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'onlyevs_calendar_candidates_location_length'
  ) then
    alter table public.onlyevs_calendar_candidates
      add constraint onlyevs_calendar_candidates_location_length
      check (location is null or char_length(location) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'onlyevs_trips_pickup_location_length'
  ) then
    alter table public.onlyevs_trips
      add constraint onlyevs_trips_pickup_location_length
      check (pickup_location is null or char_length(pickup_location) <= 500);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'onlyevs_trips_return_location_length'
  ) then
    alter table public.onlyevs_trips
      add constraint onlyevs_trips_return_location_length
      check (return_location is null or char_length(return_location) <= 500);
  end if;
end $$;

create table if not exists private.onlyevs_trip_link_secrets (
  trip_id uuid primary key,
  workspace_id uuid not null,
  token_ciphertext text not null,
  key_version smallint not null check (key_version > 0),
  destroy_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_trip_link_secrets_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade,
  check (char_length(token_ciphertext) between 32 and 4096)
);

create index if not exists onlyevs_trip_link_secrets_destroy_idx
  on private.onlyevs_trip_link_secrets (destroy_after);

create table if not exists public.onlyevs_reminder_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  recipient_masked text not null check (char_length(recipient_masked) between 3 and 320),
  provider_message_id text,
  error_code text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint onlyevs_reminder_deliveries_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade,
  check (provider_message_id is null or char_length(provider_message_id) <= 500),
  check (error_code is null or char_length(error_code) <= 120)
);

create index if not exists onlyevs_reminders_trip_requested_idx
  on public.onlyevs_reminder_deliveries (trip_id, requested_at desc);
create index if not exists onlyevs_reminders_workspace_requested_idx
  on public.onlyevs_reminder_deliveries (workspace_id, requested_at desc);
create index if not exists onlyevs_reminders_pending_idx
  on public.onlyevs_reminder_deliveries (requested_at)
  where status = 'pending';

alter table public.onlyevs_reminder_deliveries enable row level security;

-- PostgreSQL rejects an unqualified FOR UPDATE when the query contains a
-- LEFT JOIN because the nullable relation cannot be locked. Lock only the
-- access-grant rows; the guest binding is read solely as an eligibility gate.
create or replace function private.claim_onlyevs_due_access_grants(
  p_worker_id text,
  p_limit integer default 25
)
returns setof public.onlyevs_access_grants
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or char_length(p_worker_id) < 3 then
    raise exception 'invalid_worker_id';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_limit';
  end if;

  return query
  with due as (
    select g.id
    from public.onlyevs_access_grants g
    left join private.onlyevs_guest_bindings b
      on b.workspace_id = g.workspace_id and b.trip_id = g.trip_id
    where g.next_action_at <= now()
      and (g.claim_expires_at is null or g.claim_expires_at <= now())
      and g.status not in ('revoked', 'expired', 'failed_terminal', 'manual_review')
      and (
        g.status in ('issuing', 'revoking', 'invite_ready', 'redeemed')
        or (
          g.status in ('scheduled', 'failed_retryable')
          and b.bound_at is not null
          and b.consented_at is not null
          and b.onboarding_completed_at is not null
        )
      )
    order by g.next_action_at, g.id
    limit p_limit
    for update of g skip locked
  )
  update public.onlyevs_access_grants g
  set claimed_by = p_worker_id,
      claim_expires_at = now() + interval '2 minutes'
  from due
  where g.id = due.id
  returning g.*;
end;
$$;

drop function if exists public.create_onlyevs_manual_trip(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, timestamptz
);

create function public.create_onlyevs_manual_trip(
  p_trip_id uuid,
  p_workspace_id uuid,
  p_shop_slug text,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_pickup_location text,
  p_return_location text,
  p_public_token_hash text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_key_version smallint
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
  pickup text := nullif(btrim(coalesce(p_pickup_location, '')), '');
  return_place text := nullif(btrim(coalesce(p_return_location, '')), '');
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if p_trip_id is null
    or char_length(btrim(coalesce(p_shop_slug, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_guest_name, ''))) not between 1 and 240
    or char_length(btrim(coalesce(p_guest_email, ''))) not between 3 and 320
    or position('@' in p_guest_email) < 2
    or char_length(btrim(coalesce(p_timezone, ''))) not between 1 and 100
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_token_ciphertext, '')) not between 32 and 4096
    or coalesce(p_key_version, 0) < 1
    or char_length(coalesce(pickup, '')) > 500
    or char_length(coalesce(return_place, '')) > 500
    or p_starts_at < now() - interval '1 day'
    or p_starts_at > now() + interval '2 years'
    or p_ends_at <= p_starts_at
    or p_ends_at > p_starts_at + interval '90 days'
    or p_token_expires_at < p_ends_at + interval '24 hours' then
    raise exception 'invalid_manual_trip' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_branding b
    where b.workspace_id = p_workspace_id
      and b.shop_slug = btrim(p_shop_slug)
      and b.features -> 'onlyevs' ->> 'enabled' = 'true'
      and jsonb_typeof(b.features -> 'onlyevs' -> 'publishedAt') = 'number'
  ) then
    raise exception 'guest_onboarding_not_published' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.onlyevs_vehicles v
    where v.workspace_id = p_workspace_id and v.shop_slug = btrim(p_shop_slug)
      and v.id = p_vehicle_id and v.status = 'active'
  ) then
    raise exception 'active_workspace_vehicle_required' using errcode = '55000';
  end if;

  insert into public.onlyevs_trips (
    id, workspace_id, shop_slug, vehicle_id, guest_name, guest_email, timezone,
    starts_at, ends_at, pickup_location, return_location,
    public_token_hash, token_expires_at
  ) values (
    p_trip_id, p_workspace_id, btrim(p_shop_slug), p_vehicle_id,
    btrim(p_guest_name), lower(btrim(p_guest_email)), btrim(p_timezone),
    p_starts_at, p_ends_at, pickup, coalesce(return_place, pickup),
    p_public_token_hash, p_token_expires_at
  ) returning * into trip;

  insert into private.onlyevs_guest_bindings (trip_id, workspace_id, verified_email_hash)
  values (trip.id, trip.workspace_id, encode(extensions.digest(lower(btrim(p_guest_email)), 'sha256'), 'hex'));

  insert into private.onlyevs_trip_link_secrets (
    trip_id, workspace_id, token_ciphertext, key_version, destroy_after
  ) values (
    trip.id, trip.workspace_id, p_token_ciphertext, p_key_version, p_token_expires_at
  );

  return trip;
exception when exclusion_violation then
  raise exception 'vehicle_schedule_conflict' using errcode = '23P01';
end;
$$;

create or replace function public.ingest_onlyevs_calendar_candidates(
  p_workspace_id uuid,
  p_shop_slug text,
  p_integration_id uuid,
  p_candidates jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare candidate_count integer;
begin
  if not (
    ((select auth.uid()) is not null and public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin'))
    or pg_has_role(session_user, 'onlyevs_worker', 'member')
  ) then raise exception 'workspace_admin_required' using errcode = '42501'; end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 1000 then
    raise exception 'invalid_candidate_batch' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.onlyevs_integrations i where i.id = p_integration_id
      and i.workspace_id = p_workspace_id and i.shop_slug = p_shop_slug
      and i.provider = 'google_calendar' and i.status in ('connected', 'degraded')
  ) then raise exception 'calendar_integration_not_connected' using errcode = '22023'; end if;

  with source as (
    select * from jsonb_to_recordset(p_candidates) as x(
      external_event_id text, external_ical_uid text, recurring_instance_key text,
      summary text, location text, starts_at timestamptz, ends_at timestamptz,
      timezone text, source_updated_at timestamptz, source_revision text,
      status text, deleted_at timestamptz
    )
  ), upserted as (
    insert into public.onlyevs_calendar_candidates (
      workspace_id, shop_slug, integration_id, external_event_id,
      external_ical_uid, recurring_instance_key, summary, location, starts_at,
      ends_at, timezone, source_updated_at, source_revision, status, deleted_at
    )
    select p_workspace_id, p_shop_slug, p_integration_id, s.external_event_id,
      s.external_ical_uid, s.recurring_instance_key, s.summary,
      nullif(btrim(coalesce(s.location, '')), ''), s.starts_at, s.ends_at,
      s.timezone, s.source_updated_at, s.source_revision,
      case when s.status = 'cancelled' then 'cancelled' else 'pending' end,
      s.deleted_at
    from source s
    where s.external_event_id is not null and s.ends_at > s.starts_at
      and char_length(s.summary) <= 500 and char_length(coalesce(s.location, '')) <= 500
      and char_length(s.timezone) between 1 and 100
    on conflict (workspace_id, integration_id, external_event_id, recurring_instance_key)
    do update set
      external_ical_uid = excluded.external_ical_uid,
      summary = excluded.summary,
      location = excluded.location,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      timezone = excluded.timezone,
      source_updated_at = excluded.source_updated_at,
      source_revision = excluded.source_revision,
      status = case
        when excluded.status = 'cancelled' and public.onlyevs_calendar_candidates.status = 'confirmed' then 'needs_review'
        when excluded.status = 'cancelled' then 'cancelled'
        when public.onlyevs_calendar_candidates.status = 'confirmed'
          and (public.onlyevs_calendar_candidates.starts_at <> excluded.starts_at
            or public.onlyevs_calendar_candidates.ends_at <> excluded.ends_at) then 'needs_review'
        else public.onlyevs_calendar_candidates.status end,
      change_kind = case
        when excluded.status = 'cancelled' and public.onlyevs_calendar_candidates.status in ('confirmed', 'needs_review') then 'cancel'
        when public.onlyevs_calendar_candidates.status in ('confirmed', 'needs_review')
          and (public.onlyevs_calendar_candidates.starts_at <> excluded.starts_at
            or public.onlyevs_calendar_candidates.ends_at <> excluded.ends_at) then 'schedule'
        else public.onlyevs_calendar_candidates.change_kind end,
      deleted_at = case
        when excluded.status = 'cancelled' and public.onlyevs_calendar_candidates.status = 'confirmed' then null
        else excluded.deleted_at end
    returning 1
  ) select count(*) into candidate_count from upserted;

  update public.onlyevs_integrations set status = 'connected', last_sync_at = now(),
    next_sync_at = now() + interval '15 minutes', claimed_by = null,
    claim_expires_at = null, last_error_code = null
  where id = p_integration_id and workspace_id = p_workspace_id;
  return candidate_count;
end;
$$;

drop function if exists public.confirm_onlyevs_calendar_candidate(
  uuid, uuid, text, text, text, timestamptz
);

create function public.confirm_onlyevs_calendar_candidate(
  p_trip_id uuid,
  p_candidate_id uuid,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_public_token_hash text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_key_version smallint
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.onlyevs_calendar_candidates;
  trip public.onlyevs_trips;
begin
  select * into candidate from public.onlyevs_calendar_candidates c where c.id = p_candidate_id for update;
  if candidate.id is null then raise exception 'calendar_candidate_not_found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(candidate.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if candidate.status not in ('pending', 'needs_review') or candidate.deleted_at is not null then
    raise exception 'calendar_candidate_not_confirmable' using errcode = '55000';
  end if;
  if exists (select 1 from public.onlyevs_trips t where t.workspace_id = candidate.workspace_id and t.calendar_candidate_id = candidate.id) then
    raise exception 'calendar_schedule_change_requires_manual_review' using errcode = '55000';
  end if;
  if p_trip_id is null or char_length(btrim(p_guest_name)) not between 1 and 240
    or char_length(btrim(p_guest_email)) not between 3 and 320 or position('@' in p_guest_email) < 2
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_token_ciphertext, '')) not between 32 and 4096
    or coalesce(p_key_version, 0) < 1 or p_token_expires_at < candidate.ends_at + interval '24 hours' then
    raise exception 'invalid_trip_confirmation' using errcode = '22023';
  end if;

  insert into public.onlyevs_trips (
    id, workspace_id, shop_slug, calendar_candidate_id, vehicle_id,
    guest_name, guest_email, timezone, starts_at, ends_at,
    pickup_location, return_location, public_token_hash, token_expires_at
  ) values (
    p_trip_id, candidate.workspace_id, candidate.shop_slug, candidate.id, p_vehicle_id,
    btrim(p_guest_name), lower(btrim(p_guest_email)), candidate.timezone,
    candidate.starts_at, candidate.ends_at, candidate.location, candidate.location,
    p_public_token_hash, p_token_expires_at
  ) returning * into trip;

  insert into private.onlyevs_guest_bindings (trip_id, workspace_id, verified_email_hash)
  values (trip.id, trip.workspace_id, encode(extensions.digest(lower(btrim(p_guest_email)), 'sha256'), 'hex'));
  insert into private.onlyevs_trip_link_secrets (trip_id, workspace_id, token_ciphertext, key_version, destroy_after)
  values (trip.id, trip.workspace_id, p_token_ciphertext, p_key_version, p_token_expires_at);
  insert into public.onlyevs_access_grants (workspace_id, trip_id, vehicle_id, issue_at, revoke_at, next_action_at)
  values (trip.workspace_id, trip.id, trip.vehicle_id, trip.starts_at - interval '2 hours', trip.ends_at + interval '1 hour', trip.starts_at - interval '2 hours');
  update public.onlyevs_calendar_candidates set status = 'confirmed', change_kind = null, revision = revision + 1, updated_at = now()
  where id = candidate.id;
  return trip;
exception when exclusion_violation then
  raise exception 'vehicle_schedule_conflict' using errcode = '23P01';
end;
$$;

drop function if exists public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz);

create function public.rotate_onlyevs_trip_public_token(
  p_trip_id uuid,
  p_public_token_hash text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_key_version smallint
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare trip public.onlyevs_trips;
begin
  select * into trip from public.onlyevs_trips t where t.id = p_trip_id for update;
  if trip.id is null then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null or not public.has_minimum_role(trip.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if trip.status not in ('confirmed', 'armed') or trip.ends_at <= now()
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_token_ciphertext, '')) not between 32 and 4096
    or coalesce(p_key_version, 0) < 1
    or p_token_expires_at < trip.ends_at + interval '24 hours' then
    raise exception 'trip_link_not_rotatable' using errcode = '55000';
  end if;
  update public.onlyevs_trips t set public_token_hash = p_public_token_hash,
    token_expires_at = p_token_expires_at, revision = t.revision + 1, updated_at = now()
  where t.id = trip.id returning * into trip;
  insert into private.onlyevs_trip_link_secrets (trip_id, workspace_id, token_ciphertext, key_version, destroy_after)
  values (trip.id, trip.workspace_id, p_token_ciphertext, p_key_version, p_token_expires_at)
  on conflict (trip_id) do update set token_ciphertext = excluded.token_ciphertext,
    key_version = excluded.key_version, destroy_after = excluded.destroy_after, updated_at = now();
  return trip;
end;
$$;

drop function if exists public.get_onlyevs_trip_invitation(text);

create function public.get_onlyevs_trip_invitation(p_public_token_hash text)
returns table (
  company_name text,
  guest_first_name text,
  vehicle_name text,
  vehicle_model text,
  vehicle_trim text,
  vehicle_year integer,
  vehicle_color text,
  vehicle_shifter text,
  wheel_type text,
  interior text,
  tesla_interior_code text,
  tesla_paint_code text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  lifecycle text,
  pickup_location text,
  return_location text,
  onboarding_progress jsonb,
  progress_updated_at timestamptz,
  access_status text,
  tenant_config jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(wb.display_name, ''), w.name), split_part(btrim(t.guest_name), ' ', 1),
    v.display_name, v.model, v.trim, v.year, v.color, v.shifter,
    v.wheel_type, v.interior, v.tesla_interior_code, v.tesla_paint_code,
    t.starts_at, t.ends_at, t.timezone,
    case when t.ends_at <= now() or t.status = 'completed' then 'completed'
      when t.starts_at <= now() or t.status = 'active' then 'active' else 'upcoming' end,
    t.pickup_location, coalesce(t.return_location, t.pickup_location),
    nullif(gb.onboarding_progress, '{}'::jsonb), gb.progress_updated_at,
    ag.status,
    (wb.features -> 'onlyevs' -> 'config')
      #- '{car,sourceVehicleId}' #- '{car,sourceVehicleUpdatedAt}'
  from public.onlyevs_trips t
  join public.workspaces w on w.id = t.workspace_id
  join public.onlyevs_vehicles v on v.workspace_id = t.workspace_id and v.id = t.vehicle_id
  left join public.workspace_branding wb on wb.workspace_id = t.workspace_id and wb.shop_slug = t.shop_slug
  left join private.onlyevs_guest_bindings gb on gb.workspace_id = t.workspace_id and gb.trip_id = t.id
  left join public.onlyevs_access_grants ag on ag.workspace_id = t.workspace_id and ag.trip_id = t.id
  where coalesce(p_public_token_hash, '') ~ '^[0-9a-f]{64}$'
    and t.public_token_hash = p_public_token_hash and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
    and wb.features -> 'onlyevs' ->> 'enabled' = 'true'
    and jsonb_typeof(wb.features -> 'onlyevs' -> 'publishedAt') = 'number'
    and jsonb_typeof(wb.features -> 'onlyevs' -> 'config') = 'object'
  limit 1;
$$;

drop function if exists public.get_onlyevs_workspace_trip_snapshot(uuid, text);

create function public.get_onlyevs_workspace_trip_snapshot(p_workspace_id uuid, p_shop_slug text)
returns table (
  id uuid, vehicle_id uuid, guest_name text, guest_email text, status text,
  starts_at timestamptz, ends_at timestamptz, pickup_location text,
  return_location text, onboarding_progress jsonb, progress_updated_at timestamptz,
  guest_bound_at timestamptz, onboarding_completed_at timestamptz,
  access_status text, reminder_last_sent_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  return query
  select t.id, t.vehicle_id, t.guest_name, t.guest_email,
    case when t.status in ('cancelled', 'conflict') then t.status
      when t.ends_at <= now() then 'completed' when t.starts_at <= now() then 'active' else 'confirmed' end,
    t.starts_at, t.ends_at, t.pickup_location, coalesce(t.return_location, t.pickup_location),
    nullif(gb.onboarding_progress, '{}'::jsonb), gb.progress_updated_at, gb.bound_at,
    gb.onboarding_completed_at, ag.status,
    (select max(rd.completed_at) from public.onlyevs_reminder_deliveries rd where rd.trip_id = t.id and rd.status = 'sent')
  from public.onlyevs_trips t
  left join private.onlyevs_guest_bindings gb on gb.workspace_id = t.workspace_id and gb.trip_id = t.id
  left join public.onlyevs_access_grants ag on ag.workspace_id = t.workspace_id and ag.trip_id = t.id
  where t.workspace_id = p_workspace_id and t.shop_slug = btrim(p_shop_slug)
  order by t.starts_at desc, t.id;
end;
$$;

create or replace function public.begin_onlyevs_trip_reminder(
  p_trip_id uuid
)
returns table (
  delivery_id uuid, workspace_id uuid, shop_slug text, guest_name text,
  company_name text, vehicle_name text, starts_at timestamptz,
  timezone text, pickup_location text, recipient_masked text
)
language plpgsql security definer set search_path = ''
as $$
declare trip public.onlyevs_trips;
declare delivery uuid;
begin
  select * into trip from public.onlyevs_trips t where t.id = p_trip_id for update;
  if trip.id is null then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null or not public.has_minimum_role(trip.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if trip.status in ('cancelled', 'conflict') or trip.token_expires_at <= now() then
    raise exception 'trip_reminder_unavailable' using errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(trip.workspace_id::text, 0));
  if exists (select 1 from public.onlyevs_reminder_deliveries d where d.trip_id = trip.id
    and d.status in ('pending', 'sent') and d.requested_at > now() - interval '5 minutes') then
    raise exception 'trip_reminder_cooldown' using errcode = '55000';
  end if;
  if exists (select 1 from public.onlyevs_reminder_deliveries d where d.trip_id = trip.id
    and d.status = 'failed' and d.requested_at > now() - interval '1 minute') then
    raise exception 'trip_reminder_retry_delay' using errcode = '55000';
  end if;
  if (select count(*) from public.onlyevs_reminder_deliveries d where d.trip_id = trip.id
    and d.requested_at > now() - interval '24 hours') >= 6 then
    raise exception 'trip_reminder_daily_limit' using errcode = '54000';
  end if;
  if (select count(*) from public.onlyevs_reminder_deliveries d where d.workspace_id = trip.workspace_id
    and d.requested_at > now() - interval '24 hours') >= 100 then
    raise exception 'workspace_reminder_daily_limit' using errcode = '54000';
  end if;
  if not exists (select 1 from private.onlyevs_trip_link_secrets s where s.trip_id = trip.id
    and s.destroy_after > now()) then
    raise exception 'trip_link_secret_unavailable' using errcode = '55000';
  end if;

  insert into public.onlyevs_reminder_deliveries (
    workspace_id, trip_id, requested_by, recipient_hash, recipient_masked
  ) values (
    trip.workspace_id, trip.id, (select auth.uid()),
    encode(extensions.digest(lower(trip.guest_email), 'sha256'), 'hex'),
    left(split_part(lower(trip.guest_email), '@', 1), 2) || '••••@' || split_part(lower(trip.guest_email), '@', 2)
  ) returning id into delivery;

  return query select delivery, trip.workspace_id, trip.shop_slug, trip.guest_name,
    coalesce(nullif(wb.display_name, ''), w.name), v.display_name,
    trip.starts_at, trip.timezone, trip.pickup_location,
    left(split_part(lower(trip.guest_email), '@', 1), 2) || '••••@' || split_part(lower(trip.guest_email), '@', 2)
  from public.workspaces w
  join public.onlyevs_vehicles v on v.workspace_id = trip.workspace_id and v.id = trip.vehicle_id
  left join public.workspace_branding wb on wb.workspace_id = trip.workspace_id and wb.shop_slug = trip.shop_slug
  where w.id = trip.workspace_id;
end;
$$;

create or replace function public.get_onlyevs_trip_reminder_material(p_delivery_id uuid)
returns table (
  delivery_id uuid, workspace_id uuid, shop_slug text, guest_name text,
  guest_email text, company_name text, vehicle_name text, starts_at timestamptz,
  timezone text, pickup_location text, token_ciphertext text, key_version smallint
)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return query
  select d.id, t.workspace_id, t.shop_slug, t.guest_name, t.guest_email,
    coalesce(nullif(wb.display_name, ''), w.name), v.display_name,
    t.starts_at, t.timezone, t.pickup_location, s.token_ciphertext, s.key_version
  from public.onlyevs_reminder_deliveries d
  join public.onlyevs_trips t on t.workspace_id = d.workspace_id and t.id = d.trip_id
  join public.workspaces w on w.id = t.workspace_id
  join public.onlyevs_vehicles v on v.workspace_id = t.workspace_id and v.id = t.vehicle_id
  join private.onlyevs_trip_link_secrets s on s.workspace_id = t.workspace_id and s.trip_id = t.id
  left join public.workspace_branding wb on wb.workspace_id = t.workspace_id and wb.shop_slug = t.shop_slug
  where d.id = p_delivery_id and d.status = 'pending' and s.destroy_after > now();
end;
$$;

create or replace function public.finish_onlyevs_trip_reminder(
  p_delivery_id uuid,
  p_status text,
  p_provider_message_id text,
  p_error_code text
)
returns table (recipient_masked text, sent_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare delivery public.onlyevs_reminder_deliveries;
begin
  select * into delivery from public.onlyevs_reminder_deliveries d where d.id = p_delivery_id for update;
  if delivery.id is null then raise exception 'reminder_delivery_not_found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null or not public.has_minimum_role(delivery.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if delivery.status <> 'pending' or p_status not in ('sent', 'failed') then
    raise exception 'invalid_reminder_transition' using errcode = '55000';
  end if;
  update public.onlyevs_reminder_deliveries d set status = p_status,
    provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 500), ''),
    error_code = nullif(left(coalesce(p_error_code, ''), 120), ''), completed_at = now()
  where d.id = delivery.id;
  insert into public.onlyevs_integration_audit_events (
    workspace_id, actor_type, actor_id_hash, entity_type, entity_id,
    action, result, provider_request_id, error_code, details
  ) values (
    delivery.workspace_id, 'owner', encode(extensions.digest((select auth.uid())::text, 'sha256'), 'hex'),
    'trip', delivery.trip_id, 'guest_reminder_sent',
    case when p_status = 'sent' then 'success' else 'failure' end,
    nullif(left(coalesce(p_provider_message_id, ''), 500), ''),
    nullif(left(coalesce(p_error_code, ''), 120), ''),
    jsonb_build_object('delivery_id', delivery.id, 'recipient', delivery.recipient_masked)
  );
  return query select delivery.recipient_masked, now();
end;
$$;

create or replace function public.cleanup_onlyevs_expired_trip_link_secrets()
returns integer language plpgsql security definer set search_path = ''
as $$
declare deleted_count integer;
begin
  if not pg_has_role(session_user, 'onlyevs_worker', 'member') then
    raise exception 'worker_role_required' using errcode = '42501';
  end if;
  delete from private.onlyevs_trip_link_secrets where destroy_after <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on table private.onlyevs_trip_link_secrets from public, anon, authenticated;
revoke all on table public.onlyevs_reminder_deliveries from public, anon, authenticated;

revoke all on function public.create_onlyevs_manual_trip(uuid, uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, text, smallint) from public, anon, authenticated;
revoke all on function public.confirm_onlyevs_calendar_candidate(uuid, uuid, uuid, text, text, text, timestamptz, text, smallint) from public, anon, authenticated;
revoke all on function public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz, text, smallint) from public, anon, authenticated;
revoke all on function public.get_onlyevs_trip_invitation(text) from public, anon, authenticated;
revoke all on function public.get_onlyevs_workspace_trip_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function public.begin_onlyevs_trip_reminder(uuid) from public, anon, authenticated;
revoke all on function public.get_onlyevs_trip_reminder_material(uuid) from public, anon, authenticated;
revoke all on function public.finish_onlyevs_trip_reminder(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.cleanup_onlyevs_expired_trip_link_secrets() from public, anon, authenticated;

grant execute on function public.create_onlyevs_manual_trip(uuid, uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, text, smallint) to authenticated;
grant execute on function public.confirm_onlyevs_calendar_candidate(uuid, uuid, uuid, text, text, text, timestamptz, text, smallint) to authenticated;
grant execute on function public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz, text, smallint) to authenticated;
grant execute on function public.get_onlyevs_trip_invitation(text) to anon, authenticated;
grant execute on function public.get_onlyevs_workspace_trip_snapshot(uuid, text) to authenticated;
grant execute on function public.begin_onlyevs_trip_reminder(uuid) to authenticated;
grant execute on function public.get_onlyevs_trip_reminder_material(uuid) to service_role;
grant execute on function public.finish_onlyevs_trip_reminder(uuid, text, text, text) to authenticated;
grant execute on function public.cleanup_onlyevs_expired_trip_link_secrets() to onlyevs_worker;

comment on table private.onlyevs_trip_link_secrets is
  'AES-256-GCM envelopes for resendable private guest capabilities; plaintext never enters Postgres.';
comment on table public.onlyevs_reminder_deliveries is
  'Durable SendGrid delivery attempts used for database-enforced trip and workspace limits.';
