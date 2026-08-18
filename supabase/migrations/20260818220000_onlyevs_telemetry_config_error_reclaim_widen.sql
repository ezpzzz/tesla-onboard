-- Fix: private.claim_onlyevs_due_telemetry's deployment-config allowlist
-- (20260818210000_onlyevs_telemetry_config_error_reclaim.sql) held exactly
-- one code (telemetry_proxy_not_configured) at the moment the worker's
-- isDeploymentConfigTelemetryError predicate (services/onlyevs-worker/
-- index.ts) was widened to a second one, telemetry_region_not_configured
-- (D4, tesla-api-alignment-20260818.md -- status()/remove() moved off the
-- proxy onto onlyevs_integrations.region_base_url, so a missing/invalid
-- region base is the same class of deployment gap). The migration's own
-- header comment warned this allowlist "must stay in lockstep by hand" with
-- that predicate -- it wasn't, so a vehicle that hit
-- telemetry_region_not_configured was written status='error' with a
-- 15-minute next_action_at (services/onlyevs-worker/index.ts's
-- isDeploymentConfigTelemetryError branch) that private.claim_onlyevs_due_
-- telemetry's `status not in ('unsupported','error')` filter never
-- evaluates for a status='error' row unless last_error_code is in this
-- allowlist. Reconnecting does repopulate region_base_url on
-- onlyevs_integrations, but nothing resets the already-stranded enrollment
-- row -- see this migration's data-remediation note at the bottom.
--
-- "By hand" lockstep has now failed twice (the first time for
-- telemetry_proxy_not_configured itself, fixed by 20260818210000). This
-- migration does not just add the missing string: it re-derives both the
-- claim predicate's allowlist and the matching partial index from
-- TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES (lib/owner/telemetry-policy.ts),
-- now the single source of truth for this code set, and the worker's
-- isDeploymentConfigTelemetryError derives from that same constant rather
-- than an inline string/array literal. SQL cannot import a TypeScript
-- constant, so the enforcement mechanism is
-- services/onlyevs-worker/test/telemetry-config-error-code-lockstep.test.ts,
-- a plain vitest test (no database) that reads this migration's SQL off
-- disk, parses the allowlist array literal below, and fails loudly -- naming
-- the exact missing/extra code(s) -- the moment either side of the lockstep
-- drifts again. ANY future change to TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES
-- MUST ship together with a new migration that widens both the allowlist
-- below and the partial index to match, or that guard test fails CI.
--
-- Standalone-applicable: like 20260818210000, this touches only
-- private.claim_onlyevs_due_telemetry (CREATE OR REPLACE, same signature)
-- and the one partial index it added, both scoped to tables defined in
-- 20260814193000_onlyevs_access_lifecycle.sql. Depends on 20260818210000
-- having run first (it replaces that migration's function body and index);
-- does not depend on anything from the vehicle-telemetry-ledger or
-- workspace-mail eras.

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
          -- be treated as the vehicle-permanent park below. This set is
          -- TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES
          -- (lib/owner/telemetry-policy.ts) -- kept in lockstep with
          -- isDeploymentConfigTelemetryError (services/onlyevs-worker/
          -- index.ts) by services/onlyevs-worker/test/
          -- telemetry-config-error-code-lockstep.test.ts, which reads this
          -- literal off disk and diffs it against that constant. Every
          -- genuinely vehicle-specific 'error' row, and every 'unsupported'
          -- row, stays excluded exactly as before this migration.
          and e.last_error_code = any (array[
            'telemetry_proxy_not_configured',
            'telemetry_region_not_configured'
          ])
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
  'Claims due onlyevs_telemetry_enrollments rows for worker processing. A status = error row is only reclaimable when last_error_code is in the deployment-config allowlist -- the exact set TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES (lib/owner/telemetry-policy.ts) names, kept in lockstep with isDeploymentConfigTelemetryError (services/onlyevs-worker/index.ts) by services/onlyevs-worker/test/telemetry-config-error-code-lockstep.test.ts -- every other error row, and every unsupported row, stays excluded so a genuinely vehicle-specific or permanent failure is never retried automatically.';

-- CREATE OR REPLACE preserves an unchanged function's existing grants, but
-- restate this explicitly so the migration is correct standalone (e.g.
-- replayed against a database where the grant was somehow missing) without
-- depending on that Postgres behavior.
revoke all on function private.claim_onlyevs_due_telemetry(text, integer) from public;
grant execute on function private.claim_onlyevs_due_telemetry(text, integer) to onlyevs_worker;

-- Widen the matching partial index to the same two-code set. DROP + CREATE
-- rather than a bare CREATE INDEX IF NOT EXISTS: the old index's predicate
-- (last_error_code = 'telemetry_proxy_not_configured' only) does not match
-- the new one, and "if not exists" would silently keep the stale, narrower
-- index in place instead of replacing it.
drop index if exists public.onlyevs_telemetry_enrollments_config_error_due_idx;
create index onlyevs_telemetry_enrollments_config_error_due_idx
  on public.onlyevs_telemetry_enrollments (next_action_at, workspace_id)
  where status = 'error' and last_error_code = any (array[
    'telemetry_proxy_not_configured',
    'telemetry_region_not_configured'
  ]);

-- ---------------------------------------------------------------------
-- Data remediation note (intentionally NOT executed by this migration --
-- see lane brief item 5): any onlyevs_telemetry_enrollments row already
-- sitting at status='error' with last_error_code='telemetry_region_not_
-- configured' from BEFORE this migration applies is picked up automatically
-- once next_action_at (already <= now() + 15 minutes from when it was
-- written) elapses and the newly-widened claim predicate above starts
-- evaluating it -- no one-off UPDATE is required to unstick a previously
-- stranded row. The only manual step, if an operator wants a stuck
-- enrollment reprocessed immediately rather than waiting for its existing
-- next_action_at, is a one-off:
--   update public.onlyevs_telemetry_enrollments
--   set next_action_at = now()
--   where status = 'error' and last_error_code = 'telemetry_region_not_configured';
-- No such UPDATE is included here -- this migration only changes what the
-- claim query is capable of reclaiming, not any row's data.
