-- Vehicle Telemetry & Trip Evidence Ledger.
-- Additive only; extends the onlyevs_* streaming/access-lifecycle objects
-- introduced in 20260814193000_onlyevs_access_lifecycle.sql without editing
-- that file. Adds: append-only telemetry history (Phase 1), trip bookends
-- (Phase 2), vehicle home-area evidence fields (Phase 4), immutable trip
-- evidence packets (Phase 6), and durable guest identity (Phase 7).

-- =====================================================================
-- Phase 1 — append-only telemetry history
-- =====================================================================

-- One row per ingested telemetry message (source_message_id), carrying
-- whichever baseline fields that message contained. Unlike
-- onlyevs_vehicle_stats_current (monotonic, 24h age guard, one row per
-- vehicle), history is append-only and accepts late events up to the
-- HISTORY_LATE_EVENT_BACKFILL_MS window (lib/owner/telemetry-policy.ts) so a
-- collector/Kafka outage can be safely backfilled — the unique
-- source_message_id makes redelivery idempotent. Raw rows are retained for
-- the full HISTORY_RETENTION_MS window (13 months); no write-side
-- downsampling — raw history is evidence. Location is never stored here.
create table if not exists public.onlyevs_vehicle_stats_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  battery_pct numeric(5,2),
  estimated_range_mi numeric(10,2),
  odometer_mi numeric(12,2),
  charging_state text,
  locked boolean,
  source_message_id text not null,
  delete_after timestamptz not null,
  constraint onlyevs_stats_history_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete cascade,
  unique (workspace_id, source_message_id),
  check (battery_pct is null or battery_pct between 0 and 100),
  check (estimated_range_mi is null or estimated_range_mi >= 0),
  check (odometer_mi is null or odometer_mi >= 0),
  check (delete_after > observed_at)
);

create index if not exists onlyevs_stats_history_workspace_vehicle_time_idx
  on public.onlyevs_vehicle_stats_history (workspace_id, vehicle_id, observed_at);
create index if not exists onlyevs_stats_history_retention_idx
  on public.onlyevs_vehicle_stats_history (delete_after);

-- =====================================================================
-- Phase 2 — trip bookends
-- =====================================================================

-- Start/end vehicle-state snapshots per trip. A table, not trip columns, so
-- the idempotency rules (start: first-write-wins; end: latest-write-wins
-- until the trip completes or the ends_at + grace cap) are enforced at the
-- DB level by unique(trip_id, edge) rather than by application logic alone.
-- No location data lives here, so reading it never touches the envelope
-- decryption path.
create table if not exists private.onlyevs_trip_bookends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  trip_id uuid not null,
  edge text not null check (edge in ('start', 'end')),
  odometer_mi numeric(12,2),
  odometer_observed_at timestamptz,
  battery_pct numeric(5,2),
  battery_observed_at timestamptz,
  captured_at timestamptz not null default now(),
  stale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_trip_bookends_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade,
  unique (trip_id, edge),
  check (odometer_mi is null or odometer_mi >= 0),
  check (battery_pct is null or battery_pct between 0 and 100)
);

create index if not exists onlyevs_trip_bookends_workspace_idx
  on private.onlyevs_trip_bookends (workspace_id, trip_id);

create trigger touch_onlyevs_trip_bookends
  before update on private.onlyevs_trip_bookends
  for each row execute function private.touch_onlyevs_access_row();

-- =====================================================================
-- Phase 4 — vehicle home-area evidence fields
-- =====================================================================

-- Optional per-vehicle home area (never guest-visible; onlyevs_vehicles is
-- already manager-RLS-gated only). Out-of-area is haversine(current, center)
-- > radius, computed application-side after location ciphertext is
-- decrypted server-side; these columns hold only the plaintext center/radius
-- an owner configures, never a streamed position.
alter table public.onlyevs_vehicles
  add column if not exists home_area_center_lat numeric(9,6),
  add column if not exists home_area_center_lng numeric(9,6),
  add column if not exists home_area_radius_mi numeric(6,1);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_vehicles_home_area_lat_range'
      and conrelid = 'public.onlyevs_vehicles'::regclass
  ) then
    alter table public.onlyevs_vehicles add constraint onlyevs_vehicles_home_area_lat_range
      check (home_area_center_lat is null or home_area_center_lat between -90 and 90);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_vehicles_home_area_lng_range'
      and conrelid = 'public.onlyevs_vehicles'::regclass
  ) then
    alter table public.onlyevs_vehicles add constraint onlyevs_vehicles_home_area_lng_range
      check (home_area_center_lng is null or home_area_center_lng between -180 and 180);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_vehicles_home_area_radius_positive'
      and conrelid = 'public.onlyevs_vehicles'::regclass
  ) then
    alter table public.onlyevs_vehicles add constraint onlyevs_vehicles_home_area_radius_positive
      check (home_area_radius_mi is null or home_area_radius_mi > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_vehicles_home_area_lat_lng_paired'
      and conrelid = 'public.onlyevs_vehicles'::regclass
  ) then
    alter table public.onlyevs_vehicles add constraint onlyevs_vehicles_home_area_lat_lng_paired
      check ((home_area_center_lat is null) = (home_area_center_lng is null));
  end if;
