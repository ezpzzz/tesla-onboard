begin;
select plan(50);

-- =====================================================================
-- Structural coverage: tables, functions, grants, RLS policies.
-- =====================================================================

select has_table('public'::name, 'onlyevs_vehicle_stats_history'::name);
select has_table('public'::name, 'onlyevs_trip_evidence_packets'::name);
select has_table('public'::name, 'onlyevs_guests'::name);
select has_table('public'::name, 'onlyevs_charging_invoices'::name);
select has_table('public'::name, 'onlyevs_manual_charge_cost_entries'::name);
select has_table('private'::name, 'onlyevs_trip_bookends'::name);
select has_table('private'::name, 'onlyevs_guest_identity_keys'::name);
select has_table('private'::name, 'onlyevs_guest_merge_audit'::name);

select has_function('public', 'merge_onlyevs_guests', array['uuid', 'uuid', 'uuid']);
select has_function('public', 'get_onlyevs_charge_sessions', array['uuid', 'timestamptz', 'timestamptz']);
select has_function('private', 'link_onlyevs_trip_to_guest', array['text', 'uuid', 'uuid', 'jsonb', 'text']);

select function_privs_are(
  'private',
  'link_onlyevs_trip_to_guest',
  array['text', 'uuid', 'uuid', 'jsonb', 'text'],
  'authenticated',
  array[]::text[]
);
select function_privs_are(
  'private',
  'link_onlyevs_trip_to_guest',
  array['text', 'uuid', 'uuid', 'jsonb', 'text'],
  'anon',
  array[]::text[]
);
select table_privs_are(
  'private',
  'onlyevs_trip_bookends',
  'authenticated',
  array[]::text[]
);
select table_privs_are(
  'private',
  'onlyevs_guest_identity_keys',
  'authenticated',
  array[]::text[]
);
select table_privs_are(
  'private',
  'onlyevs_guest_merge_audit',
  'authenticated',
  array[]::text[]
);

select policies_are(
  'public',
  'onlyevs_vehicle_stats_history',
  array['onlyevs_stats_history_managers_select', 'onlyevs_stats_history_worker_all']
);
select policies_are(
  'public',
  'onlyevs_trip_evidence_packets',
  array['onlyevs_evidence_packets_managers_select', 'onlyevs_evidence_packets_worker_all']
);
select policies_are(
  'public',
  'onlyevs_guests',
  array['onlyevs_guests_managers_select', 'onlyevs_guests_worker_all']
);
select policies_are(
  'public',
  'onlyevs_manual_charge_cost_entries',
  array['onlyevs_manual_charge_cost_managers_all']
);
select policies_are(
  'public',
  'onlyevs_charging_invoices',
  array['onlyevs_charging_invoices_managers_select', 'onlyevs_charging_invoices_worker_all']
);

-- =====================================================================
-- Fixtures: two workspaces (A, B) each with one manager, plus a third
-- authenticated user who is a member of neither -- the non-member control
-- for every RLS/function-membership assertion below.
-- =====================================================================

insert into auth.users (id)
values
  ('95000000-0000-4000-8000-000000000001'), -- A1: manager of workspace A
  ('95000000-0000-4000-8000-000000000002'), -- B1: manager of workspace B
  ('95000000-0000-4000-8000-000000000003')  -- U3: authenticated, no workspace membership
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug)
values
  ('95100000-0000-4000-8000-000000000001', 'Telemetry Ledger A', 'telemetry-ledger-a'),
  ('95100000-0000-4000-8000-000000000002', 'Telemetry Ledger B', 'telemetry-ledger-b')
on conflict (id) do nothing;

