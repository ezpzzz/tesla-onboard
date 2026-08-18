-- Recovery for an integration stuck in 'disconnecting'.
--
-- disconnect_onlyevs_integration's async branch (20260814193000_onlyevs_
-- access_lifecycle.sql) marks the integration's onlyevs_telemetry_enrollments
-- rows 'removal_requested' and parks onlyevs_integrations.status =
-- 'disconnecting', relying on services/onlyevs-worker's claim loop
-- (private.claim_onlyevs_due_telemetry) plus a Tesla command proxy
-- (ONLYEVS_TESLA_COMMAND_PROXY_URL) to finish the job via
-- finishTeslaDisconnect. That worker infrastructure is not deployed in prod
-- (deploy/onlyevs/*.yaml templates are unfilled), so nothing ever claims a
-- parked row and the owner-facing UI (components/owner/OwnerIntegrations.tsx)
-- hides all controls while status = 'disconnecting' -- there was no way out.
--
-- This adds one additive, workspace-admin-gated RPC that lets an admin
-- locally complete a stuck disconnect: delete the stored credentials, drop
-- the stale enrollment rows, and flip status to 'disconnected' -- the same
-- terminal state and cleanup disconnect_onlyevs_integration's sync branch
-- reaches when there was nothing to wait on. It is explicitly a local-only
-- completion: the audit event it writes records that Tesla-side fleet-
-- telemetry config removal was never confirmed, because the same missing
-- worker/proxy infrastructure that stranded the row in the first place is
-- also what would have confirmed the provider-side teardown.
--
-- Standalone-applicable to a prod database that has applied the
-- access-lifecycle era (20260814193000) but not the vehicle-telemetry ledger
-- (20260817090000) or workspace-mail (20260817140000+) migrations -- this
-- touches only onlyevs_integrations, onlyevs_telemetry_enrollments,
-- private.onlyevs_integration_credentials, and
-- onlyevs_integration_audit_events, all defined in 20260814193000.

-- Widen the audit-event result enum to add 'completed_local_only' -- the
-- distinct, honest outcome this RPC records: the local DB state was
-- completed, but the provider-side (Tesla) fleet-telemetry config removal
-- was never confirmed, which is neither 'success' (implies full completion)
-- nor 'failure'/'ambiguous'/'denied' (implies nothing was completed).
alter table public.onlyevs_integration_audit_events
  drop constraint if exists onlyevs_integration_audit_events_result_check;
alter table public.onlyevs_integration_audit_events
  add constraint onlyevs_integration_audit_events_result_check
  check (result in ('success', 'failure', 'ambiguous', 'denied', 'completed_local_only'));

create or replace function public.force_complete_onlyevs_integration_disconnect(
  p_workspace_id uuid,
  p_shop_slug text,
  p_provider text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
  v_status text;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'admin') then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;

  select i.id, i.status into v_integration_id, v_status
  from public.onlyevs_integrations i
  where i.workspace_id = p_workspace_id
    and i.shop_slug = p_shop_slug
    and i.provider = p_provider
  for update;

  if v_integration_id is null or v_status <> 'disconnecting' then
    raise exception 'integration_not_disconnecting' using errcode = '55000';
  end if;

  delete from private.onlyevs_integration_credentials c
  where c.integration_id = v_integration_id;

  delete from public.onlyevs_telemetry_enrollments e
  where e.workspace_id = p_workspace_id and e.integration_id = v_integration_id;

  update public.onlyevs_integrations i
  set status = 'disconnected',
      account_label = null,
      granted_scopes = '{}',
      region_base_url = null,
      next_sync_at = null,
      claimed_by = null,
      claim_expires_at = null,
      last_error_code = null
  where i.id = v_integration_id;

  insert into public.onlyevs_integration_audit_events (
    workspace_id, actor_type, actor_id_hash, entity_type, entity_id, action, result, details
  ) values (
    p_workspace_id, 'owner', encode(extensions.digest((select auth.uid())::text, 'sha256'), 'hex'),
    'integration', v_integration_id, 'force_complete_disconnect', 'completed_local_only',
    jsonb_build_object(
      'provider', p_provider,
      'note', 'provider-side fleet-telemetry config removal was not confirmed; the async worker/proxy that would confirm it is not deployed'
    )
  );

  return 'disconnected';
end;
$$;

comment on function public.force_complete_onlyevs_integration_disconnect(uuid, text, text) is
  'Workspace-admin recovery for an integration stranded in disconnecting because the async telemetry-removal worker/proxy is not deployed. Deletes stored credentials and stale enrollment rows, flips status to disconnected, and records an audit event noting the provider-side teardown was never confirmed. Only callable when status = disconnecting.';

revoke all on function public.force_complete_onlyevs_integration_disconnect(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.force_complete_onlyevs_integration_disconnect(uuid, text, text)
  to authenticated;
