begin;
select plan(53);

select has_table('public'::name, 'onlyevs_integrations'::name);
select has_table('public'::name, 'onlyevs_calendar_candidates'::name);
select has_table('public'::name, 'onlyevs_trips'::name);
select has_table('public'::name, 'onlyevs_access_grants'::name);
select has_table('public'::name, 'onlyevs_vehicle_stats_current'::name);
select has_table('public'::name, 'onlyevs_integration_audit_events'::name);
select has_table('public'::name, 'onlyevs_brand_assets'::name);
select has_table('public'::name, 'onlyevs_custom_domains'::name);
select has_table('public'::name, 'onlyevs_telemetry_enrollments'::name);
select has_table('private'::name, 'onlyevs_integration_credentials'::name);
select has_table('private'::name, 'onlyevs_owner_import_sessions'::name);
select has_table('private'::name, 'onlyevs_guest_bindings'::name);
select has_table('private'::name, 'onlyevs_access_secrets'::name);
select has_table('private'::name, 'onlyevs_vehicle_location_points'::name);

select policies_are(
  'public',
  'onlyevs_access_grants',
  array['onlyevs_access_grants_managers_select', 'onlyevs_access_grants_worker_all']
);
select policies_are(
  'public',
  'onlyevs_telemetry_enrollments',
  array['onlyevs_telemetry_managers_select', 'onlyevs_telemetry_worker_all']
);
select policies_are(
  'public',
  'onlyevs_brand_assets',
  array['onlyevs_brand_assets_managers_all', 'onlyevs_brand_assets_worker_all']
);
select policies_are(
  'public',
  'onlyevs_custom_domains',
  array['onlyevs_custom_domains_managers_select', 'onlyevs_custom_domains_public_active', 'onlyevs_custom_domains_worker_all']
);
select policies_are(
  'public',
  'onlyevs_vehicle_stats_current',
  array['onlyevs_vehicle_stats_managers_select', 'onlyevs_vehicle_stats_worker_all']
);

select table_privs_are(
  'private',
  'onlyevs_integration_credentials',
  'authenticated',
  array[]::text[]
);
select table_privs_are(
  'private',
  'onlyevs_owner_import_sessions',
  'authenticated',
  array[]::text[]
);
select table_privs_are(
  'private',
  'onlyevs_access_secrets',
  'authenticated',
  array[]::text[]
);
select table_privs_are(
  'private',
  'onlyevs_vehicle_location_points',
  'authenticated',
  array[]::text[]
);

select has_index(
  'public'::name,
  'onlyevs_access_grants'::name,
  'onlyevs_access_grants_due_idx'::name
);
select has_index(
  'public'::name,
  'onlyevs_telemetry_enrollments'::name,
  'onlyevs_telemetry_enrollments_due_idx'::name
);
select has_index(
  'private'::name,
  'onlyevs_vehicle_location_points'::name,
  'onlyevs_location_retention_idx'::name
);
select has_index(
  'public'::name,
  'onlyevs_integrations'::name,
  'onlyevs_integrations_calendar_due_idx'::name
);
select has_index(
  'public'::name,
  'onlyevs_trips'::name,
  'onlyevs_trips_calendar_candidate_unique_idx'::name
);
select function_privs_are(
  'private',
  'claim_onlyevs_due_access_grants',
  array['text', 'integer'],
  'public',
  array[]::text[]
);
select function_privs_are(
  'private',
  'claim_onlyevs_due_telemetry',
  array['text', 'integer'],
  'public',
  array[]::text[]
);
select function_privs_are(
  'private',
  'claim_onlyevs_due_domains',
  array['text', 'integer'],
  'public',
  array[]::text[]
);
select function_privs_are(
  'private',
  'claim_onlyevs_due_calendar',
  array['text', 'integer'],
  'public',
  array[]::text[]
);
select has_function('public', 'request_onlyevs_custom_domain', array['uuid', 'text', 'text']);
select has_function('public', 'request_onlyevs_custom_domain_removal', array['uuid', 'uuid']);
select has_function('public', 'get_onlyevs_ready_invite', array['text']);
select has_function(
  'public',
  'create_onlyevs_owner_import_session',
  array['uuid', 'text', 'text', 'jsonb', 'timestamp with time zone']
);
select has_function('public', 'get_onlyevs_owner_import_profile', array['text']);
select has_function('public', 'delete_onlyevs_owner_import_session', array['text']);
select has_function('public', 'resolve_onlyevs_calendar_candidate_change', array['uuid', 'text']);
select has_column(
  'public'::name,
  'onlyevs_access_grants'::name,
  'provider_reconciliation'::name,
  'access grants retain external invitation reconciliation state'
);

