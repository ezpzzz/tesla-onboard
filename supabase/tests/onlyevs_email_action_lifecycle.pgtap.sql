begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- RPC surface + privileges
-- ---------------------------------------------------------------------------
select has_function('public', 'confirm_onlyevs_email_candidate', array['uuid', 'uuid', 'bigint', 'jsonb']);
select has_function('public', 'execute_onlyevs_email_action', array['uuid', 'uuid', 'text', 'uuid', 'text', 'timestamp with time zone', 'text', 'smallint']);
select has_function('public', 'abort_onlyevs_email_revocation', array['uuid', 'uuid', 'bigint', 'text']);
select has_function('private', 'create_onlyevs_trip_core', array[
  'uuid', 'uuid', 'text', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text',
  'timestamp with time zone', 'timestamp with time zone', 'text', 'text',
  'text', 'timestamp with time zone', 'text', 'smallint'
]);
select has_function('private', 'supersede_onlyevs_email_candidate_and_action', array['uuid', 'uuid']);

select ok(
  not has_function_privilege('anon', 'public.confirm_onlyevs_email_candidate(uuid,uuid,bigint,jsonb)', 'execute'),
  'anonymous callers cannot confirm email candidates'
);
select ok(
  has_function_privilege('authenticated', 'public.confirm_onlyevs_email_candidate(uuid,uuid,bigint,jsonb)', 'execute'),
  'authenticated (manager-checked at runtime) callers can confirm email candidates'
);
select ok(
  not has_function_privilege('anon', 'public.abort_onlyevs_email_revocation(uuid,uuid,bigint,text)', 'execute'),
  'anonymous callers cannot abort a revocation'
);
select ok(
  has_function_privilege('authenticated', 'public.abort_onlyevs_email_revocation(uuid,uuid,bigint,text)', 'execute'),
  'authenticated (manager-checked at runtime) callers can abort a revocation'
);
select ok(
  not has_function_privilege('authenticated', 'public.execute_onlyevs_email_action(uuid,uuid,text,uuid,text,timestamptz,text,smallint)', 'execute'),
  'authenticated clients cannot directly execute email action steps'
);
select ok(
  has_function_privilege('onlyevs_worker', 'public.execute_onlyevs_email_action(uuid,uuid,text,uuid,text,timestamptz,text,smallint)', 'execute'),
  'only the worker role executes email action steps'
);
select ok(
  not has_function_privilege('authenticated', 'private.supersede_onlyevs_email_candidate_and_action(uuid,uuid)', 'execute'),
  'authenticated clients cannot call the private supersede helper'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug)
values ('82000000-0000-4000-8000-000000000001', 'Email Action Tests', 'email-action-tests')
on conflict (id) do nothing;
insert into public.workspace_users (workspace_id, user_id, role)
values ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'manager')
on conflict (workspace_id, user_id) do update set role = excluded.role;
insert into public.workspace_branding (workspace_id, shop_slug, display_name, features)
values (
  '82000000-0000-4000-8000-000000000001', 'email-action-tests', 'Email Action Tests',
  '{"onlyevs":{"enabled":true,"publishedAt":1,"config":{}}}'::jsonb
)
on conflict (workspace_id, shop_slug) do update set features = excluded.features;
insert into public.onlyevs_vehicles (
  id, workspace_id, shop_slug, display_name, model, trim, year, color, vin, status
) values (
  '83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'email-action-tests', 'White Model Y', 'Model Y', 'Long Range', 2025, 'Pearl White',
  '5YJYGDEE0NF000001', 'active'
) on conflict (id) do nothing;
insert into public.onlyevs_email_integrations (
  id, workspace_id, shop_slug, status, mode
) values (
  '84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'email-action-tests', 'active', 'review'
) on conflict (id) do nothing;

create or replace function pg_temp.seed_inbound(p_id uuid, p_msgid text)
returns void language sql as $$
  insert into public.onlyevs_inbound_emails (
    id, workspace_id, integration_id, accepted_alias_revision, rfc_message_id,
    raw_sha256, normalized_sha256, ciphertext_sha256, raw_bytes, normalized_bytes,
    ciphertext_bytes, kek_version, receiver_auth_verdict, state, delete_after
  ) values (
    p_id, '82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001', 1, p_msgid,
    repeat('a', 64), repeat('b', 64), repeat('c', 64), 100, 100, 140, 1, 'pass', 'classified',
    now() + interval '30 days'
  ) on conflict (id) do nothing;
