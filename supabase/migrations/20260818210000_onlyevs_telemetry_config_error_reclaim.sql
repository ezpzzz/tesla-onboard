-- Fix: the worker's short 15-minute retry for a telemetry failure caused
-- purely by this *deployment's own* unset/invalid telemetry-proxy config
-- (processTelemetry's isDeploymentConfigTelemetryError branch,
-- services/onlyevs-worker/index.ts, added alongside the owner-facing copy
-- fix in this same release) was dead code. That branch writes
-- onlyevs_telemetry_enrollments.status = 'error' with next_action_at now()
-- + 15 minutes, but the ONLY path that ever reclaims an enrollment row --
-- private.claim_onlyevs_due_telemetry (20260814193000_onlyevs_access_
-- lifecycle.sql) -- filters status categorically:
--   where e.next_action_at <= now()
--     and e.status not in ('unsupported', 'error')
-- So next_action_at is never even evaluated for a status = 'error' row: the
-- "15-minute retry" is behaviorally identical to the vehicle-permanent
-- 365-day park it was meant to replace. A vehicle that hits
-- telemetry_proxy_not_configured is stuck with no automatic recovery,
-- contradicting the code comment on that branch and the owner-facing strip
-- copy that promises recovery once an operator configures the service.
--
-- Two ways to make the retry real were on the table:
--   (a) widen the claim predicate so a status = 'error' row is reclaimable
--       when its last_error_code belongs to a small, explicit
--       deployment-config allowlist, while 'unsupported' and every other
--       vehicle-specific error stay excluded exactly as today; or
--   (b) stop writing status = 'error' for this class and give it a new
--       status the existing predicate already accepts.
-- (a) is what this migration does. status = 'error' is what makes the
-- owner-facing strip honest (telemetry-status-strip.tsx renders its
-- "reconnecting will not help" copy off status === 'error' with the
-- deployment-config last_error_code) and the UI lane's copy fix in this
-- same release depends on that status value being 'error' right now --
-- introducing a new status would silently break it. Widening the claim
-- predicate is also the smaller, purely-additive change: one function
-- CREATE OR REPLACE plus one new partial index, versus a status-enum
-- migration touching every reader of onlyevs_telemetry_enrollments.status.
--
-- The allowlist below intentionally holds exactly the one code
-- isDeploymentConfigTelemetryError currently classifies as deployment-
-- config (telemetry_proxy_not_configured) -- it must stay in lockstep by
-- hand with that predicate in services/onlyevs-worker/index.ts, the same
-- way get_onlyevs_charge_sessions's SQL segmentation stays in lockstep with
-- segmentChargeSessions.
--
-- Standalone-applicable to a prod database that has applied the
-- access-lifecycle era (20260814193000) and the disconnect-recovery
-- migration (20260818150000) but NOT the vehicle-telemetry ledger
-- (20260817090000) or workspace-mail (20260817140000+) migrations -- this
-- touches only private.claim_onlyevs_due_telemetry and adds one partial
-- index on public.onlyevs_telemetry_enrollments, both defined in
-- 20260814193000, and depends on nothing introduced later.

create or replace function private.claim_onlyevs_due_telemetry(
  p_worker_id text,
  p_limit integer default 25
)
returns setof public.onlyevs_telemetry_enrollments
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 3 or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid_telemetry_claim' using errcode = '22023';
  end if;
  return query
  with due as (
    select e.workspace_id, e.vehicle_id
    from public.onlyevs_telemetry_enrollments e
    where e.next_action_at <= now()
      and (
        e.status not in ('unsupported', 'error')
        or (
          e.status = 'error'
          -- Deployment-config allowlist: a failure class that is never a
          -- property of the vehicle or its Tesla account, so it must not
          -- be treated as the vehicle-permanent park below. Keep this in
          -- lockstep with isDeploymentConfigTelemetryError
          -- (services/onlyevs-worker/index.ts). Every genuinely
          -- vehicle-specific 'error' row, and every 'unsupported' row,
          -- stays excluded exactly as before this migration.
          and e.last_error_code = any (array['telemetry_proxy_not_configured'])
        )
      )
      and (e.claim_expires_at is null or e.claim_expires_at <= now())
    order by e.next_action_at, e.workspace_id, e.vehicle_id
    limit p_limit
    for update skip locked
  )
  update public.onlyevs_telemetry_enrollments e
  set claimed_by = p_worker_id, claim_expires_at = now() + interval '2 minutes'
  from due
  where e.workspace_id = due.workspace_id and e.vehicle_id = due.vehicle_id
  returning e.*;
end;
$$;

comment on function private.claim_onlyevs_due_telemetry(text, integer) is
  'Claims due onlyevs_telemetry_enrollments rows for worker processing. A status = error row is only reclaimable when last_error_code is in the deployment-config allowlist (kept in lockstep with isDeploymentConfigTelemetryError in services/onlyevs-worker/index.ts) -- every other error row, and every unsupported row, stays excluded so a genuinely vehicle-specific or permanent failure is never retried automatically.';

-- CREATE OR REPLACE preserves an unchanged function's existing grants, but
-- restate this explicitly so the migration is correct standalone (e.g.
-- replayed against a database where the grant was somehow missing) without
-- depending on that Postgres behavior.
revoke all on function private.claim_onlyevs_due_telemetry(text, integer) from public;
grant execute on function private.claim_onlyevs_due_telemetry(text, integer) to onlyevs_worker;

-- Second partial index alongside the existing
-- onlyevs_telemetry_enrollments_due_idx (which excludes all 'error' rows):
-- covers exactly the reclaimable deployment-config-error slice the claim
-- predicate above now accepts, so those rows are found efficiently instead
-- of falling back to a sequential scan. Additive -- the original index is
-- untouched and still serves the non-error majority of due rows.
create index if not exists onlyevs_telemetry_enrollments_config_error_due_idx
  on public.onlyevs_telemetry_enrollments (next_action_at, workspace_id)
  where status = 'error' and last_error_code = 'telemetry_proxy_not_configured';
