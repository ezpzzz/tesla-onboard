import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCode = vi.fn();
const fetchProfile = vi.fn();
const verifyTeslaIdToken = vi.fn();
const requireOwnerWorkspace = vi.fn();
const createClient = vi.fn();
const seal = vi.fn(() => "sealed-owner-session");

vi.mock("@/lib/tesla-server", () => ({
  OWNER_PERSISTENT_SCOPES: ["openid", "offline_access", "vehicle_device_data", "vehicle_cmds", "vehicle_location"],
  assertConfigured: () => null,
  exchangeCode,
  fetchProfile,
  getConfig: () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://evhost.app/auth/tesla/callback",
    audience: "https://fleet-api.prd.na.vn.cloud.tesla.com",
    scope: "openid vehicle_device_data",
    sessionSecret: "x".repeat(32),
  }),
  resolveRegionBase: () => Promise.resolve("https://fleet-api.prd.na.vn.cloud.tesla.com"),
  safeEqual: (left: string, right: string) => left === right,
  seal,
  unseal: () => ({
    state: "expected-state",
    nonce: "expected-nonce",
    workspaceId: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f",
    shopSlug: "onlyevs",
    returnPath: "/owner/setup",
    durable: false,
    issuedAt: Date.now(),
  }),
  verifyTeslaIdToken,
}));
vi.mock("@/lib/owner/server-auth", () => ({ requireOwnerWorkspace }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner/credential-envelope", () => ({
  credentialKeyringFromEnv: vi.fn(() => { throw new Error("durable path should not run"); }),
  encryptCredential: vi.fn(),
}));

const { GET } = await import("@/app/auth/owner/tesla/callback/route");

function request(search: string) {
  return new NextRequest(`https://evhost.app/auth/owner/tesla/callback${search}`, {
    headers: { cookie: "rtr_owner_integration_state=sealed-state" },
  });
}

describe("owner Tesla callback fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TESLA_OWNER_REDIRECT_URI = "https://evhost.app/auth/owner/tesla/callback";
    requireOwnerWorkspace.mockResolvedValue({
      workspaceId: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f",
      shopSlug: "onlyevs",
      email: "owner@example.com",
    });
  });

  it("preserves read-only fleet import without the dormant database control plane", async () => {
    exchangeCode.mockResolvedValue({ access_token: "access", id_token: "id-token" });
    verifyTeslaIdToken.mockResolvedValue({ sub: "owner-subject" });
    const response = await GET(request("?code=code&state=expected-state"));

    expect(response.headers.get("location")).toBe("https://evhost.app/owner/setup?owner_connected=1");
    expect(response.headers.get("set-cookie")).toContain("rtr_owner_tesla=sealed-owner-session");
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(seal).toHaveBeenCalledWith(expect.objectContaining({
      kind: "transient_fleet",
      accessToken: "access",
      verifiedSubject: "owner-subject",
    }), "x".repeat(32), "rtr_owner_tesla");
    expect(exchangeCode).toHaveBeenCalledWith(expect.objectContaining({
      scope: "openid vehicle_device_data",
    }), "code");
  });
});
