-- Cover every foreign-key lookup used by cascades and reconciliation jobs.
create index if not exists evhost_workspace_claims_claimed_by_idx
  on private.evhost_workspace_claims (claimed_by)
  where claimed_by is not null;
create index if not exists onlyevs_integration_credentials_workspace_integration_idx
  on private.onlyevs_integration_credentials (workspace_id, integration_id);
create index if not exists onlyevs_owner_import_sessions_workspace_idx
  on private.onlyevs_owner_import_sessions (workspace_id);
create index if not exists onlyevs_guest_bindings_workspace_trip_idx
  on private.onlyevs_guest_bindings (workspace_id, trip_id);
create index if not exists onlyevs_access_secrets_workspace_grant_idx
  on private.onlyevs_access_secrets (workspace_id, grant_id);
create index if not exists onlyevs_telemetry_workspace_integration_idx
  on public.onlyevs_telemetry_enrollments (workspace_id, integration_id);
create index if not exists onlyevs_location_workspace_vehicle_idx
  on private.onlyevs_vehicle_location_points (workspace_id, vehicle_id);
create index if not exists onlyevs_brand_assets_created_by_idx
  on public.onlyevs_brand_assets (created_by);
