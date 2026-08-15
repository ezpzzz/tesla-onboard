-- evhost.app trip-bound Tesla access lifecycle and fleet intelligence.
-- Existing onlyevs_* SQL object names remain stable compatibility identifiers;
-- they are not the tenant-facing product name.
-- This migration is additive and isolated to onlyevs_* objects plus private
-- credential/location tables. It does not modify shared auth users, templates,
-- signing configuration, or unrelated application tables.

create extension if not exists btree_gist with schema extensions;
create schema if not exists private;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'onlyevs_worker') then
    create role onlyevs_worker nologin noinherit;
  end if;
end $$;

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

create table if not exists public.onlyevs_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  provider text not null check (provider in ('tesla', 'google_calendar')),
  status text not null default 'disconnected'
    check (status in ('connected', 'degraded', 'disconnecting', 'reauth_required', 'disconnected')),
  account_label text,
  granted_scopes text[] not null default '{}',
  region_base_url text,
  selected_calendar_id text,
  selected_calendar_timezone text,
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  claimed_by text,
  claim_expires_at timestamptz,
  last_error_code text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, shop_slug, provider),
  unique (workspace_id, id),
  check (char_length(shop_slug) between 1 and 160),
  check (account_label is null or char_length(account_label) <= 320),
  check (region_base_url is null or region_base_url ~ '^https://')
);

create table if not exists private.onlyevs_integration_credentials (
  integration_id uuid primary key,
  workspace_id uuid not null,
  provider_subject_ciphertext text not null,
  refresh_token_ciphertext text not null,
  key_version smallint not null check (key_version > 0),
  rotation_version bigint not null default 1 check (rotation_version > 0),
  token_expires_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_integration_credentials_integration_fk
    foreign key (workspace_id, integration_id)
    references public.onlyevs_integrations(workspace_id, id) on delete cascade
);

-- The live owner import payload can exceed browser cookie limits for larger
-- fleets. Keep that VIN-bearing profile in a private, expiring server session;
-- the browser receives only a random opaque handle whose hash is stored here.
create table if not exists private.onlyevs_owner_import_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (owner_user_id, workspace_id, shop_slug),
  check (char_length(shop_slug) between 1 and 160),
  check (expires_at > created_at)
);

create table if not exists public.onlyevs_calendar_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  integration_id uuid not null,
  external_event_id text not null,
  external_ical_uid text,
  recurring_instance_key text,
  summary text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  source_updated_at timestamptz,
  source_revision text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'dismissed', 'cancelled', 'needs_review')),
  change_kind text check (change_kind is null or change_kind in ('schedule', 'cancel')),
  deleted_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_calendar_candidates_integration_fk
    foreign key (workspace_id, integration_id)
    references public.onlyevs_integrations(workspace_id, id) on delete cascade,
  unique nulls not distinct (
    workspace_id,
    integration_id,
    external_event_id,
    recurring_instance_key
  ),
  unique (workspace_id, id),
  check (ends_at > starts_at),
  check (char_length(summary) <= 500),
  check (char_length(timezone) between 1 and 100)
);

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
  constraint onlyevs_trips_candidate_fk
    foreign key (workspace_id, calendar_candidate_id)
    references public.onlyevs_calendar_candidates(workspace_id, id) on delete set null,
  unique (workspace_id, id),
  unique (public_token_hash),
  check (ends_at > starts_at),
  check (token_expires_at >= ends_at),
  check (char_length(guest_name) between 1 and 240),
  check (char_length(guest_email) between 3 and 320),
  check (char_length(timezone) between 1 and 100)
);

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

create table if not exists public.onlyevs_access_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  vehicle_id uuid not null,
  status text not null default 'scheduled'
    check (status in (
      'scheduled', 'issuing', 'invite_ready', 'redeemed', 'revoking', 'revoked',
      'expired', 'reauth_required', 'failed_retryable', 'failed_terminal', 'manual_review'
    )),
  issue_at timestamptz not null,
  revoke_at timestamptz not null,
  invite_expires_at timestamptz,
  provider_invitation_id text,
  provider_driver_hash text,
  provider_reconciliation jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_reconciliation) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_action_at timestamptz,
  claimed_by text,
  claim_expires_at timestamptz,
  last_error_code text,
  last_provider_request_id text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_access_grants_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade,
  constraint onlyevs_access_grants_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete restrict,
  unique (workspace_id, trip_id),
  unique (workspace_id, id),
  check (revoke_at > issue_at),
  check (invite_expires_at is null or invite_expires_at > issue_at)
);

create table if not exists private.onlyevs_access_secrets (
  grant_id uuid primary key,
  workspace_id uuid not null,
  invite_url_ciphertext text,
  actionable_driver_id_ciphertext text,
  key_version smallint not null check (key_version > 0),
  destroy_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_access_secrets_grant_fk
    foreign key (workspace_id, grant_id)
    references public.onlyevs_access_grants(workspace_id, id) on delete cascade
);

create table if not exists public.onlyevs_vehicle_stats_current (
  workspace_id uuid not null,
  vehicle_id uuid not null,
  battery_pct numeric(5,2),
  estimated_range_mi numeric(10,2),
  odometer_mi numeric(12,2),
  charging_state text,
  locked boolean,
  battery_observed_at timestamptz,
  range_observed_at timestamptz,
  odometer_observed_at timestamptz,
  charging_observed_at timestamptz,
  locked_observed_at timestamptz,
  connectivity_observed_at timestamptz,
  connectivity text not null default 'unsupported'
    check (connectivity in ('connected', 'disconnected', 'stale', 'unsupported')),
  observed_at timestamptz,
  ingested_at timestamptz not null default now(),
  source text not null default 'fleet_telemetry'
    check (source in ('fleet_telemetry', 'vehicle_data_boundary')),
  primary key (workspace_id, vehicle_id),
  constraint onlyevs_vehicle_stats_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete cascade,
  check (battery_pct is null or battery_pct between 0 and 100),
  check (estimated_range_mi is null or estimated_range_mi >= 0),
  check (odometer_mi is null or odometer_mi >= 0)
);