end $$;

-- Owner-editable battery capacity (kWh), same additive column pattern as the
-- home-area fields above. Never guest-visible (onlyevs_vehicles is already
-- manager-RLS-gated only). Feeds charge-session kWh-from-delta derivation
-- (lib/owner/charge-sessions.ts's kWhFromBatteryDelta) when set; sessions
-- render without a kWh-from-delta fallback when unset, never a guessed
-- capacity.
alter table public.onlyevs_vehicles
  add column if not exists battery_capacity_kwh numeric(6,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_vehicles_battery_capacity_positive'
      and conrelid = 'public.onlyevs_vehicles'::regclass
  ) then
    alter table public.onlyevs_vehicles add constraint onlyevs_vehicles_battery_capacity_positive
      check (battery_capacity_kwh is null or battery_capacity_kwh > 0);
  end if;
end $$;

-- =====================================================================
-- Phase 3 — charging cost attribution support columns/tables
-- (remediation: workspace $/kWh rate column + synced charging invoices)
-- =====================================================================

-- Owner-configured $/kWh for pricing home/AC sessions
-- (lib/owner/charge-sessions.ts's reconcileHomeRateCost, costProvenance:
-- 'rate'). Lives on workspace_branding rather than a new table because it is
-- one scalar per workspace, same operational-data home as other owner-only
-- settings on this row; it is never read by TenantConfigProvider's guest
-- path (that provider explicit-selects its own column list, verified in
-- components/owner/cost-rate-setting.tsx's header comment) so an unrelated
-- private column here is inert to guest-facing config, never leaked.
alter table public.workspace_branding
  add column if not exists home_charge_rate_usd_per_kwh numeric(6,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_branding_home_charge_rate_positive'
      and conrelid = 'public.workspace_branding'::regclass
  ) then
    alter table public.workspace_branding add constraint workspace_branding_home_charge_rate_positive
      check (home_charge_rate_usd_per_kwh is null or home_charge_rate_usd_per_kwh > 0);
  end if;
end $$;

-- Synced Tesla charging-history invoices (Phase 3, T10 / 9B). The worker's
-- charging-invoice sync job (services/onlyevs-worker/index.ts) is the only
-- writer; reconciliation to derived sessions (by vehicle + time-window
-- overlap, lib/owner/charge-sessions.ts's reconcileChargingInvoices) happens
-- at read time in the client repository, never precomputed here — this
-- table only durably stores what Tesla's charging-history API returned.
-- provider_invoice_id is Tesla's own session/invoice identifier, used for
-- duplicate-invoice idempotency exactly like source_message_id elsewhere in
-- this schema. An invoice whose window matches no trip stays attached to the
-- vehicle only (never fabricated onto a trip) -- that attribution happens at
-- read time, not by a nullable trip_id column here.
create table if not exists public.onlyevs_charging_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null,
  provider_invoice_id text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  kwh_added numeric(10,2) not null,
  cost_usd numeric(10,2) not null,
  synced_at timestamptz not null default now(),
  constraint onlyevs_charging_invoices_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete cascade,
  unique (workspace_id, provider_invoice_id),
  check (ended_at >= started_at),
  check (kwh_added >= 0),
  check (cost_usd >= 0)
);

create index if not exists onlyevs_charging_invoices_workspace_vehicle_idx
  on public.onlyevs_charging_invoices (workspace_id, vehicle_id, started_at);

revoke all on public.onlyevs_charging_invoices from public, anon, authenticated;
grant select on public.onlyevs_charging_invoices to authenticated;
grant select, insert, update on public.onlyevs_charging_invoices to onlyevs_worker;

alter table public.onlyevs_charging_invoices enable row level security;

create policy onlyevs_charging_invoices_managers_select on public.onlyevs_charging_invoices
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));

