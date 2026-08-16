import { describe, expect, it } from "vitest";
import { deriveUrgentActionView, type EmailActionRow } from "@/components/owner/UrgentActionPanel";

function action(overrides: Partial<EmailActionRow>): EmailActionRow {
  return {
    id: "action-1",
    state: "queued",
    actionType: "cancel_trip",
    brakeDeadline: null,
    providerClaimedAt: null,
    revision: 1,
    ...overrides,
  };
}

describe("deriveUrgentActionView", () => {
  it("is not visible when there is no linked action", () => {
    expect(deriveUrgentActionView(null, Date.now()).visible).toBe(false);
  });

  it("is not visible for non-destructive action types even with a real row (schema never gives them a brake_deadline)", () => {
    expect(deriveUrgentActionView(action({ actionType: "create_trip", state: "validating" }), Date.now()).visible).toBe(false);
    expect(deriveUrgentActionView(action({ actionType: "apply_update", state: "db_committing" }), Date.now()).visible).toBe(false);
  });

  it("shows a pre-alert notifying phase with abort disabled before the owner alert is accepted", () => {
    const view = deriveUrgentActionView(action({ state: "awaiting_owner_alert" }), Date.now());
    expect(view.visible).toBe(true);
    expect(view.phase).toBe("notifying");
    expect(view.abortEnabled).toBe(false);
  });

  it("starts the countdown only once the state is revocation_pending, per the brake-start contract", () => {
    const now = Date.parse("2026-09-15T18:00:00.000Z");
    const view = deriveUrgentActionView(action({ state: "revocation_pending", brakeDeadline: "2026-09-15T18:30:00.000Z" }), now);
    expect(view.phase).toBe("counting_down");
    expect(view.abortEnabled).toBe(true);
    expect(view.minutesRemaining).toBe(30);
    expect(view.deadlineLabel).not.toBeNull();
  });

  it("disables abort once the provider has claimed the action, even while still counting down", () => {
    const now = Date.parse("2026-09-15T18:00:00.000Z");
    const view = deriveUrgentActionView(
      action({ state: "revocation_pending", brakeDeadline: "2026-09-15T18:30:00.000Z", providerClaimedAt: "2026-09-15T18:05:00.000Z" }),
      now,
    );
    expect(view.abortEnabled).toBe(false);
    expect(view.abortDisabledReason).toBe("Revocation in progress");
  });

  it("moves to grace_expired (abort disabled) once local clock passes the deadline", () => {
    const now = Date.parse("2026-09-15T18:31:00.000Z");
    const view = deriveUrgentActionView(action({ state: "revocation_pending", brakeDeadline: "2026-09-15T18:30:00.000Z" }), now);
    expect(view.phase).toBe("grace_expired");
    expect(view.abortEnabled).toBe(false);
  });

  it("shows in_progress with abort disabled once provider mutation has started", () => {
    const view = deriveUrgentActionView(action({ state: "provider_mutating" }), Date.now());
    expect(view.phase).toBe("in_progress");
    expect(view.abortEnabled).toBe(false);
  });

  it.each([
    ["succeeded", "resolved_succeeded"],
    ["aborted", "resolved_aborted"],
    ["superseded", "resolved_aborted"],
    ["needs_review", "needs_review"],
    ["failed_retryable", "failed"],
  ] as const)("maps terminal state %s to phase %s with abort disabled", (state, phase) => {
    const view = deriveUrgentActionView(action({ state }), Date.now());
    expect(view.phase).toBe(phase);
    expect(view.abortEnabled).toBe(false);
  });

  it("always states the consequence for each destructive action type", () => {
    for (const actionType of ["cancel_trip", "rotate_guest", "swap_vehicle", "revoke_access"] as const) {
      const view = deriveUrgentActionView(action({ actionType, state: "awaiting_owner_alert" }), Date.now());
      expect(view.headline.length).toBeGreaterThan(0);
      expect(view.detail.length).toBeGreaterThan(0);
    }
  });
});