-- Per-VIN telemetry configuration is a durable control-plane state machine.
-- The worker compares the applied hash before POSTing because configuration is
-- an external side effect and Location is enabled only for consented windows.
create table if not exists public.onlyevs_telemetry_enrollments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null,
  integration_id uuid not null,
  status text not null default 'requested'
    check (status in ('requested', 'configuring', 'pending_sync', 'active', 'unsupported', 'error', 'removal_requested')),
  location_enabled boolean not null default false,
  applied_config_hash text,
  provider_state jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_state) = 'object'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_provider_request_id text,
  next_action_at timestamptz not null default now(),
  claimed_by text,
  claim_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, vehicle_id),
  constraint onlyevs_telemetry_vehicle_fk foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete cascade,
  constraint onlyevs_telemetry_integration_fk foreign key (workspace_id, integration_id)
    references public.onlyevs_integrations(workspace_id, id) on delete cascade,
  check (applied_config_hash is null or applied_config_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists private.onlyevs_vehicle_location_points (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  trip_id uuid not null,
  vehicle_id uuid not null,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  coordinates_ciphertext text not null,
  key_version smallint not null check (key_version > 0),
  source_message_id text not null,
  delete_after timestamptz not null,
  constraint onlyevs_location_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade,
  constraint onlyevs_location_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete cascade,
  unique (workspace_id, source_message_id),
  check (delete_after > observed_at)
);

create table if not exists public.onlyevs_integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_type text not null check (actor_type in ('owner', 'guest', 'worker', 'provider', 'system')),
  actor_id_hash text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  result text not null check (result in ('success', 'failure', 'ambiguous', 'denied')),
  provider_request_id text,
  error_code text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  check (char_length(action) between 1 and 120)
);

-- Guest-safe workspace media. Files live in the dedicated public Storage
-- bucket; this table provides tenant ownership, purpose, and cleanup state.
create table if not exists public.onlyevs_brand_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  purpose text not null check (purpose in ('logo', 'hero', 'favicon')),
  storage_path text not null unique,
  public_url text not null,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 2097152),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'orphaned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (char_length(shop_slug) between 1 and 160),
  check (storage_path like workspace_id::text || '/' || shop_slug || '/%'),
  check (public_url ~ '^https://')
);

-- Provider-controlled state for workspace custom domains. Owners may request
-- a hostname, but only the scoped worker may advance it to active after both
-- Vercel ownership and DNS routing checks succeed.
create table if not exists public.onlyevs_custom_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  hostname text not null,
  status text not null default 'requested'
    check (status in ('requested', 'pending_verification', 'pending_dns', 'active', 'error', 'removal_requested')),
  provider_project_id text,
  verification jsonb not null default '[]'::jsonb check (jsonb_typeof(verification) = 'array'),
  last_error_code text,
  last_checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  claimed_by text,
  claim_expires_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostname),
  unique (workspace_id, shop_slug, hostname),
  unique (workspace_id, id),
  check (hostname = lower(hostname)),
  check (hostname ~ '^(xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'),
  check (char_length(hostname) <= 253),
  check (char_length(shop_slug) between 1 and 160)
);

create index if not exists onlyevs_integrations_workspace_provider_idx
  on public.onlyevs_integrations (workspace_id, provider, status);
create index if not exists onlyevs_integrations_calendar_due_idx
  on public.onlyevs_integrations (next_sync_at, id)
  where provider = 'google_calendar'
    and status in ('connected', 'degraded')
    and next_sync_at is not null;
create index if not exists onlyevs_calendar_candidates_pending_idx
  on public.onlyevs_calendar_candidates (workspace_id, integration_id, starts_at)
  where status in ('pending', 'needs_review') and deleted_at is null;
create index if not exists onlyevs_trips_workspace_time_idx
  on public.onlyevs_trips (workspace_id, starts_at, ends_at);
create unique index if not exists onlyevs_trips_calendar_candidate_unique_idx
  on public.onlyevs_trips (workspace_id, calendar_candidate_id)
  where calendar_candidate_id is not null;
create index if not exists onlyevs_trips_guest_email_idx
  on public.onlyevs_trips (workspace_id, lower(guest_email));
create index if not exists onlyevs_access_grants_due_idx
  on public.onlyevs_access_grants (next_action_at, workspace_id)
  where next_action_at is not null
    and status not in ('revoked', 'expired', 'failed_terminal', 'manual_review');
create index if not exists onlyevs_access_grants_vehicle_status_idx
  on public.onlyevs_access_grants (workspace_id, vehicle_id, status);
create index if not exists onlyevs_vehicle_stats_ingested_idx
  on public.onlyevs_vehicle_stats_current (workspace_id, ingested_at desc);
create index if not exists onlyevs_telemetry_enrollments_due_idx
  on public.onlyevs_telemetry_enrollments (next_action_at, workspace_id)
  where status not in ('unsupported', 'error');
create index if not exists onlyevs_location_trip_time_idx
  on private.onlyevs_vehicle_location_points (workspace_id, trip_id, observed_at);
create index if not exists onlyevs_location_retention_idx
  on private.onlyevs_vehicle_location_points (delete_after);
create index if not exists onlyevs_audit_workspace_time_idx
  on public.onlyevs_integration_audit_events (workspace_id, created_at desc);
create index if not exists onlyevs_brand_assets_workspace_idx
  on public.onlyevs_brand_assets (workspace_id, shop_slug, purpose, created_at desc);