create policy onlyevs_charging_invoices_worker_all on public.onlyevs_charging_invoices
  for all to onlyevs_worker using (true) with check (true);

comment on table public.onlyevs_charging_invoices is
  'Synced Tesla charging-history invoices; reconciled to derived sessions at read time by vehicle + time-window overlap. Worker-written only.';

-- Owner cost override (costProvenance: 'manual' in
-- lib/owner/types.ts's DerivedChargeSession) — a manager-entered dollar
-- amount for a charge session the other two cost sources (rate-priced
-- home/AC, synced Tesla invoice) got wrong or never covered. trip_id is
-- nullable to mirror onlyevs_charging_invoices: an override can attach to a
-- vehicle-only session outside any trip window. RLS mirrors
-- onlyevs_charging_invoices'/onlyevs_trip_evidence_packets' manager-role
-- predicate style, but managers additionally get insert/update/delete here
-- (not select-only like the packets table) because these rows are owner-
-- authored directly from the settings/ledger UI, never worker-composed.
create table if not exists public.onlyevs_manual_charge_cost_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null,
  trip_id uuid,
  session_started_at timestamptz not null,
  cost_usd numeric(10,2) not null,
  source text not null default 'manual' check (source = 'manual'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint onlyevs_manual_charge_cost_vehicle_fk
    foreign key (workspace_id, vehicle_id)
    references public.onlyevs_vehicles(workspace_id, id) on delete cascade,
  constraint onlyevs_manual_charge_cost_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete set null,
  check (cost_usd >= 0)
);

create index if not exists onlyevs_manual_charge_cost_workspace_vehicle_idx
  on public.onlyevs_manual_charge_cost_entries (workspace_id, vehicle_id, session_started_at);

revoke all on public.onlyevs_manual_charge_cost_entries from public, anon, authenticated;
grant select, insert, update, delete on public.onlyevs_manual_charge_cost_entries to authenticated;
grant select on public.onlyevs_manual_charge_cost_entries to onlyevs_worker;

alter table public.onlyevs_manual_charge_cost_entries enable row level security;

create policy onlyevs_manual_charge_cost_managers_all on public.onlyevs_manual_charge_cost_entries
  for all to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')))
  with check ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));

comment on table public.onlyevs_manual_charge_cost_entries is
  'Manager-entered charge-session cost overrides (costProvenance: manual). Owner-authored directly, unlike the worker-composed packets/invoices tables.';

-- Claim queue for the charging-invoice sync job (T10), same claim-queue
-- pattern as private.claim_onlyevs_due_calendar. Reuses onlyevs_integrations'
-- existing next_sync_at/claimed_by/claim_expires_at columns rather than a
-- new table -- those columns are only ever consumed by
-- claim_onlyevs_due_calendar, which filters strictly to
-- provider = 'google_calendar', so they are otherwise unused on tesla-
-- provider rows and safe to repurpose for this second, independent claim
-- queue without any schema addition. Scoped to tesla integrations that have
-- actually re-consented the vehicle_charging_cmds scope (T10's re-consent
-- requirement) -- an integration without that scope is never claimed, so
-- this job is a true no-op until the founder completes re-consent.
create or replace function private.claim_onlyevs_due_charging_sync(
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
    raise exception 'invalid_charging_sync_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select i.id
    from public.onlyevs_integrations i
    where i.provider = 'tesla'
      and i.status = 'connected'
      and i.granted_scopes @> array['vehicle_charging_cmds']::text[]
      and i.next_sync_at is not null
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

revoke all on function private.claim_onlyevs_due_charging_sync(text, integer) from public, anon, authenticated;
grant execute on function private.claim_onlyevs_due_charging_sync(text, integer) to onlyevs_worker;

-- =====================================================================
-- Phase 6 — immutable trip evidence packets
-- =====================================================================

-- Versioned per trip (unique(trip_id, version); previously unique(trip_id),
-- which made the "superseding row" correction model described below
-- literally impossible to insert). Composed by the worker when the end
-- bookend finalizes. Insert-only and never mutated: a correction is a new
-- row with version = previous max + 1, never an update to an existing row —
-- the current packet for a trip is always the row with the highest version.
-- payload never contains coordinates — the packet is deliberately safe to
-- render anywhere owner-side (Inbox, reminder email) without touching the
-- location seal.
create table if not exists public.onlyevs_trip_evidence_packets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  trip_id uuid not null,
  version integer not null default 1 check (version > 0),
  composed_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint onlyevs_evidence_packets_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete cascade,
  unique (trip_id, version)
);

