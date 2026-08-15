-- A private trip URL is the guest's bearer capability. Guests no longer need
-- a Supabase account or booking-email magic link before opening onboarding.
-- The 256-bit raw token is never persisted; these RPCs receive only its
-- SHA-256 digest and expose actions for the single matching, unexpired trip.

drop function if exists public.onlyevs_trip_email_matches(text, text);
drop function if exists public.bind_onlyevs_trip_guest(text);
drop function if exists public.complete_onlyevs_guest_onboarding(text, boolean, text);

create or replace function public.update_onlyevs_guest_onboarding_progress(
  p_public_token_hash text,
  p_progress jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_progress) <> 'object'
    or octet_length(p_progress::text) > 16384
    or jsonb_typeof(p_progress -> 'stepId') <> 'string'
    or jsonb_typeof(p_progress -> 'pct') <> 'number'
    or jsonb_typeof(p_progress -> 'isDone') <> 'boolean'
    or jsonb_typeof(p_progress -> 'completed') <> 'array'
    or jsonb_typeof(p_progress -> 'checklist') <> 'object'
    or jsonb_typeof(p_progress -> 'moduleTotal') <> 'number'
    or jsonb_typeof(p_progress -> 'requiredChecklistDone') <> 'number'
    or jsonb_typeof(p_progress -> 'requiredChecklistTotal') <> 'number' then
    raise exception 'invalid_onboarding_progress' using errcode = '22023';
  end if;

  update private.onlyevs_guest_bindings b
  set onboarding_progress = p_progress,
      progress_updated_at = now(),
      bound_at = coalesce(b.bound_at, now()),
      onboarding_completed_at = case
        when (p_progress ->> 'isDone')::boolean
          then coalesce(b.onboarding_completed_at, now())
        else b.onboarding_completed_at
      end,
      updated_at = now()
  from public.onlyevs_trips t
  where t.id = b.trip_id
    and t.workspace_id = b.workspace_id
    and t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict');
  if not found then
    raise exception 'trip_invitation_unavailable' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.complete_onlyevs_guest_onboarding(
  p_public_token_hash text,
  p_access_consent boolean,
  p_tesla_subject_hmac text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
  grant_payload jsonb;
begin
  if coalesce(p_public_token_hash, '') !~ '^[0-9a-f]{64}$'
    or p_access_consent is not true
    or char_length(coalesce(p_tesla_subject_hmac, '')) <> 64 then
    raise exception 'guest_consent_required' using errcode = '42501';
  end if;
  select * into trip from public.onlyevs_trips t
  where t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
  for update;
  if trip.id is null then
    raise exception 'trip_invitation_expired' using errcode = 'P0002';
  end if;

  update private.onlyevs_guest_bindings b
  set bound_at = coalesce(b.bound_at, now()),
      consented_at = coalesce(b.consented_at, now()),
      onboarding_completed_at = coalesce(b.onboarding_completed_at, now()),
      tesla_subject_hmac = p_tesla_subject_hmac,
      updated_at = now()
  where b.workspace_id = trip.workspace_id
    and b.trip_id = trip.id;
  if not found then
    raise exception 'trip_binding_unavailable' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'status', g.status,
    'issue_at', g.issue_at,
    'revoke_at', g.revoke_at
  ) into grant_payload from public.onlyevs_access_grants g
  where g.workspace_id = trip.workspace_id and g.trip_id = trip.id;
  return grant_payload;
end;
$$;

create or replace function public.get_onlyevs_ready_invite(p_public_token_hash text)
returns table (
  grant_id uuid,
  workspace_id uuid,
  shop_slug text,
  invite_url_ciphertext text,
  key_version smallint
)
language sql
security definer
set search_path = ''
stable
as $$
  select g.id, g.workspace_id, t.shop_slug, s.invite_url_ciphertext, s.key_version
  from public.onlyevs_trips t
  join private.onlyevs_guest_bindings b
    on b.workspace_id = t.workspace_id and b.trip_id = t.id
  join public.onlyevs_access_grants g
    on g.workspace_id = t.workspace_id and g.trip_id = t.id
  join private.onlyevs_access_secrets s
    on s.workspace_id = g.workspace_id and s.grant_id = g.id
  where coalesce(p_public_token_hash, '') ~ '^[0-9a-f]{64}$'
    and t.public_token_hash = p_public_token_hash
    and t.token_expires_at > now()
    and t.status not in ('cancelled', 'conflict')
    and b.consented_at is not null
    and b.onboarding_completed_at is not null
    and g.status = 'invite_ready'
    and g.issue_at <= now()
    and g.revoke_at > now()
    and s.invite_url_ciphertext is not null
    and (s.destroy_after is null or s.destroy_after > now());
$$;

revoke all on function public.update_onlyevs_guest_onboarding_progress(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_onlyevs_guest_onboarding(text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.get_onlyevs_ready_invite(text)
  from public, anon, authenticated;

grant execute on function public.update_onlyevs_guest_onboarding_progress(text, jsonb)
  to anon, authenticated;
grant execute on function public.complete_onlyevs_guest_onboarding(text, boolean, text)
  to anon, authenticated;
grant execute on function public.get_onlyevs_ready_invite(text)
  to anon, authenticated;

comment on function public.update_onlyevs_guest_onboarding_progress(text, jsonb)
  is 'Persists bounded progress for the single unexpired trip identified by a private 256-bit link capability.';
comment on function public.complete_onlyevs_guest_onboarding(text, boolean, text)
  is 'Records explicit Tesla-access consent for the single unexpired trip identified by a private link capability.';
comment on function public.get_onlyevs_ready_invite(text)
  is 'Returns encrypted invite material only for a completed, consented, unexpired private trip capability.';
