import { describe, expect, it } from "vitest";
import {
  INVITE_LEAD_MS,
  REVOCATION_GRACE_MS,
  accessWindowForTrip,
  effectiveRevocationForScheduleChange,
  reconcileNewInvitation,
  shouldIssueAccess,
  shouldRevokeAccess,
  tripSchedulesOverlap,
} from "@/lib/owner/access-lifecycle";
import type { AccessGrantSnapshot } from "@/lib/owner/access-types";

function grant(status: AccessGrantSnapshot["status"]): AccessGrantSnapshot {
  return {
    id: "grant-1",
    tripId: "trip-1",
    status,
    issueAt: 1_000,
    revokeAt: 10_000,
    inviteExpiresAt: null,
    nextActionAt: 1_000,
  };
}

describe("Tesla access lifecycle", () => {
  it("derives the approved access window", () => {
    expect(accessWindowForTrip({ startAt: 100_000_000, endAt: 200_000_000 })).toEqual({
      issueAt: 100_000_000 - INVITE_LEAD_MS,
      revokeAt: 200_000_000 + REVOCATION_GRACE_MS,
    });
  });

  it("issues only inside the eligible window", () => {
    expect(shouldIssueAccess(grant("scheduled"), 999)).toBe(false);
    expect(shouldIssueAccess(grant("scheduled"), 1_000)).toBe(true);
    expect(shouldIssueAccess(grant("invite_ready"), 2_000)).toBe(false);
    expect(shouldIssueAccess(grant("scheduled"), 10_000)).toBe(false);
  });

  it("revokes every nonterminal state at the deadline", () => {
    expect(shouldRevokeAccess(grant("redeemed"), 10_000)).toBe(true);
    expect(shouldRevokeAccess(grant("invite_ready"), 10_000)).toBe(true);
    expect(shouldRevokeAccess(grant("revoked"), 10_000)).toBe(false);
  });

  it("adopts exactly one uniquely new invitation after ambiguity", () => {
    expect(reconcileNewInvitation(["old"], ["old", "new"])).toEqual({
      kind: "adopt",
      invitationId: "new",
    });
    expect(reconcileNewInvitation(["old"], ["old"])).toEqual({
      kind: "manual_review",
      candidateIds: [],
    });
    expect(reconcileNewInvitation(["old"], ["old", "a", "b"])).toEqual({
      kind: "manual_review",
      candidateIds: ["a", "b"],
    });
  });

  it("blocks overlapping vehicle schedules but permits adjacent trips", () => {
    expect(tripSchedulesOverlap({ startAt: 0, endAt: 10 }, { startAt: 9, endAt: 20 })).toBe(true);
    expect(tripSchedulesOverlap({ startAt: 0, endAt: 10 }, { startAt: 10, endAt: 20 })).toBe(false);
  });

  it("advances revocation automatically but never extends without approval", () => {
    expect(effectiveRevocationForScheduleChange({
      previousEndAt: 10_000,
      proposedEndAt: 5_000,
      extensionApproved: false,
    })).toEqual({ revokeAt: 5_000 + REVOCATION_GRACE_MS, requiresReview: false });

    expect(effectiveRevocationForScheduleChange({
      previousEndAt: 10_000,
      proposedEndAt: 20_000,
      extensionApproved: false,
    })).toEqual({ revokeAt: 10_000 + REVOCATION_GRACE_MS, requiresReview: true });
  });
});
