begin;
select plan(34);

select has_function(
  'public',
  'create_onlyevs_manual_trip',
  array['uuid', 'text', 'uuid', 'text', 'text', 'text', 'timestamptz', 'timestamptz', 'text', 'timestamptz'],
  'the previous web release keeps its manual-trip signature during the rolling deploy'
);
select has_function(
  'public',
  'confirm_onlyevs_calendar_candidate',
  array['uuid', 'uuid', 'text', 'text', 'text', 'timestamptz'],
  'the previous web release keeps its calendar-confirm signature during the rolling deploy'
);
select has_function(
  'public',
  'rotate_onlyevs_trip_public_token',
  array['uuid', 'text', 'timestamptz'],
  'the previous web release keeps its link-rotation signature during the rolling deploy'
);

select ok(
  not has_function_privilege('anon', 'public.create_onlyevs_manual_trip(uuid,uuid,text,uuid,text,text,text,timestamptz,timestamptz,text,text,text,timestamptz,text,smallint)', 'execute'),
  'anonymous callers cannot create owner trips'
);
select ok(
  has_function_privilege('anon', 'public.update_onlyevs_guest_onboarding_progress(text,jsonb)', 'execute'),
  'the private trip capability can publish guest progress without an account'
);
select ok(
  not has_function_privilege('anon', 'public.get_onlyevs_workspace_trip_snapshot(uuid,text)', 'execute'),
  'anonymous callers cannot read manager trip snapshots'
);
select ok(
  not has_function_privilege('anon', 'public.rotate_onlyevs_trip_public_token(uuid,text,timestamptz,text,smallint)', 'execute'),
  'anonymous callers cannot rotate private links'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_onlyevs_trip_reminder_material(uuid)', 'execute'),
  'authenticated clients cannot fetch reminder ciphertext or unmasked recipients'
);
select ok(
  has_function_privilege('service_role', 'public.get_onlyevs_trip_reminder_material(uuid)', 'execute'),
  'the server service role alone can fetch reminder delivery material'
);
select hasnt_function(
  'public',
  'bind_onlyevs_trip_guest',
  array['text'],
  'guest onboarding no longer exposes an account-binding RPC'
);
select ok(
  has_function_privilege('anon', 'public.get_onlyevs_trip_invitation(text)', 'execute'),
  'anonymous guests can resolve a high-entropy invitation'
);
select hasnt_function(
  'public',
  'onlyevs_trip_email_matches',
  array['text', 'text'],
  'guest onboarding no longer exposes booking-email validation'
);
select ok(
  has_function_privilege('anon', 'public.complete_onlyevs_guest_onboarding(text,boolean,text)', 'execute'),
  'the private trip capability can record explicit Tesla-access consent'
);
select ok(
  has_function_privilege('anon', 'public.get_onlyevs_ready_invite(text)', 'execute'),
  'the private trip capability can poll its own ready Tesla invite'
);

