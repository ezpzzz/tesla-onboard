"use client";

/**
 * Owner-facing manual apply/abort surface for a Turo email candidate (M3),
 * plus the two pure helpers that back it. Manual confirm/abort is the only
 * live path in this dark-shipped build -- the ONLYEVS_EMAIL_AUTO_* flags and
 * ONLYEVS_EMAIL_WORKER_ENABLED gate the *worker* acting without a human, not
 * these manager-authenticated actions (see
 * `supabase/migrations/20260816150000_onlyevs_email_action_lifecycle.sql`,
 * `confirm_onlyevs_email_candidate` / `abort_onlyevs_email_revocation`).
 */

import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "./vehicle-repository";
import type { OwnerInboxItem } from "./email-inbox-repository";

export interface CreateTripPrefillFacts {
  guestName?: string | null;
  guestEmail?: string | null;
  vehicleId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

/**
 * Builds the "Create trip manually" handoff link into the owner dashboard's
 * existing new-guest dialog. Frozen shape: `/owner?<params>#new-guest` with
 * one query param per non-blank fact, verified against
 * `tests/email-actions-repository.test.ts`. Every fact is optional --
 * Turo's booking emails carry no guest email or fleet vehicle id (M1's
 * extraction has no source for either), so callers routinely omit them.
 */
export function buildPrefilledCreateTripHref(facts: CreateTripPrefillFacts): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | null | undefined]> = [
    ["guestName", facts.guestName],
    ["guestEmail", facts.guestEmail],
    ["vehicleId", facts.vehicleId],
    ["startsAt", facts.startsAt],
    ["endsAt", facts.endsAt],
  ];
  for (const [key, value] of entries) {
    const trimmed = value?.trim();
    if (trimmed) params.set(key, trimmed);
  }
  const query = params.toString();
  return query ? `/owner?${query}#new-guest` : "/owner#new-guest";
}

export interface AppliedCandidateTripRow {
  id: string;
  guest_name: string | null;
  guest_email: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

export interface AppliedCandidateTripCandidate {
  state: string;
  effective_trip_id: string | null;
}

export interface AppliedCandidateTrip {
  tripId: string;
  guestName: string | null;
  guestEmail: string | null;
  startAt: number;
  endAt: number;
  status: string;
}

/**
 * Pure resolver: an applied candidate points at its trip only once the
 * candidate itself has reached `applied` and the two ids agree -- anything
 * else (still mid-flight, dismissed/superseded with a stale pointer, a
 * lookup that came back empty, or a mismatched id) resolves to `null` rather
 * than risk showing the wrong trip.
 */
export function deriveAppliedCandidateTrip(
  candidate: AppliedCandidateTripCandidate | null,
  trip: AppliedCandidateTripRow | null,
): AppliedCandidateTrip | null {
  if (!candidate || candidate.state !== "applied" || !candidate.effective_trip_id) return null;
  if (!trip || trip.id !== candidate.effective_trip_id) return null;
  return {
    tripId: trip.id,
    guestName: trip.guest_name,
    guestEmail: trip.guest_email,
    startAt: Date.parse(trip.starts_at),
    endAt: Date.parse(trip.ends_at),
    status: trip.status,
  };
}

/**
 * Fetches the candidate's current state/effective_trip_id and, once applied,
 * the linked trip row -- then resolves them through `deriveAppliedCandidateTrip`.
 * Two sequential RLS-scoped reads (not a transaction): this is read-only
 * presentation state, never used for authorization or mutation, so the
 * narrow window where the candidate could change between reads is an
 * accepted tradeoff matching the rest of `lib/owner/*`'s client-side reads.
 */
export async function resolveAppliedCandidateTrip(
  scope: VehicleWorkspaceScope,
  item: Pick<OwnerInboxItem, "id" | "state">,
): Promise<AppliedCandidateTrip | null> {
  const client = createClient();
  const { data: candidate, error: candidateError } = await client
    .from("onlyevs_email_candidates")
    .select("state,effective_trip_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", item.id)
    .maybeSingle();
  if (candidateError) throw new Error(candidateError.message);
  if (!candidate || candidate.state !== "applied" || !candidate.effective_trip_id) return null;

  const { data: trip, error: tripError } = await client
    .from("onlyevs_trips")
    .select("id,guest_name,guest_email,starts_at,ends_at,status")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", candidate.effective_trip_id)
    .maybeSingle();
  if (tripError) throw new Error(tripError.message);
  return deriveAppliedCandidateTrip(candidate, trip ?? null);
}

/**
 * Manual apply: the only live path this build creates an
 * `onlyevs_email_actions` row through. Re-verified server-side on every call
 * (`confirm_onlyevs_email_candidate` re-checks candidate state/revision and
 * integration existence) -- this client never trusts anything cached.
 */
export async function confirmEmailCandidate(
  scope: VehicleWorkspaceScope,
  candidateId: string,
  expectedRevision: number,
  corrections: Record<string, string> = {},
) {
  const { error } = await createClient().rpc("confirm_onlyevs_email_candidate", {
    p_workspace_id: scope.workspaceId,
    p_candidate_id: candidateId,
    p_expected_revision: expectedRevision,
    p_corrections: corrections,
  });
  if (error) throw new Error(error.message);
}

/**
 * Owner abort of an in-flight destructive action's revocation brake. Always
 * available regardless of the ONLYEVS_EMAIL_AUTO_* rollout gates -- those
 * gate whether the worker may act without a human, never whether a human can
 * stop it. `abort_onlyevs_email_revocation` re-checks state/deadline/
 * provider-claim on every call.
 */
export async function abortEmailRevocation(
  scope: VehicleWorkspaceScope,
  actionId: string,
  expectedRevision: number,
  reason: string,
) {
  const { error } = await createClient().rpc("abort_onlyevs_email_revocation", {
    p_workspace_id: scope.workspaceId,
    p_action_id: actionId,
    p_expected_revision: expectedRevision,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}
