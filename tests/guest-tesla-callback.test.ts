import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCode = vi.fn();
const fetchProfile = vi.fn();
const verifyTeslaIdToken = vi.fn();

vi.mock("@/lib/tesla-server", () => ({
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
  safeEqual: (left: string, right: string) => left === right,
  seal: () => "sealed-profile",
  unseal: () => ({
    state: "expected-state",
    nonce: "expected-nonce",
    returnTo: "//evil.example/steal",
    issuedAt: Date.now(),
  }),
  verifyTeslaIdToken,
}));

const { GET } = await import("@/app/auth/tesla/callback/route");

function request(search: string) {
  return new NextRequest(`https://evhost.app/auth/tesla/callback${search}`, {
    headers: { cookie: "rtr_state=sealed-state" },
  });
}

describe("guest Tesla OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed on CSRF mismatch without contacting Tesla", async () => {
    const response = await GET(request("?code=code&state=wrong"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://evhost.app/?tesla_error=state_mismatch");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects an untrusted return URL and keeps the completed session on the canonical origin", async () => {
    exchangeCode.mockResolvedValue({ access_token: "access", id_token: "id-token" });
    verifyTeslaIdToken.mockResolvedValue({ sub: "subject" });
    fetchProfile.mockResolvedValue({
      profile: { id: "subject", email: "guest@example.com", fullName: "Guest", vehicles: [] },
      vehiclesOk: true,
    });
    const response = await GET(request("?code=code&state=expected-state"));
    expect(response.headers.get("location")).toBe("https://evhost.app/?connected=1");
    expect(response.headers.get("set-cookie")).toContain("rtr_tesla=sealed-profile");
  });
});