insert into auth.users (id)
values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug)
values ('20000000-0000-4000-8000-000000000001', 'evhost.app test', 'onlyevs-test')
on conflict (id) do nothing;
insert into public.workspace_branding (workspace_id, shop_slug, display_name)
values ('20000000-0000-4000-8000-000000000001', 'onlyevs-test', 'evhost.app test')
on conflict (workspace_id, shop_slug) do nothing;

insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status, selected_calendar_id,
  selected_calendar_timezone, next_sync_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'onlyevs-test', 'google_calendar', 'connected', 'primary', 'UTC', now()
);
insert into public.onlyevs_calendar_candidates (
  id, workspace_id, shop_slug, integration_id, external_event_id, summary,
  starts_at, ends_at, timezone, status
) values (
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'onlyevs-test', '30000000-0000-4000-8000-000000000001',
  'cancelled-event', 'Confirmed rental',
  now() + interval '2 days', now() + interval '3 days', 'UTC', 'confirmed'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.ingest_onlyevs_calendar_candidates(
    '20000000-0000-4000-8000-000000000001',
    'onlyevs-test',
    '30000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'external_event_id', 'cancelled-event',
      'summary', 'Confirmed rental',
      'starts_at', (now() + interval '2 days')::text,
      'ends_at', (now() + interval '3 days')::text,
      'timezone', 'UTC',
      'status', 'cancelled',
      'deleted_at', now()::text
    ))
  )$$,
  'a provider cancellation can be reconciled without cancelling a confirmed trip'
);
select is(
  (select status from public.onlyevs_calendar_candidates where id = '40000000-0000-4000-8000-000000000001'),
  'needs_review',
  'a confirmed calendar candidate becomes visible owner review state'
);
select is(
  (select deleted_at from public.onlyevs_calendar_candidates where id = '40000000-0000-4000-8000-000000000001'),
  null::timestamptz,
  'the review candidate is not hidden as deleted'
);
select is(
  (select change_kind from public.onlyevs_calendar_candidates where id = '40000000-0000-4000-8000-000000000001'),
  'cancel',
  'the review state records that the provider cancelled the event'
);
insert into public.onlyevs_vehicles (id, workspace_id, shop_slug, display_name, vin)
values (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'onlyevs-test', 'Test Model 3', '5YJ30000000000000'
);
insert into public.onlyevs_trips (
  id, workspace_id, shop_slug, calendar_candidate_id, vehicle_id,
  guest_name, guest_email, timezone, starts_at, ends_at,
  public_token_hash, token_expires_at
) values (
  '60000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 'onlyevs-test',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'Test Guest', 'guest@example.com', 'UTC',
  now() + interval '2 days', now() + interval '3 days',
  repeat('b', 64), now() + interval '4 days'
);
insert into public.onlyevs_access_grants (
  id, workspace_id, trip_id, vehicle_id, status, issue_at, revoke_at,
  next_action_at, claimed_by, claim_expires_at
) values (
  '70000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'issuing', now() + interval '46 hours', now() + interval '73 hours',
  now() + interval '46 hours', 'worker-under-test', now() + interval '2 minutes'
);
select lives_ok(
  $$select public.resolve_onlyevs_calendar_candidate_change(
    '40000000-0000-4000-8000-000000000001', 'cancel'
  )$$,
  'an owner can atomically apply a provider cancellation'
);
select is(
  (select status from public.onlyevs_trips where id = '60000000-0000-4000-8000-000000000001'),
  'cancelled',
  'the confirmed trip is cancelled'
);
select is(
  (select status from public.onlyevs_access_grants where id = '70000000-0000-4000-8000-000000000001'),
  'expired',
  'an in-flight Tesla invite is expired and its worker lease is invalidated'
);
select is(
  (select status from public.onlyevs_calendar_candidates where id = '40000000-0000-4000-8000-000000000001'),
  'cancelled',
  'the reviewed provider event is resolved as cancelled'
);
select lives_ok(
  $$select public.create_onlyevs_owner_import_session(
    '20000000-0000-4000-8000-000000000001',
    'onlyevs-test',
    repeat('a', 64),
    '{"id":"live_test","vehicles":[{"vin":"5YJ30000000000000"}]}'::jsonb,
    now() + interval '15 minutes'
  )$$,
  'owner can create a short-lived private import session'
);
select is(
  public.get_onlyevs_owner_import_profile(repeat('a', 64)),
  '{"id":"live_test","vehicles":[{"vin":"5YJ30000000000000"}]}'::jsonb,
  'the owning session can resolve its import profile'
);
select is(
  (select count(*)::integer from private.onlyevs_owner_import_sessions),
  1,
  'the opaque handle creates one private server-side row'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is(
  public.get_onlyevs_owner_import_profile(repeat('a', 64)),
  null::jsonb,
  'another authenticated user cannot resolve the owner import profile'
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.delete_onlyevs_owner_import_session(repeat('a', 64))$$,
  'the owning session can delete its opaque import handle'
);

select * from finish();
rollback;
