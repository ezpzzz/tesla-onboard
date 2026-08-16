-- EVhost Turo email intake, durable Review/Auto actions, delivery reconciliation,
-- and the source-neutral owner Inbox. All additions are dark until runtime
-- capability flags and real-template evidence are present.

create schema if not exists private;

create table public.onlyevs_email_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shop_slug text not null,
  status text not null default 'pending_verification'
    check (status in ('pending_verification','testing','active','paused','error','disconnected')),
  mode text not null default 'review' check (mode in ('review','auto')),
  alias_address text check (alias_address is null or alias_address ~ '^[a-z0-9]{20,64}\.[a-z0-9_-]{16,86}@mail\.evhost\.app$'),
  owner_alert_email_ciphertext text,
  owner_alert_email_hash text check (owner_alert_email_hash is null or owner_alert_email_hash ~ '^[0-9a-f]{64}$'),
  capability_revisions jsonb not null default '{"create":0,"pretrip":0,"active_safe":0,"active_destructive":0}'::jsonb
    check (jsonb_typeof(capability_revisions) = 'object'),
  last_receipt_at timestamptz,
  last_test_at timestamptz,
  last_canary_at timestamptz,
  pause_reason text check (pause_reason is null or char_length(pause_reason) <= 200),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 120),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, shop_slug),
  unique (workspace_id, id),
  check (char_length(shop_slug) between 1 and 160)
);

create table private.onlyevs_email_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  integration_id uuid not null,
  alias_hash text not null check (alias_hash ~ '^[0-9a-f]{64}$'),
  alias_hint text not null check (alias_hint ~ '^[a-z0-9]{6,12}$'),
  hmac_key_version smallint not null check (hmac_key_version > 0),
  revision bigint not null default 1 check (revision > 0),
  status text not null default 'active' check (status in ('active','rotated','revoked')),
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint onlyevs_email_aliases_integration_fk foreign key (workspace_id, integration_id)
    references public.onlyevs_email_integrations(workspace_id, id) on delete cascade,
  unique (alias_hash),
  unique (workspace_id, integration_id, revision)
);

create unique index onlyevs_email_aliases_one_active_idx
  on private.onlyevs_email_aliases(integration_id) where status = 'active';

