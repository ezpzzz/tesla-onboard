import { describe, expect, it } from "vitest";
import { deriveOwnerIntegrationCapabilities } from "@/lib/owner/integration-capabilities";

const baseEnv = {
  NEXT_PUBLIC_TESLA_AUTH_MODE: "live",
  TESLA_CLIENT_ID: "tesla-client",
  TESLA_CLIENT_SECRET: "tesla-secret",
  TESLA_OWNER_REDIRECT_URI: "https://evhost.app/auth/owner/tesla/callback",
  TESLA_SESSION_SECRET: "s".repeat(32),
  ONLYEVS_DATA_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 7).toString("base64")}`,
};

describe("owner integration capabilities", () => {
  it("keeps safe Tesla fleet import available while durable operations are disabled", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      ...baseEnv,
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
    });

    expect(capabilities.operationsEnabled).toBe(false);
    expect(capabilities.tesla).toMatchObject({
      connectionMode: "fleet_import",
      configured: true,
    });
    expect(capabilities.googleCalendar.connectionEnabled).toBe(false);
  });

  it("allows an initial Google Calendar import without claiming automatic refresh", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      ...baseEnv,
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
      GOOGLE_CALENDAR_CLIENT_ID: "google-client",
      GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
      GOOGLE_CALENDAR_REDIRECT_URI: "https://evhost.app/auth/owner/google/callback",
    });

    expect(capabilities.googleCalendar).toEqual({
      configured: true,
      connectionEnabled: true,
      automaticSyncEnabled: false,
    });
  });

  it("enables durable Tesla operations and automatic calendar sync only behind the operations gate", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      ...baseEnv,
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "true",
      GOOGLE_CALENDAR_CLIENT_ID: "google-client",
      GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
      GOOGLE_CALENDAR_REDIRECT_URI: "https://evhost.app/auth/owner/google/callback",
    });

    expect(capabilities.tesla.connectionMode).toBe("durable");
    expect(capabilities.googleCalendar.automaticSyncEnabled).toBe(true);
  });

  it("fails closed when credentials or encryption prerequisites are malformed", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "true",
      NEXT_PUBLIC_TESLA_AUTH_MODE: "live",
      TESLA_CLIENT_ID: "tesla-client",
      GOOGLE_CALENDAR_CLIENT_ID: "google-client",
      GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
      GOOGLE_CALENDAR_REDIRECT_URI: "not-a-url",
      ONLYEVS_DATA_ENCRYPTION_KEYS: "invalid",
    });

    expect(capabilities.tesla.connectionMode).toBe("unavailable");
    expect(capabilities.googleCalendar).toEqual({
      configured: false,
      connectionEnabled: false,
      automaticSyncEnabled: false,
    });
  });

  it("never advertises mock Tesla import in a production runtime", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      NODE_ENV: "production",
      NEXT_PUBLIC_TESLA_AUTH_MODE: "mock",
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
    });

    expect(capabilities.tesla).toEqual({
      configured: false,
      connectionMode: "unavailable",
    });
  });
});
