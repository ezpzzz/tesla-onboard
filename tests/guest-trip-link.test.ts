import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTenantConfigDraft } from "@/lib/tenant-config";

const rpc = vi.fn();
const createAnonymousClient = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAnonymousClient }));

const { loadGuestTripPortal } = await import("@/lib/guest-trip-portal");

describe("private guest trip links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://local-test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
    createAnonymousClient.mockReturnValue({ rpc });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns only the guest-safe portal allowlist without guest authentication", async () => {
    const config = newTenantConfigDraft("Desert EV Hosting");
    Object.assign(config, { hostName: "Alex", hostPhone: "+16025550148" });
    Object.assign(config.car, { sourceVehicleId: "vehicle-public", model: "Model Y", trim: "Long Range AWD", year: 2025, color: "Quicksilver" });
    rpc.mockResolvedValue({ data: [{
      company_name: "Desert EV Hosting",
      guest_first_name: "Maya",
      guest_email: "must-not-escape@example.com",
      vehicle_name: "2025 Model Y",
      vehicle_model: "Model Y",
      vehicle_trim: "Long Range AWD",
      vehicle_year: 2025,
      vehicle_color: "Quicksilver",
      vehicle_shifter: "screen",
      vehicle_vin: "must-not-escape",
      starts_at: "2026-08-20T17:00:00.000Z",
      ends_at: "2026-08-24T17:00:00.000Z",
      timezone: "America/Phoenix",
      lifecycle: "upcoming",
      pickup_location: "PHX Sky Harbor",
      return_location: "PHX Sky Harbor",
      onboarding_progress: null,
      progress_updated_at: null,
      access_status: "invite_ready",
      provider_identifier: "must-not-escape",
      latitude: 33.4,
      tenant_config: { ...config, car: { ...config.car, sourceVehicleId: null, sourceVehicleUpdatedAt: null } },
    }], error: null });
    const token = "a".repeat(43);

    const snapshot = await loadGuestTripPortal(token);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_onlyevs_trip_invitation", {
      p_public_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(snapshot).toMatchObject({ guestFirstName: "Maya", pickupLocation: "PHX Sky Harbor", accessStatus: "invite_ready" });
    expect(Object.keys(snapshot ?? {}).sort()).toEqual([
      "accessStatus", "companyName", "endsAt", "generatedAt", "guestFirstName", "lifecycle", "pickupLocation",
      "progress", "progressUpdatedAt", "returnLocation", "startsAt", "tenantConfig",
      "storageScope", "timezone", "vehicle",
    ].sort());
    expect(JSON.stringify(snapshot)).not.toContain("must-not-escape");
    expect(JSON.stringify(snapshot)).not.toContain("vehicle-public");
  });

  it("fails closed before querying for a malformed token", async () => {
    await expect(loadGuestTripPortal("short")).resolves.toBeNull();
    expect(createAnonymousClient).not.toHaveBeenCalled();
  });

  it("fails closed when the guest portal provider is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    await expect(loadGuestTripPortal("a".repeat(43))).resolves.toBeNull();
    expect(createAnonymousClient).not.toHaveBeenCalled();
  });
});
