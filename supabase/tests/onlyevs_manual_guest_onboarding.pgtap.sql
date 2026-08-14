begin;
select plan(10);

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
  '{"onlyevs":{"enabled":true,"publishedAt":1}}'::jsonb
)
on conflict (workspace_id, shop_slug) do update set features = excluded.features;
insert into public.onlyevs_vehicles (id, workspace_id, shop_slug, display_name, vin, status)
values (
  '73000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'tracked-rentals',
  'Black Model 3',
  '5YJ30000000000001',
  'active'
)
on conflict (id) do nothing;

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.create_onlyevs_manual_trip(
    '72000000-0000-4000-8000-000000000001',
    'tracked-rentals',
    '73000000-0000-4000-8000-000000000001',
    'Taylor Guest',
    'taylor@example.com',
    'America/Phoenix',
    now() + interval '2 days',
    now() + interval '4 days',
    repeat('a', 64),
    now() + interval '5 days'
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
  (select company_name from public.get_onlyevs_trip_invitation(repeat('a', 64))),
  'Tracked Rentals',
  'the high-entropy link resolves only guest-safe invitation fields'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"email":"taylor@example.com"}', true);
select is(
  (select tenant_ref from public.bind_onlyevs_trip_guest(repeat('a', 64))),
  '72000000-0000-4000-8000-000000000001~tracked-rentals',
  'the verified booking email binds the guest to the correct tenant'
);
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
  'the bound guest can publish a bounded progress summary'
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
    now() + interval '5 days'
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

select * from finish();
rollback;
