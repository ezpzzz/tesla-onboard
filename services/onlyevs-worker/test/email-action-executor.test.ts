import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { actionJobProgressed, buildOwnerAlertMessage } = await import("@/services/onlyevs-worker/email");

describe("actionJobProgressed", () => {
  it("treats the first call (no prior state) as progress", () => {
    expect(actionJobProgressed(null, { state: "claimed", revision: 2 })).toBe(true);
  });

  it("is progress when the state changed", () => {
    expect(actionJobProgressed({ state: "queued", revision: 1 }, { state: "claimed", revision: 2 })).toBe(true);
  });

  it("is progress when only the revision changed (same state written twice)", () => {
    expect(actionJobProgressed({ state: "claimed", revision: 2 }, { state: "claimed", revision: 3 })).toBe(true);
  });

  it("is not progress when neither state nor revision changed -- the loop's stop condition", () => {
    expect(actionJobProgressed({ state: "awaiting_owner_alert", revision: 4 }, { state: "awaiting_owner_alert", revision: 4 })).toBe(false);
  });

  it("is not progress for a terminal state repeated across calls", () => {
    expect(actionJobProgressed({ state: "succeeded", revision: 7 }, { state: "succeeded", revision: 7 })).toBe(false);
  });
});

describe("buildOwnerAlertMessage", () => {
  it("names the consequence for a cancellation and includes the reservation id", () => {
    const message = buildOwnerAlertMessage({ actionType: "cancel_trip", reservationId: "71234582" });
    expect(message.text).toContain("cancelled their Turo reservation (Turo reservation 71234582)");
    expect(message.text).toContain("30 minutes unless you abort");
    expect(message.html).toContain("30 minutes unless you abort");
  });

  it("omits the reservation clause entirely when none is known, rather than printing a blank", () => {
    const message = buildOwnerAlertMessage({ actionType: "cancel_trip", reservationId: null });
    expect(message.text).not.toContain("()");
    expect(message.text).not.toContain("reservation )");
  });

  it("never leaks the private guest-facing capability or link into the alert copy", () => {
    const message = buildOwnerAlertMessage({ actionType: "cancel_trip", reservationId: "71234582" });
    expect(message.text).not.toMatch(/https?:\/\//);
  });

  it("escapes the reservation id in the HTML body", () => {
    const message = buildOwnerAlertMessage({ actionType: "cancel_trip", reservationId: "<script>1</script>" });
    expect(message.html).not.toContain("<script>1</script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("still states a consequence for an unrecognized destructive action_type rather than being blank", () => {
    const message = buildOwnerAlertMessage({ actionType: "swap_vehicle", reservationId: null });
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.text).toContain("30 minutes unless you abort");
  });
});
