import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/owner/sendgrid", () => ({
  sendGridConfigFromEnv: vi.fn(() => ({ apiKey: "test-key", fromEmail: "trips@example.com", fromName: "EVhost Trips" })),
  sendGridEmailAction: vi.fn(async () => ({ messageId: "test-message-id" })),
  SendGridDeliveryError: class SendGridDeliveryError extends Error {
    classification: "ambiguous" | "definite";
    constructor(message: string, classification: "ambiguous" | "definite") {
      super(message);
      this.classification = classification;
    }
  },
}));

vi.mock("@/lib/owner/credential-envelope", () => ({
  credentialKeyringFromEnv: vi.fn(() => ({})),
  decryptCredential: vi.fn(() => "owner@example.com"),
  encryptCredential: vi.fn(() => ({ ciphertext: "encrypted-owner-alert" })),
}));

const { actionJobProgressed, buildOwnerAlertMessage, sendOwnerAlertForAction } = await import("@/services/onlyevs-worker/email");
const { sendGridEmailAction } = await import("@/lib/owner/sendgrid");

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

describe("sendOwnerAlertForAction — delivery-claim race", () => {
  function makeAction() {
    return {
      id: "action-1", workspace_id: "ws-1", candidate_id: "cand-1", action_type: "cancel_trip",
      state: "awaiting_owner_alert", revision: 3, delivery_id: null, brake_deadline: null,
      effective_trip_id: null, last_error_code: null,
    };
  }

  /**
   * Fake `pg` client whose `delivery_id is null` claim UPDATE reports
   * `claimRowCount` -- 0 simulates an overlapping caller (e.g. a re-claimed
   * outbox job after this one's lease expired mid-send) having already won
   * the claim for the same action.
   */
  function makeClient(claimRowCount: number) {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("select delivery_id from public.onlyevs_email_actions")) {
        return { rows: [{ delivery_id: null }], rowCount: 1 };
      }
      if (sql.includes("select i.owner_alert_email_ciphertext")) {
        return {
          rows: [{
            owner_alert_email_ciphertext: "cipher", shop_slug: "shop",
            workspace_id: "ws-1", reservation_id: "71234582",
          }],
          rowCount: 1,
        };
      }
      if (sql.trim().startsWith("insert into public.onlyevs_email_deliveries")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("update public.onlyevs_email_actions set delivery_id")) {
        return { rows: [], rowCount: claimRowCount };
      }
      return { rows: [], rowCount: 0 };
    });
    return { query, release: vi.fn(), queries };
  }

  it("never calls SendGrid and cleans up the orphaned delivery row when the claim UPDATE affects zero rows", async () => {
    vi.mocked(sendGridEmailAction).mockClear();
    const client = makeClient(0);
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await sendOwnerAlertForAction(pool, makeAction(), "worker-1");

    expect(sendGridEmailAction).not.toHaveBeenCalled();
    expect(client.queries.some((q) => q.sql.trim().startsWith("delete from public.onlyevs_email_deliveries"))).toBe(true);
  });

  it("calls SendGrid exactly once when this caller wins the claim", async () => {
    vi.mocked(sendGridEmailAction).mockClear();
    const client = makeClient(1);
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await sendOwnerAlertForAction(pool, makeAction(), "worker-1");

    expect(sendGridEmailAction).toHaveBeenCalledTimes(1);
    expect(client.queries.some((q) => q.sql.trim().startsWith("delete from public.onlyevs_email_deliveries"))).toBe(false);
  });
});
