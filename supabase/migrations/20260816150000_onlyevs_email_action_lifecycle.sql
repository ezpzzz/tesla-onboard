-- Email action saga executor: trip-creation core extraction, candidate confirm,
-- action execution state machine, the owner-alert-gated destructive brake, abort,
-- and same-reservation supersession. Additive only -- never edits
-- 20260816003000_onlyevs_email_ingestion.sql or 20260815190000_evhost_guest_portal.sql;
-- redefines function bodies from those files here with `create or replace`,
-- same signatures, so both files' own callers and pgTAP assertions keep passing
-- unmodified. Everything here stays dark: `confirm_onlyevs_email_candidate` is a
-- manager-authenticated manual action (the only live path per the locked eng
-- plan) and `execute_onlyevs_email_action` re-derives candidate/integration
-- state on every call rather than trusting anything decided earlier.

-- ---------------------------------------------------------------------------
-- private.create_onlyevs_trip_core: the shared insert/overlap/guest-binding
-- logic extracted from create_onlyevs_manual_trip and confirm_onlyevs_calendar_
-- candidate. It performs no authorization and no business-rule validation --
-- each caller keeps doing its own checks exactly as before so neither existing
-- caller's behavior changes by one byte. security invoker: it only ever runs
-- inside another security definer function's already-elevated context.
-- ---------------------------------------------------------------------------
create or replace function private.create_onlyevs_trip_core(
  p_trip_id uuid,
  p_workspace_id uuid,
  p_shop_slug text,
  p_calendar_candidate_id uuid,
  p_email_candidate_id uuid,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_pickup_location text,
  p_return_location text,
  p_public_token_hash text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_key_version smallint
)
returns public.onlyevs_trips
language plpgsql
security invoker
set search_path = ''
as $$
declare trip public.onlyevs_trips;
begin
  insert into public.onlyevs_trips (
    id, workspace_id, shop_slug, calendar_candidate_id, email_candidate_id, vehicle_id,
    guest_name, guest_email, timezone, starts_at, ends_at, pickup_location, return_location,
    public_token_hash, token_expires_at
  ) values (
    p_trip_id, p_workspace_id, p_shop_slug, p_calendar_candidate_id, p_email_candidate_id, p_vehicle_id,
    p_guest_name, p_guest_email, p_timezone, p_starts_at, p_ends_at,
    p_pickup_location, coalesce(p_return_location, p_pickup_location),
    p_public_token_hash, p_token_expires_at
  ) returning * into trip;

  insert into private.onlyevs_guest_bindings (trip_id, workspace_id, verified_email_hash)
  values (trip.id, trip.workspace_id, encode(extensions.digest(p_guest_email, 'sha256'), 'hex'));

  insert into private.onlyevs_trip_link_secrets (
    trip_id, workspace_id, token_ciphertext, key_version, destroy_after
  ) values (
    trip.id, trip.workspace_id, p_token_ciphertext, p_key_version, p_token_expires_at
  );

  return trip;
exception when exclusion_violation then
  raise exception 'vehicle_schedule_conflict' using errcode = '23P01';
end;
$$;

revoke all on function private.create_onlyevs_trip_core(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, text, smallint
) from public, anon, authenticated;
grant execute on function private.create_onlyevs_trip_core(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, text, smallint
) to onlyevs_worker;

