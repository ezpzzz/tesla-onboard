import { describe, expect, it } from "vitest";
import {
  CHARGING_SYNC_INTERVAL_MS,
  CHARGING_SYNC_LOOKBACK_MS,
  CHARGING_SYNC_RETRY_MS,
  LOCATION_READ_TIMEOUT_MS,
  TURO_INVOICE_WINDOW_MS,
  isLocationInsideAuthorizedWindow,
  validCoordinates,
} from "@/lib/owner/telemetry-policy";
import { INVITE_LEAD_MS, REVOCATION_GRACE_MS } from "@/lib/owner/access-lifecycle";

describe("telemetry privacy policy", () => {
  it("accepts only provider-observed timestamps inside the trip window", () => {
    const args = {
      tripStartAt: 1_000_000,
      tripEndAt: 2_000_000,
      leadMs: INVITE_LEAD_MS,
      graceMs: REVOCATION_GRACE_MS,
    };
    expect(isLocationInsideAuthorizedWindow({ ...args, observedAt: args.tripStartAt })).toBe(true);
    expect(isLocationInsideAuthorizedWindow({
      ...args,
      observedAt: args.tripStartAt - INVITE_LEAD_MS - 1,
    })).toBe(false);
    expect(isLocationInsideAuthorizedWindow({
      ...args,
      observedAt: args.tripEndAt + REVOCATION_GRACE_MS + 1,
    })).toBe(false);
  });

  it("rejects malformed coordinates", () => {
    expect(validCoordinates(33.4484, -112.074)).toBe(true);
    expect(validCoordinates(91, 0)).toBe(false);
    expect(validCoordinates(0, -181)).toBe(false);
    expect(validCoordinates(Number.NaN, 0)).toBe(false);
  });
});

// Code Quality Issue 2 (2A): every new time/threshold constant lives in this
// module — these were previously inline literals in
// components/owner/packet-evidence-card.tsx, services/onlyevs-worker/
// index.ts, and lib/tesla-server.ts. Pinning the values here means a change
// to any of them is a deliberate, reviewed edit to this module, not a
// silent divergence in one importer.
describe("centralized telemetry/charging/location thresholds (Issue 2, 2A)", () => {
  it("keeps the Turo invoice-eligibility window at 72 hours", () => {
    expect(TURO_INVOICE_WINDOW_MS).toBe(72 * 60 * 60 * 1_000);
  });

  it("keeps the charging-invoice sync thresholds positive and ordered", () => {
    expect(CHARGING_SYNC_LOOKBACK_MS).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(CHARGING_SYNC_INTERVAL_MS).toBe(6 * 60 * 60 * 1_000);
    expect(CHARGING_SYNC_RETRY_MS).toBe(15 * 60 * 1_000);
    // Retry backoff must be shorter than the steady-state interval, or a
    // failed sync would wait longer than a healthy one before trying again.
    expect(CHARGING_SYNC_RETRY_MS).toBeLessThan(CHARGING_SYNC_INTERVAL_MS);
  });

  it("keeps the one-shot home-area location read timeout bounded", () => {
    expect(LOCATION_READ_TIMEOUT_MS).toBe(4_000);
    expect(LOCATION_READ_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