insert into public.workspace_users (workspace_id, user_id, role)
values
  ('95100000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'manager'),
  ('95100000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 'manager')
on conflict (workspace_id, user_id) do update set role = excluded.role;

insert into public.workspace_branding (workspace_id, shop_slug, display_name)
values
  ('95100000-0000-4000-8000-000000000001', 'telemetry-ledger-a', 'Telemetry Ledger A'),
  ('95100000-0000-4000-8000-000000000002', 'telemetry-ledger-b', 'Telemetry Ledger B')
on conflict (workspace_id, shop_slug) do nothing;

insert into public.onlyevs_vehicles (
  id, workspace_id, shop_slug, display_name, model, trim, year, color
)
values
  ('95200000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', 'telemetry-ledger-a', 'Ledger Model 3 A', 'Model 3', 'Performance', 2024, 'Solid Black'),
  ('95200000-0000-4000-8000-000000000002', '95100000-0000-4000-8000-000000000002', 'telemetry-ledger-b', 'Ledger Model 3 B', 'Model 3', 'Performance', 2024, 'Pearl White');

insert into public.onlyevs_trips (
  id, workspace_id, shop_slug, vehicle_id, guest_name, guest_email, timezone,
  starts_at, ends_at, public_token_hash, token_expires_at
)
values
  ('95300000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', 'telemetry-ledger-a',
   '95200000-0000-4000-8000-000000000001', 'Ledger Guest A', 'ledger-a@example.com', 'UTC',
   now() + interval '2 days', now() + interval '3 days', repeat('9', 64), now() + interval '4 days'),
  ('95300000-0000-4000-8000-000000000002', '95100000-0000-4000-8000-000000000002', 'telemetry-ledger-b',
   '95200000-0000-4000-8000-000000000002', 'Ledger Guest B', 'ledger-b@example.com', 'UTC',
   now() + interval '2 days', now() + interval '3 days', repeat('8', 64), now() + interval '4 days');

-- One history row per workspace, deliberately not charging (charging_state
-- null) so it never becomes a charge-session island and cannot contaminate
-- the segmentation cap test run later in this file.
insert into public.onlyevs_vehicle_stats_history (
  workspace_id, vehicle_id, observed_at, battery_pct, source_message_id, delete_after
)
values
  ('95100000-0000-4000-8000-000000000001', '95200000-0000-4000-8000-000000000001', now(), 72, 'seed-history-a', now() + interval '1 day'),
  ('95100000-0000-4000-8000-000000000002', '95200000-0000-4000-8000-000000000002', now(), 68, 'seed-history-b', now() + interval '1 day');

insert into public.onlyevs_trip_evidence_packets (
  workspace_id, trip_id, version, payload
)
values
  ('95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001', 1, '{"summary":"ledger a v1"}'::jsonb),
  ('95100000-0000-4000-8000-000000000002', '95300000-0000-4000-8000-000000000002', 1, '{"summary":"ledger b v1"}'::jsonb);

insert into public.onlyevs_guests (id, workspace_id, display_name)
values
  ('95400000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', 'Alex Guest'),
  ('95400000-0000-4000-8000-000000000002', '95100000-0000-4000-8000-000000000001', 'Sam Guest'),
  ('95400000-0000-4000-8000-000000000003', '95100000-0000-4000-8000-000000000002', 'Blair Guest');

-- =====================================================================
-- RLS: a manager can select their own workspace's rows and cannot see
-- another workspace's rows; a non-member sees nothing at all. Enforced
-- for real by actually switching connection role to `authenticated` --
-- the default test-harness role bypasses RLS entirely.
-- =====================================================================

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.onlyevs_vehicle_stats_history where workspace_id = '95100000-0000-4000-8000-000000000001'),
  1,
  'a manager can select telemetry history scoped to their own workspace'
);
select is(
  (select count(*)::integer from public.onlyevs_vehicle_stats_history where workspace_id = '95100000-0000-4000-8000-000000000002'),
  0,
  'a manager cannot select another workspace''s telemetry history'
);
select is(
  (select count(*)::integer from public.onlyevs_trip_evidence_packets where workspace_id = '95100000-0000-4000-8000-000000000001'),
  1,
  'a manager can select trip evidence packets scoped to their own workspace'
);
select is(
  (select count(*)::integer from public.onlyevs_trip_evidence_packets where workspace_id = '95100000-0000-4000-8000-000000000002'),
  0,
  'a manager cannot select another workspace''s trip evidence packets'
);
select is(
  (select count(*)::integer from public.onlyevs_guests where workspace_id = '95100000-0000-4000-8000-000000000001'),
  2,
  'a manager can select durable guests scoped to their own workspace'
);
select is(
  (select count(*)::integer from public.onlyevs_guests where workspace_id = '95100000-0000-4000-8000-000000000002'),
  0,
  'a manager cannot select another workspace''s durable guests'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);