-- ---------------------------------------------------------------------------
-- Redefine the two existing trip-creation entry points to call the extracted
-- core for the insert. Every pre-insert check below is byte-identical to the
-- version in 20260815190000_evhost_guest_portal.sql -- only the final insert
-- block is now delegated.
-- ---------------------------------------------------------------------------
create or replace function public.create_onlyevs_manual_trip(
  p_trip_id uuid,
  p_workspace_id uuid,
  p_shop_slug text,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_pickup_location text,
  p_return_location text,
  p_public_token_hash text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_key_version smallint
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  pickup text := nullif(btrim(coalesce(p_pickup_location, '')), '');
  return_place text := nullif(btrim(coalesce(p_return_location, '')), '');
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if p_trip_id is null
    or char_length(btrim(coalesce(p_shop_slug, ''))) not between 1 and 160
    or char_length(btrim(coalesce(p_guest_name, ''))) not between 1 and 240
    or char_length(btrim(coalesce(p_guest_email, ''))) not between 3 and 320
    or position('@' in p_guest_email) < 2
    or char_length(btrim(coalesce(p_timezone, ''))) not between 1 and 100
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_token_ciphertext, '')) not between 32 and 4096
    or coalesce(p_key_version, 0) < 1
    or char_length(coalesce(pickup, '')) > 500
    or char_length(coalesce(return_place, '')) > 500
    or p_starts_at < now() - interval '1 day'
    or p_starts_at > now() + interval '2 years'
    or p_ends_at <= p_starts_at
    or p_ends_at > p_starts_at + interval '90 days'
    or p_token_expires_at < p_ends_at + interval '24 hours' then
    raise exception 'invalid_manual_trip' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_branding b
    where b.workspace_id = p_workspace_id
      and b.shop_slug = btrim(p_shop_slug)
      and b.features -> 'onlyevs' ->> 'enabled' = 'true'
      and jsonb_typeof(b.features -> 'onlyevs' -> 'publishedAt') = 'number'
  ) then
    raise exception 'guest_onboarding_not_published' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.onlyevs_vehicles v
    where v.workspace_id = p_workspace_id and v.shop_slug = btrim(p_shop_slug)
      and v.id = p_vehicle_id and v.status = 'active'
  ) then
    raise exception 'active_workspace_vehicle_required' using errcode = '55000';
  end if;

  return private.create_onlyevs_trip_core(
    p_trip_id, p_workspace_id, btrim(p_shop_slug), null, null, p_vehicle_id,
    btrim(p_guest_name), lower(btrim(p_guest_email)), btrim(p_timezone),
    p_starts_at, p_ends_at, pickup, return_place,
    p_public_token_hash, p_token_expires_at, p_token_ciphertext, p_key_version
  );
end;
$$;

create or replace function public.confirm_onlyevs_calendar_candidate(
  p_trip_id uuid,
  p_candidate_id uuid,
  p_vehicle_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_public_token_hash text,
  p_token_expires_at timestamptz,
  p_token_ciphertext text,
  p_key_version smallint
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.onlyevs_calendar_candidates;
  trip public.onlyevs_trips;
begin
  select * into candidate from public.onlyevs_calendar_candidates c where c.id = p_candidate_id for update;
  if candidate.id is null then raise exception 'calendar_candidate_not_found' using errcode = 'P0002'; end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(candidate.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if candidate.status not in ('pending', 'needs_review') or candidate.deleted_at is not null then
    raise exception 'calendar_candidate_not_confirmable' using errcode = '55000';
  end if;
  if exists (select 1 from public.onlyevs_trips t where t.workspace_id = candidate.workspace_id and t.calendar_candidate_id = candidate.id) then
    raise exception 'calendar_schedule_change_requires_manual_review' using errcode = '55000';
  end if;
  if p_trip_id is null or char_length(btrim(p_guest_name)) not between 1 and 240
    or char_length(btrim(p_guest_email)) not between 3 and 320 or position('@' in p_guest_email) < 2
    or coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_token_ciphertext, '')) not between 32 and 4096
    or coalesce(p_key_version, 0) < 1 or p_token_expires_at < candidate.ends_at + interval '24 hours' then
    raise exception 'invalid_trip_confirmation' using errcode = '22023';
  end if;

  trip := private.create_onlyevs_trip_core(
    p_trip_id, candidate.workspace_id, candidate.shop_slug, candidate.id, null, p_vehicle_id,
    btrim(p_guest_name), lower(btrim(p_guest_email)), candidate.timezone,
    candidate.starts_at, candidate.ends_at, candidate.location, candidate.location,
    p_public_token_hash, p_token_expires_at, p_token_ciphertext, p_key_version
  );

  insert into public.onlyevs_access_grants (workspace_id, trip_id, vehicle_id, issue_at, revoke_at, next_action_at)
  values (trip.workspace_id, trip.id, trip.vehicle_id, trip.starts_at - interval '2 hours', trip.ends_at + interval '1 hour', trip.starts_at - interval '2 hours');
  update public.onlyevs_calendar_candidates set status = 'confirmed', change_kind = null, revision = revision + 1, updated_at = now()
  where id = candidate.id;
  return trip;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expand the shared transition-validation trigger additively. Every edge from
-- the landed 20260816003000 migration is preserved verbatim; only two new
-- edges are added, both required for the bounce/drop-cancels-the-brake path
-- (see reconcile_onlyevs_sendgrid_event below).
-- ---------------------------------------------------------------------------
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
      ('pending','superseded'),('needs_review','superseded'),('auto_queued','superseded'),
      -- Added: confirm_onlyevs_email_candidate lets a manager confirm a clean
      -- 'pending' candidate directly (Review mode does not force every
      -- candidate through needs_review first just to reach applying).
      ('pending','applying'))
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
      ('queued','superseded'),('claimed','superseded'),
      -- Added for the SendGrid bounce/drop path: a rejected owner alert must
      -- be able to cancel the destructive brake from either side of the
      -- accept transition and land on needs_review, never proceed silently.
      ('awaiting_owner_alert','needs_review'),('revocation_pending','needs_review'),
      -- Added: a db_committing failure (incomplete facts, an exclusion
      -- violation, an unsupported action_type) must fail closed to
      -- needs_review rather than get stuck or silently retry.
      ('db_committing','needs_review'))
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

