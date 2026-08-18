begin;
select plan(69);

-- =====================================================================
-- Structural coverage: tables, functions, grants.
-- =====================================================================

select has_table('private'::name, 'onlyevs_email_message_index'::name);
select has_table('private'::name, 'onlyevs_email_attachments'::name);
select has_table('private'::name, 'onlyevs_email_read_receipts'::name);
select has_table('private'::name, 'onlyevs_email_purge_audit'::name);

select has_function('public', 'list_onlyevs_email_messages',
  array['uuid', 'text', 'text', 'boolean', 'boolean', 'timestamptz', 'uuid', 'integer']);
select has_function('public', 'search_onlyevs_email_messages', array['uuid', 'text', 'text', 'integer']);
select has_function('public', 'get_onlyevs_email_unread_count', array['uuid', 'text']);
select has_function('public', 'record_onlyevs_email_read', array['uuid', 'uuid']);
select has_function('public', 'get_onlyevs_email_read_receipts', array['uuid', 'uuid']);
select has_function('public', 'set_onlyevs_email_retention_window', array['uuid', 'uuid', 'bigint', 'integer']);
select has_function('public', 'purge_onlyevs_email_message', array['uuid', 'uuid', 'text']);
select has_function('public', 'purge_onlyevs_email_reservation', array['uuid', 'text', 'text']);
select has_function('public', 'purge_onlyevs_email_guest', array['uuid', 'uuid', 'text']);
select has_function('private', 'claim_onlyevs_due_email_index_backfill', array['text', 'integer']);
select has_function('private', 'list_onlyevs_email_retention_due', array['integer']);
select has_function('private', 'purge_onlyevs_email_message_core', array['uuid', 'uuid', 'uuid', 'text', 'text']);

-- private tables carry no authenticated grant at all -- RPC-only access.
select table_privs_are('private', 'onlyevs_email_message_index', 'authenticated', array[]::text[]);
select table_privs_are('private', 'onlyevs_email_attachments', 'authenticated', array[]::text[]);
select table_privs_are('private', 'onlyevs_email_read_receipts', 'authenticated', array[]::text[]);
select table_privs_are('private', 'onlyevs_email_purge_audit', 'authenticated', array[]::text[]);

-- The shared purge core is never directly callable by anyone -- only the
-- three public wrapper RPCs (which run as the function owner) reach it.
select function_privs_are('private', 'purge_onlyevs_email_message_core',
  array['uuid', 'uuid', 'uuid', 'text', 'text'], 'authenticated', array[]::text[]);
select function_privs_are('private', 'purge_onlyevs_email_message_core',
  array['uuid', 'uuid', 'uuid', 'text', 'text'], 'onlyevs_worker', array[]::text[]);
select function_privs_are('private', 'claim_onlyevs_due_email_index_backfill',
  array['text', 'integer'], 'authenticated', array[]::text[]);
select function_privs_are('private', 'list_onlyevs_email_retention_due',
  array['integer'], 'authenticated', array[]::text[]);

-- job_type widened, single check constraint (drop+re-add, not a second
-- redundant one left behind by a name mismatch).
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.onlyevs_email_outbox'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%job_type%'),
  1,
  'exactly one job_type CHECK constraint exists on onlyevs_email_outbox'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.onlyevs_email_outbox'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%job_type%') like '%index_backfill%',
  'the job_type CHECK constraint includes index_backfill'
);

-- =====================================================================
-- Fixtures: two workspaces (A, B), a manager each, a non-member, a shared
-- guest-purge scenario, and a booking candidate wired up for the in-flight
-- hash-bounce test.
-- =====================================================================

insert into auth.users (id) values
  ('97000000-0000-4000-8000-000000000001'), -- A1: manager of workspace A
  ('97000000-0000-4000-8000-000000000002'), -- B1: manager of workspace B
  ('97000000-0000-4000-8000-000000000003')  -- U3: authenticated, no workspace membership
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug) values
  ('97100000-0000-4000-8000-000000000001', 'Mail Ledger A', 'mail-ledger-a'),
  ('97100000-0000-4000-8000-000000000002', 'Mail Ledger B', 'mail-ledger-b')
on conflict (id) do nothing;