select is(
  (select count(*)::integer from public.onlyevs_vehicle_stats_history where workspace_id = '95100000-0000-4000-8000-000000000001'),
  0,
  'a non-member sees no telemetry history rows for a workspace they do not belong to'
);
select is(
  (select count(*)::integer from public.onlyevs_trip_evidence_packets where workspace_id = '95100000-0000-4000-8000-000000000001'),
  0,
  'a non-member sees no trip evidence packet rows for a workspace they do not belong to'
);
select is(
  (select count(*)::integer from public.onlyevs_guests where workspace_id = '95100000-0000-4000-8000-000000000001'),
  0,
  'a non-member sees no durable guest rows for a workspace they do not belong to'
);

-- =====================================================================
-- These three tables grant SELECT only to authenticated (worker-composed
-- writes only) -- even a workspace manager cannot insert/update directly.
-- =====================================================================

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.onlyevs_vehicle_stats_history (
      workspace_id, vehicle_id, observed_at, source_message_id, delete_after
    ) values (
      '95100000-0000-4000-8000-000000000001', '95200000-0000-4000-8000-000000000001',
      now(), 'authenticated-direct-insert', now() + interval '1 day'
    )$$,
  '42501',
  null,
  'an authenticated manager cannot insert telemetry history directly (worker-composed only)'
);
select throws_ok(
  $$insert into public.onlyevs_trip_evidence_packets (
      workspace_id, trip_id, payload
    ) values (
      '95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001',
      '{"summary":"forged"}'::jsonb
    )$$,
  '42501',
  null,
  'an authenticated manager cannot insert trip evidence packets directly (worker-composed only)'
);
select throws_ok(
  $$insert into public.onlyevs_guests (
      workspace_id, display_name
    ) values (
      '95100000-0000-4000-8000-000000000001', 'Forged Guest'
    )$$,
  '42501',
  null,
  'an authenticated manager cannot insert durable guests directly (worker-composed only)'
);
select throws_ok(
  $$update public.onlyevs_guests set display_name = 'Renamed' where id = '95400000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'an authenticated manager cannot update durable guests directly (worker-composed only)'
);

-- =====================================================================
-- onlyevs_manual_charge_cost_entries: authenticated managers CAN insert
-- (owner-authored overrides), but the WITH CHECK clause pins created_by to
-- the caller's own auth.uid() -- a forged created_by is rejected.
-- =====================================================================

