-- Workspace Mail: full-content Turo email inbox (design doc
-- alex-email-inbox-design-20260817-123909.md, Implementation Tasks
-- T1/T2/T3/T4/T5-migration-side/T6). Additive only -- never edits
-- 20260816003000_onlyevs_email_ingestion.sql or any other prior migration.
--
-- Adds: a private search index over already-captured mail (metadata +
-- extracted plaintext tsvector -- the raw HTML/attachments themselves stay
-- in encrypted R2, this table is never a second copy of the raw message),
-- per-message attachment object references, per-user read receipts,
-- purge machinery (message/reservation/guest-scoped) that scrubs every body
-- copy Postgres holds (including the one that already existed before this
-- migration: onlyevs_email_candidates.proposed_state's messageText/
-- guestMessageText, per Premise 3), a per-workspace retention window, and
-- the standing reconciler's claim query (2A).
--
-- Everything here stays dark: ONLYEVS_EMAIL_WORKER_ENABLED and friends are
-- unaffected by this migration, and no UI route exists yet that reads any of
-- these tables -- see the T2/T13 split in the design doc's worktree table.

-- =====================================================================
-- T1 -- message index + attachments + per-mechanism auth columns
-- =====================================================================

-- One row per already-parsed inbound email (unique on inbound_email_id --
-- upserts from the parse job (T8) and the reconciler (T9/2A) are both
-- idempotent by that key, so either writer racing the other just overwrites
-- the same row rather than duplicating it). Carries metadata + an extracted
-- plaintext search column; the raw HTML/attachments never live here -- see
-- private.onlyevs_email_attachments below for the attachment objects and
-- the read route (T11, app-side) for how the raw envelope itself is served.
-- shop_slug is denormalized from the owning integration at write time,
-- matching the onlyevs_vehicles/onlyevs_trips convention of storing
-- shop_slug directly on the row for RLS/shop-scoped queries rather than
-- forcing every reader to join onlyevs_email_integrations.
create table if not exists private.onlyevs_email_message_index (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  shop_slug text not null check (char_length(shop_slug) between 1 and 160),
  inbound_email_id uuid not null,
  subject text not null default '',
  sender text not null default '',
  sent_at timestamptz not null,
  snippet text not null default '' check (char_length(snippet) <= 400),
  body_tsv tsvector not null default ''::tsvector,
  has_attachments boolean not null default false,
  -- Per-mechanism receiver-auth columns (outside-voice Issue 8 gap this
  -- migration closes): today only the collapsed pass|review|fail verdict is
  -- persisted (onlyevs_inbound_emails.receiver_auth_verdict) -- the
  -- renderer's trust chips (T12) need to show DKIM/SPF/DMARC and From-domain
  -- alignment individually, which cannot be reconstructed from the
  -- collapsed verdict alone. Nullable: populated at parse for new mail,
  -- derived from raw headers during index_backfill for already-captured
  -- mail, and legitimately unknown for anything captured before either
  -- writer ran.
  dkim_pass boolean,
  spf_pass boolean,
  dmarc_pass boolean,
  from_domain_aligned boolean,
  -- Presentation-only links, populated as the reservation/trip/guest
  -- resolves. All three are nullable and independently nullable-on-delete --
  -- losing a candidate/trip/guest must never delete the message record
  -- itself (the archive property Premise 1's "Trust the archive" job
  -- depends on).
  candidate_id uuid,
  trip_id uuid,
  guest_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_email_message_index_inbound_fk
    foreign key (workspace_id, inbound_email_id)
    references public.onlyevs_inbound_emails(workspace_id, id) on delete cascade,
  constraint onlyevs_email_message_index_candidate_fk
    foreign key (workspace_id, candidate_id)
    references public.onlyevs_email_candidates(workspace_id, id) on delete set null,
  constraint onlyevs_email_message_index_trip_fk
    foreign key (workspace_id, trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete set null,
  constraint onlyevs_email_message_index_guest_fk
    foreign key (workspace_id, guest_id)
    references public.onlyevs_guests(workspace_id, id) on delete set null,
  unique (workspace_id, id),
  unique (inbound_email_id)
);

create index if not exists onlyevs_email_message_index_body_tsv_idx
  on private.onlyevs_email_message_index using gin (body_tsv);
-- List-view cursor pagination: (workspace_id, sent_at desc, id) mirrors the
-- shape lib/owner/email-inbox-repository.ts's paginateInboxItems already
-- uses for the triage queue -- same tie-break discipline (id as the
-- deterministic secondary key) so a page boundary is never ambiguous when
-- many messages share a timestamp.
create index if not exists onlyevs_email_message_index_workspace_sent_idx
  on private.onlyevs_email_message_index (workspace_id, sent_at desc, id);
create index if not exists onlyevs_email_message_index_candidate_idx
  on private.onlyevs_email_message_index (workspace_id, candidate_id) where candidate_id is not null;
create index if not exists onlyevs_email_message_index_trip_idx
  on private.onlyevs_email_message_index (workspace_id, trip_id) where trip_id is not null;
create index if not exists onlyevs_email_message_index_guest_idx
  on private.onlyevs_email_message_index (workspace_id, guest_id) where guest_id is not null;

create trigger touch_onlyevs_email_message_index
  before update on private.onlyevs_email_message_index
  for each row execute function private.touch_onlyevs_access_row();

-- Extraction happens only in the worker (Premise 5, amended per outside
-- voice): at parse for new mail (T8), and during the reconciler's pass
-- (T9/2A) for already-captured mail. Each attachment is its own encrypted
-- R2 object (3A) -- this row is a reference/manifest entry only, never a
-- second copy of the bytes. content_id is captured specifically for the
-- renderer's cid: -> data: rewriting (T12); it is null for a non-inline
-- attachment. r2_object_key's exact naming convention is the worker's
-- (T8/T9) to define -- this column only bounds its length, it does not
-- prescribe a path shape (unlike onlyevs_inbound_emails.r2_object_key,
-- which is pinned to a single fixed shape because exactly one function,
-- finalize_onlyevs_email_capture, has ever minted it).
create table if not exists private.onlyevs_email_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  message_index_id uuid not null,
  filename text check (filename is null or char_length(filename) <= 400),
  content_type text check (content_type is null or char_length(content_type) <= 200),
  size_bytes integer not null default 0 check (size_bytes >= 0),
  content_id text check (content_id is null or char_length(content_id) <= 400),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  r2_object_key text not null check (char_length(r2_object_key) between 1 and 512),
  created_at timestamptz not null default now(),
  constraint onlyevs_email_attachments_message_fk
    foreign key (workspace_id, message_index_id)
    references private.onlyevs_email_message_index(workspace_id, id) on delete cascade,
  unique (workspace_id, r2_object_key)
);