create index if not exists onlyevs_evidence_packets_workspace_idx
  on public.onlyevs_trip_evidence_packets (workspace_id, composed_at desc);
-- Supports "current packet = highest version" lookups (order by version desc
-- limit 1 per trip) without a full-table scan.
create index if not exists onlyevs_evidence_packets_trip_version_idx
  on public.onlyevs_trip_evidence_packets (trip_id, version desc);

-- =====================================================================
-- Phase 7 — durable guest identity
-- =====================================================================

create table if not exists public.onlyevs_guests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  check (char_length(btrim(display_name)) between 1 and 240)
);

create index if not exists onlyevs_guests_workspace_idx
  on public.onlyevs_guests (workspace_id, created_at, id);

create trigger touch_onlyevs_guests
  before update on public.onlyevs_guests
  for each row execute function private.touch_onlyevs_access_row();

-- Exact-match identity keys only — no fuzzy linking, ever. Equal hashes are
-- the same credential, so precision holds even if Turo proxy emails prove
-- unstable across bookings; instability only splits records (recall loss),
-- which the merge tool repairs. Keys never reach the client: worker/RPC
-- access only.
create table if not exists private.onlyevs_guest_identity_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  guest_id uuid not null,
  key_type text not null check (key_type in ('email_hash', 'tesla_subject_hmac')),
  key_value text not null check (key_value ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint onlyevs_guest_identity_keys_guest_fk
    foreign key (workspace_id, guest_id)
    references public.onlyevs_guests(workspace_id, id) on delete cascade,
  unique (workspace_id, key_type, key_value)
);

create index if not exists onlyevs_guest_identity_keys_guest_idx
  on private.onlyevs_guest_identity_keys (workspace_id, guest_id);

-- Trips <-> durable guest link (additive; nullable so a trip can exist
-- before linking runs, and so a merge/re-split never has to leave a trip
-- momentarily unlinked). set null on guest delete rather than cascade: a
-- guest record disappearing (merge) must never delete trip history — the
-- merge tool repoints guest_id to the target guest before removing the
-- source record, so this on-delete path only fires for a direct/manual
-- guest deletion outside that flow.
alter table public.onlyevs_trips
  add column if not exists guest_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_trips_guest_fk'
      and conrelid = 'public.onlyevs_trips'::regclass
  ) then
    alter table public.onlyevs_trips add constraint onlyevs_trips_guest_fk
      foreign key (workspace_id, guest_id)
      references public.onlyevs_guests(workspace_id, id) on delete set null;
  end if;
end $$;

create index if not exists onlyevs_trips_guest_idx
  on public.onlyevs_trips (workspace_id, guest_id)
  where guest_id is not null;

-- Merge audit log (Phase 7 merge tool). Records prior state *before* a merge
-- repoints trips/keys, so a bad merge can be re-split later
-- (lib/owner/guest-linking.ts's planGuestReSplit reads this). Append-only:
-- never updated or deleted. No FK to onlyevs_guests on source_guest_id — the
-- source record is removed by the merge itself, so the id in this log
-- necessarily outlives the row it names, by design (the audit trail, not
-- live referential state).
create table if not exists private.onlyevs_guest_merge_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_guest_id uuid not null,
  target_guest_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  prior_state jsonb not null check (jsonb_typeof(prior_state) = 'object'),
  merged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (source_guest_id <> target_guest_id)
);

create index if not exists onlyevs_guest_merge_audit_workspace_idx
  on private.onlyevs_guest_merge_audit (workspace_id, merged_at desc);

comment on table private.onlyevs_guest_merge_audit is
  'Append-only prior-state log for guest merges (Phase 7); worker/RPC access only, never sent to the client. Read by the merge tool''s re-split path.';

