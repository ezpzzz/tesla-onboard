import { describe, expect, it } from "vitest";
import { deriveIntegrationRecovery } from "@/lib/owner/integration-recovery";
import { INTEGRATION_DISCONNECT_STALE_MS } from "@/lib/owner/telemetry-policy";
import type { IntegrationStatus } from "@/lib/owner/access-types";

const NOW = Date.parse("2026-08-18T12:00:00Z");

describe("deriveIntegrationRecovery", () => {
  it("is stale when disconnecting has sat just over the threshold", () => {
    const updatedAt = NOW - INTEGRATION_DISCONNECT_STALE_MS - 1;
    expect(deriveIntegrationRecovery({ status: "disconnecting", updatedAt }, NOW)).toEqual({
      transitional: true,
      stale: true,
    });
  });

  it("is not stale exactly at the threshold (strictly greater-than only)", () => {
    const updatedAt = NOW - INTEGRATION_DISCONNECT_STALE_MS;
    expect(deriveIntegrationRecovery({ status: "disconnecting", updatedAt }, NOW)).toEqual({
      transitional: true,
      stale: false,
    });
  });

  it("is not stale just under the threshold", () => {
    const updatedAt = NOW - INTEGRATION_DISCONNECT_STALE_MS + 1;
    expect(deriveIntegrationRecovery({ status: "disconnecting", updatedAt }, NOW)).toEqual({
      transitional: true,
      stale: false,
    });
  });

  it("is never transitional or stale for non-disconnecting statuses, however old", () => {
    const ancient = NOW - INTEGRATION_DISCONNECT_STALE_MS * 100;
    const statuses: IntegrationStatus[] = ["connected", "degraded", "reauth_required", "disconnected"];
    for (const status of statuses) {
      expect(deriveIntegrationRecovery({ status, updatedAt: ancient }, NOW)).toEqual({
        transitional: false,
        stale: false,
      });
    }
  });

  it("treats a null updatedAt on a disconnecting row as transitional but not stale (unknown age is not evidence of staleness)", () => {
    expect(deriveIntegrationRecovery({ status: "disconnecting", updatedAt: null }, NOW)).toEqual({
      transitional: true,
      stale: false,
    });
  });

  it("treats an undefined updatedAt on a disconnecting row the same way", () => {
    expect(deriveIntegrationRecovery({ status: "disconnecting", updatedAt: undefined }, NOW)).toEqual({
      transitional: true,
      stale: false,
    });
  });
});