create index if not exists onlyevs_email_attachments_message_idx
  on private.onlyevs_email_attachments (message_index_id);

-- =====================================================================
-- T3 -- per-user read receipts (audit-visible to workspace managers,
-- decided during spec review -- no longer an open question).
-- =====================================================================

create table if not exists private.onlyevs_email_read_receipts (
  workspace_id uuid not null,
  message_index_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, message_index_id),
  constraint onlyevs_email_read_receipts_message_fk
    foreign key (workspace_id, message_index_id)
    references private.onlyevs_email_message_index(workspace_id, id) on delete cascade
);

create index if not exists onlyevs_email_read_receipts_message_idx
  on private.onlyevs_email_read_receipts (workspace_id, message_index_id);

-- =====================================================================
-- T4 -- purge audit (mirrors private.onlyevs_guest_merge_audit's
-- append-only prior-state precedent at
-- 20260817090000_onlyevs_vehicle_telemetry_ledger.sql:445).
-- =====================================================================

create table if not exists private.onlyevs_email_purge_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('message', 'reservation', 'guest')),
  inbound_email_id uuid not null,
  -- actor_user_id is nullable: a manager-triggered purge always carries a
  -- real auth.users id, but T5's retention sweep (services/onlyevs-worker/
  -- email.ts's sweepEmailRetentionDue) is a config-driven, time-based
  -- trigger nobody clicked -- there is no user to attribute it to, and
  -- fabricating one (or reusing an unrelated workspace member's id) would
  -- make this audit trail lie about who acted. actor_type distinguishes the
  -- two, and the check constraint below is what keeps actor_user_id from
  -- silently going null on a manager purge instead.
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_type text not null default 'manager' check (actor_type in ('manager', 'system')),
  reason text check (reason is null or char_length(reason) <= 500),
  r2_object_keys text[] not null default '{}',
  purged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint onlyevs_email_purge_audit_actor_consistency check (
    (actor_type = 'manager' and actor_user_id is not null)
    or (actor_type = 'system' and actor_user_id is null)
  )
);