-- ---------------------------------------------------------------------------
-- confirm_onlyevs_email_candidate: manager-authenticated manual apply. This is
-- the only live path in this dark-shipped build (no ONLYEVS_EMAIL_AUTO_* gate
-- is set) -- the owner reviewing and confirming despite blocker_codes is the
-- point of Review mode, so this does not re-check canAutoApply.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_onlyevs_email_candidate(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_expected_revision bigint,
  p_corrections jsonb default '{}'::jsonb
)
returns public.onlyevs_email_actions
language plpgsql security definer set search_path = '' as $$
declare
  candidate public.onlyevs_email_candidates;
  integration public.onlyevs_email_integrations;
  v_action_type text;
  v_capability text;
  resolved_trip_id uuid;
  action_row public.onlyevs_email_actions;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if p_corrections is null or jsonb_typeof(p_corrections) <> 'object' then
    raise exception 'invalid_email_corrections' using errcode = '22023';
  end if;

  select * into candidate from public.onlyevs_email_candidates c
    where c.workspace_id = p_workspace_id and c.id = p_candidate_id for update;
  if candidate.id is null then raise exception 'email_candidate_not_found' using errcode = 'P0002'; end if;
  if candidate.revision <> p_expected_revision or candidate.state not in ('pending', 'needs_review') then
    raise exception 'email_candidate_revision_conflict' using errcode = '40001';
  end if;

  v_action_type := case candidate.event_type
    when 'booking' then 'create_trip'
    when 'change' then 'apply_update'
    when 'cancellation' then 'cancel_trip'
    else null
  end;
  if v_action_type is null then
    raise exception 'email_candidate_not_confirmable' using errcode = '55000';
  end if;
  v_capability := case v_action_type
    when 'create_trip' then 'create'
    when 'apply_update' then 'pretrip'
    else 'active_destructive'
  end;

  select * into integration from public.onlyevs_email_integrations i
    where i.id = candidate.integration_id and i.workspace_id = p_workspace_id;
  if integration.id is null then raise exception 'email_integration_not_found' using errcode = 'P0002'; end if;

  if v_action_type in ('apply_update', 'cancel_trip') then
    -- The candidate that will be mutated/cancelled is resolved now, from the
    -- most recent already-applied candidate for the same reservation, and
    -- stored on the action as its target (see execute_onlyevs_email_action).
    -- This build never guesses a target trip.
    select c.effective_trip_id into resolved_trip_id
    from public.onlyevs_email_candidates c
    where c.workspace_id = candidate.workspace_id and c.integration_id = candidate.integration_id
      and c.reservation_id = candidate.reservation_id and c.effective_trip_id is not null
      and c.id <> candidate.id
    order by c.occurred_at desc limit 1;
    if resolved_trip_id is null then
      raise exception 'email_candidate_target_trip_not_found' using errcode = '55000';
    end if;
  end if;

  update public.onlyevs_email_candidates c
    set state = 'applying', correction_facts = p_corrections, revision = c.revision + 1
    where c.id = candidate.id
    returning * into candidate;

  insert into public.onlyevs_email_actions (
    workspace_id, candidate_id, action_type, idempotency_key, state,
    integration_revision, candidate_revision, capability_name, capability_revision,
    proposed_state_hash, effective_trip_id, next_action_at
  ) values (
    p_workspace_id, candidate.id, v_action_type, 'email-action:' || candidate.id::text, 'queued',
    integration.revision, candidate.revision, v_capability,
    coalesce((integration.capability_revisions ->> v_capability)::bigint, 0),
    encode(extensions.digest(candidate.proposed_state::text || coalesce(candidate.correction_facts::text, ''), 'sha256'), 'hex'),
    resolved_trip_id, now()
  ) returning * into action_row;

  insert into public.onlyevs_email_outbox (workspace_id, job_type, entity_id)
  values (p_workspace_id, 'action', action_row.id)
  on conflict (job_type, entity_id) do nothing;

  return action_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- execute_onlyevs_email_action: advances exactly one legal edge per call.