create table public.onlyevs_inbound_emails (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null,
  accepted_alias_revision bigint not null check (accepted_alias_revision > 0),
  rfc_message_id text,
  synthetic_identity text,
  raw_sha256 text check (raw_sha256 is null or raw_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_sha256 text check (normalized_sha256 is null or normalized_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext_sha256 text check (ciphertext_sha256 is null or ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  wrapped_dek_sha256 text check (wrapped_dek_sha256 is null or wrapped_dek_sha256 ~ '^[0-9a-f]{64}$'),
  raw_bytes integer check (raw_bytes is null or raw_bytes between 0 and 2097152),
  normalized_bytes integer check (normalized_bytes is null or normalized_bytes between 0 and 262144),
  ciphertext_bytes integer check (ciphertext_bytes is null or ciphertext_bytes > 0),
  r2_object_key text,
  kek_version smallint check (kek_version is null or kek_version > 0),
  receiver_auth_verdict text check (receiver_auth_verdict is null or receiver_auth_verdict in ('pass','review','fail')),
  redacted_headers jsonb not null default '{}'::jsonb check (jsonb_typeof(redacted_headers) = 'object'),
  template_version text,
  parser_version text,
  state text not null default 'authorized' check (state in (
    'authorized','storing','stored','queued','processing','classified','rejected','dead_letter'
  )),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 200),
  claimed_by text,
  claim_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  delete_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_inbound_emails_integration_fk foreign key (workspace_id, integration_id)
    references public.onlyevs_email_integrations(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  check ((rfc_message_id is not null) <> (synthetic_identity is not null)),
  check (state = 'authorized' or (
    raw_sha256 is not null and normalized_sha256 is not null and raw_bytes is not null
    and normalized_bytes is not null and kek_version is not null and receiver_auth_verdict is not null
  )),
  check (r2_object_key is null or r2_object_key ~ '^pending/[0-9a-f-]{36}\.evmail$')
);

create unique index onlyevs_inbound_message_id_idx
  on public.onlyevs_inbound_emails(workspace_id, integration_id, accepted_alias_revision, rfc_message_id)
  where rfc_message_id is not null;
create unique index onlyevs_inbound_raw_fallback_idx
  on public.onlyevs_inbound_emails(workspace_id, integration_id, accepted_alias_revision, raw_sha256)
  where rfc_message_id is null;
create index onlyevs_inbound_due_idx
  on public.onlyevs_inbound_emails(state, claim_expires_at, created_at)
  where state in ('stored','queued','processing');
create index onlyevs_inbound_delete_idx on public.onlyevs_inbound_emails(delete_after, id);

create table public.onlyevs_email_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null,
  inbound_email_id uuid not null,
  reservation_id text,
  event_type text not null check (event_type in ('booking','change','cancellation','guest_message','noise','unknown')),
  authoritative_revision text,
  authoritative_order_at timestamptz,
  proposed_state jsonb not null check (jsonb_typeof(proposed_state) = 'object'),
  correction_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(correction_facts) = 'object'),
  blocker_codes text[] not null default '{}',
  state text not null default 'pending' check (state in (
    'pending','needs_review','auto_queued','applying','applied','dismissed','superseded'
  )),
  effective_trip_id uuid,
  revision bigint not null default 1 check (revision > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_email_candidates_integration_fk foreign key (workspace_id, integration_id)
    references public.onlyevs_email_integrations(workspace_id, id) on delete cascade,
  constraint onlyevs_email_candidates_inbound_fk foreign key (workspace_id, inbound_email_id)
    references public.onlyevs_inbound_emails(workspace_id, id) on delete cascade,
  constraint onlyevs_email_candidates_trip_fk foreign key (workspace_id, effective_trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete set null,
  unique (workspace_id, id),
  unique (inbound_email_id),
  check (reservation_id is null or char_length(reservation_id) between 1 and 120),
  check (authoritative_revision is null or char_length(authoritative_revision) <= 160)
);

create unique index onlyevs_email_candidate_revision_idx
  on public.onlyevs_email_candidates(workspace_id, integration_id, reservation_id, event_type, authoritative_revision)
  where reservation_id is not null and authoritative_revision is not null and state <> 'superseded';
create index onlyevs_email_candidates_inbox_idx
  on public.onlyevs_email_candidates(workspace_id, occurred_at desc, id);
create index onlyevs_email_candidates_action_idx
  on public.onlyevs_email_candidates(workspace_id, state, occurred_at desc)
  where state in ('pending','needs_review','auto_queued','applying');

create table public.onlyevs_email_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null,
  action_type text not null check (action_type in (
    'create_trip','apply_update','cancel_trip','rotate_guest','swap_vehicle','deliver_link','revoke_access'
  )),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  state text not null default 'queued' check (state in (
    'queued','claimed','validating','awaiting_owner_alert','revocation_pending','provider_mutating',
    'db_committing','delivery_pending','succeeded','aborted','superseded','needs_review',
    'failed_retryable','ambiguous','dead_letter'
  )),
  integration_revision bigint not null,
  candidate_revision bigint not null,
  capability_name text not null check (capability_name in ('create','pretrip','active_safe','active_destructive')),
  capability_revision bigint not null default 0,
  proposed_state_hash text not null check (proposed_state_hash ~ '^[0-9a-f]{64}$'),
  brake_deadline timestamptz,
  provider_claimed_at timestamptz,
  effective_trip_id uuid,
  delivery_id uuid,
  claimed_by text,
  claim_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_action_at timestamptz,
  last_error_code text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_email_actions_candidate_fk foreign key (workspace_id, candidate_id)
    references public.onlyevs_email_candidates(workspace_id, id) on delete cascade,
  constraint onlyevs_email_actions_trip_fk foreign key (workspace_id, effective_trip_id)
    references public.onlyevs_trips(workspace_id, id) on delete set null,
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  check (brake_deadline is null or action_type in ('cancel_trip','rotate_guest','swap_vehicle','revoke_access'))
);

create index onlyevs_email_actions_due_idx
  on public.onlyevs_email_actions(next_action_at, id)
  where state in ('queued','failed_retryable','revocation_pending');

create table public.onlyevs_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_id uuid,
  purpose text not null check (purpose in ('guest_onboarding','trip_update','owner_alert','owner_copy')),
  recipient_route text not null check (recipient_route in ('turo_relay','guest_email','owner_alert','owner_copy')),
  recipient_ciphertext text not null,
  stable_message_id text not null check (char_length(stable_message_id) between 10 and 320),
  provider_message_id text,
  state text not null default 'pending' check (state in (
    'pending','sending','accepted','delivered','delivery_paused','ambiguous','bounced','dropped',
    'failed_retryable','failed_terminal','owner_review'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_action_at timestamptz,
  claimed_by text,
  claim_expires_at timestamptz,
  last_error_code text,
  accepted_at timestamptz,
  delivered_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onlyevs_email_deliveries_action_fk foreign key (workspace_id, action_id)
    references public.onlyevs_email_actions(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (stable_message_id)
);

alter table public.onlyevs_email_actions
  add constraint onlyevs_email_actions_delivery_fk foreign key (workspace_id, delivery_id)
  references public.onlyevs_email_deliveries(workspace_id, id) on delete set null;

create table private.onlyevs_sendgrid_events (
  sg_event_id text primary key check (char_length(sg_event_id) between 8 and 200),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  delivery_id uuid not null,
  event_type text not null check (event_type in ('processed','delivered','deferred','bounce','dropped','blocked')),
  response_code text,
  signature_key_version smallint not null check (signature_key_version > 0),
  provider_timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  constraint onlyevs_sendgrid_events_delivery_fk foreign key (workspace_id, delivery_id)
    references public.onlyevs_email_deliveries(workspace_id, id) on delete cascade
);

create table private.onlyevs_email_key_references (
  inbound_email_id uuid primary key,
  workspace_id uuid not null,
  kek_version smallint not null check (kek_version > 0),
  wrapped_dek_hash text not null check (wrapped_dek_hash ~ '^[0-9a-f]{64}$'),
  delete_after timestamptz not null,
  rewrapped_at timestamptz,
  legal_hold_until timestamptz,
  created_at timestamptz not null default now(),
  constraint onlyevs_email_key_references_inbound_fk foreign key (workspace_id, inbound_email_id)
    references public.onlyevs_inbound_emails(workspace_id, id) on delete cascade
);

create table private.onlyevs_email_capture_nonces (
  key_version smallint not null check (key_version > 0),
  nonce text not null check (char_length(nonce) between 16 and 120),
  used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (key_version, nonce)
);

create table public.onlyevs_email_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_type text not null check (job_type in ('parse','action','delivery','retention','reconcile','canary')),
  entity_id uuid not null,
  due_at timestamptz not null default now(),
  claimed_by text,
  claim_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  state text not null default 'pending' check (state in ('pending','claimed','completed','failed_retryable','dead_letter')),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type, entity_id)
);

create index onlyevs_email_outbox_due_idx on public.onlyevs_email_outbox(due_at, id)
  where state in ('pending','failed_retryable','claimed');

create table public.onlyevs_inbox_archives (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email_candidate_id uuid,
  calendar_candidate_id uuid,
  archived_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint onlyevs_inbox_archives_email_fk foreign key (workspace_id, email_candidate_id)
    references public.onlyevs_email_candidates(workspace_id, id) on delete cascade,
  constraint onlyevs_inbox_archives_calendar_fk foreign key (workspace_id, calendar_candidate_id)
    references public.onlyevs_calendar_candidates(workspace_id, id) on delete cascade,
  check ((email_candidate_id is not null) <> (calendar_candidate_id is not null))
);

create unique index onlyevs_inbox_archives_email_idx on public.onlyevs_inbox_archives(workspace_id, email_candidate_id)
  where email_candidate_id is not null;
create unique index onlyevs_inbox_archives_calendar_idx on public.onlyevs_inbox_archives(workspace_id, calendar_candidate_id)
  where calendar_candidate_id is not null;

alter table public.onlyevs_trips add column if not exists email_candidate_id uuid;
alter table public.onlyevs_trips add column if not exists pii_scrubbed_at timestamptz;
alter table public.onlyevs_trips add constraint onlyevs_trips_email_candidate_fk
  foreign key (workspace_id, email_candidate_id)
  references public.onlyevs_email_candidates(workspace_id, id) on delete set null;
alter table public.onlyevs_trips add constraint onlyevs_trips_source_xor
  check (not (calendar_candidate_id is not null and email_candidate_id is not null));
create unique index onlyevs_trips_email_candidate_unique_idx
  on public.onlyevs_trips(workspace_id, email_candidate_id) where email_candidate_id is not null;

alter table public.onlyevs_access_grants drop constraint if exists onlyevs_access_grants_status_check;
alter table public.onlyevs_access_grants add constraint onlyevs_access_grants_status_check check (status in (
  'scheduled','issuing','invite_ready','redeemed','revocation_pending','revoking','revoked',
  'revocation_aborted','expired','reauth_required','failed_retryable','failed_terminal','manual_review'
));

create trigger touch_onlyevs_email_integrations before update on public.onlyevs_email_integrations
  for each row execute function private.touch_onlyevs_access_row();
create trigger touch_onlyevs_inbound_emails before update on public.onlyevs_inbound_emails
  for each row execute function private.touch_onlyevs_access_row();
create trigger touch_onlyevs_email_candidates before update on public.onlyevs_email_candidates
  for each row execute function private.touch_onlyevs_access_row();
create trigger touch_onlyevs_email_actions before update on public.onlyevs_email_actions
  for each row execute function private.touch_onlyevs_access_row();
create trigger touch_onlyevs_email_deliveries before update on public.onlyevs_email_deliveries
  for each row execute function private.touch_onlyevs_access_row();
create trigger touch_onlyevs_email_outbox before update on public.onlyevs_email_outbox
  for each row execute function private.touch_onlyevs_access_row();

create or replace function private.validate_onlyevs_email_state_transition()
returns trigger language plpgsql set search_path = '' as $$
declare allowed boolean := false;
begin
  if new.state = old.state then return new; end if;
  allowed := case tg_table_name
    when 'onlyevs_inbound_emails' then (old.state,new.state) in (
      ('authorized','storing'),('storing','stored'),('stored','queued'),('queued','processing'),
      ('processing','classified'),('processing','rejected'),('processing','dead_letter'),
      ('queued','dead_letter'),('stored','dead_letter'))
    when 'onlyevs_email_candidates' then (old.state,new.state) in (
      ('pending','needs_review'),('pending','auto_queued'),('pending','dismissed'),
      ('needs_review','applying'),('needs_review','dismissed'),('auto_queued','applying'),
      ('applying','applied'),('applying','needs_review'),('applying','superseded'),
      ('pending','superseded'),('needs_review','superseded'),('auto_queued','superseded'))
    when 'onlyevs_email_actions' then (old.state,new.state) in (
      ('queued','claimed'),('claimed','validating'),('validating','awaiting_owner_alert'),
      ('validating','provider_mutating'),('validating','db_committing'),
      ('awaiting_owner_alert','revocation_pending'),('revocation_pending','provider_mutating'),
      ('revocation_pending','aborted'),('provider_mutating','db_committing'),
      ('db_committing','delivery_pending'),('db_committing','succeeded'),
      ('delivery_pending','succeeded'),('claimed','failed_retryable'),
      ('validating','needs_review'),('validating','failed_retryable'),
      ('provider_mutating','ambiguous'),('db_committing','ambiguous'),
      ('failed_retryable','claimed'),('failed_retryable','dead_letter'),
      ('queued','superseded'),('claimed','superseded'))
    when 'onlyevs_email_deliveries' then (old.state,new.state) in (
      ('pending','sending'),('sending','accepted'),('sending','ambiguous'),
      ('sending','failed_retryable'),('accepted','delivered'),('accepted','bounced'),
      ('accepted','dropped'),('accepted','delivery_paused'),('ambiguous','owner_review'),
      ('failed_retryable','sending'),('failed_retryable','failed_terminal'),
      ('delivery_paused','sending'))
    else false end;
  if not allowed then raise exception 'invalid_%_state_transition_%_to_%', tg_table_name, old.state, new.state using errcode = '55000'; end if;
  return new;
end;
$$;

create trigger validate_onlyevs_inbound_email_transition before update of state on public.onlyevs_inbound_emails
  for each row execute function private.validate_onlyevs_email_state_transition();
create trigger validate_onlyevs_email_candidate_transition before update of state on public.onlyevs_email_candidates
  for each row execute function private.validate_onlyevs_email_state_transition();
create trigger validate_onlyevs_email_action_transition before update of state on public.onlyevs_email_actions
  for each row execute function private.validate_onlyevs_email_state_transition();
create trigger validate_onlyevs_email_delivery_transition before update of state on public.onlyevs_email_deliveries
  for each row execute function private.validate_onlyevs_email_state_transition();

create or replace function private.claim_onlyevs_due_email(p_worker_id text, p_limit integer default 5)
returns setof public.onlyevs_email_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 3 or p_limit < 1 or p_limit > 25 then
    raise exception 'invalid_email_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select o.id from public.onlyevs_email_outbox o
    where o.due_at <= now()
      and o.state in ('pending','failed_retryable','claimed')
      and (o.claim_expires_at is null or o.claim_expires_at <= now())
    order by o.due_at, o.id limit p_limit for update skip locked
  )
  update public.onlyevs_email_outbox o set
    state = 'claimed', claimed_by = p_worker_id,
    claim_expires_at = now() + interval '2 minutes', attempt_count = o.attempt_count + 1
  from due where o.id = due.id returning o.*;
end;
$$;

create or replace function public.claim_onlyevs_email_capture_nonce(
  p_key_version smallint, p_nonce text, p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from private.onlyevs_email_capture_nonces where expires_at <= now();
  insert into private.onlyevs_email_capture_nonces(key_version,nonce,expires_at)
  values (p_key_version,p_nonce,p_expires_at) on conflict do nothing;
  return found;
end;
$$;

create or replace function public.reconcile_onlyevs_sendgrid_event(
  p_sg_event_id text, p_workspace_id uuid, p_delivery_id uuid, p_event_type text,
  p_response_code text, p_signature_key_version smallint, p_provider_timestamp timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted boolean;
begin
  insert into private.onlyevs_sendgrid_events(sg_event_id,workspace_id,delivery_id,event_type,response_code,signature_key_version,provider_timestamp)
  values(p_sg_event_id,p_workspace_id,p_delivery_id,p_event_type,p_response_code,p_signature_key_version,p_provider_timestamp)
  on conflict(sg_event_id) do nothing;
  inserted := found;
  if not inserted then return false; end if;
  update public.onlyevs_email_deliveries d set
    provider_message_id = coalesce(d.provider_message_id,p_sg_event_id),
    state = case p_event_type when 'delivered' then 'delivered' when 'bounce' then 'bounced'
      when 'dropped' then 'dropped' when 'blocked' then 'dropped'
      when 'deferred' then 'delivery_paused' else d.state end,
    delivered_at = case when p_event_type='delivered' then p_provider_timestamp else d.delivered_at end,
    revision = d.revision + 1
  where d.id=p_delivery_id and d.workspace_id=p_workspace_id;
  return true;
end;
$$;

create or replace function public.configure_onlyevs_email_integration(
  p_workspace_id uuid,
  p_shop_slug text,
  p_alias_address text,
  p_alias_hash text,
  p_alias_hint text,
  p_hmac_key_version smallint,
  p_owner_alert_email_ciphertext text,
  p_owner_alert_email_hash text
) returns public.onlyevs_email_integrations
language plpgsql security definer set search_path = '' as $$
declare result public.onlyevs_email_integrations;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin') then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.workspace_branding b where b.workspace_id = p_workspace_id and b.shop_slug = p_shop_slug
  ) and not exists (
    select 1 from public.workspaces w where w.id = p_workspace_id and w.slug = p_shop_slug
  ) then raise exception 'workspace_shop_not_found' using errcode = 'P0002'; end if;

  insert into public.onlyevs_email_integrations(
    workspace_id, shop_slug, alias_address, owner_alert_email_ciphertext, owner_alert_email_hash
  ) values (
    p_workspace_id, p_shop_slug, p_alias_address, p_owner_alert_email_ciphertext, p_owner_alert_email_hash
  )
  on conflict (workspace_id, shop_slug) do update set
    alias_address = excluded.alias_address,
    owner_alert_email_ciphertext = excluded.owner_alert_email_ciphertext,
    owner_alert_email_hash = excluded.owner_alert_email_hash,
    status = case when public.onlyevs_email_integrations.status = 'disconnected' then 'pending_verification' else public.onlyevs_email_integrations.status end,
    revision = public.onlyevs_email_integrations.revision + 1
  returning * into result;

  update private.onlyevs_email_aliases set status = 'rotated', rotated_at = now()
  where integration_id = result.id and status = 'active';
  insert into private.onlyevs_email_aliases(
    workspace_id, integration_id, alias_hash, alias_hint, hmac_key_version, revision
  ) values (
    p_workspace_id, result.id, p_alias_hash, p_alias_hint, p_hmac_key_version,
    coalesce((select max(a.revision) + 1 from private.onlyevs_email_aliases a where a.integration_id = result.id), 1)
  );
  return result;
end;
$$;

create or replace function public.authorize_onlyevs_email_alias(
  p_alias_hash text,
  p_inbound_id uuid,
  p_rfc_message_id text
) returns table (
  inbound_id uuid, workspace_id uuid, integration_id uuid, accepted_alias_revision bigint,
  object_key text, integration_status text, integration_mode text
)
language plpgsql security definer set search_path = '' as $$
declare alias_row private.onlyevs_email_aliases;
declare integration_row public.onlyevs_email_integrations;
declare resolved_id uuid;
begin
  select * into alias_row from private.onlyevs_email_aliases a
    where a.alias_hash = p_alias_hash and a.status = 'active' for share;
  if not found then raise exception 'email_alias_not_active' using errcode = '42501'; end if;
  select * into integration_row from public.onlyevs_email_integrations i
    where i.id = alias_row.integration_id and i.workspace_id = alias_row.workspace_id
      and i.status in ('pending_verification','testing','active');
  if not found then raise exception 'email_integration_not_accepting' using errcode = '42501'; end if;

  if p_rfc_message_id is not null then
    select e.id into resolved_id from public.onlyevs_inbound_emails e
      where e.workspace_id = alias_row.workspace_id and e.integration_id = alias_row.integration_id
        and e.accepted_alias_revision = alias_row.revision and e.rfc_message_id = p_rfc_message_id;
  end if;
  resolved_id := coalesce(resolved_id, p_inbound_id);
  insert into public.onlyevs_inbound_emails(
    id, workspace_id, integration_id, accepted_alias_revision, rfc_message_id,
    synthetic_identity, state, delete_after
  ) values (
    resolved_id, alias_row.workspace_id, alias_row.integration_id, alias_row.revision,
    p_rfc_message_id, case when p_rfc_message_id is null then p_inbound_id::text else null end,
    'authorized', now() + interval '30 days'
  ) on conflict (id) do nothing;

  return query select resolved_id, alias_row.workspace_id, alias_row.integration_id, alias_row.revision,
    'pending/' || resolved_id::text || '.evmail', integration_row.status, integration_row.mode;
end;
$$;

create or replace function public.update_onlyevs_email_integration(
  p_workspace_id uuid, p_integration_id uuid, p_expected_revision bigint,
  p_mode text default null, p_status text default null
) returns public.onlyevs_email_integrations
language plpgsql security definer set search_path = '' as $$
declare result public.onlyevs_email_integrations;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin') then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;
  if p_mode is not null and p_mode not in ('review','auto') then raise exception 'invalid_email_mode' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('pending_verification','testing','active','paused','disconnected') then
    raise exception 'invalid_email_status' using errcode = '22023';
  end if;
  update public.onlyevs_email_integrations i set
    mode = coalesce(p_mode, i.mode), status = coalesce(p_status, i.status),
    revision = i.revision + 1,
    pause_reason = case when p_status = 'paused' then 'owner_paused' when p_status = 'active' then null else i.pause_reason end
  where i.id = p_integration_id and i.workspace_id = p_workspace_id and i.revision = p_expected_revision
  returning * into result;
  if not found then raise exception 'email_integration_revision_conflict' using errcode = '40001'; end if;
  return result;
end;
$$;

create or replace function public.init_onlyevs_email_capture(
  p_inbound_id uuid, p_alias_revision bigint, p_raw_sha256 text, p_normalized_sha256 text,
  p_raw_bytes integer, p_normalized_bytes integer, p_auth_verdict text, p_kek_version smallint
) returns public.onlyevs_inbound_emails
language plpgsql security definer set search_path = '' as $$
declare result public.onlyevs_inbound_emails;
begin
  update public.onlyevs_inbound_emails e set
    raw_sha256 = p_raw_sha256, normalized_sha256 = p_normalized_sha256,
    raw_bytes = p_raw_bytes, normalized_bytes = p_normalized_bytes,
    receiver_auth_verdict = p_auth_verdict, kek_version = p_kek_version, state = 'storing'
  where e.id = p_inbound_id and e.accepted_alias_revision = p_alias_revision
    and e.state in ('authorized','storing')
  returning * into result;
  if not found then raise exception 'email_capture_init_conflict' using errcode = '40001'; end if;
  return result;
end;
$$;

create or replace function public.finalize_onlyevs_email_capture(
  p_inbound_id uuid, p_object_key text, p_ciphertext_sha256 text, p_ciphertext_bytes integer,
  p_wrapped_dek_sha256 text, p_kek_version smallint, p_delete_after timestamptz
) returns public.onlyevs_inbound_emails
language plpgsql security definer set search_path = '' as $$
declare result public.onlyevs_inbound_emails;
begin
  update public.onlyevs_inbound_emails e set
    r2_object_key = p_object_key, ciphertext_sha256 = p_ciphertext_sha256,
    ciphertext_bytes = p_ciphertext_bytes, wrapped_dek_sha256 = p_wrapped_dek_sha256,
    kek_version = p_kek_version, delete_after = p_delete_after, state = 'stored'
  where e.id = p_inbound_id and e.state in ('storing','stored')
    and p_object_key = 'pending/' || p_inbound_id::text || '.evmail'
  returning * into result;
  if not found then raise exception 'email_capture_finalize_conflict' using errcode = '40001'; end if;
  insert into private.onlyevs_email_key_references(
    inbound_email_id, workspace_id, kek_version, wrapped_dek_hash, delete_after
  ) values (result.id, result.workspace_id, p_kek_version, p_wrapped_dek_sha256, p_delete_after)
  on conflict (inbound_email_id) do update set
    kek_version = excluded.kek_version, wrapped_dek_hash = excluded.wrapped_dek_hash,
    delete_after = excluded.delete_after;
  insert into public.onlyevs_email_outbox(workspace_id, job_type, entity_id)
  values (result.workspace_id, 'parse', result.id) on conflict (job_type, entity_id) do nothing;
  update public.onlyevs_inbound_emails set state = 'queued' where id = result.id returning * into result;
  update public.onlyevs_email_integrations set
    status = case when status in ('pending_verification','testing') then 'active' else status end,
    last_receipt_at = now(), last_test_at = case when status = 'testing' then now() else last_test_at end,
    revision = revision + 1
  where id = result.integration_id;
  return result;
end;
$$;

create or replace function public.archive_onlyevs_inbox_item(
  p_workspace_id uuid, p_email_candidate_id uuid default null, p_calendar_candidate_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if (p_email_candidate_id is null) = (p_calendar_candidate_id is null) then
    raise exception 'one_inbox_source_required' using errcode = '22023';
  end if;
  if p_email_candidate_id is not null and not exists (
    select 1 from public.onlyevs_email_candidates c where c.workspace_id = p_workspace_id
      and c.id = p_email_candidate_id and c.state in ('applied','dismissed','superseded')
  ) then raise exception 'inbox_item_still_actionable' using errcode = '55000'; end if;
  if p_calendar_candidate_id is not null and not exists (
    select 1 from public.onlyevs_calendar_candidates c where c.workspace_id = p_workspace_id
      and c.id = p_calendar_candidate_id and c.status in ('confirmed','dismissed','cancelled')
  ) then raise exception 'inbox_item_still_actionable' using errcode = '55000'; end if;
  insert into public.onlyevs_inbox_archives(workspace_id,email_candidate_id,calendar_candidate_id,archived_by)
  values (p_workspace_id,p_email_candidate_id,p_calendar_candidate_id,(select auth.uid()))
  on conflict do nothing;
end;
$$;

create or replace function public.restore_onlyevs_inbox_item(p_archive_id uuid, p_workspace_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  delete from public.onlyevs_inbox_archives a where a.id = p_archive_id and a.workspace_id = p_workspace_id;
  if not found then raise exception 'inbox_archive_not_found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.dismiss_onlyevs_email_candidate(
  p_workspace_id uuid, p_candidate_id uuid, p_expected_revision bigint
) returns public.onlyevs_email_candidates
language plpgsql security definer set search_path = '' as $$
declare result public.onlyevs_email_candidates;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  update public.onlyevs_email_candidates c set state = 'dismissed', revision = c.revision + 1
  where c.workspace_id = p_workspace_id and c.id = p_candidate_id
    and c.revision = p_expected_revision and c.state in ('pending','needs_review')
  returning * into result;
  if not found then raise exception 'email_candidate_revision_conflict' using errcode = '40001'; end if;
  return result;
end;
$$;

revoke all on function private.claim_onlyevs_due_email(text, integer) from public;
revoke all on function public.claim_onlyevs_email_capture_nonce(smallint,text,timestamptz) from public;
revoke all on function public.reconcile_onlyevs_sendgrid_event(text,uuid,uuid,text,text,smallint,timestamptz) from public;
revoke all on function public.configure_onlyevs_email_integration(uuid,text,text,text,text,smallint,text,text) from public;
revoke all on function public.update_onlyevs_email_integration(uuid,uuid,bigint,text,text) from public;
revoke all on function public.authorize_onlyevs_email_alias(text,uuid,text) from public;
revoke all on function public.init_onlyevs_email_capture(uuid,bigint,text,text,integer,integer,text,smallint) from public;
revoke all on function public.finalize_onlyevs_email_capture(uuid,text,text,integer,text,smallint,timestamptz) from public;
revoke all on function public.archive_onlyevs_inbox_item(uuid, uuid, uuid) from public;
revoke all on function public.restore_onlyevs_inbox_item(uuid, uuid) from public;
revoke all on function public.dismiss_onlyevs_email_candidate(uuid,uuid,bigint) from public;
grant execute on function private.claim_onlyevs_due_email(text, integer) to onlyevs_worker;
grant execute on function public.claim_onlyevs_email_capture_nonce(smallint,text,timestamptz) to service_role;
grant execute on function public.reconcile_onlyevs_sendgrid_event(text,uuid,uuid,text,text,smallint,timestamptz) to service_role;
grant execute on function public.configure_onlyevs_email_integration(uuid,text,text,text,text,smallint,text,text) to authenticated;
grant execute on function public.update_onlyevs_email_integration(uuid,uuid,bigint,text,text) to authenticated;
grant execute on function public.authorize_onlyevs_email_alias(text,uuid,text) to service_role;
grant execute on function public.init_onlyevs_email_capture(uuid,bigint,text,text,integer,integer,text,smallint) to service_role;
grant execute on function public.finalize_onlyevs_email_capture(uuid,text,text,integer,text,smallint,timestamptz) to service_role;
grant execute on function public.archive_onlyevs_inbox_item(uuid, uuid, uuid) to authenticated;
grant execute on function public.restore_onlyevs_inbox_item(uuid, uuid) to authenticated;
grant execute on function public.dismiss_onlyevs_email_candidate(uuid,uuid,bigint) to authenticated;

revoke all on public.onlyevs_email_integrations, public.onlyevs_inbound_emails,
  public.onlyevs_email_candidates, public.onlyevs_email_actions, public.onlyevs_email_deliveries,
  public.onlyevs_email_outbox, public.onlyevs_inbox_archives from public, anon, authenticated;
grant select on public.onlyevs_email_integrations, public.onlyevs_inbound_emails,
  public.onlyevs_email_candidates, public.onlyevs_email_actions, public.onlyevs_email_deliveries,
  public.onlyevs_inbox_archives to authenticated;
grant select, insert, update, delete on public.onlyevs_email_integrations, public.onlyevs_inbound_emails,
  public.onlyevs_email_candidates, public.onlyevs_email_actions, public.onlyevs_email_deliveries,
  public.onlyevs_email_outbox, public.onlyevs_inbox_archives to onlyevs_worker;
grant select, insert, update, delete on private.onlyevs_email_aliases, private.onlyevs_sendgrid_events,
  private.onlyevs_email_key_references to onlyevs_worker;

alter table public.onlyevs_email_integrations enable row level security;
alter table public.onlyevs_inbound_emails enable row level security;
alter table public.onlyevs_email_candidates enable row level security;
alter table public.onlyevs_email_actions enable row level security;
alter table public.onlyevs_email_deliveries enable row level security;
alter table public.onlyevs_email_outbox enable row level security;
alter table public.onlyevs_inbox_archives enable row level security;

create policy onlyevs_email_integrations_manager_select on public.onlyevs_email_integrations
  for select to authenticated using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_inbound_emails_manager_select on public.onlyevs_inbound_emails
  for select to authenticated using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_email_candidates_manager_select on public.onlyevs_email_candidates
  for select to authenticated using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_email_actions_manager_select on public.onlyevs_email_actions
  for select to authenticated using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_email_deliveries_manager_select on public.onlyevs_email_deliveries
  for select to authenticated using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));
create policy onlyevs_inbox_archives_manager_select on public.onlyevs_inbox_archives
  for select to authenticated using ((select public.has_minimum_role(workspace_id, (select auth.uid()), 'manager')));

create policy onlyevs_email_integrations_worker_all on public.onlyevs_email_integrations for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_inbound_emails_worker_all on public.onlyevs_inbound_emails for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_email_candidates_worker_all on public.onlyevs_email_candidates for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_email_actions_worker_all on public.onlyevs_email_actions for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_email_deliveries_worker_all on public.onlyevs_email_deliveries for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_email_outbox_worker_all on public.onlyevs_email_outbox for all to onlyevs_worker using (true) with check (true);
create policy onlyevs_inbox_archives_worker_all on public.onlyevs_inbox_archives for all to onlyevs_worker using (true) with check (true);

comment on table public.onlyevs_inbound_emails is 'Metadata and encrypted-object references only; raw message content lives in private R2.';
comment on table public.onlyevs_inbox_archives is 'Presentation-only archive markers; source event and audit history remain unchanged.';
