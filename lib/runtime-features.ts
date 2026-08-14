/**
 * Production control-plane features stay fail-closed until their additive
 * database migration and background services have been provisioned and
 * verified. This value is intentionally build-time/public: it controls only
 * presentation and route availability, never credentials or authorization.
 */
export const ONLYEVS_OPERATIONS_ENABLED =
  process.env.NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED === "true";
