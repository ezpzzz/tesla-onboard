-- Cover the guest-capability and reminder foreign keys used by cleanup,
-- workspace deletion, and delivery-history joins. The primary/request-time
-- indexes in the portal migration optimize different access paths and do not
-- cover these composite constraints in PostgreSQL's FK checks.

create index if not exists onlyevs_trip_link_secrets_workspace_trip_idx
  on private.onlyevs_trip_link_secrets (workspace_id, trip_id);

create index if not exists onlyevs_reminder_deliveries_workspace_trip_idx
  on public.onlyevs_reminder_deliveries (workspace_id, trip_id);

create index if not exists onlyevs_reminder_deliveries_requested_by_idx
  on public.onlyevs_reminder_deliveries (requested_by);