select lives_ok(
  $$insert into public.onlyevs_manual_charge_cost_entries (
      workspace_id, vehicle_id, session_started_at, cost_usd, created_by
    ) values (
      '95100000-0000-4000-8000-000000000001', '95200000-0000-4000-8000-000000000001',
      now(), 9.99, '95000000-0000-4000-8000-000000000001'
    )$$,
  'a manager can insert a manual charge cost entry attributed to themselves'
);
select throws_ok(
  $$insert into public.onlyevs_manual_charge_cost_entries (
      workspace_id, vehicle_id, session_started_at, cost_usd, created_by
    ) values (
      '95100000-0000-4000-8000-000000000001', '95200000-0000-4000-8000-000000000001',
      now(), 4.50, '95000000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  null,
  'the WITH CHECK clause rejects a manual charge cost entry with a forged created_by'
);

reset role;

-- =====================================================================
-- CHECK constraints. Run at the default (bypass) role -- these are hard
-- schema constraints and are enforced regardless of the calling role.
-- =====================================================================

select throws_ok(
  $$insert into public.onlyevs_guests (workspace_id, display_name)
    values ('95100000-0000-4000-8000-000000000001', '   ')$$,
  '23514',
  null,
  'a whitespace-only display_name violates the guest display_name bounds check'
);
select throws_ok(
  $$insert into public.onlyevs_guests (workspace_id, display_name)
    values ('95100000-0000-4000-8000-000000000001', repeat('a', 241))$$,
  '23514',
  null,
  'a 241-character display_name violates the guest display_name bounds check'
);
select lives_ok(
  $$insert into public.onlyevs_guests (workspace_id, display_name)
    values ('95100000-0000-4000-8000-000000000001', repeat('a', 240))$$,
  'a 240-character display_name is exactly at the guest display_name upper bound'
);

select lives_ok(
  $$insert into private.onlyevs_trip_bookends (workspace_id, trip_id, edge)
    values ('95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001', 'start')$$,
  'the first start bookend for a trip can be inserted'
);
select throws_ok(
  $$insert into private.onlyevs_trip_bookends (workspace_id, trip_id, edge)
    values ('95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001', 'start')$$,
  '23505',
  null,
  'a second start bookend for the same trip violates unique(trip_id, edge)'
);
select lives_ok(
  $$insert into private.onlyevs_trip_bookends (workspace_id, trip_id, edge)
    values ('95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001', 'end')$$,
  'the end bookend for the same trip is a distinct edge and can be inserted'
);

select throws_ok(
  $$insert into public.onlyevs_trip_evidence_packets (workspace_id, trip_id, version, payload)
    values ('95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001', 1, '{"summary":"dup"}'::jsonb)$$,
  '23505',
  null,
  'a duplicate (trip_id, version) evidence packet violates the unique constraint'
);
select lives_ok(
  $$insert into public.onlyevs_trip_evidence_packets (workspace_id, trip_id, version, payload)
    values ('95100000-0000-4000-8000-000000000001', '95300000-0000-4000-8000-000000000001', 2, '{"summary":"correction"}'::jsonb)$$,
  'a version 2 correction row for the same trip can be inserted (never an update)'
);

-- =====================================================================
-- merge_onlyevs_guests: membership + same-workspace pairing enforcement.
-- =====================================================================

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.merge_onlyevs_guests(
    '95100000-0000-4000-8000-000000000001',
    '95400000-0000-4000-8000-000000000002',
    '95400000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'workspace_manager_required',
  'a non-member cannot merge guests in a workspace they do not belong to'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.merge_onlyevs_guests(
    '95100000-0000-4000-8000-000000000001',
    '95400000-0000-4000-8000-000000000002',
    '95400000-0000-4000-8000-000000000003'
  )$$,
  'P0002',
  'target_guest_not_found',
  'merge rejects a target guest that belongs to a different workspace'
);
select throws_ok(
  $$select public.merge_onlyevs_guests(
    '95100000-0000-4000-8000-000000000001',
    '95400000-0000-4000-8000-000000000003',
    '95400000-0000-4000-8000-000000000001'
  )$$,
  'P0002',
  'source_guest_not_found',
  'merge rejects a source guest that belongs to a different workspace'
);
select lives_ok(
  $$select public.merge_onlyevs_guests(
    '95100000-0000-4000-8000-000000000001',
    '95400000-0000-4000-8000-000000000002',
    '95400000-0000-4000-8000-000000000001'
  )$$,
  'a manager can merge two guests within their own workspace'
);

-- =====================================================================
-- get_onlyevs_charge_sessions: membership enforcement, and the hard
-- output cap (<=2000 rows) actually engages when more candidate sessions
-- exist. Sessions here are single-tick charging islands (Charging then
-- immediately Disconnected) on a vehicle that otherwise has no other
-- charging telemetry, so island count == inserted session count exactly.
-- =====================================================================

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.get_onlyevs_charge_sessions(
    '95100000-0000-4000-8000-000000000001', now() - interval '1 year', now()
  )$$,
  '42501',
  'workspace_manager_required',
  'a non-member cannot read charge sessions for a workspace they do not belong to'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

insert into public.onlyevs_vehicle_stats_history (
  workspace_id, vehicle_id, observed_at, battery_pct, charging_state, source_message_id, delete_after
)
select
  '95100000-0000-4000-8000-000000000001',
  '95200000-0000-4000-8000-000000000001',
  ts,
  state_battery,
  state_label,
  'cap-' || rn || '-' || state_label,
  ts + interval '1 day'
from (
  select
    timestamptz '2020-01-01 00:00:00+00' + (n * interval '2 minutes') as ts,
    50 as state_battery,
    'Charging' as state_label,
    n as rn
  from generate_series(1, 2200) as n
  union all
  select
    timestamptz '2020-01-01 00:00:00+00' + (n * interval '2 minutes') + interval '30 seconds',
    51,
    'Disconnected',
    n
  from generate_series(1, 2200) as n
) seeded;

select is(
  (select count(*)::integer from public.get_onlyevs_charge_sessions(
    '95100000-0000-4000-8000-000000000001',
    timestamptz '2019-01-01 00:00:00+00',
    timestamptz '2021-01-01 00:00:00+00'
  )),
  2000,
  'get_onlyevs_charge_sessions caps its output at 2000 rows when more candidate sessions exist'
);

select * from finish();
rollback;