create index if not exists onlyevs_custom_domains_due_idx
  on public.onlyevs_custom_domains (next_check_at, id)
  where status not in ('active', 'error');

create or replace function private.touch_onlyevs_access_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  if to_jsonb(new) ? 'revision' then
    new.revision = old.revision + 1;
  end if;
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'onlyevs_integrations',
    'onlyevs_calendar_candidates',
    'onlyevs_trips',
    'onlyevs_access_grants',
    'onlyevs_telemetry_enrollments',
    'onlyevs_brand_assets',
    'onlyevs_custom_domains'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'touch_' || target, target);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_onlyevs_access_row()',
      'touch_' || target,
      target
    );
  end loop;
end $$;

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
    for update skip locked
  )
  update public.onlyevs_access_grants g
  set claimed_by = p_worker_id,
      claim_expires_at = now() + interval '2 minutes'
  from due
  where g.id = due.id
  returning g.*;
end;
$$;

create or replace function private.claim_onlyevs_due_domains(
  p_worker_id text,
  p_limit integer default 10
)
returns setof public.onlyevs_custom_domains
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 3 or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_domain_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select d.id
    from public.onlyevs_custom_domains d
    where d.next_check_at <= now()
      and d.status not in ('active', 'error')
      and (d.claim_expires_at is null or d.claim_expires_at <= now())
    order by d.next_check_at, d.id
    limit p_limit
    for update skip locked
  )
  update public.onlyevs_custom_domains d
  set claimed_by = p_worker_id,
      claim_expires_at = now() + interval '2 minutes'
  from due
  where d.id = due.id
  returning d.*;
end;
$$;

create or replace function private.claim_onlyevs_due_telemetry(
  p_worker_id text,
  p_limit integer default 25
)
returns setof public.onlyevs_telemetry_enrollments
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 3 or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_telemetry_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select e.workspace_id, e.vehicle_id
    from public.onlyevs_telemetry_enrollments e
    where e.next_action_at <= now()
      and e.status not in ('unsupported', 'error')
      and (e.claim_expires_at is null or e.claim_expires_at <= now())
    order by e.next_action_at, e.workspace_id, e.vehicle_id
    limit p_limit
    for update skip locked
  )
  update public.onlyevs_telemetry_enrollments e
  set claimed_by = p_worker_id, claim_expires_at = now() + interval '2 minutes'
  from due
  where e.workspace_id = due.workspace_id and e.vehicle_id = due.vehicle_id
  returning e.*;
end;
$$;

create or replace function private.claim_onlyevs_due_calendar(
  p_worker_id text,
  p_limit integer default 10
)
returns setof public.onlyevs_integrations
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 3 or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid_calendar_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select i.id
    from public.onlyevs_integrations i
    where i.provider = 'google_calendar'
      and i.status in ('connected', 'degraded')
      and i.next_sync_at <= now()
      and (i.claim_expires_at is null or i.claim_expires_at <= now())
    order by i.next_sync_at, i.id
    limit p_limit
    for update skip locked
  )
  update public.onlyevs_integrations i
  set claimed_by = p_worker_id,
      claim_expires_at = now() + interval '2 minutes'
  from due
  where i.id = due.id
  returning i.*;
end;
$$;

create or replace function public.request_onlyevs_custom_domain(
  p_workspace_id uuid,
  p_shop_slug text,
  p_hostname text
)
returns public.onlyevs_custom_domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.onlyevs_custom_domains;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_branding b
    where b.workspace_id = p_workspace_id and b.shop_slug = p_shop_slug
  ) then
    raise exception 'workspace_shop_not_found' using errcode = 'P0002';
  end if;
  if p_hostname <> lower(p_hostname)
    or char_length(p_hostname) > 253
    or p_hostname !~ '^(xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'invalid_custom_hostname' using errcode = '22023';
  end if;
  insert into public.onlyevs_custom_domains (workspace_id, shop_slug, hostname)
  values (p_workspace_id, p_shop_slug, p_hostname)
  returning * into result;
  return result;
end;
$$;

create or replace function public.request_onlyevs_custom_domain_removal(
  p_domain_id uuid,
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  update public.onlyevs_custom_domains
  set status = 'removal_requested', next_check_at = now(),
      claimed_by = null, claim_expires_at = null
  where id = p_domain_id and workspace_id = p_workspace_id;
  if not found then raise exception 'custom_domain_not_found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.complete_onlyevs_integration(
  p_workspace_id uuid,
  p_shop_slug text,
  p_provider text,
  p_account_label text,
  p_granted_scopes text[],
  p_region_base_url text,
  p_selected_calendar_id text,
  p_selected_calendar_timezone text,
  p_provider_subject_ciphertext text,
  p_refresh_token_ciphertext text,
  p_key_version smallint,
  p_token_expires_at timestamptz
)
returns public.onlyevs_integrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  integration public.onlyevs_integrations;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin') then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;
  if p_provider not in ('tesla', 'google_calendar') then
    raise exception 'unsupported_provider' using errcode = '22023';
  end if;
  if char_length(coalesce(p_provider_subject_ciphertext, '')) < 32
    or char_length(coalesce(p_refresh_token_ciphertext, '')) < 32
    or p_key_version < 1 then
    raise exception 'invalid_encrypted_credentials' using errcode = '22023';
  end if;

  insert into public.onlyevs_integrations (
    workspace_id,
    shop_slug,
    provider,
    status,
    account_label,
    granted_scopes,
    region_base_url,
    selected_calendar_id,
    selected_calendar_timezone,
    last_sync_at,
    next_sync_at,
    last_error_code
  ) values (
    p_workspace_id,
    p_shop_slug,
    p_provider,
    'connected',
    nullif(btrim(p_account_label), ''),
    coalesce(p_granted_scopes, '{}'),
    p_region_base_url,
    p_selected_calendar_id,
    p_selected_calendar_timezone,
    case when p_provider = 'google_calendar' then now() else null end,
    case when p_provider = 'google_calendar' then now() + interval '15 minutes' else null end,
    null
  )
  on conflict (workspace_id, shop_slug, provider) do update set
    status = 'connected',
    account_label = excluded.account_label,
    granted_scopes = excluded.granted_scopes,
    region_base_url = excluded.region_base_url,
    selected_calendar_id = excluded.selected_calendar_id,
    selected_calendar_timezone = excluded.selected_calendar_timezone,
    last_sync_at = excluded.last_sync_at,
    next_sync_at = excluded.next_sync_at,
    claimed_by = null,
    claim_expires_at = null,
    last_error_code = null
  returning * into integration;

  insert into private.onlyevs_integration_credentials (
    integration_id,
    workspace_id,
    provider_subject_ciphertext,
    refresh_token_ciphertext,
    key_version,
    token_expires_at,
    last_refresh_at
  ) values (
    integration.id,
    p_workspace_id,
    p_provider_subject_ciphertext,
    p_refresh_token_ciphertext,
    p_key_version,
    p_token_expires_at,
    now()
  )
  on conflict (integration_id) do update set
    provider_subject_ciphertext = excluded.provider_subject_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    key_version = excluded.key_version,
    rotation_version = private.onlyevs_integration_credentials.rotation_version + 1,
    token_expires_at = excluded.token_expires_at,
    last_refresh_at = now(),
    updated_at = now();

  return integration;
