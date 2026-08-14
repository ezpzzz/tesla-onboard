import type {
  AccessGrantSnapshot,
  AccessGrantStatus,
  ConfirmedTripSchedule,
} from "./access-types";

export const INVITE_LEAD_MS = 2 * 60 * 60 * 1_000;
export const REVOCATION_GRACE_MS = 60 * 60 * 1_000;
export const TESLA_INVITE_LIFETIME_MS = 24 * 60 * 60 * 1_000;

const TERMINAL_STATUSES = new Set<AccessGrantStatus>([
  "revoked",
  "expired",
  "failed_terminal",
]);

export function accessWindowForTrip(trip: Pick<ConfirmedTripSchedule, "startAt" | "endAt">) {
  return {
    issueAt: trip.startAt - INVITE_LEAD_MS,
    revokeAt: trip.endAt + REVOCATION_GRACE_MS,
  };
}

export function tripSchedulesOverlap(
  a: Pick<ConfirmedTripSchedule, "startAt" | "endAt">,
  b: Pick<ConfirmedTripSchedule, "startAt" | "endAt">,
): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

export function shouldIssueAccess(grant: AccessGrantSnapshot, now: number): boolean {
  return (
    (grant.status === "scheduled" || grant.status === "failed_retryable") &&
    now >= grant.issueAt &&
    now < grant.revokeAt
  );
}

export function shouldRevokeAccess(grant: AccessGrantSnapshot, now: number): boolean {
  return !TERMINAL_STATUSES.has(grant.status) && now >= grant.revokeAt;
}

export type ReconcileNewInviteResult =
  | { kind: "adopt"; invitationId: string }
  | { kind: "manual_review"; candidateIds: string[] };

/**
 * Tesla invitation creation is not idempotent. After an ambiguous response,
 * only one uniquely new provider id is safe to adopt; any other result must
 * stop automation rather than guessing.
 */
export function reconcileNewInvitation(
  beforeIds: readonly string[],
  afterIds: readonly string[],
): ReconcileNewInviteResult {
  const before = new Set(beforeIds);
  const candidates = [...new Set(afterIds)].filter((id) => !before.has(id));
  return candidates.length === 1
    ? { kind: "adopt", invitationId: candidates[0] }
    : { kind: "manual_review", candidateIds: candidates };
}

export function effectiveRevocationForScheduleChange(args: {
  previousEndAt: number;
  proposedEndAt: number;
  extensionApproved: boolean;
}): { revokeAt: number; requiresReview: boolean } {
  const previous = args.previousEndAt + REVOCATION_GRACE_MS;
  const proposed = args.proposedEndAt + REVOCATION_GRACE_MS;
  if (proposed <= previous) return { revokeAt: proposed, requiresReview: false };
  return args.extensionApproved
    ? { revokeAt: proposed, requiresReview: false }
    : { revokeAt: previous, requiresReview: true };
}