insert into public.workspace_users (workspace_id, user_id, role) values
  ('97100000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'manager'),
  ('97100000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000002', 'manager')
on conflict (workspace_id, user_id) do update set role = excluded.role;

insert into public.workspace_branding (workspace_id, shop_slug, display_name) values
  ('97100000-0000-4000-8000-000000000001', 'mail-ledger-a', 'Mail Ledger A'),
  ('97100000-0000-4000-8000-000000000002', 'mail-ledger-b', 'Mail Ledger B')
on conflict (workspace_id, shop_slug) do nothing;

insert into public.onlyevs_vehicles (id, workspace_id, shop_slug, display_name, model, trim, year, color, vin, status)
values
  ('97150000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a', 'White Model Y', 'Model Y', 'Long Range', 2025, 'Pearl White', '5YJYGDEE0NF000097', 'active')
on conflict (id) do nothing;

insert into public.onlyevs_email_integrations (id, workspace_id, shop_slug, status, mode) values
  ('97200000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a', 'active', 'review'),
  ('97200000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000002', 'mail-ledger-b', 'active', 'review')
on conflict (id) do nothing;

create or replace function pg_temp.seed_inbound(p_id uuid, p_workspace_id uuid, p_integration_id uuid, p_msgid text)
returns void language sql as $$
  insert into public.onlyevs_inbound_emails (
    id, workspace_id, integration_id, accepted_alias_revision, rfc_message_id,
    raw_sha256, normalized_sha256, ciphertext_sha256, raw_bytes, normalized_bytes,
    ciphertext_bytes, kek_version, receiver_auth_verdict, state, delete_after, r2_object_key
  ) values (
    p_id, p_workspace_id, p_integration_id, 1, p_msgid,
    repeat('a', 64), repeat('b', 64), repeat('c', 64), 100, 100, 140, 1, 'pass', 'classified',
    now() + interval '30 days', 'pending/' || p_id::text || '.evmail'
  ) on conflict (id) do nothing;
$$;

create or replace function pg_temp.seed_candidate(
  p_id uuid, p_workspace_id uuid, p_integration_id uuid, p_inbound_id uuid,
  p_reservation_id text, p_event_type text, p_facts jsonb, p_occurred_at timestamptz
) returns void language sql as $$
  insert into public.onlyevs_email_candidates (
    id, workspace_id, integration_id, inbound_email_id, reservation_id, event_type,
    proposed_state, blocker_codes, state, occurred_at
  ) values (
    p_id, p_workspace_id, p_integration_id, p_inbound_id, p_reservation_id, p_event_type,
    p_facts, '{}', 'pending', p_occurred_at
  ) on conflict (id) do nothing;
$$;

create or replace function pg_temp.seed_index(
  p_id uuid, p_workspace_id uuid, p_shop_slug text, p_inbound_id uuid, p_subject text,
  p_sender text, p_sent_at timestamptz, p_snippet text, p_body text, p_candidate_id uuid
) returns void language sql as $$
  insert into private.onlyevs_email_message_index (
    id, workspace_id, shop_slug, inbound_email_id, subject, sender, sent_at, snippet, body_tsv, candidate_id
  ) values (
    p_id, p_workspace_id, p_shop_slug, p_inbound_id, p_subject, p_sender, p_sent_at, p_snippet,
    to_tsvector('english', p_body), p_candidate_id
  ) on conflict (id) do nothing;
$$;

select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-1@turo.com');
select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-2@turo.com');
select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000003', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-3-unindexed@turo.com');
select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000009', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-9-hashbounce@turo.com');

select pg_temp.seed_candidate('97400000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000001', 'RES-A1', 'guest_message',
  jsonb_build_object('subject', 'Riley sent you a message', 'sender', 'Riley <r@example.com>', 'messageText', 'Running 10 min late', 'guestMessageText', 'Running 10 min late'),
  now() - interval '2 hours');
select pg_temp.seed_candidate('97400000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000002', 'RES-A1', 'booking',
  jsonb_build_object('subject', 'Trip booked', 'sender', 'Turo <noreply@mail.turo.com>', 'messageText', 'Your trip is booked'),
  now() - interval '3 hours');

