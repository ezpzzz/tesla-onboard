import { describe, expect, it } from "vitest";
import {
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