end;
$$;

create or replace function public.create_onlyevs_owner_import_session(
  p_workspace_id uuid,
  p_shop_slug text,
  p_token_hash text,
  p_profile jsonb,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null
    or not public.has_minimum_role(p_workspace_id, v_user_id, 'admin') then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_branding b
    where b.workspace_id = p_workspace_id and b.shop_slug = p_shop_slug
  ) then
    raise exception 'workspace_shop_not_found' using errcode = 'P0002';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '20 minutes'
    or jsonb_typeof(p_profile) <> 'object'
    or jsonb_typeof(p_profile -> 'vehicles') <> 'array'
    or jsonb_array_length(p_profile -> 'vehicles') > 500
    or pg_column_size(p_profile) > 1048576 then
    raise exception 'invalid_owner_import_session' using errcode = '22023';
  end if;

  delete from private.onlyevs_owner_import_sessions s
  where s.expires_at <= now()
    or (
      s.owner_user_id = v_user_id
      and s.workspace_id = p_workspace_id
      and s.shop_slug = p_shop_slug
    );
  insert into private.onlyevs_owner_import_sessions (
    workspace_id, shop_slug, owner_user_id, token_hash, profile, expires_at
  ) values (
    p_workspace_id, p_shop_slug, v_user_id, p_token_hash, p_profile, p_expires_at
  );
end;
$$;

