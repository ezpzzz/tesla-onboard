/**
 * Pure derivation for the stale-disconnect recovery UX
 * (components/owner/OwnerIntegrations.tsx). `disconnect_onlyevs_integration`
 * parks Tesla in `status='disconnecting'` and hands the rest of the teardown
 * to the async worker claim loop; when that infrastructure isn't deployed
 * (or simply hasn't run yet), nothing ever moves the row out of
 * `disconnecting` and the UI hides all controls for it. This module decides,
 * from plain status/updatedAt inputs, whether the owner should see a polling
 * "in progress" state or a "this is stuck, force it" recovery affordance.
 *
 * No I/O here -- deliberately testable without jsdom.
 */

import { INTEGRATION_DISCONNECT_STALE_MS } from "@/lib/owner/telemetry-policy";
import type { IntegrationStatus } from "@/lib/owner/access-types";

export interface IntegrationRecoveryInput {
  status: IntegrationStatus;
  /** Milliseconds since epoch, or null/undefined when unknown (e.g. a
   * pre-migration row that never got an updated_at read). */
  updatedAt: number | null | undefined;
}

export interface IntegrationRecovery {
  /** True while the integration sits in a status that can resolve on its
   * own without owner action (currently just `disconnecting`) -- the caller
   * uses this to decide whether to keep polling. */
  transitional: boolean;
  /** True only once a transitional status has sat unchanged for longer than
   * INTEGRATION_DISCONNECT_STALE_MS -- the caller uses this to offer the
   * manual force-complete recovery action. Never true for a non-transitional
   * status, and never true when updatedAt is unknown (fail closed: an
   * unknown age is not evidence of staleness). */
  stale: boolean;
}

export function deriveIntegrationRecovery(
  integration: IntegrationRecoveryInput,
  nowMs: number,
): IntegrationRecovery {
  const transitional = integration.status === "disconnecting";
  if (!transitional) return { transitional: false, stale: false };
  if (integration.updatedAt == null) return { transitional: true, stale: false };

  const stale = nowMs - integration.updatedAt > INTEGRATION_DISCONNECT_STALE_MS;
  return { transitional: true, stale };
}
