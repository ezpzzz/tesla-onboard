import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fetchProfile = vi.fn();
const unseal = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/owner/import-session", () => ({
  OWNER_IMPORT_TOKEN_PATTERN: /^oi_[A-Za-z0-9_-]{43}$/,
  ownerImportTokenHash: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/tesla-server", () => ({
  fetchProfile,
  getConfig: () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://evhost.app/auth/tesla/callback",
    audience: "https://fleet-api.prd.na.vn.cloud.tesla.com",
    scope: "openid vehicle_device_data",
    sessionSecret: "x".repeat(32),
  }),
  unseal,
}));

const { GET } = await import("@/app/api/owner/tesla/me/route");

describe("owner Tesla transient fleet session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TESLA_OWNER_REDIRECT_URI = "https://evhost.app/auth/owner/tesla/callback";
  });

  it("consumes the encrypted access credential once and returns the complete profile", async () => {
    unseal.mockReturnValue({
      kind: "transient_fleet",
      accessToken: "access-token",
      verifiedSubject: "owner-subject",
      expiresAt: Date.now() + 60_000,
    });
    const profile = {
      id: "live_owner-subject",
      fullName: "Fleet Owner",
      firstName: "Fleet",
      email: "fleet@example.com",
      source: "live",
      vehicles: Array.from({ length: 25 }, (_, index) => ({
        id: `vehicle-${index}`,
        displayName: `Vehicle ${index}`,
        model: "Model 3",
      })),
    };
    fetchProfile.mockResolvedValue({ profile, vehiclesOk: true });

    const response = await GET(new NextRequest("https://evhost.app/api/owner/tesla/me", {
      headers: { cookie: "rtr_owner_tesla=encrypted-transient-session" },
    }));

    await expect(response.json()).resolves.toEqual({ profile });
    expect(fetchProfile).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: "https://evhost.app/auth/owner/tesla/callback" }),
      { access_token: "access-token" },
      { includeVehicleConfig: true, verifiedSubject: "owner-subject" },
    );
    expect(response.headers.get("set-cookie")).toContain("rtr_owner_tesla=");
    expect(createClient).not.toHaveBeenCalled();
  });
});