insert into auth.users (id)
values
  ('71000000-0000-4000-8000-000000000001'),
  ('71000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug)
values ('72000000-0000-4000-8000-000000000001', 'Tracked Rentals', 'tracked-rentals')
on conflict (id) do nothing;
insert into public.workspace_users (workspace_id, user_id, role)
values (
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'manager'
)
on conflict (workspace_id, user_id) do nothing;
insert into public.workspace_branding (workspace_id, shop_slug, display_name, features)
values (
  '72000000-0000-4000-8000-000000000001',
  'tracked-rentals',
  'Tracked Rentals',
  '{"onlyevs":{"enabled":true,"publishedAt":1,"config":{}}}'::jsonb
)
on conflict (workspace_id, shop_slug) do update set features = excluded.features;
insert into public.onlyevs_vehicles (
  id, workspace_id, shop_slug, display_name, model, trim, year, color, vin, status
)
values (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'tracked-rentals',
  'Black Model 3',
  'Model 3',
  'Performance',
  2024,
  'Solid Black',
  '5YJ30000000000001',
  'active'
)
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.create_onlyevs_manual_trip(
    '74000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'tracked-rentals',
    '73000000-0000-4000-8000-000000000001',
    'Taylor Guest',
    'taylor@example.com',
    'America/Phoenix',
    now() + interval '2 days',
    now() + interval '4 days',
    'PHX Sky Harbor',
    'PHX Sky Harbor',
    repeat('a', 64),
    now() + interval '5 days',
    repeat('c', 64),
    1::smallint
  )$$,
  'a manager can create one durable private guest onboarding'
);
select is(
  (select count(*)::integer from public.onlyevs_trips where workspace_id = '72000000-0000-4000-8000-000000000001'),
  1,
  'the trip is persisted once'
);
select is(
  (select verified_email_hash from private.onlyevs_guest_bindings where workspace_id = '72000000-0000-4000-8000-000000000001'),
  encode(extensions.digest('taylor@example.com', 'sha256'), 'hex'),
  'the private binding stores an email hash rather than another plaintext copy'
);
select is(
  (select token_ciphertext from private.onlyevs_trip_link_secrets where trip_id = '74000000-0000-4000-8000-000000000001'),
  repeat('c', 64),
  'trip creation persists the resendable capability only as server-side ciphertext'
);
select is(
  (select company_name from public.get_onlyevs_trip_invitation(repeat('a', 64))),
  'Tracked Rentals',
  'the high-entropy link resolves only guest-safe invitation fields'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select lives_ok(
  $$select public.update_onlyevs_guest_onboarding_progress(
    repeat('a', 64),
    '{
      "stepId":"plan",
      "pct":25,
      "isDone":false,
      "completed":["welcome"],
      "checklist":{},
      "moduleTotal":5,
      "checklistDone":0,
      "checklistTotal":4,
      "requiredChecklistDone":0,
      "requiredChecklistTotal":3,
      "updatedAt":1700000000000
    }'::jsonb
  )$$,
  'the unexpired private trip capability can publish a bounded progress summary'
);
select ok(
  (select bound_at is not null
   from private.onlyevs_guest_bindings
   where workspace_id = '72000000-0000-4000-8000-000000000001'),
  'the first capability-authorized progress update records that onboarding opened'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is(
  (select onboarding_progress ->> 'pct'
   from public.get_onlyevs_workspace_trip_snapshot(
     '72000000-0000-4000-8000-000000000001',
     'tracked-rentals'
   )),
  '25',
  'the owner snapshot exposes the tracked progress without private identity fields'
);
select lives_ok(
  $$select public.rotate_onlyevs_trip_public_token(
    (select id from public.onlyevs_trips where workspace_id = '72000000-0000-4000-8000-000000000001'),
    repeat('b', 64),
    now() + interval '5 days',
    repeat('d', 64),
    1::smallint
  )$$,
  'a manager can rotate a lost guest link'
);
select is_empty(
  $$select * from public.get_onlyevs_trip_invitation(repeat('a', 64))$$,
  'rotation invalidates the previous link immediately'
);
select isnt_empty(
  $$select * from public.get_onlyevs_trip_invitation(repeat('b', 64))$$,
  'the replacement link resolves the same booking'
);
select is(
  (select token_ciphertext from private.onlyevs_trip_link_secrets where trip_id = '74000000-0000-4000-8000-000000000001'),
  repeat('d', 64),
  'rotation replaces the ciphertext in the same transaction as the public hash'
);
select lives_ok(
  $$select public.begin_onlyevs_trip_reminder('74000000-0000-4000-8000-000000000001')$$,
  'a manager can reserve one reminder delivery'
);
select throws_ok(
  $$select public.begin_onlyevs_trip_reminder('74000000-0000-4000-8000-000000000001')$$,
  '55000',
  'trip_reminder_cooldown',
  'a pending reminder enforces the five-minute cooldown'
);
select lives_ok(
  $$select public.finish_onlyevs_trip_reminder(
    (select id from public.onlyevs_reminder_deliveries
      where trip_id = '74000000-0000-4000-8000-000000000001'
      order by requested_at desc limit 1),
    'failed', null, 'provider_unavailable'
  )$$,
  'a failed provider attempt is recorded durably'
);
select is(
  (select action from public.onlyevs_integration_audit_events
    where entity_id = '74000000-0000-4000-8000-000000000001'
    order by created_at desc limit 1),
  'guest_reminder_failed',
  'the audit action does not describe a failed reminder as sent'
);
select throws_ok(
  $$select public.begin_onlyevs_trip_reminder('74000000-0000-4000-8000-000000000001')$$,
  '55000',
  'trip_reminder_retry_delay',
  'a failed reminder enforces the one-minute retry delay'
);
update public.onlyevs_reminder_deliveries
set requested_at = now() - interval '2 minutes'
where trip_id = '74000000-0000-4000-8000-000000000001';
insert into public.onlyevs_reminder_deliveries (
  workspace_id, trip_id, requested_by, status, recipient_hash, recipient_masked,
  error_code, requested_at, completed_at
)
select
  '72000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'failed', repeat('e', 64), 'ta••••@example.com', 'provider_unavailable',
  now() - interval '2 minutes', now() - interval '2 minutes'
from generate_series(1, 5);
select throws_ok(
  $$select public.begin_onlyevs_trip_reminder('74000000-0000-4000-8000-000000000001')$$,
  '54000',
  'trip_reminder_daily_limit',
  'a trip cannot exceed six reminder attempts in 24 hours'
);
delete from public.onlyevs_reminder_deliveries
where trip_id = '74000000-0000-4000-8000-000000000001';
insert into public.onlyevs_trips (
  id, workspace_id, shop_slug, vehicle_id, guest_name, guest_email, timezone,
  starts_at, ends_at, public_token_hash, token_expires_at
)
select
  '74000000-0000-4000-8000-000000000002', workspace_id, shop_slug, vehicle_id,
  'Workspace Limit Guest', 'limit@example.com', timezone,
  starts_at + interval '20 days', ends_at + interval '20 days', repeat('f', 64),
  token_expires_at + interval '20 days'
from public.onlyevs_trips
where id = '74000000-0000-4000-8000-000000000001';
insert into public.onlyevs_reminder_deliveries (
  workspace_id, trip_id, requested_by, status, recipient_hash, recipient_masked,
  error_code, requested_at, completed_at
)
select
  '72000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000001',
  'failed', repeat('f', 64), 'li••••@example.com', 'provider_unavailable',
  now() - interval '2 minutes', now() - interval '2 minutes'
from generate_series(1, 100);
select throws_ok(
  $$select public.begin_onlyevs_trip_reminder('74000000-0000-4000-8000-000000000001')$$,
  '54000',
  'workspace_reminder_daily_limit',
  'a workspace cannot exceed 100 reminder attempts in 24 hours'
);
update public.onlyevs_trips
set status = 'completed'
where id = '74000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.begin_onlyevs_trip_reminder('74000000-0000-4000-8000-000000000001')$$,
  '55000',
  'trip_reminder_unavailable',
  'a completed trip cannot send a pickup reminder'
);

select * from finish();
rollback;
