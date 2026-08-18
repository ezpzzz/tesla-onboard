-- Recovery path for an integration stuck in 'disconnecting' because the
-- async Tesla-side telemetry-removal worker infrastructure
-- (services/onlyevs-worker + ONLYEVS_TESLA_COMMAND_PROXY_URL) is not
-- deployed in prod, so nothing ever claims the parked
-- onlyevs_telemetry_enrollments 'removal_requested' row and advances
-- onlyevs_integrations.status to 'disconnected'.
-- public.force_complete_onlyevs_integration_disconnect lets a workspace
-- admin locally complete the disconnect (delete stored credentials, drop
-- the stale enrollment rows, flip status to 'disconnected') without
-- waiting on that unclaimed worker job, and records an honest audit event
-- noting the provider-side fleet-telemetry config removal was never
-- confirmed.

begin;
select plan(23);

-- =====================================================================
-- Structural coverage: signature, SECURITY DEFINER, pinned search_path,
-- and the exact grant surface (revoked from public/anon, authenticated
-- only).
-- =====================================================================

select has_function(
  'public',
  'force_complete_onlyevs_integration_disconnect',
  array['uuid', 'text', 'text']
);
select function_returns(
  'public',
  'force_complete_onlyevs_integration_disconnect',
  array['uuid', 'text', 'text'],
  'text'
);
select ok(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'force_complete_onlyevs_integration_disconnect'
  ),
  'the RPC is SECURITY DEFINER'
);
select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'force_complete_onlyevs_integration_disconnect'
      and p.proconfig is not null
      and array_to_string(p.proconfig, ',') like '%search_path=%'
  ),
  'the RPC pins search_path'
);
select function_privs_are(
  'public',
  'force_complete_onlyevs_integration_disconnect',
  array['uuid', 'text', 'text'],
  'public',
  array[]::text[]
);
select function_privs_are(
  'public',
  'force_complete_onlyevs_integration_disconnect',
  array['uuid', 'text', 'text'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'force_complete_onlyevs_integration_disconnect',
  array['uuid', 'text', 'text'],
  'authenticated',
  array['EXECUTE']
);

-- =====================================================================
-- Fixtures: one workspace, an admin member, a below-admin member, a
-- 'disconnecting' Tesla integration with a parked credential row and a
-- 'removal_requested' enrollment row (exactly the stuck shape the async
-- worker never claims because it is not deployed in prod).
-- =====================================================================

insert into auth.users (id)
values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug)
values ('91100000-0000-4000-8000-000000000001', 'Disconnect Recovery Test', 'disconnect-recovery-test')
on conflict (id) do nothing;
insert into public.workspace_users (workspace_id, user_id, role)
values
  ('91100000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'admin'),
  ('91100000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'manager')
on conflict (workspace_id, user_id) do update set role = excluded.role;
insert into public.workspace_branding (workspace_id, shop_slug, display_name)
values ('91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'Disconnect Recovery Test')
on conflict (workspace_id, shop_slug) do nothing;

insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status, account_label, granted_scopes
) values (
  '91200000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'tesla', 'disconnecting',
  'stuck@example.com', array['vehicle_device_data']
);
insert into private.onlyevs_integration_credentials (
  integration_id, workspace_id, provider_subject_ciphertext, refresh_token_ciphertext, key_version
) values (
  '91200000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001',
  repeat('a', 40), repeat('b', 40), 1
);
insert into public.onlyevs_vehicles (
  id, workspace_id, shop_slug, display_name, model, year, color
) values (
  '91300000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'Stuck Vehicle', 'Model 3', 2024, 'White'
);
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status
) values (
  '91100000-0000-4000-8000-000000000001', '91300000-0000-4000-8000-000000000001',
  '91200000-0000-4000-8000-000000000001', 'removal_requested'
);

-- =====================================================================
-- (2) A below-admin member cannot force-complete the disconnect.
-- =====================================================================

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.force_complete_onlyevs_integration_disconnect(
    '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'tesla'
  )$$,
  '42501',
  'workspace_admin_required',
  'a workspace manager (below admin) cannot force-complete an integration disconnect'
);

-- =====================================================================
-- (3) An admin caller against a 'connected' integration is rejected --
-- the recovery RPC only ever applies to a stale 'disconnecting' row.
-- =====================================================================

insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status
) values (
  '91200000-0000-4000-8000-000000000002',
  '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'google_calendar', 'connected'
);
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.force_complete_onlyevs_integration_disconnect(
    '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'google_calendar'
  )$$,
  '55000',
  'integration_not_disconnecting',
  'an admin cannot force-complete a disconnect against a connected integration'
);

-- =====================================================================
-- (4) Happy path: an admin caller force-completes the stuck
-- 'disconnecting' Tesla integration in one transaction.
-- =====================================================================