-- =====================================================================
-- Phase 7 backfill — link pre-existing trips to durable guests by verified
-- email hash. One-time data migration, not a client-facing RPC, so it does
-- not need the Issue 8 authenticated-RPC hardening spec; it runs with
-- migration-apply privileges exactly once per trip. Idempotent: guarded by
-- `t.guest_id is null`, so re-applying this migration (or re-running it in
-- a freshly seeded environment) only ever touches trips that are still
-- unlinked, and it reuses an already-created guest via the same exact-match
-- key lookup the runtime linkTripToGuest() path uses
-- (lib/owner/guest-linking.ts) rather than creating a duplicate.
-- =====================================================================
do $$
declare
  r record;
  v_guest_id uuid;
begin
  for r in
    select t.workspace_id, t.id as trip_id, b.verified_email_hash, t.guest_name
    from public.onlyevs_trips t
    join private.onlyevs_guest_bindings b
      on b.workspace_id = t.workspace_id and b.trip_id = t.id
    where t.guest_id is null
      and b.verified_email_hash is not null
    order by t.workspace_id, t.created_at
  loop
    select k.guest_id into v_guest_id
    from private.onlyevs_guest_identity_keys k
    where k.workspace_id = r.workspace_id
      and k.key_type = 'email_hash'
      and k.key_value = r.verified_email_hash;

    if v_guest_id is null then
      insert into public.onlyevs_guests (workspace_id, display_name)
      values (r.workspace_id, r.guest_name)
      returning id into v_guest_id;

      insert into private.onlyevs_guest_identity_keys (workspace_id, guest_id, key_type, key_value)
      values (r.workspace_id, v_guest_id, 'email_hash', r.verified_email_hash)
      on conflict (workspace_id, key_type, key_value) do nothing;
    end if;

    update public.onlyevs_trips
    set guest_id = v_guest_id
    where workspace_id = r.workspace_id and id = r.trip_id;
  end loop;
end $$;

-- =====================================================================
-- Bucketed history aggregation (reader; SECURITY INVOKER — relies on the
-- manager RLS select policy on onlyevs_vehicle_stats_history below, same as
-- any other authenticated read of that table).
-- =====================================================================

-- date_trunc-style bucketing sized so a call over any retained range (up to
-- 13 months) never returns more than 300 points. Chart reads always go
-- through this function — the page never fetches raw history rows.
create or replace function public.get_onlyevs_vehicle_stats_history_buckets(
  p_workspace_id uuid,
  p_vehicle_id uuid,
  p_since timestamptz,
  p_until timestamptz default now()
)
returns table (
  bucket_at timestamptz,
  battery_pct numeric,
  estimated_range_mi numeric,
  odometer_mi numeric,
  charging_state text,
  locked boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select greatest(60, ceil(extract(epoch from (p_until - p_since)) / 300))::int as bucket_seconds
  ),
  bucketed as (
    select
      to_timestamp(
        floor(extract(epoch from h.observed_at) / p.bucket_seconds) * p.bucket_seconds
      ) as bucket_at,
      h.battery_pct,
      h.estimated_range_mi,
      h.odometer_mi,
      h.charging_state,
      h.locked,
      h.observed_at
    from public.onlyevs_vehicle_stats_history h, params p
    where h.workspace_id = p_workspace_id
      and h.vehicle_id = p_vehicle_id
      and h.observed_at >= p_since
      and h.observed_at <= p_until
  )
  select
    b.bucket_at,
    avg(b.battery_pct) as battery_pct,
    avg(b.estimated_range_mi) as estimated_range_mi,
    max(b.odometer_mi) as odometer_mi,
    (array_agg(b.charging_state order by b.observed_at desc))[1] as charging_state,
    (array_agg(b.locked order by b.observed_at desc))[1] as locked
  from bucketed b
  group by b.bucket_at
  order by b.bucket_at
  limit 300;
$$;

revoke all on function public.get_onlyevs_vehicle_stats_history_buckets(
  uuid, uuid, timestamptz, timestamptz
) from public, anon;
grant execute on function public.get_onlyevs_vehicle_stats_history_buckets(
  uuid, uuid, timestamptz, timestamptz
) to authenticated;

-- =====================================================================
-- Hardened SECURITY DEFINER readers (outside-voice Issue 8, decided 8A).
-- Both functions below: SET search_path = '' (fully qualified references
-- only); owned by the migration role, which owns every table they touch —
-- no broader role is granted ownership; REVOKE EXECUTE FROM public/anon;
-- GRANT EXECUTE TO authenticated only; the membership/active-trip checks run
-- as the function's first statements, before any private-schema access.
-- =====================================================================

