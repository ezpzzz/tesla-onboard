import type { Guest } from "./types";
import type { GuestIdentityKeyType } from "./access-types";

/**
 * Durable guest identity — shared shapes only (Phase 7, premise P4 amended
 * — TODO 3 founder choice C; D1 remediation, "Full atomic RPC").
 *
 * This module used to hold the full pure orchestrator (find-or-create a
 * guest by exact key match, merge two guests, plan a re-split from a merge
 * audit event, build a drivers-list trip summary) that a live
 * `GuestLinkingStore` executed against a `pg` Pool. A dead-code audit
 * (adversarial-review sweep) found zero production callers left for any of
 * it, because both real call sites now go straight to atomic SQL instead:
 *
 * - The worker's per-trip auto-link sweep
 *   (services/onlyevs-worker/index.ts `sweepGuestLinking`) calls the
 *   migration's `private.link_onlyevs_trip_to_guest()` RPC directly, one
 *   statement per candidate trip, instead of running the old
 *   `linkTripToGuest()` against a Pg-backed store as three separate
 *   statements — that non-atomic sequence let two concurrent sweep passes
 *   racing on the same not-yet-seen identity key each create a *different*
 *   guest. See that function's header comment for the full failure mode.
 * - The browser's guest-merge action (app/owner/drivers/[id]/page.tsx) goes
 *   through `mergeGuestsViaRpc()` (./guest-linking-client.ts) straight to
 *   `merge_onlyevs_guests`, a hardened SECURITY DEFINER RPC that performs
 *   the identical repoint/audit/delete sequence as one atomic statement.
 * - The one-time email-hash backfill was superseded by the migration's own
 *   SQL `do $$` block, so `backfillGuestLinksByEmailHash` never ran.
 * - The merge dialog's "You can re-split by key later" promise is honored
 *   today by the audit row the RPC records existing, not by a live
 *   re-split button — so the JS re-split planner had no caller either.
 *
 * The Pg-backed `GuestLinkingStore` implementation this file's functions
 * ran against (`PgGuestLinkingStore`,
 * services/onlyevs-worker/guest-linking-store.ts) had zero production
 * constructors as a result and was deleted as dead code first. This file's
 * remaining exports are the two shapes that dead code left behind still in
 * real use: the candidate-key shape the worker sweep builds and passes as
 * the RPC's jsonb argument, and the merge-result shape
 * `mergeGuestsViaRpc()` maps the RPC's row onto. Reintroducing the
 * orchestrator functions (rather than more SQL/RPC surface) would need a
 * new production caller first.
 */

export interface GuestIdentityCandidateKey {
  keyType: GuestIdentityKeyType;
  /** Already-hashed/HMACed value — this module never hashes raw PII, it
   * only compares and stores the key material callers supply. */
  keyValue: string;
}

export interface MergeGuestsResult {
  targetGuest: Guest;
  tripsMoved: number;
  keysMoved: number;
  /** Opaque id of the recorded prior-state audit entry — required so a bad
   * merge can be re-split by key later (Phase 7 merge-tool guarantee). */
  auditEventId: string;
}