select is(
  public.force_complete_onlyevs_integration_disconnect(
    '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'tesla'
  ),
  'disconnected',
  'the RPC returns the new status'
);
select is(
  (select status from public.onlyevs_integrations where id = '91200000-0000-4000-8000-000000000001'),
  'disconnected',
  'the stuck integration is now disconnected'
);
select is(
  (select revision from public.onlyevs_integrations where id = '91200000-0000-4000-8000-000000000001'),
  2::bigint,
  'the integration revision is bumped by the update'
);
select is(
  (select count(*)::integer from private.onlyevs_integration_credentials
    where integration_id = '91200000-0000-4000-8000-000000000001'),
  0,
  'the parked credential row is deleted'
);
select is(
  (select count(*)::integer from public.onlyevs_telemetry_enrollments
    where integration_id = '91200000-0000-4000-8000-000000000001'),
  0,
  'the parked enrollment row is deleted'
);
select is(
  (select count(*)::integer from public.onlyevs_integration_audit_events
    where workspace_id = '91100000-0000-4000-8000-000000000001'
      and entity_id = '91200000-0000-4000-8000-000000000001'
      and action = 'force_complete_disconnect'
      and result = 'completed_local_only'),
  1,
  'exactly one audit event records the local-only force-complete'
);

-- =====================================================================
-- (5) Idempotency: a second call against the now-'disconnected'
-- integration is rejected -- no double-processing.
-- =====================================================================

select throws_ok(
  $$select public.force_complete_onlyevs_integration_disconnect(
    '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test', 'tesla'
  )$$,
  '55000',
  'integration_not_disconnecting',
  'a second force-complete call against an already-disconnected integration is rejected'
);

-- =====================================================================
-- (6) Regression pin: disconnect_onlyevs_integration's existing
-- sync/async split must not change.
-- =====================================================================

-- (6a) Sync branch: a connected Tesla integration with zero enrollment
-- rows disconnects immediately. Distinct shop_slug from the fixture above
-- -- unique(workspace_id, shop_slug, provider) forbids a second 'tesla' row
-- for the same shop_slug.
insert into public.workspace_branding (workspace_id, shop_slug, display_name)
values ('91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-2', 'Disconnect Recovery Test 2')
on conflict (workspace_id, shop_slug) do nothing;
insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status
) values (
  '91200000-0000-4000-8000-000000000003',
  '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-2', 'tesla', 'connected'
);
insert into private.onlyevs_integration_credentials (
  integration_id, workspace_id, provider_subject_ciphertext, refresh_token_ciphertext, key_version
) values (
  '91200000-0000-4000-8000-000000000003', '91100000-0000-4000-8000-000000000001',
  repeat('c', 40), repeat('d', 40), 1
);
select lives_ok(
  $$select public.disconnect_onlyevs_integration(
    '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-2', 'tesla'
  )$$,
  'the sync branch (no enrollments) disconnects without error'
);
select is(
  (select status from public.onlyevs_integrations where id = '91200000-0000-4000-8000-000000000003'),
  'disconnected',
  'a Tesla integration with no enrollment rows disconnects immediately (sync branch)'
);
select is(
  (select count(*)::integer from private.onlyevs_integration_credentials
    where integration_id = '91200000-0000-4000-8000-000000000003'),
  0,
  'the sync branch deletes the credential row immediately'
);

-- (6b) Async branch: a connected Tesla integration with an active
-- enrollment row parks as 'disconnecting' and the enrollment moves to
-- 'removal_requested' -- exactly the shape this migration recovers from.
-- Distinct shop_slug again for the same unique(workspace_id, shop_slug,
-- provider) reason.
insert into public.workspace_branding (workspace_id, shop_slug, display_name)
values ('91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-3', 'Disconnect Recovery Test 3')
on conflict (workspace_id, shop_slug) do nothing;
insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status
) values (
  '91200000-0000-4000-8000-000000000004',
  '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-3', 'tesla', 'connected'
);
insert into private.onlyevs_integration_credentials (
  integration_id, workspace_id, provider_subject_ciphertext, refresh_token_ciphertext, key_version
) values (
  '91200000-0000-4000-8000-000000000004', '91100000-0000-4000-8000-000000000001',
  repeat('e', 40), repeat('f', 40), 1
);
insert into public.onlyevs_vehicles (
  id, workspace_id, shop_slug, display_name, model, year, color
) values (
  '91300000-0000-4000-8000-000000000002',
  '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-3', 'Second Vehicle', 'Model Y', 2024, 'Black'
);
insert into public.onlyevs_telemetry_enrollments (
  workspace_id, vehicle_id, integration_id, status
) values (
  '91100000-0000-4000-8000-000000000001', '91300000-0000-4000-8000-000000000002',
  '91200000-0000-4000-8000-000000000004', 'active'
);
select lives_ok(
  $$select public.disconnect_onlyevs_integration(
    '91100000-0000-4000-8000-000000000001', 'disconnect-recovery-test-3', 'tesla'
  )$$,
  'the async branch (enrollment exists) parks without error'
);
select is(
  (select status from public.onlyevs_integrations where id = '91200000-0000-4000-8000-000000000004'),
  'disconnecting',
  'a Tesla integration with an active enrollment row parks as disconnecting (async branch)'
);
select is(
  (select status from public.onlyevs_telemetry_enrollments
    where integration_id = '91200000-0000-4000-8000-000000000004'),
  'removal_requested',
  'the async branch marks the enrollment removal_requested'
);
select is(
  (select count(*)::integer from private.onlyevs_integration_credentials
    where integration_id = '91200000-0000-4000-8000-000000000004'),
  1,
  'the async branch does not delete the credential row (that is this migration''s recovery path''s job)'
);

select * from finish();
rollback;