$$;

create or replace function pg_temp.seed_candidate(
  p_id uuid, p_inbound_id uuid, p_reservation_id text, p_event_type text,
  p_facts jsonb, p_occurred_at timestamptz
) returns void language sql as $$
  insert into public.onlyevs_email_candidates (
    id, workspace_id, integration_id, inbound_email_id, reservation_id, event_type,
    proposed_state, blocker_codes, state, occurred_at
  ) values (
    p_id, '82000000-0000-4000-8000-000000000001', '84000000-0000-4000-8000-000000000001',
    p_inbound_id, p_reservation_id, p_event_type, p_facts, '{}', 'pending', p_occurred_at
  ) on conflict (id) do nothing;
$$;

select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000001', 'booking-res100@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'RES100', 'booking',
  jsonb_build_object(
    -- Key names match lib/email/turo-parser.ts's actual proposedState output
    -- (guestFirstName/tripTimeZone/tripStartAt/tripEndAt), not arbitrary
    -- SQL-side names -- see the db_committing key-contract comment in
    -- 20260816150000_onlyevs_email_action_lifecycle.sql. guestEmail has no
    -- parser source and is included here to stand in for an owner correction.
    'guestFirstName', 'Taylor Reyes', 'guestEmail', 'taylor@example.com', 'tripTimeZone', 'America/Phoenix',
    'tripStartAt', (now() + interval '2 days')::text, 'tripEndAt', (now() + interval '4 days')::text
  ),
  now() - interval '10 minutes'
);

-- ---------------------------------------------------------------------------
-- Happy path: booking candidate -> confirm -> create_trip saga -> succeeded.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 999, '{}'::jsonb
  )$$,
  '40001',
  'email_candidate_revision_conflict',
  'a stale expected_revision is rejected'
);

select lives_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 1, '{}'::jsonb
  )$$,
  'a manager can confirm a pending booking candidate'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000001'),
  'applying',
  'the confirmed candidate moves to applying'
);
select is(
  (select action_type from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'create_trip',
  'a booking event confirms into a create_trip action'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'queued',
  'the new action starts queued'
);

select throws_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 2, '{}'::jsonb
  )$$,
  '40001',
  'email_candidate_revision_conflict',
  'a candidate already applying cannot be confirmed again'
);

-- queued -> claimed
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$,
  'execute step 1: queued -> claimed'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'claimed', 'action is claimed after step 1'
);

-- claimed -> validating
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$,
  'execute step 2: claimed -> validating'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'validating', 'action is validating after step 2'
);

-- validating -> db_committing (create_trip is not destructive: no owner alert)
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$,
  'execute step 3: validating -> db_committing'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'db_committing', 'action is db_committing after step 3'
);

-- db_committing without trip-link material stays incomplete (needs_review)
-- is intentionally NOT exercised on this row (would consume the saga); a
-- dedicated incomplete-facts case is covered further below on RES999.

-- db_committing -> succeeded, with the worker-supplied trip-link envelope.
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1',
    '87000000-0000-4000-8000-000000000001',
    repeat('a', 64), now() + interval '10 days', repeat('x', 40), 1::smallint
  )$$,
  'execute step 4: db_committing -> succeeded'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'succeeded', 'action succeeds once the trip is created'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000001'),
  'applied', 'the candidate is marked applied'
);
select is(
  (select effective_trip_id from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000001'),
  '87000000-0000-4000-8000-000000000001'::uuid,
  'the candidate points at the newly created trip'
);
select is(
  (select guest_name from public.onlyevs_trips where id = '87000000-0000-4000-8000-000000000001'),
  'Taylor Reyes', 'the trip carries the extracted guest name'
);
select is(
  (select email_candidate_id from public.onlyevs_trips where id = '87000000-0000-4000-8000-000000000001'),
  '86000000-0000-4000-8000-000000000001'::uuid,
  'the trip records which email candidate created it'
);

-- Calling execute again on a terminal action is a safe no-op.
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$,
  'a terminal action tolerates another execute call'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000001'),
  'succeeded', 'a succeeded action stays succeeded'
);

