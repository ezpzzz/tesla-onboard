-- Owner-facing cancellation for manual (and calendar-confirmed) trips.
--
-- Additive only: adds `cancelled_at` / `cancellation_reason` columns to the
-- existing `public.onlyevs_trips` table (there was no cancelled_at column in
-- any prior migration) and one new manager-gated SECURITY DEFINER RPC,
-- `public.cancel_onlyevs_trip`. History is preserved -- this never deletes a
-- trip row, only flips status the same way the two existing cancel-capable
-- paths already do:
--   - public.resolve_onlyevs_calendar_candidate_change(p_action => 'cancel')
--     (20260814193000_onlyevs_access_lifecycle.sql) -- only reachable from a
--     calendar candidate already in 'needs_review', so it never applies to a
--     manually created trip.
--   - execute_onlyevs_email_action's 'cancel_trip' saga branch
--     (20260816150000_onlyevs_email_action_lifecycle.sql) -- only reachable
--     from the dark, ONLYEVS_EMAIL_AUTO_*-gated auto-pipeline, never directly
--     from an owner route.
-- Neither is owner-UI-invokable today, so this adds the missing direct path
-- rather than reusing either. The access-grant nudge (push revoke_at/
-- next_action_at into the past so the existing worker claim cycle in
-- private.claim_onlyevs_due_access_grants handles the Tesla-side revoke) is
-- copied byte-for-byte in spirit from both of the above -- manual trips
-- normally have no access-grant row at all (only
-- confirm_onlyevs_calendar_candidate inserts one), so this is defensive/
-- forward-compatible rather than load-bearing for the common case.

alter table public.onlyevs_trips
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text
    check (cancellation_reason is null or char_length(cancellation_reason) <= 1000);

create or replace function public.cancel_onlyevs_trip(
  p_trip_id uuid,
  p_reason text default null
)
returns public.onlyevs_trips
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip public.onlyevs_trips;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into trip
  from public.onlyevs_trips t
  where t.id = p_trip_id
  for update;
  if trip.id is null then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null
    or not public.has_minimum_role(trip.workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  if reason is not null and char_length(reason) > 1000 then
    raise exception 'invalid_cancellation_reason' using errcode = '22023';
  end if;

  -- Idempotent: repeat calls against an already-cancelled trip are a benign
  -- no-op that returns the (unchanged) row, mirroring
  -- dismiss_onlyevs_calendar_candidate's "already in a terminal state, do
  -- nothing" idiom rather than raising.
  if trip.status = 'cancelled' then
    return trip;
  end if;
  if trip.status not in ('confirmed', 'armed', 'active') then
    raise exception 'trip_not_cancellable' using errcode = '55000';
  end if;

  update public.onlyevs_trips t
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = coalesce(reason, t.cancellation_reason),
      schedule_version = t.schedule_version + 1,
      revision = t.revision + 1,
      updated_at = now()
  where t.id = trip.id
  returning * into trip;

  -- Defensive/forward-compatible: nudge any access grant into revocation.
  -- Manual trips have none today (only confirm_onlyevs_calendar_candidate
  -- inserts one), so this is normally a zero-row update.
  update public.onlyevs_access_grants g
  set status = case
        when g.provider_invitation_id is null then 'expired'
        else g.status
      end,
      revoke_at = case
        when g.status in ('revoked', 'expired', 'failed_terminal') then g.revoke_at
        else least(g.revoke_at, now())
      end,
      next_action_at = case
        when g.status in ('revoked', 'expired', 'failed_terminal') then null
        when g.provider_invitation_id is null then null
        else now()
      end,
      claimed_by = null, claim_expires_at = null,
      revision = g.revision + 1, updated_at = now()
  where g.workspace_id = trip.workspace_id and g.trip_id = trip.id
    and g.status not in ('revoked', 'expired', 'failed_terminal', 'manual_review');

  return trip;
end;
$$;

comment on function public.cancel_onlyevs_trip(uuid, text)
  is 'Owner-facing manual/calendar trip cancellation: flips status to cancelled, preserves history, and nudges any access grant toward revocation. Idempotent on an already-cancelled trip.';

revoke all on function public.cancel_onlyevs_trip(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_onlyevs_trip(uuid, text) to authenticated;
