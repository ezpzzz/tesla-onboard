-- Defect 1 regression coverage: private.claim_onlyevs_due_telemetry
-- (20260818210000_onlyevs_telemetry_config_error_reclaim.sql) must actually
-- reclaim a due onlyevs_telemetry_enrollments row parked in status='error'
-- with last_error_code='telemetry_proxy_not_configured' -- the worker's
-- short 15-minute retry for that class is otherwise dead code, because the
-- pre-existing predicate filtered status = 'error' out categorically and
-- never evaluated next_action_at for it at all.
--
-- The whole point of this suite is to exercise the real claim predicate
-- against real rows, never a SQL string -- that is exactly the kind of test
-- that would have caught the dead code the first time.

begin;
select plan(8);

-- =====================================================================
-- Fixtures: one workspace, one Tesla integration, three vehicles each
-- with a distinct enrollment shape.
-- =====================================================================

insert into public.workspaces (id, name, slug)
values ('92100000-0000-4000-8000-000000000001', 'Telemetry Reclaim Test', 'telemetry-reclaim-test')
on conflict (id) do nothing;
insert into public.workspace_branding (workspace_id, shop_slug, display_name)
values ('92100000-0000-4000-8000-000000000001', 'telemetry-reclaim-test', 'Telemetry Reclaim Test')
on conflict (workspace_id, shop_slug) do nothing;
insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status, account_label, granted_scopes
) values (
  '92200000-0000-4000-8000-000000000001',
  '92100000-0000-4000-8000-000000000001', 'telemetry-reclaim-test', 'tesla', 'connected',
  'reclaim@example.com', array['vehicle_device_data']
);

insert into public.onlyevs_vehicles (id, workspace_id, shop_slug, display_name, model, year, color)
values
  ('92300000-0000-4000-8000-000000000001', '92100000-0000-4000-8000-000000000001',
    'telemetry-reclaim-test', 'Deployment Gap Vehicle', 'Model 3', 2024, 'White'),
  ('92300000-0000-4000-8000-000000000002', '92100000-0000-4000-8000-000000000001',
    'telemetry-reclaim-test', 'Permanent Failure Vehicle', 'Model Y', 2024, 'Black'),
  ('92300000-0000-4000-8000-000000000003', '92100000-0000-4000-8000-000000000001',
    'telemetry-reclaim-test', 'Unsupported Vehicle', 'Model S', 2021, 'Red'),
  ('92300000-0000-4000-8000-000000000004', '92100000-0000-4000-8000-000000000001',
    'telemetry-reclaim-test', 'Requested Vehicle', 'Model X', 2023, 'Blue');

-- (1) Blocked ONLY by an unconfigured deployment: status='error',
-- last_error_code is in the deployment-config allowlist, next_action_at is
-- already due.
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status, last_error_code, attempt_count, next_action_at
) values (
  '92100000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000001',
  '92200000-0000-4000-8000-000000000001', 'error', 'telemetry_proxy_not_configured', 0, now() - interval '1 minute'
);

-- (2) A genuinely vehicle-specific / permanent error: status='error' but a
-- last_error_code NOT in the allowlist -- must stay excluded exactly as
-- before this migration.
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status, last_error_code, attempt_count, next_action_at
) values (
  '92100000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000002',
  '92200000-0000-4000-8000-000000000001', 'error', 'tesla_refresh_failed', 5, now() - interval '1 minute'
);

-- (3) 'unsupported' (e.g. limit-reached / unsupported firmware): must stay
-- excluded regardless of last_error_code or how due it is.
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status, last_error_code, attempt_count, next_action_at
) values (
  '92100000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000003',
  '92200000-0000-4000-8000-000000000001', 'unsupported', 'telemetry_proxy_not_configured', 0, now() - interval '1 minute'
);

-- (4) Regression pin: an ordinary due 'requested' row still claims exactly
-- as before this migration.
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status, last_error_code, attempt_count, next_action_at
) values (
  '92100000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000004',
  '92200000-0000-4000-8000-000000000001', 'requested', null, 0, now() - interval '1 minute'
);

-- =====================================================================
-- Claim as the worker role and inspect exactly which rows came back.
-- =====================================================================

select results_eq(
  $$
    select vehicle_id::text
    from private.claim_onlyevs_due_telemetry('pgtap-test-worker-1', 10)
    order by vehicle_id
  $$,
  $$
    values
      ('92300000-0000-4000-8000-000000000001'),
      ('92300000-0000-4000-8000-000000000004')
  $$,
  'exactly the deployment-config-blocked row and the ordinary requested row are claimed -- not the permanent-error row, not the unsupported row'
);

-- =====================================================================
-- (5) The claimed deployment-config row's own state proves it is a real
-- reclaim, not a no-op: claimed_by/claim_expires_at are now set.
-- =====================================================================

select is(
  (select claimed_by from public.onlyevs_telemetry_enrollments
    where vehicle_id = '92300000-0000-4000-8000-000000000001'),
  'pgtap-test-worker-1',
  'the deployment-config-blocked row is actually marked claimed by the worker'
);
select ok(
  (select claim_expires_at from public.onlyevs_telemetry_enrollments
    where vehicle_id = '92300000-0000-4000-8000-000000000001') > now(),
  'the claim lease on the reclaimed row is in the future'
);
select is(
  (select status from public.onlyevs_telemetry_enrollments
    where vehicle_id = '92300000-0000-4000-8000-000000000001'),
  'error',
  'claiming does not itself change status away from error -- only processTelemetry does that once it actually runs'
);

-- =====================================================================
-- (6) The two excluded rows are untouched by the claim (no claimed_by).
-- =====================================================================

select is(
  (select claimed_by from public.onlyevs_telemetry_enrollments
    where vehicle_id = '92300000-0000-4000-8000-000000000002'),
  null,
  'the genuinely vehicle-permanent error row is left unclaimed'
);
select is(
  (select claimed_by from public.onlyevs_telemetry_enrollments
    where vehicle_id = '92300000-0000-4000-8000-000000000003'),
  null,
  'the unsupported row is left unclaimed regardless of its last_error_code'
);

-- =====================================================================
-- (7) A second claim call immediately after returns nothing further --
-- the lease just taken keeps the same rows from being claimed twice.
-- =====================================================================

select is(
  (select count(*)::integer from private.claim_onlyevs_due_telemetry('pgtap-test-worker-2', 10)),
  0,
  'a second immediate claim call returns nothing -- the active claim lease is honored'
);

-- =====================================================================
-- (8) Sanity: a status='error' row with the allowlisted code but
-- next_action_at still in the future is NOT due yet.
-- =====================================================================

insert into public.onlyevs_vehicles (id, workspace_id, shop_slug, display_name, model, year, color)
values ('92300000-0000-4000-8000-000000000005', '92100000-0000-4000-8000-000000000001',
  'telemetry-reclaim-test', 'Not Yet Due Vehicle', 'Model 3', 2024, 'Silver');
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status, last_error_code, attempt_count, next_action_at
) values (
  '92100000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000005',
  '92200000-0000-4000-8000-000000000001', 'error', 'telemetry_proxy_not_configured', 0, now() + interval '10 minutes'
);
select is(
  (select count(*)::integer from private.claim_onlyevs_due_telemetry('pgtap-test-worker-3', 10)),
  0,
  'a not-yet-due deployment-config-error row is not claimed early -- next_action_at is honored, not bypassed'
);

select * from finish();
rollback;