-- The worker calls this in a loop until the returned (state, revision) stops
-- changing (see services/onlyevs-worker/email.ts's actionJobProgressed).
-- Every step re-reads integration/candidate state fresh (invariant 3) rather
-- than trusting anything decided when the action was created or by an
-- earlier call. p_new_trip_id/p_public_token_hash/p_token_expires_at/
-- p_token_ciphertext/p_key_version are pre-generated by the worker (trip-link
-- envelopes need the app-side encryption keyring, unavailable in SQL) and are
-- only consulted for a create_trip action's db_committing step.
-- ---------------------------------------------------------------------------
create or replace function public.execute_onlyevs_email_action(
  p_action_id uuid,
  p_workspace_id uuid,
  p_worker_id text,
  p_new_trip_id uuid default null,
  p_public_token_hash text default null,
  p_token_expires_at timestamptz default null,
  p_token_ciphertext text default null,
  p_key_version smallint default null
)
returns public.onlyevs_email_actions
language plpgsql security definer set search_path = '' as $$
declare
  action public.onlyevs_email_actions;
  candidate public.onlyevs_email_candidates;
  integration public.onlyevs_email_integrations;
  trip public.onlyevs_trips;
  recomputed_hash text;
begin
  if char_length(coalesce(p_worker_id, '')) < 3 then
    raise exception 'invalid_email_worker' using errcode = '22023';
  end if;

  select * into action from public.onlyevs_email_actions a
    where a.id = p_action_id and a.workspace_id = p_workspace_id for update;
  if action.id is null then raise exception 'email_action_not_found' using errcode = 'P0002'; end if;

  if action.state = 'queued' then
    update public.onlyevs_email_actions a set state = 'claimed', claimed_by = p_worker_id,
      claim_expires_at = now() + interval '2 minutes', attempt_count = a.attempt_count + 1,
      revision = a.revision + 1
      where a.id = action.id returning * into action;
    return action;
  end if;

  if action.state = 'failed_retryable' then
    if action.attempt_count >= 8 then
      update public.onlyevs_email_actions a set state = 'dead_letter', claimed_by = null,
        claim_expires_at = null, revision = a.revision + 1
        where a.id = action.id returning * into action;
      return action;
    end if;
    update public.onlyevs_email_actions a set state = 'claimed', claimed_by = p_worker_id,
      claim_expires_at = now() + interval '2 minutes', attempt_count = a.attempt_count + 1,
      revision = a.revision + 1
      where a.id = action.id returning * into action;
    return action;
  end if;

  if action.state = 'claimed' then
    update public.onlyevs_email_actions a set state = 'validating', revision = a.revision + 1
      where a.id = action.id returning * into action;
    return action;
  end if;

  if action.state = 'validating' then
    -- Invariant 3: re-read integration + candidate fresh on every call.
    select * into candidate from public.onlyevs_email_candidates c
      where c.id = action.candidate_id and c.workspace_id = action.workspace_id;
    if candidate.id is not null then
      select * into integration from public.onlyevs_email_integrations i
        where i.id = candidate.integration_id and i.workspace_id = action.workspace_id;
      recomputed_hash := encode(
        extensions.digest(candidate.proposed_state::text || coalesce(candidate.correction_facts::text, ''), 'sha256'),
        'hex'
      );
    end if;

    if candidate.id is null or candidate.state <> 'applying' or candidate.revision <> action.candidate_revision
      or integration.id is null or integration.status not in ('pending_verification', 'testing', 'active')
      or recomputed_hash <> action.proposed_state_hash then
      update public.onlyevs_email_actions a set state = 'needs_review', claimed_by = null, claim_expires_at = null,
        last_error_code = 'validation_conflict', revision = a.revision + 1
        where a.id = action.id returning * into action;
      update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
        where c.id = action.candidate_id and c.state = 'applying';
      return action;
    end if;

    if action.action_type in ('cancel_trip', 'rotate_guest', 'swap_vehicle', 'revoke_access') then
      -- Destructive changes always announce themselves to the owner before
      -- mutating anything, manual apply or not (DESIGN.md: "a destructive
      -- countdown starts only after the owner alert is accepted").
      update public.onlyevs_email_actions a set state = 'awaiting_owner_alert', revision = a.revision + 1
        where a.id = action.id returning * into action;
      return action;
    end if;

    update public.onlyevs_email_actions a set state = 'db_committing', revision = a.revision + 1
      where a.id = action.id returning * into action;
    return action;
  end if;

  if action.state = 'awaiting_owner_alert' then
    -- No legal automatic edge here: services/onlyevs-worker/email.ts sends the
    -- owner alert out-of-band and links delivery_id; the brake only starts
    -- once reconcile_onlyevs_sendgrid_event sees that send accepted.
    return action;
  end if;

  if action.state = 'revocation_pending' then
    if action.brake_deadline is null or now() < action.brake_deadline then
      return action;
    end if;
    -- Stamping provider_claimed_at here is what closes the abort window:
    -- abort_onlyevs_email_revocation refuses once this is set.
    update public.onlyevs_email_actions a set state = 'provider_mutating',
      provider_claimed_at = now(), revision = a.revision + 1
      where a.id = action.id returning * into action;
    return action;
  end if;

  if action.state = 'provider_mutating' then
    -- This build performs no direct Tesla call from the email pipeline: the
    -- db_committing step below flips the trip/access-grant rows, and the
    -- existing access-grant worker (services/onlyevs-worker/index.ts,
    -- untouched by this migration) performs the actual Tesla-facing revoke
    -- once it next claims that grant.
    update public.onlyevs_email_actions a set state = 'db_committing', revision = a.revision + 1
      where a.id = action.id returning * into action;
    return action;
  end if;

  if action.state = 'db_committing' then
    begin
      select * into candidate from public.onlyevs_email_candidates c
        where c.id = action.candidate_id and c.workspace_id = action.workspace_id;
      select * into integration from public.onlyevs_email_integrations i
        where i.id = candidate.integration_id and i.workspace_id = action.workspace_id;

      if action.action_type = 'create_trip' then
        declare
          merged jsonb := coalesce(candidate.proposed_state, '{}'::jsonb) || coalesce(candidate.correction_facts, '{}'::jsonb);
          guest_name text := nullif(btrim(coalesce(merged ->> 'guestName', '')), '');
          guest_email text := lower(nullif(btrim(coalesce(merged ->> 'guestEmail', '')), ''));
          tz_value text := nullif(btrim(coalesce(merged ->> 'timezone', '')), '');
          starts_at timestamptz := nullif(merged ->> 'startsAt', '')::timestamptz;
          ends_at timestamptz := nullif(merged ->> 'endsAt', '')::timestamptz;
          pickup text := nullif(btrim(coalesce(merged ->> 'pickupLocation', '')), '');
          return_place text := nullif(btrim(coalesce(merged ->> 'returnLocation', '')), '');
          chosen_vehicle_id uuid;
          requested_vehicle_id uuid;
          vehicle_count integer;
          link_missing boolean;
        begin
          begin
            requested_vehicle_id := nullif(merged ->> 'vehicleId', '')::uuid;
          exception when invalid_text_representation then
            requested_vehicle_id := null;
          end;
          link_missing := p_public_token_hash is null or p_token_ciphertext is null
            or p_key_version is null or p_new_trip_id is null or p_token_expires_at is null
            or (ends_at is not null and p_token_expires_at < ends_at + interval '24 hours');

          chosen_vehicle_id := null;
          if requested_vehicle_id is not null and exists (
            select 1 from public.onlyevs_vehicles v where v.workspace_id = action.workspace_id
              and v.shop_slug = integration.shop_slug and v.id = requested_vehicle_id and v.status = 'active'
          ) then
            chosen_vehicle_id := requested_vehicle_id;
          end if;
          if chosen_vehicle_id is null then
            select count(*) into vehicle_count
              from public.onlyevs_vehicles v
              where v.workspace_id = action.workspace_id and v.shop_slug = integration.shop_slug and v.status = 'active';
            if vehicle_count = 1 then
              select v.id into chosen_vehicle_id
                from public.onlyevs_vehicles v
                where v.workspace_id = action.workspace_id and v.shop_slug = integration.shop_slug and v.status = 'active'
                limit 1;
            end if;
          end if;

          if guest_name is null or guest_email is null or position('@' in guest_email) < 2
            or tz_value is null or starts_at is null or ends_at is null or ends_at <= starts_at
            or chosen_vehicle_id is null or link_missing
            or not exists (
              select 1 from public.workspace_branding b where b.workspace_id = action.workspace_id
                and b.shop_slug = integration.shop_slug and b.features -> 'onlyevs' ->> 'enabled' = 'true'
                and jsonb_typeof(b.features -> 'onlyevs' -> 'publishedAt') = 'number'
            ) then
            update public.onlyevs_email_actions a set state = 'needs_review', claimed_by = null, claim_expires_at = null,
              last_error_code = 'create_trip_facts_incomplete', revision = a.revision + 1
              where a.id = action.id returning * into action;
            update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
              where c.id = action.candidate_id and c.state = 'applying';
            return action;
          end if;

          trip := private.create_onlyevs_trip_core(
            p_new_trip_id, action.workspace_id, integration.shop_slug, null, candidate.id,
            chosen_vehicle_id, guest_name, guest_email, tz_value, starts_at, ends_at,
            pickup, coalesce(return_place, pickup), p_public_token_hash, p_token_expires_at,
            p_token_ciphertext, p_key_version
          );
        end;
      elsif action.action_type = 'apply_update' then
        if action.effective_trip_id is null then
          raise exception 'email_action_target_trip_missing' using errcode = '55000';
        end if;
        declare
          merged jsonb := coalesce(candidate.proposed_state, '{}'::jsonb) || coalesce(candidate.correction_facts, '{}'::jsonb);
          new_starts timestamptz := nullif(merged ->> 'startsAt', '')::timestamptz;
          new_ends timestamptz := nullif(merged ->> 'endsAt', '')::timestamptz;
          new_pickup text := nullif(btrim(coalesce(merged ->> 'pickupLocation', '')), '');
          new_return text := nullif(btrim(coalesce(merged ->> 'returnLocation', '')), '');
        begin
          update public.onlyevs_trips t set
            starts_at = coalesce(new_starts, t.starts_at),
            ends_at = coalesce(new_ends, t.ends_at),
            pickup_location = coalesce(new_pickup, t.pickup_location),
            return_location = coalesce(new_return, t.return_location),
            revision = t.revision + 1, updated_at = now()
          where t.id = action.effective_trip_id and t.workspace_id = action.workspace_id
            and t.status not in ('cancelled', 'completed')
          returning * into trip;
        end;
        if trip.id is null then
          update public.onlyevs_email_actions a set state = 'needs_review', claimed_by = null, claim_expires_at = null,
            last_error_code = 'apply_update_target_not_updatable', revision = a.revision + 1
            where a.id = action.id returning * into action;
          update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
            where c.id = action.candidate_id and c.state = 'applying';
          return action;
        end if;
      elsif action.action_type = 'cancel_trip' then
        if action.effective_trip_id is null then
          raise exception 'email_action_target_trip_missing' using errcode = '55000';
        end if;
        update public.onlyevs_trips t set status = 'cancelled', revision = t.revision + 1, updated_at = now()
          where t.id = action.effective_trip_id and t.workspace_id = action.workspace_id
            and t.status not in ('cancelled', 'completed')
          returning * into trip;
        if trip.id is null then
          select * into trip from public.onlyevs_trips t
            where t.id = action.effective_trip_id and t.workspace_id = action.workspace_id;
        end if;
        if trip.id is null or trip.status <> 'cancelled' then
          update public.onlyevs_email_actions a set state = 'needs_review', claimed_by = null, claim_expires_at = null,
            last_error_code = 'cancel_trip_target_not_cancellable', revision = a.revision + 1
            where a.id = action.id returning * into action;
          update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
            where c.id = action.candidate_id and c.state = 'applying';
          return action;
        end if;
        -- Hand the Tesla-facing revoke to the existing, untouched access-grant
        -- worker rather than duplicating provider logic here: nudging
        -- revoke_at/next_action_at into the past makes the next claim cycle
        -- of private.claim_onlyevs_due_access_grants pick it up.
        update public.onlyevs_access_grants g set
          revoke_at = least(g.revoke_at, now()), next_action_at = now(), revision = g.revision + 1
          where g.workspace_id = action.workspace_id and g.trip_id = trip.id
            and g.status not in ('revoked', 'expired', 'failed_terminal', 'manual_review');
      else
        raise exception 'email_action_type_unsupported' using errcode = '55000';
      end if;

      update public.onlyevs_email_actions a set state = 'succeeded', effective_trip_id = trip.id,
        claimed_by = null, claim_expires_at = null, revision = a.revision + 1
        where a.id = action.id returning * into action;
      update public.onlyevs_email_candidates c set state = 'applied', effective_trip_id = trip.id, revision = c.revision + 1
        where c.id = action.candidate_id and c.state = 'applying';
      return action;
    exception when others then
      -- A db_committing failure (schedule conflict, unsupported type, an
      -- unexpected constraint) must never leave the saga stuck: surface it
      -- for owner review instead of retrying indefinitely or leaving
      -- inconsistent state.
      update public.onlyevs_email_actions a set state = 'needs_review', claimed_by = null, claim_expires_at = null,
        last_error_code = left(sqlerrm, 160), revision = a.revision + 1
        where a.id = p_action_id and a.workspace_id = p_workspace_id and a.state = 'db_committing';
      update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
        where c.id = action.candidate_id and c.state = 'applying';
      select * into action from public.onlyevs_email_actions a
        where a.id = p_action_id and a.workspace_id = p_workspace_id;
      return action;
    end;
  end if;

  -- Any other (terminal) state: nothing left to advance.
  return action;
end;
$$;

-- ---------------------------------------------------------------------------
-- Brake start/cancel: redefine reconcile_onlyevs_sendgrid_event with the same
-- signature. The existing delivery-row mapping is preserved verbatim for
-- every purpose; only a leading 'processed' -> 'accepted' case (previously
-- unreachable -- nothing wrote 'accepted') and the owner_alert-linked action
-- bookkeeping below it are new.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_onlyevs_sendgrid_event(
  p_sg_event_id text, p_workspace_id uuid, p_delivery_id uuid, p_event_type text,
  p_response_code text, p_signature_key_version smallint, p_provider_timestamp timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted boolean;
declare delivery public.onlyevs_email_deliveries;
declare linked_action public.onlyevs_email_actions;
begin
  insert into private.onlyevs_sendgrid_events(sg_event_id,workspace_id,delivery_id,event_type,response_code,signature_key_version,provider_timestamp)
  values(p_sg_event_id,p_workspace_id,p_delivery_id,p_event_type,p_response_code,p_signature_key_version,p_provider_timestamp)
  on conflict(sg_event_id) do nothing;
  inserted := found;
  if not inserted then return false; end if;
  update public.onlyevs_email_deliveries d set
    provider_message_id = coalesce(d.provider_message_id,p_sg_event_id),
    state = case p_event_type
      when 'processed' then case when d.state = 'sending' then 'accepted' else d.state end
      when 'delivered' then 'delivered' when 'bounce' then 'bounced'
      when 'dropped' then 'dropped' when 'blocked' then 'dropped'
      when 'deferred' then 'delivery_paused' else d.state end,
    accepted_at = case when p_event_type = 'processed' and d.state = 'sending' then p_provider_timestamp else d.accepted_at end,
    delivered_at = case when p_event_type='delivered' then p_provider_timestamp else d.delivered_at end,
    revision = d.revision + 1
  where d.id=p_delivery_id and d.workspace_id=p_workspace_id
  returning * into delivery;

  if delivery.id is not null and delivery.purpose = 'owner_alert' and delivery.action_id is not null then
    if p_event_type = 'processed' and delivery.state = 'accepted' then
      update public.onlyevs_email_actions a set
        state = 'revocation_pending', brake_deadline = now() + interval '30 minutes',
        next_action_at = now() + interval '30 minutes', revision = a.revision + 1
      where a.id = delivery.action_id and a.workspace_id = p_workspace_id and a.state = 'awaiting_owner_alert'
      returning * into linked_action;
      if linked_action.id is not null then
        update public.onlyevs_email_outbox o set state = 'pending', due_at = linked_action.brake_deadline,
          claimed_by = null, claim_expires_at = null
        where o.job_type = 'action' and o.entity_id = linked_action.id;
      end if;
    elsif p_event_type in ('bounce', 'dropped', 'blocked') then
      update public.onlyevs_email_actions a set
        state = 'needs_review', brake_deadline = null, next_action_at = null,
        claimed_by = null, claim_expires_at = null, last_error_code = 'owner_alert_' || p_event_type,
        revision = a.revision + 1
      where a.id = delivery.action_id and a.workspace_id = p_workspace_id
        and a.state in ('awaiting_owner_alert', 'revocation_pending')
      returning * into linked_action;
      if linked_action.id is not null then
        update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
          where c.id = linked_action.candidate_id and c.state = 'applying';
        update public.onlyevs_email_outbox o set state = 'completed', claimed_by = null, claim_expires_at = null
          where o.job_type = 'action' and o.entity_id = linked_action.id;
      end if;
    end if;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- abort_onlyevs_email_revocation: manager-only, audited, only legal before the
-- brake deadline and before the worker has stamped provider_claimed_at.
-- ---------------------------------------------------------------------------
create or replace function public.abort_onlyevs_email_revocation(
  p_workspace_id uuid, p_action_id uuid, p_expected_revision bigint, p_reason text
) returns public.onlyevs_email_actions
language plpgsql security definer set search_path = '' as $$
declare action public.onlyevs_email_actions;
begin
  if not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 1 or char_length(p_reason) > 500 then
    raise exception 'invalid_email_abort_reason' using errcode = '22023';
  end if;
  select * into action from public.onlyevs_email_actions a
    where a.id = p_action_id and a.workspace_id = p_workspace_id for update;
  if action.id is null then raise exception 'email_action_not_found' using errcode = 'P0002'; end if;
  if action.revision <> p_expected_revision then
    raise exception 'email_action_revision_conflict' using errcode = '40001';
  end if;
  if action.state <> 'revocation_pending' or action.provider_claimed_at is not null
    or (action.brake_deadline is not null and now() >= action.brake_deadline) then
    raise exception 'email_action_not_abortable' using errcode = '55000';
  end if;

  update public.onlyevs_email_actions a set state = 'aborted', brake_deadline = null, next_action_at = null,
    claimed_by = null, claim_expires_at = null, last_error_code = null, revision = a.revision + 1
    where a.id = action.id returning * into action;
  update public.onlyevs_email_candidates c set state = 'needs_review', revision = c.revision + 1
    where c.id = action.candidate_id and c.state = 'applying';
  update public.onlyevs_email_outbox o set state = 'completed', claimed_by = null, claim_expires_at = null
    where o.job_type = 'action' and o.entity_id = action.id;

  insert into public.onlyevs_integration_audit_events (
    workspace_id, actor_type, actor_id_hash, entity_type, entity_id, action, result, details
  ) values (
    p_workspace_id, 'owner', encode(extensions.digest((select auth.uid())::text, 'sha256'), 'hex'),
    'email_action', action.id, 'email_revocation_abort', 'success', jsonb_build_object('reason', p_reason)
  );
  return action;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supersession: called from the parse path (services/onlyevs-worker/email.ts)
-- when a strictly newer email for the same (workspace, integration,
-- reservation) arrives while an earlier candidate for it is still live and
-- unclaimed. A confirmed-but-unclaimed candidate is 'applying' with a
-- 'queued' action (confirm_onlyevs_email_candidate moves both together), so
-- 'applying' is included alongside the pre-confirm 'pending'/'needs_review'
-- states -- but only queued/claimed actions (the landed transition table's
-- own boundary) are ever moved to 'superseded'; an action already past
-- 'claimed' (validating or later) is never silently killed.
-- ---------------------------------------------------------------------------
create or replace function private.supersede_onlyevs_email_candidate_and_action(
  p_workspace_id uuid, p_old_candidate_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare old_candidate public.onlyevs_email_candidates;
declare old_action public.onlyevs_email_actions;
begin
  select * into old_candidate from public.onlyevs_email_candidates c
    where c.workspace_id = p_workspace_id and c.id = p_old_candidate_id
      and c.state in ('pending', 'needs_review', 'applying') for update;
  if old_candidate.id is null then return false; end if;
  if old_candidate.state = 'applying' and not exists (
    select 1 from public.onlyevs_email_actions a
      where a.candidate_id = old_candidate.id and a.state in ('queued', 'claimed')
  ) then
    -- Applying with no queued/claimed action means the saga already moved
    -- past the safe supersede window (validating or later); leave it alone.
    return false;
  end if;

  update public.onlyevs_email_candidates c set state = 'superseded', revision = c.revision + 1
    where c.id = old_candidate.id;

  select * into old_action from public.onlyevs_email_actions a
    where a.candidate_id = old_candidate.id and a.state in ('queued', 'claimed') for update;
  if old_action.id is not null then
    update public.onlyevs_email_actions a set state = 'superseded', claimed_by = null, claim_expires_at = null,
      revision = a.revision + 1
      where a.id = old_action.id;
    update public.onlyevs_email_outbox o set state = 'completed', claimed_by = null, claim_expires_at = null
      where o.job_type = 'action' and o.entity_id = old_action.id and o.state in ('pending', 'claimed', 'failed_retryable');
  end if;
  return true;
end;
$$;

revoke all on function public.confirm_onlyevs_email_candidate(uuid, uuid, bigint, jsonb) from public, anon;
revoke all on function public.execute_onlyevs_email_action(uuid, uuid, text, uuid, text, timestamptz, text, smallint) from public, anon, authenticated;
revoke all on function public.abort_onlyevs_email_revocation(uuid, uuid, bigint, text) from public, anon;
revoke all on function private.supersede_onlyevs_email_candidate_and_action(uuid, uuid) from public, anon, authenticated;

grant execute on function public.confirm_onlyevs_email_candidate(uuid, uuid, bigint, jsonb) to authenticated;
grant execute on function public.execute_onlyevs_email_action(uuid, uuid, text, uuid, text, timestamptz, text, smallint) to onlyevs_worker;
grant execute on function public.abort_onlyevs_email_revocation(uuid, uuid, bigint, text) to authenticated;
grant execute on function private.supersede_onlyevs_email_candidate_and_action(uuid, uuid) to onlyevs_worker;

comment on function public.execute_onlyevs_email_action(uuid, uuid, text, uuid, text, timestamptz, text, smallint) is
  'Advances exactly one legal onlyevs_email_actions transition per call; re-verifies candidate/integration state every call (never trusts an earlier decision).';
comment on function private.create_onlyevs_trip_core(uuid, uuid, text, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, text, smallint) is
  'Shared insert/overlap/guest-binding logic behind create_onlyevs_manual_trip, confirm_onlyevs_calendar_candidate, and execute_onlyevs_email_action''s create_trip step.';