create index if not exists onlyevs_email_purge_audit_workspace_idx
  on private.onlyevs_email_purge_audit (workspace_id, purged_at desc);

comment on table private.onlyevs_email_purge_audit is
  'Append-only prior-purge log (Premise 3); worker/RPC access only, never sent to the client. Records which R2 object keys a purge returned to the caller for deletion.';

-- =====================================================================
-- T5 (migration side) -- per-workspace retention window (5A).
-- =====================================================================

alter table public.onlyevs_email_integrations
  add column if not exists retention_window_days integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onlyevs_email_integrations_retention_window_positive'
      and conrelid = 'public.onlyevs_email_integrations'::regclass
  ) then
    alter table public.onlyevs_email_integrations add constraint onlyevs_email_integrations_retention_window_positive
      check (retention_window_days is null or retention_window_days > 0);
  end if;
end $$;

comment on column public.onlyevs_email_integrations.retention_window_days is
  'Null = keep forever (default). Config-driven retention window (5A) -- adjustable without a migration. Never in workspace_branding (guest-safe fields only) and never env.';

-- =====================================================================
-- job_type widen (drop+re-add pattern, matching
-- 20260816160001_onlyevs_email_alias_format.sql's precedent for
-- enum-style CHECK constraints). 'retention' already exists from
-- 20260816003000 -- this adds 'index_backfill' (the reconciler's own
-- pacing job type -- its actual claim path below reads
-- public.onlyevs_inbound_emails directly, not the outbox row itself; an
-- 'index_backfill' outbox entry is a scheduling knob the worker can enqueue
-- to pace/trigger a sweep, claimed generically by the existing
-- private.claim_onlyevs_due_email -- that function has never filtered by
-- job_type) and 'purge' (T10's actual dispatch trigger -- see
-- purge_onlyevs_email_message_core below, which enqueues one of these in
-- the same transaction as its audit row, and services/onlyevs-worker/
-- email.ts's processPurgeJob, which is what actually deletes the R2 object
-- keys that row's audit entry recorded; entity_id is the purge_audit row's
-- own id, giving the worker a stable, idempotent-to-retry key).
-- =====================================================================

alter table public.onlyevs_email_outbox
  drop constraint if exists onlyevs_email_outbox_job_type_check;

alter table public.onlyevs_email_outbox
  add constraint onlyevs_email_outbox_job_type_check
  check (job_type in ('parse', 'action', 'delivery', 'retention', 'reconcile', 'canary', 'index_backfill', 'purge'));

-- =====================================================================
-- Reconciler claim query (2A). Mirrors private.claim_onlyevs_due_email at
-- 20260816003000_onlyevs_email_ingestion.sql:371-391, but claims rows
-- directly from public.onlyevs_inbound_emails rather than the outbox --
-- already-captured mail sits at state='classified' permanently (the parse
-- job's own state machine never revisits it), so there is no outbox row per
-- message to claim the way the parse job claims one. This reuses that
-- table's existing claimed_by/claim_expires_at lease columns, which the
-- parse job (services/onlyevs-worker/email.ts) always resets to null the
-- moment a row reaches 'classified' -- the exact same "second independent
-- claim queue reusing otherwise-idle lease columns" pattern as
-- private.claim_onlyevs_due_charging_sync repurposing
-- onlyevs_integrations.next_sync_at/claimed_by/claim_expires_at
-- (20260817090000_onlyevs_vehicle_telemetry_ledger.sql). Idempotent by
-- design: the caller (T9) upserts private.onlyevs_email_message_index on
-- inbound_email_id, so migration backfill and post-launch self-healing are
-- one mechanism, not two. Never transitions onlyevs_inbound_emails.state --
-- backfilling the index is not a state-machine edge for that table.
create or replace function private.claim_onlyevs_due_email_index_backfill(
  p_worker_id text,
  p_limit integer default 25
)
returns setof public.onlyevs_inbound_emails
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 3 or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_email_index_backfill_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select e.id
    from public.onlyevs_inbound_emails e
    where e.state = 'classified'
      and (e.claim_expires_at is null or e.claim_expires_at <= now())
      and not exists (
        select 1 from private.onlyevs_email_message_index i where i.inbound_email_id = e.id
      )
    order by e.created_at, e.id
    limit p_limit
    for update skip locked
  )
  update public.onlyevs_inbound_emails e set
    claimed_by = p_worker_id, claim_expires_at = now() + interval '2 minutes'
  from due where e.id = due.id returning e.*;