-- ---------------------------------------------------------------------------
-- A non-actionable event type cannot be confirmed.
-- ---------------------------------------------------------------------------
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000002', 'noise-res999@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000002', null, 'noise',
  jsonb_build_object('subject', 'You were paid'), now()
);
select throws_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000002', 1, '{}'::jsonb
  )$$,
  '55000',
  'email_candidate_not_confirmable',
  'a noise candidate cannot be confirmed into an action'
);

-- ---------------------------------------------------------------------------
-- Manager-only enforcement.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000001', 3, '{}'::jsonb
  )$$,
  '42501',
  'workspace_manager_required',
  'a non-member cannot confirm an email candidate'
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Incomplete facts fail closed to needs_review rather than a half-built trip.
-- ---------------------------------------------------------------------------
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000003', 'booking-res999@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000003', '85000000-0000-4000-8000-000000000003', 'RES999', 'booking',
  jsonb_build_object('subject', 'A trip is booked!'), now()
);
select lives_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000003', 1, '{}'::jsonb
  )$$,
  'an owner can confirm a candidate missing extracted facts (manual override)'
);
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000003'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$, 'RES999 step 1'
);
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000003'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$, 'RES999 step 2'
);
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000003'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$, 'RES999 step 3 (validating -> db_committing)'
);
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000003'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$, 'RES999 step 4: db_committing without facts fails closed'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000003'),
  'needs_review', 'an action with no extractable facts and no corrections lands on needs_review'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000003'),
  'needs_review', 'the linked candidate also returns to needs_review'
);
select is(
  (select count(*)::integer from public.onlyevs_trips where workspace_id = '82000000-0000-4000-8000-000000000001'),
  1, 'no trip was created for the incomplete candidate'
);