create or replace function public.get_onlyevs_owner_import_profile(p_token_hash text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select s.profile
  from private.onlyevs_owner_import_sessions s
  where s.token_hash = p_token_hash
    and s.owner_user_id = (select auth.uid())
    and s.expires_at > now()
    and public.has_minimum_role(s.workspace_id, (select auth.uid()), 'admin')
  limit 1;
$$;

create or replace function public.delete_onlyevs_owner_import_session(p_token_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.onlyevs_owner_import_sessions s
  where s.token_hash = p_token_hash
    and s.owner_user_id = (select auth.uid());
$$;

create or replace function public.disconnect_onlyevs_integration(
  p_workspace_id uuid,
  p_shop_slug text,
  p_provider text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin') then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;

  select i.id into v_integration_id
  from public.onlyevs_integrations i
  where i.workspace_id = p_workspace_id
    and i.shop_slug = p_shop_slug
    and i.provider = p_provider
  for update;

  if v_integration_id is null then return; end if;
  if p_provider = 'tesla' and exists (
    select 1
    from public.onlyevs_access_grants g
    join public.onlyevs_trips t
      on t.workspace_id = g.workspace_id and t.id = g.trip_id
    where g.workspace_id = p_workspace_id
      and t.shop_slug = p_shop_slug
      and g.status not in ('revoked', 'expired', 'failed_terminal')
  ) then
    raise exception 'active_access_grants_must_be_revoked_first' using errcode = '55000';
  end if;
  if p_provider = 'tesla' then
    update public.onlyevs_telemetry_enrollments e
    set status = 'removal_requested', next_action_at = now(),
        claimed_by = null, claim_expires_at = null
    where e.workspace_id = p_workspace_id and e.integration_id = v_integration_id;
    if found then
      update public.onlyevs_integrations i
      set status = 'disconnecting', last_error_code = null
      where i.id = v_integration_id;
      return;
    end if;
  elsif p_provider = 'google_calendar' then
    update public.onlyevs_calendar_candidates c
    set status = 'dismissed', deleted_at = coalesce(c.deleted_at, now())
    where c.workspace_id = p_workspace_id
      and c.integration_id = v_integration_id
      and c.status in ('pending', 'needs_review');
  end if;
  delete from private.onlyevs_integration_credentials c
  where c.integration_id = v_integration_id;
  update public.onlyevs_integrations i
  set status = 'disconnected',
      account_label = null,
      granted_scopes = '{}',
      region_base_url = null,
      next_sync_at = null,
      claimed_by = null,
      claim_expires_at = null,
      last_error_code = null
  where i.id = v_integration_id;
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
declare
  candidate_count integer;
begin
  if not (
    ((select auth.uid()) is not null
      and public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin'))
    or pg_has_role(session_user, 'onlyevs_worker', 'member')
  ) then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 1000 then
    raise exception 'invalid_candidate_batch' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.onlyevs_integrations i
    where i.id = p_integration_id
      and i.workspace_id = p_workspace_id
      and i.shop_slug = p_shop_slug
      and i.provider = 'google_calendar'
      and i.status in ('connected', 'degraded')
  ) then
    raise exception 'calendar_integration_not_connected' using errcode = '22023';
  end if;

  with source as (
    select *
    from jsonb_to_recordset(p_candidates) as x(
      external_event_id text,
      external_ical_uid text,
      recurring_instance_key text,
      summary text,
      starts_at timestamptz,
      ends_at timestamptz,
      timezone text,
      source_updated_at timestamptz,
      source_revision text,
      status text,
      deleted_at timestamptz
    )
  ), upserted as (
    insert into public.onlyevs_calendar_candidates (
      workspace_id,
      shop_slug,
      integration_id,
      external_event_id,
      external_ical_uid,
      recurring_instance_key,
      summary,
      starts_at,
      ends_at,
      timezone,
      source_updated_at,
      source_revision,
      status,
      deleted_at
    )
    select
      p_workspace_id,
      p_shop_slug,
      p_integration_id,
      s.external_event_id,
      s.external_ical_uid,
      s.recurring_instance_key,
      s.summary,
      s.starts_at,
      s.ends_at,
      s.timezone,
      s.source_updated_at,
      s.source_revision,
      case when s.status = 'cancelled' then 'cancelled' else 'pending' end,
      s.deleted_at
    from source s
    where s.external_event_id is not null
      and s.ends_at > s.starts_at
      and char_length(s.summary) <= 500
      and char_length(s.timezone) between 1 and 100
    on conflict (
      workspace_id,
      integration_id,
      external_event_id,
      recurring_instance_key
    ) do update set
      external_ical_uid = excluded.external_ical_uid,
      summary = excluded.summary,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      timezone = excluded.timezone,
      source_updated_at = excluded.source_updated_at,
      source_revision = excluded.source_revision,
      status = case
        when excluded.status = 'cancelled'
          and public.onlyevs_calendar_candidates.status = 'confirmed'
          then 'needs_review'
        when excluded.status = 'cancelled' then 'cancelled'
        when public.onlyevs_calendar_candidates.status = 'confirmed'
          and (
            public.onlyevs_calendar_candidates.starts_at <> excluded.starts_at
            or public.onlyevs_calendar_candidates.ends_at <> excluded.ends_at
          ) then 'needs_review'
        else public.onlyevs_calendar_candidates.status
      end,
      change_kind = case
        when excluded.status = 'cancelled'
          and public.onlyevs_calendar_candidates.status in ('confirmed', 'needs_review')
          then 'cancel'
        when public.onlyevs_calendar_candidates.status in ('confirmed', 'needs_review')
          and (
            public.onlyevs_calendar_candidates.starts_at <> excluded.starts_at
            or public.onlyevs_calendar_candidates.ends_at <> excluded.ends_at
          ) then 'schedule'
        else public.onlyevs_calendar_candidates.change_kind
      end,
      deleted_at = case
        when excluded.status = 'cancelled'
          and public.onlyevs_calendar_candidates.status = 'confirmed'
          then null
        else excluded.deleted_at
      end
    returning 1
  )
  select count(*) into candidate_count from upserted;

  update public.onlyevs_integrations
  set status = 'connected', last_sync_at = now(),
      next_sync_at = now() + interval '15 minutes',
      claimed_by = null, claim_expires_at = null,
      last_error_code = null
  where id = p_integration_id and workspace_id = p_workspace_id;
  return candidate_count;
end;
$$;

create or replace function public.confirm_onlyevs_calendar_candidate(
  p_candidate_id uuid,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_public_token_hash text,
  p_token_expires_at timestamptz
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
  select * into candidate
  from public.onlyevs_calendar_candidates c
  where c.id = p_candidate_id
  for update;
  if candidate.id is null then
    raise exception 'calendar_candidate_not_found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(candidate.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if candidate.status not in ('pending', 'needs_review') or candidate.deleted_at is not null then
    raise exception 'calendar_candidate_not_confirmable' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.onlyevs_trips t
    where t.workspace_id = candidate.workspace_id
      and t.calendar_candidate_id = candidate.id
  ) then
    -- Never create a second trip/access lifecycle from a changed provider
    -- event. Existing-trip schedule edits need their own explicit lifecycle
    -- transition so issued access cannot be silently extended.
    raise exception 'calendar_schedule_change_requires_manual_review' using errcode = '55000';
  end if;
  if char_length(btrim(p_guest_name)) not between 1 and 240
    or char_length(btrim(p_guest_email)) not between 3 and 320
    or position('@' in p_guest_email) < 2
    or char_length(p_public_token_hash) <> 64
    or p_token_expires_at < candidate.ends_at then
    raise exception 'invalid_trip_confirmation' using errcode = '22023';
  end if;

  insert into public.onlyevs_trips (
    workspace_id,
    shop_slug,
    calendar_candidate_id,
    vehicle_id,
    guest_name,
    guest_email,
    timezone,
    starts_at,
    ends_at,
    public_token_hash,
    token_expires_at
  ) values (
    candidate.workspace_id,
    candidate.shop_slug,
    candidate.id,
    p_vehicle_id,
    btrim(p_guest_name),
    lower(btrim(p_guest_email)),
    candidate.timezone,
    candidate.starts_at,
    candidate.ends_at,
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

  insert into public.onlyevs_access_grants (
    workspace_id,
    trip_id,
    vehicle_id,
    issue_at,
    revoke_at,
    next_action_at
  ) values (
    trip.workspace_id,
    trip.id,
    trip.vehicle_id,
    trip.starts_at - interval '2 hours',
    trip.ends_at + interval '1 hour',
    trip.starts_at - interval '2 hours'
  );

  update public.onlyevs_calendar_candidates
  set status = 'confirmed'
  where id = candidate.id;
  return trip;
exception
  when exclusion_violation then
    raise exception 'vehicle_schedule_conflict' using errcode = '23P01';
end;
$$;

create or replace function public.dismiss_onlyevs_calendar_candidate(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.onlyevs_calendar_candidates;
begin
  select * into candidate
  from public.onlyevs_calendar_candidates c
  where c.id = p_candidate_id
  for update;
  if candidate.id is null then return; end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(candidate.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if candidate.status in ('pending', 'needs_review') then
    update public.onlyevs_calendar_candidates set status = 'dismissed' where id = candidate.id;
  end if;
end;
$$;

create or replace function public.resolve_onlyevs_calendar_candidate_change(
  p_candidate_id uuid,
  p_action text
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.onlyevs_calendar_candidates;
  trip public.onlyevs_trips;
  next_issue_at timestamptz;
  next_revoke_at timestamptz;
begin
  if p_action not in ('apply', 'cancel') then
    raise exception 'invalid_calendar_change_action' using errcode = '22023';
  end if;
  select * into candidate
  from public.onlyevs_calendar_candidates c
  where c.id = p_candidate_id
  for update;
  if candidate.id is null then
    raise exception 'calendar_candidate_not_found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(candidate.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if candidate.status <> 'needs_review' then
    raise exception 'calendar_candidate_not_in_review' using errcode = '55000';
  end if;
  select * into trip
  from public.onlyevs_trips t
  where t.workspace_id = candidate.workspace_id
    and t.calendar_candidate_id = candidate.id
  for update;
  if trip.id is null then
    raise exception 'calendar_trip_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'cancel' then
    update public.onlyevs_trips t
    set status = 'cancelled', schedule_version = t.schedule_version + 1,
        revision = t.revision + 1, updated_at = now()
    where t.id = trip.id
    returning * into trip;

    update public.onlyevs_access_grants g
    set status = case
          when g.provider_invitation_id is null then 'expired'
          else g.status
        end,
        revoke_at = case
          when g.status in ('revoked', 'expired', 'failed_terminal') then g.revoke_at
          else greatest(now(), g.issue_at + interval '1 second')
        end,
        next_action_at = case
          when g.status in ('revoked', 'expired', 'failed_terminal') then null
          when g.provider_invitation_id is null then null
          else now()
        end,
        claimed_by = null, claim_expires_at = null,
        revision = g.revision + 1, updated_at = now()
    where g.workspace_id = trip.workspace_id and g.trip_id = trip.id;
    update public.onlyevs_calendar_candidates
    set status = 'cancelled', change_kind = null, deleted_at = now(),
        revision = revision + 1, updated_at = now()
    where id = candidate.id;
    return trip;
  end if;

  if candidate.change_kind = 'cancel' then
    raise exception 'cancelled_calendar_event_cannot_be_rescheduled' using errcode = '55000';
  end if;
  next_issue_at := candidate.starts_at - interval '2 hours';
  next_revoke_at := candidate.ends_at + interval '1 hour';
  update public.onlyevs_trips t
  set starts_at = candidate.starts_at,
      ends_at = candidate.ends_at,
      timezone = candidate.timezone,
      token_expires_at = greatest(t.token_expires_at, candidate.ends_at + interval '24 hours'),
      schedule_version = t.schedule_version + 1,
      status = case
        when candidate.ends_at <= now() then 'completed'
        when candidate.starts_at <= now() then 'active'
        else 'confirmed'
      end,
      revision = t.revision + 1,
      updated_at = now()
  where t.id = trip.id
  returning * into trip;

  update public.onlyevs_access_grants g
  set status = case
        when g.status = 'issuing' and g.provider_invitation_id is null then 'scheduled'
        else g.status
      end,
      issue_at = next_issue_at,
      revoke_at = next_revoke_at,
      next_action_at = case
        when g.status in ('revoked', 'expired', 'failed_terminal') then null
        when g.status in ('scheduled', 'issuing', 'failed_retryable', 'reauth_required')
          then greatest(now(), next_issue_at)
        else greatest(now(), next_revoke_at)
      end,
      claimed_by = null,
      claim_expires_at = null,
      revision = g.revision + 1,
      updated_at = now()
  where g.workspace_id = trip.workspace_id and g.trip_id = trip.id;
  update public.onlyevs_calendar_candidates
  set status = 'confirmed', change_kind = null, deleted_at = null,
      revision = revision + 1, updated_at = now()
  where id = candidate.id;
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
    coalesce(b.display_name, w.name),
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
    and char_length(p_public_token_hash) = 64
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

create or replace function public.complete_onlyevs_guest_onboarding(
  p_public_token_hash text,
  p_access_consent boolean,
  p_tesla_subject_hmac text
)
returns public.onlyevs_access_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
  grant_row public.onlyevs_access_grants;
begin
  if (select auth.uid()) is null
    or p_access_consent is not true
    or char_length(coalesce(p_tesla_subject_hmac, '')) <> 64 then
    raise exception 'guest_consent_required' using errcode = '42501';
  end if;
  select * into trip from public.onlyevs_trips t
  where t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
  for update;
  if trip.id is null then raise exception 'trip_invitation_expired' using errcode = 'P0002'; end if;
  update private.onlyevs_guest_bindings b
  set consented_at = coalesce(b.consented_at, now()),
      onboarding_completed_at = coalesce(b.onboarding_completed_at, now()),
      tesla_subject_hmac = p_tesla_subject_hmac,
      updated_at = now()
  where b.workspace_id = trip.workspace_id
    and b.trip_id = trip.id
    and b.supabase_user_id = (select auth.uid())
    and b.bound_at is not null;
  if not found then raise exception 'guest_binding_required' using errcode = '42501'; end if;
  select * into grant_row from public.onlyevs_access_grants g
  where g.workspace_id = trip.workspace_id and g.trip_id = trip.id;
  return grant_row;
end;
$$;

create or replace function public.get_onlyevs_ready_invite(p_public_token_hash text)
returns table (
  grant_id uuid,
  workspace_id uuid,
  shop_slug text,
  invite_url_ciphertext text,
  key_version smallint
)
language sql
security definer
set search_path = ''
stable
as $$
  select g.id, g.workspace_id, t.shop_slug, s.invite_url_ciphertext, s.key_version
  from public.onlyevs_trips t
  join private.onlyevs_guest_bindings b
    on b.workspace_id = t.workspace_id and b.trip_id = t.id
  join public.onlyevs_access_grants g
    on g.workspace_id = t.workspace_id and g.trip_id = t.id
  join private.onlyevs_access_secrets s
    on s.workspace_id = g.workspace_id and s.grant_id = g.id
  where (select auth.uid()) is not null
    and t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and b.supabase_user_id = (select auth.uid())
    and b.bound_at is not null
    and b.consented_at is not null
    and b.onboarding_completed_at is not null
    and g.status = 'invite_ready'
    and g.issue_at <= now()
    and g.revoke_at > now()
    and s.invite_url_ciphertext is not null
    and (s.destroy_after is null or s.destroy_after > now());
$$;

revoke all on function private.claim_onlyevs_due_access_grants(text, integer) from public;
revoke all on function private.claim_onlyevs_due_domains(text, integer) from public;
revoke all on function private.claim_onlyevs_due_telemetry(text, integer) from public;
revoke all on function private.claim_onlyevs_due_calendar(text, integer) from public;
revoke all on function public.request_onlyevs_custom_domain(uuid, text, text) from public;
revoke all on function public.request_onlyevs_custom_domain_removal(uuid, uuid) from public;
revoke all on function public.complete_onlyevs_integration(
  uuid, text, text, text, text[], text, text, text, text, text, smallint, timestamptz
) from public;
revoke all on function public.create_onlyevs_owner_import_session(
  uuid, text, text, jsonb, timestamptz
) from public;
revoke all on function public.get_onlyevs_owner_import_profile(text) from public;
revoke all on function public.delete_onlyevs_owner_import_session(text) from public;
revoke all on function public.disconnect_onlyevs_integration(uuid, text, text) from public;
revoke all on function public.ingest_onlyevs_calendar_candidates(uuid, text, uuid, jsonb) from public;
revoke all on function public.confirm_onlyevs_calendar_candidate(
  uuid, uuid, text, text, text, timestamptz
) from public;
revoke all on function public.dismiss_onlyevs_calendar_candidate(uuid) from public;
revoke all on function public.resolve_onlyevs_calendar_candidate_change(uuid, text) from public;
revoke all on function public.get_onlyevs_trip_invitation(text) from public;
revoke all on function public.onlyevs_trip_email_matches(text, text) from public;
revoke all on function public.bind_onlyevs_trip_guest(text) from public;
revoke all on function public.complete_onlyevs_guest_onboarding(text, boolean, text) from public;
revoke all on function public.get_onlyevs_ready_invite(text) from public;
grant execute on function public.complete_onlyevs_integration(
  uuid, text, text, text, text[], text, text, text, text, text, smallint, timestamptz
) to authenticated;
grant execute on function public.create_onlyevs_owner_import_session(
  uuid, text, text, jsonb, timestamptz
) to authenticated;
grant execute on function public.get_onlyevs_owner_import_profile(text) to authenticated;
grant execute on function public.delete_onlyevs_owner_import_session(text) to authenticated;
grant execute on function public.disconnect_onlyevs_integration(uuid, text, text) to authenticated;
grant execute on function public.ingest_onlyevs_calendar_candidates(uuid, text, uuid, jsonb)
  to authenticated;
grant execute on function public.confirm_onlyevs_calendar_candidate(
  uuid, uuid, text, text, text, timestamptz
) to authenticated;
grant execute on function public.dismiss_onlyevs_calendar_candidate(uuid) to authenticated;
grant execute on function public.resolve_onlyevs_calendar_candidate_change(uuid, text) to authenticated;
grant execute on function public.get_onlyevs_trip_invitation(text) to anon, authenticated;
grant execute on function public.onlyevs_trip_email_matches(text, text) to anon, authenticated;
grant execute on function public.bind_onlyevs_trip_guest(text) to authenticated;
grant execute on function public.complete_onlyevs_guest_onboarding(text, boolean, text) to authenticated;
grant execute on function public.get_onlyevs_ready_invite(text) to authenticated;
grant execute on function public.request_onlyevs_custom_domain(uuid, text, text) to authenticated;
grant execute on function public.request_onlyevs_custom_domain_removal(uuid, uuid) to authenticated;
revoke all on public.onlyevs_integrations,
  public.onlyevs_calendar_candidates,
  public.onlyevs_trips,
  public.onlyevs_access_grants,
  public.onlyevs_telemetry_enrollments,
  public.onlyevs_vehicle_stats_current,
  public.onlyevs_integration_audit_events,
  public.onlyevs_brand_assets,
  public.onlyevs_custom_domains from public, anon, authenticated;
grant select on public.onlyevs_integrations,
  public.onlyevs_calendar_candidates,
  public.onlyevs_trips,
  public.onlyevs_access_grants,
  public.onlyevs_telemetry_enrollments,
  public.onlyevs_vehicle_stats_current,
  public.onlyevs_integration_audit_events to authenticated;
grant usage on schema private to onlyevs_worker;
grant select, insert, update on public.onlyevs_integrations,
  public.onlyevs_calendar_candidates,
  public.onlyevs_trips,
  public.onlyevs_access_grants,
  public.onlyevs_telemetry_enrollments,
  public.onlyevs_vehicle_stats_current,
  public.onlyevs_integration_audit_events,
  public.onlyevs_vehicles to onlyevs_worker;
grant delete on public.onlyevs_calendar_candidates,
  public.onlyevs_telemetry_enrollments to onlyevs_worker;
grant select, insert, update, delete on private.onlyevs_integration_credentials,
  private.onlyevs_guest_bindings,
  private.onlyevs_access_secrets,
  private.onlyevs_vehicle_location_points to onlyevs_worker;
grant execute on function private.claim_onlyevs_due_access_grants(text, integer) to onlyevs_worker;
grant execute on function private.claim_onlyevs_due_domains(text, integer) to onlyevs_worker;
grant execute on function private.claim_onlyevs_due_telemetry(text, integer) to onlyevs_worker;
grant execute on function private.claim_onlyevs_due_calendar(text, integer) to onlyevs_worker;
grant execute on function public.ingest_onlyevs_calendar_candidates(uuid, text, uuid, jsonb)
  to onlyevs_worker;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onlyevs-brand-assets',
  'onlyevs-brand-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant select, insert, update, delete on public.onlyevs_brand_assets to authenticated;
grant select on public.onlyevs_custom_domains to authenticated;
revoke all on public.onlyevs_custom_domains from anon;
grant select (workspace_id, shop_slug, hostname, status)
  on public.onlyevs_custom_domains to anon;
grant select, insert, update, delete on public.onlyevs_brand_assets,
  public.onlyevs_custom_domains to onlyevs_worker;
grant select on public.onlyevs_vehicles to onlyevs_worker;

alter table public.onlyevs_integrations enable row level security;
alter table public.onlyevs_calendar_candidates enable row level security;
alter table public.onlyevs_trips enable row level security;
alter table public.onlyevs_access_grants enable row level security;
alter table public.onlyevs_telemetry_enrollments enable row level security;
alter table public.onlyevs_vehicle_stats_current enable row level security;
alter table public.onlyevs_integration_audit_events enable row level security;
alter table public.onlyevs_brand_assets enable row level security;
alter table public.onlyevs_custom_domains enable row level security;

create policy onlyevs_integrations_managers_select on public.onlyevs_integrations
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_candidates_managers_select on public.onlyevs_calendar_candidates
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_trips_managers_select on public.onlyevs_trips
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_access_grants_managers_select on public.onlyevs_access_grants
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_vehicle_stats_managers_select on public.onlyevs_vehicle_stats_current
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_telemetry_managers_select on public.onlyevs_telemetry_enrollments
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_audit_managers_select on public.onlyevs_integration_audit_events
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_brand_assets_managers_all on public.onlyevs_brand_assets
  for all to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')))
  with check ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_custom_domains_managers_select on public.onlyevs_custom_domains
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_custom_domains_public_active on public.onlyevs_custom_domains
  for select to anon
  using (status = 'active');

-- The worker role has no global BYPASSRLS privilege. Its access is limited to
-- these tables by ordinary grants plus these table-scoped policies.
create policy onlyevs_integrations_worker_all on public.onlyevs_integrations
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_candidates_worker_all on public.onlyevs_calendar_candidates
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_trips_worker_all on public.onlyevs_trips
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_access_grants_worker_all on public.onlyevs_access_grants
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_vehicle_stats_worker_all on public.onlyevs_vehicle_stats_current
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_telemetry_worker_all on public.onlyevs_telemetry_enrollments
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_audit_worker_all on public.onlyevs_integration_audit_events
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_brand_assets_worker_all on public.onlyevs_brand_assets
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_custom_domains_worker_all on public.onlyevs_custom_domains
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_vehicles_worker_select on public.onlyevs_vehicles
  for select to onlyevs_worker using (true);

-- Owners can upload only beneath their own workspace/shop prefix. Raster-only
-- bucket MIME and size constraints are enforced again by Storage itself.
create policy onlyevs_brand_storage_managers_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'onlyevs-brand-assets'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (select public.has_minimum_role(((storage.foldername(name))[1])::uuid, (select auth.uid()), 'manager'))
  );
create policy onlyevs_brand_storage_managers_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'onlyevs-brand-assets'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (select public.has_minimum_role(((storage.foldername(name))[1])::uuid, (select auth.uid()), 'manager'))
  )
  with check (
    bucket_id = 'onlyevs-brand-assets'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (select public.has_minimum_role(((storage.foldername(name))[1])::uuid, (select auth.uid()), 'manager'))
  );
create policy onlyevs_brand_storage_managers_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'onlyevs-brand-assets'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (select public.has_minimum_role(((storage.foldername(name))[1])::uuid, (select auth.uid()), 'manager'))
  );

revoke all on private.onlyevs_integration_credentials,
  private.onlyevs_owner_import_sessions,
  private.onlyevs_guest_bindings,
  private.onlyevs_access_secrets,
  private.onlyevs_vehicle_location_points from anon, authenticated;

comment on role onlyevs_worker is
  'NOLOGIN privilege group for the evhost.app worker; provision a separate LOGIN role out-of-band and grant this role.';
comment on table private.onlyevs_vehicle_location_points is
  'Application-envelope-encrypted trip locations; provider-observed timestamps are privacy-window checked before insert.';
comment on table private.onlyevs_owner_import_sessions is
  'Short-lived owner-scoped Tesla import profiles; browsers hold only an opaque random handle.';