end;
$$;

revoke all on function private.claim_onlyevs_due_email_index_backfill(text, integer) from public, anon, authenticated;
grant execute on function private.claim_onlyevs_due_email_index_backfill(text, integer) to onlyevs_worker;

-- =====================================================================
-- T5 (migration side) -- worker-only reader for the retention sweep: which
-- (workspace_id, inbound_email_id) pairs are past their integration's
-- configured retention_window_days and still have an R2 envelope to delete.
-- The sweep loop itself (claiming the 'retention' outbox job, calling this,
-- then calling the purge core below per row, then deleting the returned R2
-- keys) is the worker's own to build (T5 worker side) -- this function only
-- provides the bounded, always-capped "what's due" read.
-- =====================================================================

create or replace function private.list_onlyevs_email_retention_due(p_limit integer default 500)
returns table (workspace_id uuid, inbound_email_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.workspace_id, e.id
  from public.onlyevs_inbound_emails e
  join public.onlyevs_email_integrations i
    on i.id = e.integration_id and i.workspace_id = e.workspace_id
  where i.retention_window_days is not null
    and e.r2_object_key is not null
    and e.created_at <= now() - make_interval(days => i.retention_window_days)
  order by e.created_at
  limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function private.list_onlyevs_email_retention_due(integer) from public, anon, authenticated;
grant execute on function private.list_onlyevs_email_retention_due(integer) to onlyevs_worker;

-- Manager-gated retention setter, structurally mirroring
-- update_onlyevs_email_integration's optimistic-revision pattern
-- (20260816003000_onlyevs_email_ingestion.sql), but a dedicated function
-- rather than widening that one's signature -- the retention window is a
-- distinct, deliberately narrow control surface (5A) and this keeps its own
-- validation (positive-or-null) separate from mode/status validation.
create or replace function public.set_onlyevs_email_retention_window(
  p_workspace_id uuid,
  p_integration_id uuid,
  p_expected_revision bigint,
  p_retention_window_days integer default null
)
returns public.onlyevs_email_integrations
language plpgsql
security definer
set search_path = ''
as $$
declare result public.onlyevs_email_integrations;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if p_retention_window_days is not null and p_retention_window_days <= 0 then
    raise exception 'invalid_email_retention_window' using errcode = '22023';
  end if;
  update public.onlyevs_email_integrations i set
    retention_window_days = p_retention_window_days,
    revision = i.revision + 1
  where i.id = p_integration_id and i.workspace_id = p_workspace_id and i.revision = p_expected_revision
  returning * into result;
  if not found then raise exception 'email_integration_revision_conflict' using errcode = '40001'; end if;
  return result;
end;
$$;

revoke all on function public.set_onlyevs_email_retention_window(uuid, uuid, bigint, integer) from public, anon;
grant execute on function public.set_onlyevs_email_retention_window(uuid, uuid, bigint, integer) to authenticated;

-- =====================================================================
-- T4 -- purge machinery. private.purge_onlyevs_email_message_core is the
-- shared body every scope (message/reservation/guest) calls, one message at
-- a time -- same "one shared private core, security invoker, callers do
-- their own authorization" shape as private.create_onlyevs_trip_core
-- (20260816150000_onlyevs_email_action_lifecycle.sql). It:
--   1. Collects every R2 object key this message owns (attachments +
--      the raw envelope) BEFORE deleting/nulling anything, so the caller
--      always gets back the full set to delete from R2 itself.
--   2. Deletes the index row (cascades to attachment rows via FK).
--   3. Scrubs the pre-existing plaintext copy Postgres already held before
--      this migration -- onlyevs_email_candidates.proposed_state's
--      messageText/guestMessageText keys -- in place via jsonb `-` key
--      removal. The candidate row and every other structured fact stay
--      untouched (Premise 3: "candidate row and structured facts
--      retained").
--   4. Stamps onlyevs_trips.pii_scrubbed_at when the candidate resolved to
--      a trip.
--   5. Nulls the raw envelope's r2_object_key on onlyevs_inbound_emails so
--      a purge can never be silently defeated by a stale reference (the
--      worker deletes the actual R2 object using the key this function
--      returned).
--   6. Writes one append-only audit row per message purged.
-- A purge that scrubs proposed_state while a confirm/apply action for that
-- candidate is mid-flight bumps candidate.revision (step 3) -- when
-- execute_onlyevs_email_action's 'validating' step re-reads the candidate,
-- both `candidate.revision <> action.candidate_revision` and the
-- independently recomputed proposed_state_hash mismatch, and the action
-- fails closed to 'needs_review'/'validation_conflict' by that existing
-- state machine (20260816150000_onlyevs_email_action_lifecycle.sql) --
-- nothing new is required here to get that property; see the pgTAP
-- coverage for it.
-- =====================================================================

create or replace function private.purge_onlyevs_email_message_core(
  p_workspace_id uuid,
  p_inbound_email_id uuid,
  p_actor_user_id uuid,
  p_scope text,
  p_reason text default null
)
returns table (r2_object_key text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inbound public.onlyevs_inbound_emails;
  v_candidate public.onlyevs_email_candidates;
  v_attachment_keys text[];
  v_all_keys text[];
  v_audit_id uuid;
begin
  select * into v_inbound from public.onlyevs_inbound_emails e
    where e.workspace_id = p_workspace_id and e.id = p_inbound_email_id
    for update;
  if v_inbound.id is null then
    raise exception 'email_message_not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(a.r2_object_key), '{}') into v_attachment_keys
  from private.onlyevs_email_attachments a
  join private.onlyevs_email_message_index i
    on i.workspace_id = a.workspace_id and i.id = a.message_index_id
  where i.workspace_id = p_workspace_id and i.inbound_email_id = p_inbound_email_id;

  v_all_keys := v_attachment_keys;
  if v_inbound.r2_object_key is not null then
    v_all_keys := array_append(v_all_keys, v_inbound.r2_object_key);
  end if;

  delete from private.onlyevs_email_message_index i
    where i.workspace_id = p_workspace_id and i.inbound_email_id = p_inbound_email_id;

  select * into v_candidate from public.onlyevs_email_candidates c
    where c.workspace_id = p_workspace_id and c.inbound_email_id = p_inbound_email_id
    for update;
  if v_candidate.id is not null then
    update public.onlyevs_email_candidates c set
      proposed_state = c.proposed_state - 'messageText' - 'guestMessageText',
      revision = c.revision + 1
      where c.id = v_candidate.id;
    if v_candidate.effective_trip_id is not null then
      update public.onlyevs_trips t set pii_scrubbed_at = now()
        where t.workspace_id = p_workspace_id and t.id = v_candidate.effective_trip_id;
    end if;
  end if;

  update public.onlyevs_inbound_emails e set r2_object_key = null
    where e.id = v_inbound.id;

  insert into private.onlyevs_email_purge_audit (
    workspace_id, scope, inbound_email_id, actor_user_id, reason, r2_object_keys
  ) values (
    p_workspace_id, p_scope, v_inbound.id, p_actor_user_id, p_reason, v_all_keys
  ) returning id into v_audit_id;

  -- The R2 bytes for v_all_keys are not deleted by this function -- Postgres
  -- has no S3 client. Enqueueing this job in the SAME transaction as the
  -- audit row (rather than leaving it to the caller) is what actually wires
  -- T10's executor to a real trigger: entity_id is the audit row's own id,
  -- so services/onlyevs-worker/email.ts's processPurgeJob can read
  -- r2_object_keys straight back off private.onlyevs_email_purge_audit
  -- (append-only, already durable) with no separate payload channel, and
  -- `on conflict (job_type, entity_id) do nothing` makes a second call for
  -- the same already-purged message (v_all_keys = '{}') a harmless no-op
  -- enqueue rather than an error.
  insert into public.onlyevs_email_outbox (workspace_id, job_type, entity_id)
  values (p_workspace_id, 'purge', v_audit_id)
  on conflict (job_type, entity_id) do nothing;

  return query select unnest(v_all_keys);
end;
$$;

revoke all on function private.purge_onlyevs_email_message_core(uuid, uuid, uuid, text, text) from public, anon, authenticated, onlyevs_worker;

-- Message-scoped purge: always available (Premise 3's first key rule).
create or replace function public.purge_onlyevs_email_message(
  p_workspace_id uuid,
  p_inbound_email_id uuid,
  p_reason text default null
)
returns table (r2_object_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  return query
  select * from private.purge_onlyevs_email_message_core(
    p_workspace_id, p_inbound_email_id, (select auth.uid()), 'message', p_reason
  );
end;
$$;

revoke all on function public.purge_onlyevs_email_message(uuid, uuid, text) from public, anon;
grant execute on function public.purge_onlyevs_email_message(uuid, uuid, text) to authenticated;

-- Reservation-scoped purge: every message whose candidate carries this
-- reservation_id (Premise 3's second key rule). Targets are resolved
-- directly off onlyevs_email_candidates, which always exists once a message
-- is captured -- NOT off private.onlyevs_email_message_index, which can
-- lag capture (still awaiting the T9 reconciler's pass, or mid the parse+
-- index dual-write window). Gating target resolution on "has an index row"
-- was indistinguishable from "not yet indexed" and silently dropped
-- in-flight messages from the purge with no error/partial-count signal.
-- "Already purged" is instead read off onlyevs_inbound_emails.r2_object_key
-- -- purge_onlyevs_email_message_core nulls it unconditionally (line ~435
-- above) as its own, index-row-independent signal that nothing is left to
-- purge for that message, so a second reservation/guest purge covering the
-- same reservation correctly skips it without depending on indexing state.
create or replace function public.purge_onlyevs_email_reservation(
  p_workspace_id uuid,
  p_reservation_id text,
  p_reason text default null
)
returns table (r2_object_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  return query
  select k.r2_object_key
  from (
    select distinct c.inbound_email_id
    from public.onlyevs_email_candidates c
    join public.onlyevs_inbound_emails e
      on e.workspace_id = c.workspace_id and e.id = c.inbound_email_id
    where c.workspace_id = p_workspace_id and c.reservation_id = p_reservation_id
      and e.r2_object_key is not null
  ) targets
  cross join lateral private.purge_onlyevs_email_message_core(
    p_workspace_id, targets.inbound_email_id, (select auth.uid()), 'reservation', p_reason
  ) k;
end;
$$;

revoke all on function public.purge_onlyevs_email_reservation(uuid, text, text) from public, anon;
grant execute on function public.purge_onlyevs_email_reservation(uuid, text, text) to authenticated;

-- Guest-scoped purge (Premise 3's third key rule): a confirmed trip gives an
-- exact guest_id/trip_id link; for mail that never made it past "captured"
-- (no confirmed trip), there is no reliable guest key, so this resolves to
-- reservation matching against the guest's own confirmed trips' reservation
-- ids -- a deliberately named proxy, not an exact match. Any caller-facing
-- surface built on this (T13/T14) must disclose that scope explicitly, per
-- Premise 3 ("the UI says so").
create or replace function public.purge_onlyevs_email_guest(
  p_workspace_id uuid,
  p_guest_id uuid,
  p_reason text default null
)
returns table (r2_object_key text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  return query
  with guest_trips as (
    select t.id
    from public.onlyevs_trips t
    where t.workspace_id = p_workspace_id and t.guest_id = p_guest_id
  ),
  -- Reservation ids belonging to this guest's own confirmed trips: joined via
  -- onlyevs_email_candidates.effective_trip_id (the "this candidate resolved
  -- to that trip" link the action lifecycle sets at db_committing time,
  -- 20260816150000_onlyevs_email_action_lifecycle.sql), not
  -- onlyevs_trips.email_candidate_id (which instead names the single
  -- candidate/calendar event a trip was originally *created from* -- a
  -- different relationship that would silently miss every later candidate
  -- for the same reservation, e.g. an apply_update or guest_message that
  -- shares the reservation but never created the trip itself).
  guest_reservations as (
    select distinct c.reservation_id
    from public.onlyevs_email_candidates c
    join guest_trips gt on gt.id = c.effective_trip_id
    where c.reservation_id is not null
  ),
  targets as (
    select distinct i.inbound_email_id
    from private.onlyevs_email_message_index i
    where i.workspace_id = p_workspace_id
      and (i.guest_id = p_guest_id or i.trip_id in (select id from guest_trips))
    union
    -- Same fix as purge_onlyevs_email_reservation above: targets resolve
    -- directly off onlyevs_email_candidates (always present once captured),
    -- not off private.onlyevs_email_message_index (which can lag capture --
    -- awaiting T9's reconciler pass, or mid the parse+index dual-write
    -- window -- and would otherwise be silently indistinguishable from an
    -- already-purged message). "Already purged" is instead read off
    -- onlyevs_inbound_emails.r2_object_key, which purge_onlyevs_email_
    -- message_core nulls unconditionally regardless of whether an index row
    -- ever existed.
    select distinct c.inbound_email_id
    from public.onlyevs_email_candidates c
    join public.onlyevs_inbound_emails e
      on e.workspace_id = c.workspace_id and e.id = c.inbound_email_id
    where c.workspace_id = p_workspace_id
      and (
        c.effective_trip_id in (select id from guest_trips)
        or (c.reservation_id is not null and c.reservation_id in (select reservation_id from guest_reservations))
      )
      and e.r2_object_key is not null
  )
  select k.r2_object_key
  from targets
  cross join lateral private.purge_onlyevs_email_message_core(
    p_workspace_id, targets.inbound_email_id, (select auth.uid()), 'guest', p_reason
  ) k;
end;
$$;

revoke all on function public.purge_onlyevs_email_guest(uuid, uuid, text) from public, anon;
grant execute on function public.purge_onlyevs_email_guest(uuid, uuid, text) to authenticated;

-- =====================================================================
-- T2 -- hardened public RPCs (list, search, unread counts). All three:
-- membership check first, search_path locked, revoked from public/anon,
-- granted to authenticated only -- same convention as every reader in
-- 20260817090000_onlyevs_vehicle_telemetry_ledger.sql.
-- =====================================================================

-- Cursor-paginated list, mirroring lib/owner/email-inbox-repository.ts's
-- paginateInboxItems shape (occurred_at/id tie-break, exclusive cursor).
-- p_linked: null = no filter, true = has any of candidate/trip/guest link,
-- false = none. p_unread_only: true = only messages the calling user has no
-- read receipt for.
create or replace function public.list_onlyevs_email_messages(
  p_workspace_id uuid,
  p_shop_slug text default null,
  p_event_type text default null,
  p_linked boolean default null,
  p_unread_only boolean default null,
  p_before_sent_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  inbound_email_id uuid,
  subject text,
  sender text,
  sent_at timestamptz,
  snippet text,
  has_attachments boolean,
  candidate_id uuid,
  trip_id uuid,
  guest_id uuid,
  event_type text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_limit integer;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  return query
  select
    m.id, m.inbound_email_id, m.subject, m.sender, m.sent_at, m.snippet, m.has_attachments,
    m.candidate_id, m.trip_id, m.guest_id, c.event_type,
    (r.user_id is not null) as is_read
  from private.onlyevs_email_message_index m
  left join public.onlyevs_email_candidates c
    on c.workspace_id = m.workspace_id and c.id = m.candidate_id
  left join private.onlyevs_email_read_receipts r
    on r.workspace_id = m.workspace_id and r.message_index_id = m.id and r.user_id = (select auth.uid())
  where m.workspace_id = p_workspace_id
    and (p_shop_slug is null or m.shop_slug = btrim(p_shop_slug))
    and (p_event_type is null or c.event_type = p_event_type)
    and (
      p_linked is null
      or (p_linked and (m.candidate_id is not null or m.trip_id is not null or m.guest_id is not null))
      or (not p_linked and m.candidate_id is null and m.trip_id is null and m.guest_id is null)
    )
    and (p_unread_only is not true or r.user_id is null)
    and (
      p_before_sent_at is null
      or m.sent_at < p_before_sent_at
      or (m.sent_at = p_before_sent_at and p_before_id is not null and m.id > p_before_id)
    )
  order by m.sent_at desc, m.id asc
  limit v_limit;
end;
$$;

revoke all on function public.list_onlyevs_email_messages(
  uuid, text, text, boolean, boolean, timestamptz, uuid, integer
) from public, anon;
grant execute on function public.list_onlyevs_email_messages(
  uuid, text, text, boolean, boolean, timestamptz, uuid, integer
) to authenticated;

-- Body search via websearch_to_tsquery (natural "quoted phrase -exclude"
-- syntax); hard-capped at 100 rows regardless of caller input, matching the
-- always-bounded-output discipline of get_onlyevs_vehicle_stats_history_
-- buckets / get_onlyevs_charge_sessions.
create or replace function public.search_onlyevs_email_messages(
  p_workspace_id uuid,
  p_query text,
  p_shop_slug text default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  inbound_email_id uuid,
  subject text,
  sender text,
  sent_at timestamptz,
  snippet text,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_query tsquery;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if p_query is null or btrim(p_query) = '' then
    raise exception 'invalid_email_search_query' using errcode = '22023';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_query := websearch_to_tsquery('english', p_query);

  return query
  select m.id, m.inbound_email_id, m.subject, m.sender, m.sent_at, m.snippet,
    ts_rank(m.body_tsv, v_query) as rank
  from private.onlyevs_email_message_index m
  where m.workspace_id = p_workspace_id
    and (p_shop_slug is null or m.shop_slug = btrim(p_shop_slug))
    and m.body_tsv @@ v_query
  order by rank desc, m.sent_at desc, m.id asc
  limit v_limit;
end;
$$;

revoke all on function public.search_onlyevs_email_messages(uuid, text, text, integer) from public, anon;
grant execute on function public.search_onlyevs_email_messages(uuid, text, text, integer) to authenticated;

create or replace function public.get_onlyevs_email_unread_count(
  p_workspace_id uuid,
  p_shop_slug text default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  select count(*)::integer into v_count
  from private.onlyevs_email_message_index m
  left join private.onlyevs_email_read_receipts r
    on r.workspace_id = m.workspace_id and r.message_index_id = m.id and r.user_id = (select auth.uid())
  where m.workspace_id = p_workspace_id
    and (p_shop_slug is null or m.shop_slug = btrim(p_shop_slug))
    and r.user_id is null;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_onlyevs_email_unread_count(uuid, text) from public, anon;
grant execute on function public.get_onlyevs_email_unread_count(uuid, text) to authenticated;

-- =====================================================================
-- T3 -- read receipts. record_onlyevs_email_read upserts the calling
-- user's own receipt (never lets a caller record a receipt for anyone
-- else -- user_id is always (select auth.uid()), never a parameter).
-- get_onlyevs_email_read_receipts is the manager-visible audit read: any
-- workspace manager can see who on the team has read a given message and
-- when, not just their own receipt.
-- =====================================================================

create or replace function public.record_onlyevs_email_read(
  p_workspace_id uuid,
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.onlyevs_email_message_index m
    where m.workspace_id = p_workspace_id and m.id = p_message_id
  ) then
    raise exception 'email_message_not_found' using errcode = 'P0002';
  end if;
  insert into private.onlyevs_email_read_receipts (workspace_id, message_index_id, user_id, read_at)
  values (p_workspace_id, p_message_id, (select auth.uid()), now())
  on conflict (user_id, message_index_id) do update set read_at = excluded.read_at;
end;
$$;

revoke all on function public.record_onlyevs_email_read(uuid, uuid) from public, anon;
grant execute on function public.record_onlyevs_email_read(uuid, uuid) to authenticated;

create or replace function public.get_onlyevs_email_read_receipts(
  p_workspace_id uuid,
  p_message_id uuid
)
returns table (user_id uuid, read_at timestamptz)
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
  select r.user_id, r.read_at
  from private.onlyevs_email_read_receipts r
  where r.workspace_id = p_workspace_id and r.message_index_id = p_message_id
  order by r.read_at desc;
end;
$$;

revoke all on function public.get_onlyevs_email_read_receipts(uuid, uuid) from public, anon;
grant execute on function public.get_onlyevs_email_read_receipts(uuid, uuid) to authenticated;

-- =====================================================================
-- Grants + RLS. private schema: no RLS (consistent with the other private
-- onlyevs_* tables) -- access is either the direct onlyevs_worker grants
-- below (the parse job and reconciler write these tables with ordinary
-- SQL, not through a wrapper RPC) or the hardened SECURITY DEFINER readers
-- above, which run as the function owner and so are unaffected by the
-- blanket revoke below.
-- =====================================================================

revoke all on private.onlyevs_email_message_index, private.onlyevs_email_attachments,
  private.onlyevs_email_read_receipts, private.onlyevs_email_purge_audit
  from anon, authenticated;

grant select, insert, update, delete on private.onlyevs_email_message_index,
  private.onlyevs_email_attachments, private.onlyevs_email_read_receipts
  to onlyevs_worker;
-- Append-only audit: select (for support/audit tooling) + insert only, same
-- as private.onlyevs_guest_merge_audit's grant shape -- no update/delete
-- even for the worker role.
grant select, insert on private.onlyevs_email_purge_audit to onlyevs_worker;

comment on table private.onlyevs_email_message_index is
  'Metadata + extracted-plaintext search index for already-captured mail. Raw HTML/attachments stay in encrypted R2; never a second copy of the raw message.';
comment on table private.onlyevs_email_attachments is
  'Per-attachment encrypted R2 object references (3A). The read route never parses MIME -- it serves these pre-extracted objects.';
comment on table private.onlyevs_email_read_receipts is
  'Per-user read state (T3); audit-visible to workspace managers via get_onlyevs_email_read_receipts, never RLS-exposed directly.';