-- ---------------------------------------------------------------------------
-- Helper: drive a fresh booking reservation all the way to an applied trip,
-- used as the pre-existing trip that a change/cancellation targets.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.apply_booking(
  p_reservation text, p_candidate_id uuid, p_inbound_id uuid, p_trip_id uuid,
  p_day_offset integer default 2
) returns void language plpgsql as $$
begin
  -- Each caller gets a distinct, non-overlapping window on the shared test
  -- vehicle (the exclusion constraint on active trips is real and correctly
  -- enforced end-to-end -- reusing one window across reservations would
  -- itself produce a vehicle_schedule_conflict here).
  perform pg_temp.seed_inbound(p_inbound_id, p_reservation || '@turo.com');
  perform pg_temp.seed_candidate(
    p_candidate_id, p_inbound_id, p_reservation, 'booking',
    jsonb_build_object(
      'guestFirstName', 'Prior Guest', 'guestEmail', 'prior@example.com', 'tripTimeZone', 'UTC',
      'tripStartAt', (now() + make_interval(days => p_day_offset))::text,
      'tripEndAt', (now() + make_interval(days => p_day_offset + 1))::text
    ),
    now() - interval '1 hour'
  );
  perform public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', p_candidate_id, 1, '{}'::jsonb);
  perform public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = p_candidate_id),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  );
  perform public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = p_candidate_id),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  );
  perform public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = p_candidate_id),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  );
  perform public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = p_candidate_id),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1',
    p_trip_id, encode(extensions.digest(p_trip_id::text, 'sha256'), 'hex'),
    now() + make_interval(days => p_day_offset + 30), repeat('y', 40), 1::smallint
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Destructive brake scenario A: accept -> wait -> claim (deadline manipulated,
-- not slept).
-- ---------------------------------------------------------------------------
select pg_temp.apply_booking(
  'RES201', '86000000-0000-4000-8000-000000000101', '85000000-0000-4000-8000-000000000101',
  '87000000-0000-4000-8000-000000000101', 20
);
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000201', 'cancel-res201@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000201', '85000000-0000-4000-8000-000000000201', 'RES201', 'cancellation',
  jsonb_build_object('subject', 'Guest cancelled'), now()
);
select lives_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000201', 1, '{}'::jsonb
  )$$, 'a cancellation candidate with a resolvable prior trip confirms'
);
select is(
  (select action_type from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'cancel_trip', 'the cancellation confirms into a cancel_trip action'
);
select is(
  (select effective_trip_id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  '87000000-0000-4000-8000-000000000101'::uuid,
  'the cancel action targets the previously applied trip'
);
-- queued -> claimed -> validating -> awaiting_owner_alert
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'awaiting_owner_alert', 'a destructive action always announces itself before mutating anything'
);
select is(
  (select brake_deadline from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  null::timestamptz, 'the brake has not started before the owner alert is accepted'
);

insert into public.onlyevs_email_deliveries (
  id, workspace_id, action_id, purpose, recipient_route, recipient_ciphertext, stable_message_id, state
) values (
  '88000000-0000-4000-8000-000000000201', '82000000-0000-4000-8000-000000000001',
  (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'owner_alert', 'owner_alert', 'ciphertext-placeholder', 'evhost-alert-201@mail.evhost.app', 'sending'
);
select lives_ok(
  $$select public.reconcile_onlyevs_sendgrid_event(
    'sg-evt-201-processed', '82000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000201',
    'processed', null, 1::smallint, now()
  )$$, 'a processed webhook event resolves the owner-alert delivery to accepted'
);
select is(
  (select state from public.onlyevs_email_deliveries where id = '88000000-0000-4000-8000-000000000201'),
  'accepted', 'the owner-alert delivery is accepted'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'revocation_pending', 'accepting the owner alert starts the destructive brake'
);
select ok(
  (select brake_deadline from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201') > now(),
  'the brake deadline is set roughly 30 minutes out'
);
select is(
  (select state from public.onlyevs_email_outbox where job_type = 'action'
    and entity_id = (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201')),
  'pending', 'the outbox job is rescheduled for the brake deadline rather than left completed'
);

-- Re-delivering the same webhook event id is a no-op (idempotent claim).
select is(
  (select public.reconcile_onlyevs_sendgrid_event(
    'sg-evt-201-processed', '82000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000201',
    'processed', null, 1::smallint, now()
  )), false, 'a duplicate sg_event_id is rejected without a second brake start'
);

-- Fake the deadline into the past instead of sleeping 30 minutes.
update public.onlyevs_email_actions set brake_deadline = now() - interval '1 minute'
  where candidate_id = '86000000-0000-4000-8000-000000000201';
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$, 'revocation_pending -> provider_mutating once the deadline has passed'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'provider_mutating', 'the action claims the provider step once due'
);
select ok(
  (select provider_claimed_at from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201') is not null,
  'provider_claimed_at is stamped, closing the abort window'
);
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'succeeded', 'the cancellation reaches succeeded once the brake clears'
);
select is(
  (select status from public.onlyevs_trips where id = '87000000-0000-4000-8000-000000000101'),
  'cancelled', 'the target trip is cancelled'
);

-- ---------------------------------------------------------------------------
-- Destructive brake scenario B: accept -> abort-before-deadline.
-- ---------------------------------------------------------------------------
select pg_temp.apply_booking(
  'RES202', '86000000-0000-4000-8000-000000000102', '85000000-0000-4000-8000-000000000102',
  '87000000-0000-4000-8000-000000000102', 40
);
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000202', 'cancel-res202@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000202', '85000000-0000-4000-8000-000000000202', 'RES202', 'cancellation',
  jsonb_build_object('subject', 'Guest cancelled'), now()
);
select public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000202', 1, '{}'::jsonb);
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
insert into public.onlyevs_email_deliveries (
  id, workspace_id, action_id, purpose, recipient_route, recipient_ciphertext, stable_message_id, state
) values (
  '88000000-0000-4000-8000-000000000202', '82000000-0000-4000-8000-000000000001',
  (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
  'owner_alert', 'owner_alert', 'ciphertext-placeholder', 'evhost-alert-202@mail.evhost.app', 'sending'
);
select public.reconcile_onlyevs_sendgrid_event(
  'sg-evt-202-processed', '82000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000202',
  'processed', null, 1::smallint, now()
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
  'revocation_pending', 'RES202 reaches the brake'
);

select throws_ok(
  $$select public.abort_onlyevs_email_revocation(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
    999, 'Guest confirmed by phone; keep the original trip.'
  )$$, '40001', 'email_action_revision_conflict', 'abort rejects a stale expected_revision'
);
select throws_ok(
  $$select public.abort_onlyevs_email_revocation(
    '82000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000',
    1, 'Guest confirmed by phone; keep the original trip.'
  )$$, 'P0002', 'email_action_not_found', 'abort rejects a missing action id'
);

select lives_ok(
  $$select public.abort_onlyevs_email_revocation(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
    (select revision from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
    'Guest confirmed by phone; keep the original trip.'
  )$$, 'a manager aborts the revocation before its deadline'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
  'aborted', 'the action is aborted'
);
select is(
  (select status from public.onlyevs_trips where id = '87000000-0000-4000-8000-000000000102'),
  'confirmed', 'the effective trip is left untouched by an aborted revocation'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000202'),
  'needs_review', 'the candidate returns to needs_review after an abort'
);

select throws_ok(
  $$select public.abort_onlyevs_email_revocation(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
    (select revision from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000202'),
    'Second attempt.'
  )$$, '55000', 'email_action_not_abortable', 'an already-aborted action cannot be aborted again'
);

-- Abort is refused once the deadline has passed, even before a worker claims it.
select pg_temp.apply_booking(
  'RES205', '86000000-0000-4000-8000-000000000105', '85000000-0000-4000-8000-000000000105',
  '87000000-0000-4000-8000-000000000105', 60
);
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000206', 'cancel-res205@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000206', '85000000-0000-4000-8000-000000000206', 'RES205', 'cancellation',
  jsonb_build_object('subject', 'Guest cancelled'), now()
);
select public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000206', 1, '{}'::jsonb);
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000206'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000206'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000206'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
insert into public.onlyevs_email_deliveries (
  id, workspace_id, action_id, purpose, recipient_route, recipient_ciphertext, stable_message_id, state
) values (
  '88000000-0000-4000-8000-000000000206', '82000000-0000-4000-8000-000000000001',
  (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000206'),
  'owner_alert', 'owner_alert', 'ciphertext-placeholder', 'evhost-alert-206@mail.evhost.app', 'sending'
);
select public.reconcile_onlyevs_sendgrid_event(
  'sg-evt-206-processed', '82000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000206',
  'processed', null, 1::smallint, now()
);
update public.onlyevs_email_actions set brake_deadline = now() - interval '1 second'
  where candidate_id = '86000000-0000-4000-8000-000000000206';
select throws_ok(
  $$select public.abort_onlyevs_email_revocation(
    '82000000-0000-4000-8000-000000000001',
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000206'),
    (select revision from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000206'),
    'Too late.'
  )$$, '55000', 'email_action_not_abortable', 'abort is refused once the deadline has passed'
);

-- ---------------------------------------------------------------------------
-- Destructive brake scenario C: accept -> bounce -> needs_review.
-- ---------------------------------------------------------------------------
select pg_temp.apply_booking(
  'RES203', '86000000-0000-4000-8000-000000000103', '85000000-0000-4000-8000-000000000103',
  '87000000-0000-4000-8000-000000000103', 80
);
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000203', 'cancel-res203@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000203', '85000000-0000-4000-8000-000000000203', 'RES203', 'cancellation',
  jsonb_build_object('subject', 'Guest cancelled'), now()
);
select public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000203', 1, '{}'::jsonb);
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
insert into public.onlyevs_email_deliveries (
  id, workspace_id, action_id, purpose, recipient_route, recipient_ciphertext, stable_message_id, state
) values (
  '88000000-0000-4000-8000-000000000203', '82000000-0000-4000-8000-000000000001',
  (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'),
  'owner_alert', 'owner_alert', 'ciphertext-placeholder', 'evhost-alert-203@mail.evhost.app', 'sending'
);
select public.reconcile_onlyevs_sendgrid_event(
  'sg-evt-203-processed', '82000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000203',
  'processed', null, 1::smallint, now()
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'),
  'revocation_pending', 'RES203 reaches the brake before the bounce'
);
select lives_ok(
  $$select public.reconcile_onlyevs_sendgrid_event(
    'sg-evt-203-bounce', '82000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000203',
    'bounce', '550', 1::smallint, now()
  )$$, 'a later bounce on the owner-alert delivery is reconciled'
);
select is(
  (select state from public.onlyevs_email_deliveries where id = '88000000-0000-4000-8000-000000000203'),
  'bounced', 'the delivery itself is marked bounced'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'),
  'needs_review', 'a bounced owner alert cancels the brake and forces review'
);
select is(
  (select brake_deadline from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203'),
  null::timestamptz, 'the brake deadline is cleared on bounce'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000203'),
  'needs_review', 'the candidate is also returned to needs_review on bounce'
);
select is(
  (select status from public.onlyevs_trips where id = '87000000-0000-4000-8000-000000000103'),
  'confirmed', 'the trip is never touched when the owner alert bounces'
);
select is(
  (select state from public.onlyevs_email_outbox where job_type = 'action'
    and entity_id = (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000203')),
  'completed', 'the outbox job stops polling once the action needs review'
);

-- ---------------------------------------------------------------------------
-- Destructive brake scenario D: newer-revision-supersedes-before-claim.
-- ---------------------------------------------------------------------------
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000204', 'booking-res204-v1@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000204', '85000000-0000-4000-8000-000000000204', 'RES204', 'booking',
  jsonb_build_object('guestName', 'Old Fact'), now() - interval '20 minutes'
);
select public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000204', 1, '{}'::jsonb);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000204'),
  'queued', 'the older candidate''s action is still queued, unclaimed'
);

select is(
  (select private.supersede_onlyevs_email_candidate_and_action(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000204'
  )), true, 'a strictly newer email can supersede an unclaimed candidate/action'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000204'),
  'superseded', 'the older candidate is superseded'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000204'),
  'superseded', 'the unclaimed action tied to it is superseded too'
);
select is(
  (select state from public.onlyevs_email_outbox where job_type = 'action'
    and entity_id = (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000204')),
  'completed', 'the superseded action''s outbox job stops polling'
);
select lives_ok(
  $$select public.execute_onlyevs_email_action(
    (select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000204'),
    '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1'
  )$$, 'executing a superseded action is a safe no-op'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000204'),
  'superseded', 'a superseded action has no further legal edge'
);

-- A confirmed-but-still-queued candidate (applying, action still queued) is
-- exactly the realistic "before claim" case and IS supersedable.
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000205', 'booking-res206-v1@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000205', '85000000-0000-4000-8000-000000000205', 'RES206', 'booking',
  jsonb_build_object('guestName', 'Applying Guest'), now() - interval '20 minutes'
);
select public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000205', 1, '{}'::jsonb);
select is(
  (select private.supersede_onlyevs_email_candidate_and_action(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000205'
  )), true, 'a confirmed-but-unclaimed (applying, action still queued) candidate is supersedable'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000205'),
  'superseded', 'the applying candidate is superseded once its action is still queued'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000205'),
  'superseded', 'its queued action is superseded along with it'
);

-- Supersede is a no-op once the action has progressed past claimed (already
-- validating or later) -- an in-flight saga is never silently killed.
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000207', 'booking-res207-v1@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000207', '85000000-0000-4000-8000-000000000207', 'RES207', 'booking',
  jsonb_build_object('guestName', 'Validating Guest'), now() - interval '20 minutes'
);
select public.confirm_onlyevs_email_candidate('82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000207', 1, '{}'::jsonb);
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000207'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000207'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000207'),
  'validating', 'RES207''s action has moved past the safe supersede window'
);
select is(
  (select private.supersede_onlyevs_email_candidate_and_action(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000207'
  )), false, 'an in-flight validating action is never silently superseded'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000207'),
  'applying', 'the in-flight candidate is untouched'
);

-- ---------------------------------------------------------------------------
-- apply_update: a 'change' event against an already-applied booking patches
-- the existing trip in place rather than creating a second one.
-- ---------------------------------------------------------------------------
select pg_temp.apply_booking(
  'RESAU1', '86000000-0000-4000-8000-000000000208', '85000000-0000-4000-8000-000000000208',
  '87000000-0000-4000-8000-000000000208', 100
);
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000209', 'change-resau1@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000209', '85000000-0000-4000-8000-000000000209', 'RESAU1', 'change',
  jsonb_build_object(
    'tripStartAt', (now() + make_interval(days => 101))::text,
    'tripEndAt', (now() + make_interval(days => 103))::text
  ),
  now()
);
select lives_ok(
  $$select public.confirm_onlyevs_email_candidate(
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000209', 1, '{}'::jsonb
  )$$, 'a change event with a resolvable prior trip confirms into apply_update'
);
select is(
  (select action_type from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'),
  'apply_update', 'the change event confirms into apply_update, not create_trip'
);
select is(
  (select capability_name from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'),
  'pretrip', 'apply_update maps to the pretrip capability'
);
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select public.execute_onlyevs_email_action((select id from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'), '82000000-0000-4000-8000-000000000001', 'pgtap-worker-1');
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000209'),
  'succeeded', 'apply_update reaches succeeded (no owner alert -- not destructive)'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '86000000-0000-4000-8000-000000000209'),
  'applied', 'the change candidate is marked applied'
);
select is(
  (select (starts_at - now())::interval > interval '100 days' and (starts_at - now())::interval < interval '102 days'
    from public.onlyevs_trips where id = '87000000-0000-4000-8000-000000000208'),
  true, 'the existing trip''s schedule is patched to the new dates'
);
select is(
  (select count(*)::integer from public.onlyevs_trips where email_candidate_id = '86000000-0000-4000-8000-000000000209'),
  0, 'apply_update patches the existing trip in place rather than creating a second one'
);

-- ---------------------------------------------------------------------------
-- Existing rolling-deploy callers are unaffected by the core extraction.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.create_onlyevs_manual_trip(
    '89000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'email-action-tests',
    '83000000-0000-4000-8000-000000000001',
    'Manual Guest',
    'manual@example.com',
    'America/Phoenix',
    now() + interval '10 days',
    now() + interval '12 days',
    'PHX Sky Harbor',
    'PHX Sky Harbor',
    repeat('e', 64),
    now() + interval '13 days',
    repeat('n', 64),
    1::smallint
  )$$,
  'create_onlyevs_manual_trip still works unmodified after the core extraction'
);
select is(
  (select count(*)::integer from private.onlyevs_guest_bindings where trip_id = '89000000-0000-4000-8000-000000000001'),
  1, 'the manual trip still gets a private guest binding'
);

insert into public.onlyevs_integrations (
  id, workspace_id, shop_slug, provider, status, selected_calendar_id, selected_calendar_timezone, next_sync_at
) values (
  '8a000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001',
  'email-action-tests', 'google_calendar', 'connected', 'primary', 'UTC', now()
) on conflict (id) do nothing;
insert into public.onlyevs_calendar_candidates (
  id, workspace_id, shop_slug, integration_id, external_event_id, summary, starts_at, ends_at, timezone, status
) values (
  '8b000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'email-action-tests',
  '8a000000-0000-4000-8000-000000000001', 'calendar-event-1', 'Confirmed rental',
  now() + interval '20 days', now() + interval '22 days', 'UTC', 'pending'
) on conflict (id) do nothing;
select lives_ok(
  $$select public.confirm_onlyevs_calendar_candidate(
    '89000000-0000-4000-8000-000000000002',
    '8b000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    'Calendar Guest',
    'calendar@example.com',
  repeat('f', 64),
    now() + interval '23 days',
    repeat('q', 64),
    1::smallint
  )$$,
  'confirm_onlyevs_calendar_candidate still works unmodified after the core extraction'
);
select is(
  (select count(*)::integer from public.onlyevs_access_grants where trip_id = '89000000-0000-4000-8000-000000000002'),
  1, 'confirming a calendar candidate still issues an access grant (unlike the email create_trip path)'
);

-- ---------------------------------------------------------------------------
-- Hardening: 20260816180000_onlyevs_email_action_hardening.sql's two CHECK
-- constraints (capability/action_type binding, and the state-scoped
-- destructive brake).
-- ---------------------------------------------------------------------------
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000301', 'hardening-check-a@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000301', '85000000-0000-4000-8000-000000000301', 'RESHARDENA', 'cancellation',
  jsonb_build_object('subject', 'Guest cancelled'), now()
);

-- Negative: a destructive action_type can never be inserted under a
-- non-destructive capability_name (onlyevs_email_actions_capability_action_binding).
select throws_ok(
  $$insert into public.onlyevs_email_actions (
    workspace_id, candidate_id, action_type, idempotency_key, state,
    integration_revision, candidate_revision, capability_name, capability_revision,
    proposed_state_hash, effective_trip_id, next_action_at
  ) values (
    '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000301', 'cancel_trip',
    'email-action:hardening-check-a', 'queued', 1, 1, 'active_safe', 0,
    repeat('0', 64), null, now()
  )$$,
  '23514',
  null,
  'a cancel_trip action cannot be inserted with a non-destructive capability_name'
);

-- Positive (regression, restated explicitly): the existing manual Confirm
-- cancel_trip flow above (candidate 86000000-0000-4000-8000-000000000201,
-- lines ~394-419) already asserted state='awaiting_owner_alert' with
-- brake_deadline null and that assertion still passed with both new
-- constraints in place -- 'awaiting_owner_alert' is not one of the
-- brake-scoped constraint's blocked states, so the announce-then-brake
-- window is untouched. Confirmed again here directly against that same row.
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201'),
  'succeeded', 'the earlier Confirm cancel_trip flow still reached succeeded under the new constraints'
);
select ok(
  (select brake_deadline from public.onlyevs_email_actions where candidate_id = '86000000-0000-4000-8000-000000000201') is not null,
  'and its brake_deadline was populated by the time it reached a post-acceptance state, as the scoped constraint requires'
);

-- Negative: UPDATE-ing a destructive row into the first post-acceptance
-- state (revocation_pending) without a brake_deadline throws
-- (onlyevs_email_actions_destructive_brake_scoped). Uses the queued action
-- just inserted's sibling scenario B row (86000000-0000-4000-8000-000000000202),
-- which is already 'succeeded' with brake_deadline set -- reset it on a
-- fresh in-transaction copy instead so this doesn't disturb an assertion
-- already made against that row.
select pg_temp.seed_inbound('85000000-0000-4000-8000-000000000302', 'hardening-check-b@turo.com');
select pg_temp.seed_candidate(
  '86000000-0000-4000-8000-000000000302', '85000000-0000-4000-8000-000000000302', 'RESHARDENB', 'cancellation',
  jsonb_build_object('subject', 'Guest cancelled'), now()
);
insert into public.onlyevs_email_actions (
  workspace_id, candidate_id, action_type, idempotency_key, state,
  integration_revision, candidate_revision, capability_name, capability_revision,
  proposed_state_hash, effective_trip_id, next_action_at, brake_deadline
) values (
  '82000000-0000-4000-8000-000000000001', '86000000-0000-4000-8000-000000000302', 'cancel_trip',
  'email-action:hardening-check-b', 'awaiting_owner_alert', 1, 1, 'active_destructive', 0,
  repeat('0', 64), null, now(), null
);
select throws_ok(
  $$update public.onlyevs_email_actions
    set state = 'revocation_pending'
    where candidate_id = '86000000-0000-4000-8000-000000000302'$$,
  '23514',
  null,
  'a destructive action cannot reach revocation_pending without a brake_deadline'
);
-- Same row, brake_deadline set alongside the transition: allowed.
select lives_ok(
  $$update public.onlyevs_email_actions
    set state = 'revocation_pending', brake_deadline = now() + interval '30 minutes'
    where candidate_id = '86000000-0000-4000-8000-000000000302'$$,
  'the same transition succeeds once brake_deadline is set in the same statement'
);

select * from finish();
rollback;