select pg_temp.seed_index('97500000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a', '97300000-0000-4000-8000-000000000001', 'Riley sent you a message', 'Riley <r@example.com>', now() - interval '2 hours', 'Running 10 min late', 'Riley sent you a message running 10 minutes late', '97400000-0000-4000-8000-000000000001');
select pg_temp.seed_index('97500000-0000-4000-8000-000000000002', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a', '97300000-0000-4000-8000-000000000002', 'Trip booked', 'Turo <noreply@mail.turo.com>', now() - interval '3 hours', 'Your trip is booked', 'Your trip with the Tesla is booked', '97400000-0000-4000-8000-000000000002');

insert into private.onlyevs_email_attachments (
  id, workspace_id, message_index_id, filename, content_type, size_bytes, sha256, r2_object_key
) values (
  '97600000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001',
  '97500000-0000-4000-8000-000000000001', 'photo.jpg', 'image/jpeg', 2048, repeat('e', 64),
  'attachments/97600000-0000-4000-8000-000000000001.evattach'
);

-- =====================================================================
-- Membership gating: non-members and cross-workspace managers are rejected.
-- =====================================================================

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::int from public.list_onlyevs_email_messages('97100000-0000-4000-8000-000000000001')),
  2,
  'a manager can list their own workspace''s mail'
);
select is(
  (select count(*)::int from public.search_onlyevs_email_messages('97100000-0000-4000-8000-000000000001', 'late')),
  1,
  'search matches the message containing the query term'
);
select is(
  public.get_onlyevs_email_unread_count('97100000-0000-4000-8000-000000000001'),
  2,
  'both messages are unread before any read receipt is recorded'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select * from public.list_onlyevs_email_messages('97100000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a non-member cannot list another workspace''s mail'
);
select throws_ok(
  $$select public.get_onlyevs_email_unread_count('97100000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a non-member cannot read another workspace''s unread count'
);
select throws_ok(
  $$select public.record_onlyevs_email_read('97100000-0000-4000-8000-000000000001', '97500000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a non-member cannot record a read receipt in another workspace'
);
select throws_ok(
  $$select public.purge_onlyevs_email_message('97100000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a non-member cannot purge another workspace''s mail'
);
select throws_ok(
  $$select public.set_onlyevs_email_retention_window('97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 1, 30)$$,
  '42501', null, 'a non-member cannot set another workspace''s retention window'
);

reset role;
select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select * from public.list_onlyevs_email_messages('97100000-0000-4000-8000-000000000001')$$,
  '42501', null, 'workspace B''s manager cannot list workspace A''s mail'
);

reset role;

-- =====================================================================
-- Read receipts: record + manager-visible audit read.
-- =====================================================================

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.record_onlyevs_email_read('97100000-0000-4000-8000-000000000001', '97500000-0000-4000-8000-000000000001')$$,
  'a manager can record a read receipt on a message in their workspace'
);
select is(
  public.get_onlyevs_email_unread_count('97100000-0000-4000-8000-000000000001'),
  1,
  'unread count drops by one after the reading manager records a receipt'
);
select is(
  (select count(*)::int from public.get_onlyevs_email_read_receipts('97100000-0000-4000-8000-000000000001', '97500000-0000-4000-8000-000000000001')),
  1,
  'the read-receipt reader returns the recorded receipt'
);
select throws_ok(
  $$select public.record_onlyevs_email_read('97100000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000')$$,
  'P0002', null, 'recording a read receipt on a nonexistent message is rejected'
);

reset role;

-- Audit-visible to a *different* manager on the same workspace, not just the
-- reader themselves (decided during spec review).
insert into public.workspace_users (workspace_id, user_id, role) values
  ('97100000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000003', 'manager')
on conflict (workspace_id, user_id) do update set role = excluded.role;

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select is(
  (select user_id from public.get_onlyevs_email_read_receipts('97100000-0000-4000-8000-000000000001', '97500000-0000-4000-8000-000000000001') limit 1),
  '97000000-0000-4000-8000-000000000001'::uuid,
  'a different workspace manager can see who read a message and when (audit-visible)'
);

reset role;

-- =====================================================================
-- Retention window setter: manager-gated, positive-or-null, optimistic
-- revision.
-- =====================================================================

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select retention_window_days from public.set_onlyevs_email_retention_window('97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 1, 45)),
  45,
  'a manager can set a positive retention window'
);
select throws_ok(
  $$select public.set_onlyevs_email_retention_window('97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 2, 0)$$,
  '22023', null, 'a zero retention window is rejected'
);
select throws_ok(
  $$select public.set_onlyevs_email_retention_window('97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 1, 30)$$,
  '40001', null, 'a stale expected_revision is rejected'
);
select is(
  (select retention_window_days from public.set_onlyevs_email_retention_window('97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 2, null)),
  null,
  'the retention window can be cleared back to null (keep forever)'
);

reset role;

-- =====================================================================
-- Purge: message-scoped. Returns every R2 key, scrubs proposed_state in
-- place (structured facts retained), deletes index+attachment rows, nulls
-- the raw envelope reference, and writes an audit row.
-- =====================================================================

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::int from public.purge_onlyevs_email_message('97100000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000001', 'pgtap message purge')),
  2,
  'message-scoped purge returns both the attachment object key and the raw envelope key'
);
select throws_ok(
  $$select * from public.purge_onlyevs_email_message('97100000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000000')$$,
  'P0002', null, 'purging a nonexistent message is rejected'
);

reset role;

select is(
  (select proposed_state ? 'messageText' or proposed_state ? 'guestMessageText' from public.onlyevs_email_candidates where id = '97400000-0000-4000-8000-000000000001'),
  false,
  'the purged candidate''s proposed_state no longer carries messageText/guestMessageText'
);
select is(
  (select proposed_state ? 'subject' from public.onlyevs_email_candidates where id = '97400000-0000-4000-8000-000000000001'),
  true,
  'the purged candidate''s structured facts (subject) are retained, not deleted'
);
select is(
  (select count(*)::int from private.onlyevs_email_message_index where inbound_email_id = '97300000-0000-4000-8000-000000000001'),
  0,
  'the message index row is deleted by the purge'
);
select is(
  (select count(*)::int from private.onlyevs_email_attachments where message_index_id = '97500000-0000-4000-8000-000000000001'),
  0,
  'attachment rows cascade-delete with the message index row'
);
select is(
  (select r2_object_key from public.onlyevs_inbound_emails where id = '97300000-0000-4000-8000-000000000001'),
  null,
  'the raw envelope''s r2_object_key is nulled after purge'
);
select is(
  (select count(*)::int from private.onlyevs_email_purge_audit where inbound_email_id = '97300000-0000-4000-8000-000000000001' and scope = 'message'),
  1,
  'a message-scoped purge audit row is written'
);

-- =====================================================================
-- Purge: reservation-scoped. RES-A1 has three live-target candidates by
-- this point: already-purged message 1 (must be correctly skipped), message
-- 2 (indexed), and message 4 below -- captured (has a candidate row) but
-- deliberately never given a seed_index row, modeling the exact race the
-- fix-before-merge review flagged: a message captured in the same window a
-- deletion request lands, still awaiting the T9 reconciler's indexing pass.
-- Before the fix, target resolution required an index row to exist, so this
-- message was silently indistinguishable from "already purged" and dropped
-- from the purge with no error/partial-count signal -- this asserts it is
-- now reached.
-- =====================================================================

select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000004', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-4-captured-not-yet-indexed@turo.com');
select pg_temp.seed_candidate('97400000-0000-4000-8000-000000000004', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000004', 'RES-A1', 'guest_message',
  jsonb_build_object('subject', 'RES-A1 message captured mid-index-race', 'messageText', 'captured but not yet indexed', 'guestMessageText', 'captured but not yet indexed'),
  now() - interval '1 hour');

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::int from public.purge_onlyevs_email_reservation('97100000-0000-4000-8000-000000000001', 'RES-A1', 'pgtap reservation purge')),
  2,
  'reservation-scoped purge reaches both the indexed message and the captured-but-not-yet-indexed one sharing that reservation'
);

reset role;

select is(
  (select count(*)::int from private.onlyevs_email_message_index where inbound_email_id = '97300000-0000-4000-8000-000000000002'),
  0,
  'the second RES-A1 message''s index row is gone after the reservation-scoped purge'
);
select is(
  (select r2_object_key from public.onlyevs_inbound_emails where id = '97300000-0000-4000-8000-000000000004'),
  null,
  'the never-indexed RES-A1 message''s raw envelope is nulled too -- it was not silently skipped'
);
select is(
  (select proposed_state ? 'messageText' from public.onlyevs_email_candidates where id = '97400000-0000-4000-8000-000000000004'),
  false,
  'the never-indexed RES-A1 message''s proposed_state.messageText is scrubbed'
);
select is(
  (select count(*)::int from private.onlyevs_email_purge_audit where scope = 'reservation'),
  2,
  'a reservation-scoped purge audit row is written per message purged, including the never-indexed one'
);

-- =====================================================================
-- Purge: guest-scoped, via a confirmed trip's guest_id link and the
-- reservation-matching proxy for unconfirmed mail sharing that trip's
-- reservation.
-- =====================================================================

insert into public.onlyevs_guests (id, workspace_id, display_name) values
  ('97700000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'Riley Guest');

insert into public.onlyevs_trips (
  id, workspace_id, shop_slug, vehicle_id, guest_id, guest_name, guest_email, timezone,
  starts_at, ends_at, public_token_hash, token_expires_at
) values (
  '97800000-0000-4000-8000-000000000001', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a',
  '97150000-0000-4000-8000-000000000001', '97700000-0000-4000-8000-000000000001',
  'Riley Guest', 'riley@example.com', 'UTC', now() + interval '2 days', now() + interval '3 days',
  repeat('7', 64), now() + interval '4 days'
);

select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000005', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-5-guest-reservation-proxy@turo.com');
select pg_temp.seed_candidate('97400000-0000-4000-8000-000000000005', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000005', 'RES-A1', 'guest_message',
  jsonb_build_object('subject', 'A follow-up about RES-A1', 'messageText', 'unconfirmed follow-up'), now());
select pg_temp.seed_index('97500000-0000-4000-8000-000000000005', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a', '97300000-0000-4000-8000-000000000005', 'A follow-up about RES-A1', 'Riley <r@example.com>', now(), 'unconfirmed follow-up', 'unconfirmed follow up about the reservation', '97400000-0000-4000-8000-000000000005');

update public.onlyevs_email_candidates set effective_trip_id = '97800000-0000-4000-8000-000000000001'
  where id = '97400000-0000-4000-8000-000000000002';

select pg_temp.seed_inbound('97300000-0000-4000-8000-000000000006', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 'msg-6-guest-direct-link@turo.com');
select pg_temp.seed_index('97500000-0000-4000-8000-000000000006', '97100000-0000-4000-8000-000000000001', 'mail-ledger-a', '97300000-0000-4000-8000-000000000006', 'Directly linked to Riley', 'Riley <r@example.com>', now(), 'directly linked', 'directly linked to riley by guest id', null);
update private.onlyevs_email_message_index set guest_id = '97700000-0000-4000-8000-000000000001'
  where id = '97500000-0000-4000-8000-000000000006';

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::int from public.purge_onlyevs_email_guest('97100000-0000-4000-8000-000000000001', '97700000-0000-4000-8000-000000000001', 'pgtap guest purge')),
  2,
  'guest-scoped purge reaches both the directly guest-linked message and the reservation-matched unconfirmed follow-up'
);

reset role;

select is(
  (select count(*)::int from private.onlyevs_email_message_index
    where inbound_email_id in ('97300000-0000-4000-8000-000000000005', '97300000-0000-4000-8000-000000000006')),
  0,
  'both guest-scoped-purge targets'' index rows are gone'
);
select is(
  (select count(*)::int from private.onlyevs_email_purge_audit where scope = 'guest'),
  2,
  'guest-scoped purge writes one audit row per message purged'
);

-- =====================================================================
-- Reconciler claim (2A): claims a classified row lacking an index row,
-- respects the lease, never claims an already-indexed row.
-- =====================================================================

-- Scoped by id rather than an exact total count: by this point in the file,
-- every message purged above (msg-1/2/5/6) also legitimately reads as
-- "classified, lacking an index row" (the purge deleted their index rows),
-- so the claim set correctly includes them too -- msg-3 (never indexed to
-- begin with) is asserted present among them, not asserted alone.
select is(
  (select bool_or(id = '97300000-0000-4000-8000-000000000003')
    from private.claim_onlyevs_due_email_index_backfill('pgtap-reconciler-1', 50)),
  true,
  'the reconciler claims the classified, unindexed msg-3 row among the due set'
);
select is(
  (select count(*)::int from private.claim_onlyevs_due_email_index_backfill('pgtap-reconciler-2', 50)
    where id = '97300000-0000-4000-8000-000000000003'),
  0,
  'a second reconciler worker cannot reclaim msg-3 while its lease is held'
);
select is(
  (select claimed_by from public.onlyevs_inbound_emails where id = '97300000-0000-4000-8000-000000000003'),
  'pgtap-reconciler-1',
  'the claimed row records which worker holds the lease'
);
select throws_ok(
  $$select * from private.claim_onlyevs_due_email_index_backfill('ab', 10)$$,
  '22023', null, 'a too-short worker id is rejected'
);
select throws_ok(
  $$select * from private.claim_onlyevs_due_email_index_backfill('pgtap-reconciler-1', 500)$$,
  '22023', null, 'a limit above the bound is rejected'
);

-- =====================================================================
-- In-flight action hash-bounce (Premise 3's documented interaction): a
-- purge mid-flight scrubs proposed_state, bumping candidate.revision and
-- changing the recomputed proposed_state_hash -- the existing action state
-- machine (20260816150000) fails closed to needs_review/validation_conflict
-- on its next step, with no new logic required in this migration.
-- =====================================================================

select pg_temp.seed_candidate('97400000-0000-4000-8000-000000000009', '97100000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000009', 'RES-A9', 'booking',
  jsonb_build_object('guestFirstName', 'Jamie', 'guestEmail', 'jamie@example.com', 'tripTimeZone', 'America/Phoenix',
    'tripStartAt', (now() + interval '2 days')::text, 'tripEndAt', (now() + interval '4 days')::text,
    'messageText', 'Booking confirmed for Jamie'),
  now());

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select public.confirm_onlyevs_email_candidate('97100000-0000-4000-8000-000000000001', '97400000-0000-4000-8000-000000000009', 1, '{}'::jsonb);

reset role;

-- Advance queued -> claimed -> validating. At 'validating' the candidate is
-- still 'applying' with a matching hash/revision, so this step legitimately
-- progresses past the check (create_trip's own db_committing needs worker-
-- supplied trip params, which this test never provides -- it only needs to
-- reach 'validating' before the purge below, not complete the saga).
select public.execute_onlyevs_email_action(
  (select id from public.onlyevs_email_actions where candidate_id = '97400000-0000-4000-8000-000000000009'),
  '97100000-0000-4000-8000-000000000001', 'pgtap-action-worker'
);
select public.execute_onlyevs_email_action(
  (select id from public.onlyevs_email_actions where candidate_id = '97400000-0000-4000-8000-000000000009'),
  '97100000-0000-4000-8000-000000000001', 'pgtap-action-worker'
);
select is(
  (select state from public.onlyevs_email_actions where candidate_id = '97400000-0000-4000-8000-000000000009'),
  'validating',
  'the action has reached validating before the purge runs'
);

select set_config('request.jwt.claim.sub', '97000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select public.purge_onlyevs_email_message('97100000-0000-4000-8000-000000000001', '97300000-0000-4000-8000-000000000009', 'pgtap hash-bounce purge');

reset role;

select public.execute_onlyevs_email_action(
  (select id from public.onlyevs_email_actions where candidate_id = '97400000-0000-4000-8000-000000000009'),
  '97100000-0000-4000-8000-000000000001', 'pgtap-action-worker'
);

select is(
  (select state from public.onlyevs_email_actions where candidate_id = '97400000-0000-4000-8000-000000000009'),
  'needs_review',
  'the in-flight action bounces to needs_review after a mid-flight purge invalidates its proposed_state_hash'
);
select is(
  (select last_error_code from public.onlyevs_email_actions where candidate_id = '97400000-0000-4000-8000-000000000009'),
  'validation_conflict',
  'the bounce is recorded as a validation_conflict, the existing fail-closed error code'
);
select is(
  (select state from public.onlyevs_email_candidates where id = '97400000-0000-4000-8000-000000000009'),
  'needs_review',
  'the candidate itself also bounces to needs_review'
);

select * from finish();
rollback;