-- Bookends reader. private.onlyevs_trip_bookends carries no direct grant to
-- authenticated (see the private-table revoke block below) — this RPC is
-- the only manager-facing read path, matching the pattern used elsewhere in
-- this codebase for private-schema reads (e.g. get_onlyevs_ready_invite).
create or replace function public.get_onlyevs_trip_bookends(p_trip_id uuid)
returns table (
  trip_id uuid,
  edge text,
  odometer_mi numeric,
  odometer_observed_at timestamptz,
  battery_pct numeric,
  battery_observed_at timestamptz,
  captured_at timestamptz,
  stale boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select t.workspace_id into v_workspace_id
  from public.onlyevs_trips t
  where t.id = p_trip_id;

  if v_workspace_id is null
    or (select auth.uid()) is null
    or not public.has_minimum_role(v_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;

  return query
  select b.trip_id, b.edge, b.odometer_mi, b.odometer_observed_at,
         b.battery_pct, b.battery_observed_at, b.captured_at, b.stale
  from private.onlyevs_trip_bookends b
  where b.trip_id = p_trip_id
  order by b.edge;
end;
$$;

-- Workspace-scoped bookends reader (remediation: replaces an N-per-trip
-- fan-out of get_onlyevs_trip_bookends calls in
-- lib/owner/trip-repository.ts's fetchWorkspaceOperationalSnapshot with one
-- round trip). Same hardening as get_onlyevs_trip_bookends above; scoped by
-- workspace_id + shop_slug exactly like get_onlyevs_workspace_trip_snapshot.
-- get_onlyevs_trip_bookends(uuid) stays as the single-trip reader for
-- surfaces that only need one trip's bookends (e.g. the active-trip card).
create or replace function public.get_onlyevs_workspace_trip_bookends(
  p_workspace_id uuid,
  p_shop_slug text
)
returns table (
  trip_id uuid,
  edge text,
  odometer_mi numeric,
  odometer_observed_at timestamptz,
  battery_pct numeric,
  battery_observed_at timestamptz,
  captured_at timestamptz,
  stale boolean
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
  select b.trip_id, b.edge, b.odometer_mi, b.odometer_observed_at,
         b.battery_pct, b.battery_observed_at, b.captured_at, b.stale
  from private.onlyevs_trip_bookends b
  join public.onlyevs_trips t on t.workspace_id = b.workspace_id and t.id = b.trip_id
  where b.workspace_id = p_workspace_id
    and t.shop_slug = btrim(p_shop_slug)
  order by b.trip_id, b.edge;
end;
$$;

revoke all on function public.get_onlyevs_workspace_trip_bookends(uuid, text) from public, anon;
grant execute on function public.get_onlyevs_workspace_trip_bookends(uuid, text) to authenticated;

-- Location evidence ciphertext reader. Enforces manager membership AND an
-- active, guest-consented trip window in SQL before touching the sealed
-- location table — the same invariant the app-level route re-checks (its
-- own workspace allowlist gate) before this function is ever called.
-- Returns no rows (never an error) when there is no active/consented trip,
-- so the caller can render an honest "absent" state rather than leak which
-- precondition failed. Never returns a breadcrumb/history set — always the
-- single latest point for the active trip.
create or replace function public.get_onlyevs_vehicle_location_evidence(
  p_workspace_id uuid,
  p_vehicle_id uuid
)
returns table (
  trip_id uuid,
  observed_at timestamptz,
  coordinates_ciphertext text,
  key_version smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trip_id uuid;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;

  select t.id into v_trip_id
  from public.onlyevs_trips t
  join private.onlyevs_guest_bindings gb
    on gb.workspace_id = t.workspace_id and gb.trip_id = t.id
  where t.workspace_id = p_workspace_id
    and t.vehicle_id = p_vehicle_id
    and t.status = 'active'
    and t.starts_at <= now()
    and t.ends_at >= now()
    and gb.consented_at is not null
  order by t.starts_at desc
  limit 1;

  if v_trip_id is null then
    return;
  end if;

  return query
  select lp.trip_id, lp.observed_at, lp.coordinates_ciphertext, lp.key_version
  from private.onlyevs_vehicle_location_points lp
  where lp.workspace_id = p_workspace_id
    and lp.vehicle_id = p_vehicle_id
    and lp.trip_id = v_trip_id
  order by lp.observed_at desc
  limit 1;
end;
$$;

revoke all on function public.get_onlyevs_trip_bookends(uuid) from public, anon;
revoke all on function public.get_onlyevs_vehicle_location_evidence(uuid, uuid) from public, anon;
grant execute on function public.get_onlyevs_trip_bookends(uuid) to authenticated;
grant execute on function public.get_onlyevs_vehicle_location_evidence(uuid, uuid) to authenticated;

-- Guest identity-key counts (Phase 7 client read path). public.onlyevs_guests
-- and public.onlyevs_trips (via the new guest_id column above) already grant
-- direct authenticated SELECT under manager RLS, so the client reads durable
-- guests + their linked trips with ordinary table selects — no RPC needed
-- for that half. private.onlyevs_guest_identity_keys carries no
-- authenticated grant at all ("keys never reach the client"), so the one
-- thing the client cannot read directly is how many identity keys a guest
-- has — needed verbatim by the merge dialog's real-counts copy ("4 trips
-- and 2 identity keys move to Sam K."). This RPC returns counts only, never
-- key_value, and is workspace-scoped (one round trip for the whole drivers
-- list) rather than per-guest, matching the
-- get_onlyevs_workspace_trip_bookends efficiency precedent above.
create or replace function public.get_onlyevs_guest_identity_key_counts(
  p_workspace_id uuid
)
returns table (
  guest_id uuid,
  key_count bigint
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
  select k.guest_id, count(*)::bigint as key_count
  from private.onlyevs_guest_identity_keys k
  where k.workspace_id = p_workspace_id
  group by k.guest_id;
end;
$$;

revoke all on function public.get_onlyevs_guest_identity_key_counts(uuid) from public, anon;
grant execute on function public.get_onlyevs_guest_identity_key_counts(uuid) to authenticated;

-- Guest merge (Phase 7 merge tool's apply half). The browser holds no
-- onlyevs_worker role, so it cannot call the store-oriented steps
-- lib/owner/guest-linking.ts's mergeGuests() runs against a Pool/PoolClient
-- (services/onlyevs-worker/guest-linking-store.ts) -- this RPC performs the
-- same operation atomically, server-side, as the one manager-facing entry
-- point: repoints public.onlyevs_trips.guest_id and
-- private.onlyevs_guest_identity_keys.guest_id from source to target,
-- records the prior-state audit row (private.onlyevs_guest_merge_audit) so a
-- bad merge can be re-split by key later, then deletes the source guest.
-- Membership check runs first, before any private-schema access, matching
-- every other hardened reader above. Re-split itself has no browser-facing
-- counterpart yet -- lib/owner/guest-linking.ts's planGuestReSplit() reads
-- this table's prior_state and is executed by the worker/support tooling
-- that already holds the onlyevs_worker role, not from a client RPC; the
-- merge dialog's "You can re-split by key later" promise is honored by that
-- audit row existing, not by a live re-split button in this wave.
create or replace function public.merge_onlyevs_guests(
  p_workspace_id uuid,
  p_source_guest_id uuid,
  p_target_guest_id uuid
)
returns table (
  target_guest_id uuid,
  target_display_name text,
  target_created_at timestamptz,
  target_updated_at timestamptz,
  trips_moved integer,
  keys_moved integer,
  audit_event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip_ids uuid[];
  v_keys jsonb;
  v_key_count integer;
  v_trip_count integer;
  v_audit_id uuid;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;

  if p_source_guest_id = p_target_guest_id then
    raise exception 'cannot_merge_guest_into_itself' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.onlyevs_guests
    where workspace_id = p_workspace_id and id = p_source_guest_id
  ) then
    raise exception 'source_guest_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.onlyevs_guests
    where workspace_id = p_workspace_id and id = p_target_guest_id
  ) then
    raise exception 'target_guest_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(t.id), '{}') into v_trip_ids
  from public.onlyevs_trips t
  where t.workspace_id = p_workspace_id and t.guest_id = p_source_guest_id;
  v_trip_count := coalesce(array_length(v_trip_ids, 1), 0);

  select coalesce(jsonb_agg(jsonb_build_object('keyType', k.key_type, 'keyValue', k.key_value)), '[]'::jsonb),
         count(*)
    into v_keys, v_key_count
  from private.onlyevs_guest_identity_keys k
  where k.workspace_id = p_workspace_id and k.guest_id = p_source_guest_id;

  -- Prior state recorded *before* the repoint below, so re-split always has
  -- the exact set that moved -- same ordering as the worker's mergeGuests().
  insert into private.onlyevs_guest_merge_audit
    (workspace_id, source_guest_id, target_guest_id, actor_user_id, prior_state)
  values (
    p_workspace_id, p_source_guest_id, p_target_guest_id, (select auth.uid()),
    jsonb_build_object('tripIds', to_jsonb(v_trip_ids), 'keys', v_keys)
  )
  returning id into v_audit_id;

  update public.onlyevs_trips
  set guest_id = p_target_guest_id
  where workspace_id = p_workspace_id and guest_id = p_source_guest_id;

  -- Safe without a conflict-handling clause: (workspace_id, key_type,
  -- key_value) is unique per private.onlyevs_guest_identity_keys, so a key
  -- can only ever belong to one guest at a time -- the source and target
  -- guests' key sets are disjoint by construction before this update runs.
  update private.onlyevs_guest_identity_keys
  set guest_id = p_target_guest_id
  where workspace_id = p_workspace_id and guest_id = p_source_guest_id;

  delete from public.onlyevs_guests
  where workspace_id = p_workspace_id and id = p_source_guest_id;

  return query
  select g.id, g.display_name, g.created_at, g.updated_at, v_trip_count, v_key_count, v_audit_id
  from public.onlyevs_guests g
  where g.workspace_id = p_workspace_id and g.id = p_target_guest_id;
end;
$$;

revoke all on function public.merge_onlyevs_guests(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_onlyevs_guests(uuid, uuid, uuid) to authenticated;

-- =====================================================================
-- Grants + RLS
-- =====================================================================

revoke all on public.onlyevs_vehicle_stats_history,
  public.onlyevs_trip_evidence_packets,
  public.onlyevs_guests from public, anon, authenticated;
grant select on public.onlyevs_vehicle_stats_history,
  public.onlyevs_trip_evidence_packets,
  public.onlyevs_guests to authenticated;

grant select, insert, delete on public.onlyevs_vehicle_stats_history to onlyevs_worker;
grant select, insert on public.onlyevs_trip_evidence_packets to onlyevs_worker;
grant select, insert, update, delete on public.onlyevs_guests to onlyevs_worker;
grant select, insert, update on private.onlyevs_trip_bookends to onlyevs_worker;
grant select, insert, update, delete on private.onlyevs_guest_identity_keys to onlyevs_worker;
-- Append-only audit log: select (for re-split planning) + insert only, no
-- update/delete grant even for the worker role.
grant select, insert on private.onlyevs_guest_merge_audit to onlyevs_worker;

alter table public.onlyevs_vehicle_stats_history enable row level security;
alter table public.onlyevs_trip_evidence_packets enable row level security;
alter table public.onlyevs_guests enable row level security;

create policy onlyevs_stats_history_managers_select on public.onlyevs_vehicle_stats_history
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_evidence_packets_managers_select on public.onlyevs_trip_evidence_packets
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_guests_managers_select on public.onlyevs_guests
  for select to authenticated
  using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));

-- The worker role has no global BYPASSRLS privilege; scoped by these
-- table policies plus the ordinary grants above, matching every other
-- worker-managed table in this schema.
create policy onlyevs_stats_history_worker_all on public.onlyevs_vehicle_stats_history
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_evidence_packets_worker_all on public.onlyevs_trip_evidence_packets
  for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_guests_worker_all on public.onlyevs_guests
  for all to onlyevs_worker using (true) with check (true);

-- private schema: no RLS (consistent with the other private onlyevs_* tables
-- in 20260814193000) — access is either the direct onlyevs_worker grants
-- above, or the hardened SECURITY DEFINER readers, which run as the
-- function owner and so are unaffected by the blanket revoke below.
revoke all on private.onlyevs_trip_bookends,
  private.onlyevs_guest_identity_keys,
  private.onlyevs_guest_merge_audit from anon, authenticated;

comment on table private.onlyevs_trip_bookends is
  'Trip-start/end vehicle-state snapshots; no location data. Read only via public.get_onlyevs_trip_bookends().';
comment on table private.onlyevs_guest_identity_keys is
  'Exact-match guest linking keys (email hash / Tesla subject HMAC); worker/RPC access only, never sent to the client.';
