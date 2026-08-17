import { describe, expect, it } from "vitest";
import { deriveOwnerIntegrationCapabilities } from "@/lib/owner/integration-capabilities";

const baseEnv = {
  NEXT_PUBLIC_TESLA_AUTH_MODE: "live",
  TESLA_CLIENT_ID: "tesla-client",
  TESLA_CLIENT_SECRET: "tesla-secret",
  TESLA_OWNER_REDIRECT_URI: "https://evhost.app/auth/owner/tesla/callback",
  TESLA_SESSION_SECRET: "s".repeat(32),
  ONLYEVS_DATA_ENCRYPTION_KEYS: `1:${Buffer.alloc(32, 7).toString("base64")}`,
  EVHOST_EMAIL_ALIAS_HMAC_KEYS: `1:${Buffer.alloc(32, 8).toString("base64")}`,
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
    expect(capabilities.turoEmail).toEqual({ configured: true, intakeEnabled: false, automationEnabled: false });
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
    expect(capabilities.turoEmail.intakeEnabled).toBe(false);
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
    expect(capabilities.turoEmail.automationEnabled).toBe(false);
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

  it("uses the production keyring parser instead of accepting a decodable but invalid entry", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      ...baseEnv,
      GOOGLE_CALENDAR_CLIENT_ID: "google-client",
      GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
      GOOGLE_CALENDAR_REDIRECT_URI: "https://evhost.app/auth/owner/google/callback",
      ONLYEVS_DATA_ENCRYPTION_KEYS: `not-a-version:${Buffer.alloc(32, 7).toString("base64")}`,
    });

    expect(capabilities.googleCalendar.connectionEnabled).toBe(false);
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

  it("keeps local mock Tesla import available only in non-production development", () => {
    const capabilities = deriveOwnerIntegrationCapabilities({
      NODE_ENV: "development",
      NEXT_PUBLIC_TESLA_AUTH_MODE: "mock",
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
    });

    expect(capabilities.tesla).toEqual({
      configured: true,
      connectionMode: "fleet_import",
    });
  });

  it("defaults to mock Tesla import in dev when NEXT_PUBLIC_TESLA_AUTH_MODE is unset, matching lib/tesla.ts's AUTH_MODE default", () => {
    // Regression for the owner-route-matrix e2e artifact: an external dev
    // server that never sets NEXT_PUBLIC_TESLA_AUTH_MODE still runs the
    // guest flow against mock Tesla per lib/tesla.ts's AUTH_MODE (mock
    // unless explicitly "live" or NODE_ENV === "production"), so the owner
    // dashboard's "Import Tesla fleet" link must stay available too.
    const capabilities = deriveOwnerIntegrationCapabilities({
      NODE_ENV: "development",
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
    });

    expect(capabilities.tesla).toEqual({
      configured: true,
      connectionMode: "fleet_import",
    });
  });

  it("requires an explicit 32-byte OAuth state secret when no Tesla session secret exists", () => {
    const googleEnv = {
      NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
      GOOGLE_CALENDAR_CLIENT_ID: "google-client",
      GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
      GOOGLE_CALENDAR_REDIRECT_URI: "https://evhost.app/auth/owner/google/callback",
      ONLYEVS_DATA_ENCRYPTION_KEYS: `1:${Buffer.alloc(32, 7).toString("base64")}`,
    };

    expect(deriveOwnerIntegrationCapabilities(googleEnv).googleCalendar.connectionEnabled).toBe(false);
    expect(deriveOwnerIntegrationCapabilities({
      ...googleEnv,
      ONLYEVS_OAUTH_STATE_SECRET: "o".repeat(32),
    }).googleCalendar.connectionEnabled).toBe(true);
  });

  it("keeps Turo email intake disabled until the operator flag is explicitly enabled", () => {
    const withoutFlag = deriveOwnerIntegrationCapabilities(baseEnv);
    expect(withoutFlag.turoEmail).toEqual({ configured: true, intakeEnabled: false, automationEnabled: false });

    const withFlag = deriveOwnerIntegrationCapabilities({
      ...baseEnv,
      EVHOST_EMAIL_INGEST_ENABLED: "true",
    });
    expect(withFlag.turoEmail.intakeEnabled).toBe(true);
  });
});
