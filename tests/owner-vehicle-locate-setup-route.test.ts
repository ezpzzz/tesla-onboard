import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClient = vi.fn();
const fetchVehicleLocationReading = vi.fn();
const getConfig = vi.fn();
const resolveRegionBase = vi.fn();
const unseal = vi.fn();
const isOwnerAuthConfigured = vi.fn(() => true);

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/tesla-server", () => ({ fetchVehicleLocationReading, getConfig, resolveRegionBase, unseal }));
vi.mock("@/lib/owner-auth", () => ({ isOwnerAuthConfigured }));

const { GET, lastLocateSetupAttemptAt } = await import("@/app/api/owner/vehicles/[id]/locate-setup/route");
const { LOCATE_SETUP_COOLDOWN_MS } = await import("@/lib/owner/telemetry-policy");

const vehicleId = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id: vehicleId }) } as RouteContext<"/api/owner/vehicles/[id]/locate-setup">;

function contextFor(id: string) {
  return { params: Promise.resolve({ id }) } as RouteContext<"/api/owner/vehicles/[id]/locate-setup">;
}

function request(withCookie?: string) {
  const req = new NextRequest(`https://evhost.app/api/owner/vehicles/${vehicleId}/locate-setup`);
  if (withCookie !== undefined) req.cookies.set("rtr_owner_tesla", withCookie);
  return req;
}

/** Table access tracker: fails the test loudly if the route ever touches a
 * table other than onlyevs_vehicles (its one honest read), and records every
 * insert/update call so "never writes location tables" can be asserted. */
function makeSupabase(vehicleRow: unknown, writes: string[]) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } } }) },
    from: vi.fn((table: string) => {
      if (table !== "onlyevs_vehicles") throw new Error(`unexpected table access: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: vehicleRow, error: null }),
          })),
        })),
        insert: vi.fn(() => { writes.push(`insert:${table}`); return { error: null }; }),
        update: vi.fn(() => { writes.push(`update:${table}`); return { eq: vi.fn(() => ({ error: null })) }; }),
      };
    }),
  };
}

describe("GET /api/owner/vehicles/[id]/locate-setup", () => {
  let writes: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    lastLocateSetupAttemptAt.clear();
    isOwnerAuthConfigured.mockReturnValue(true);
    writes = [];
    getConfig.mockReturnValue({
      sessionSecret: "a-session-secret-that-is-at-least-32-bytes-long",
      audience: "https://fleet-api.prd.na.vn.cloud.tesla.com",
    });
    createClient.mockResolvedValue(
      makeSupabase({ id: vehicleId, vin: "5YJ3E1EA0PF000001" }, writes),
    );
  });

  it("rejects unauthenticated requests", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
  });

  it("returns vehicle_not_found for an unknown vehicle without reading Tesla", async () => {
    createClient.mockResolvedValue(makeSupabase(null, writes));
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ state: "vehicle_not_found" });
    expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
  });

  it("returns vin_unknown when the vehicle has no VIN on file", async () => {
    createClient.mockResolvedValue(makeSupabase({ id: vehicleId, vin: null }, writes));
    const response = await GET(request(), context);
    await expect(response.json()).resolves.toEqual({ state: "vin_unknown" });
    expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
  });

  it("reports reconnect_required when no transient Tesla session cookie is present", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "reconnect_required" });
    expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
  });

  it("reports reconnect_required when the sealed session has expired", async () => {
    unseal.mockReturnValue({
      kind: "transient_fleet",
      accessToken: "tok",
      verifiedSubject: "sub",
      expiresAt: Date.now() - 1_000,
    });
    const response = await GET(request("sealed-session"), context);
    await expect(response.json()).resolves.toEqual({ state: "reconnect_required" });
    expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
  });

  it("performs a one-shot read on success and never writes to any table", async () => {
    unseal.mockReturnValue({
      kind: "transient_fleet",
      accessToken: "tok",
      verifiedSubject: "sub",
      expiresAt: Date.now() + 60_000,
    });
    resolveRegionBase.mockResolvedValue("https://fleet-api.prd.na.vn.cloud.tesla.com");
    fetchVehicleLocationReading.mockResolvedValue({ latitude: 33.45, longitude: -111.94 });

    const response = await GET(request("sealed-session"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "reading",
      latitude: 33.45,
      longitude: -111.94,
    });
    expect(fetchVehicleLocationReading).toHaveBeenCalledWith(
      "https://fleet-api.prd.na.vn.cloud.tesla.com",
      "tok",
      "5YJ3E1EA0PF000001",
    );
    expect(writes).toEqual([]);
    // One-shot: the transient session cookie must be consumed regardless of outcome.
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/rtr_owner_tesla=;/);
  });

  it("reports read_failed without throwing (and writes nothing) when the Tesla read fails", async () => {
    unseal.mockReturnValue({
      kind: "transient_fleet",
      accessToken: "tok",
      verifiedSubject: "sub",
      expiresAt: Date.now() + 60_000,
    });
    resolveRegionBase.mockResolvedValue("https://fleet-api.prd.na.vn.cloud.tesla.com");
    fetchVehicleLocationReading.mockResolvedValue(null);

    const response = await GET(request("sealed-session"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "read_failed" });
    expect(writes).toEqual([]);
  });

  it("reports read_failed (never a 500) when the Tesla call throws", async () => {
    unseal.mockReturnValue({
      kind: "transient_fleet",
      accessToken: "tok",
      verifiedSubject: "sub",
      expiresAt: Date.now() + 60_000,
    });
    resolveRegionBase.mockRejectedValue(new Error("network down"));

    const response = await GET(request("sealed-session"), context);

    expect(response.status).not.toBe(500);
    await expect(response.json()).resolves.toEqual({ state: "read_failed" });
    expect(writes).toEqual([]);
  });

  it("reports reconnect_required and never constructs a Supabase client when owner auth is unconfigured (demo mode)", async () => {
    isOwnerAuthConfigured.mockReturnValue(false);
    const response = await GET(request("sealed-session"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "reconnect_required" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
  });

  describe("per-vehicle cooldown", () => {
    beforeEach(() => {
      unseal.mockReturnValue({
        kind: "transient_fleet",
        accessToken: "tok",
        verifiedSubject: "sub",
        expiresAt: Date.now() + 10 * LOCATE_SETUP_COOLDOWN_MS,
      });
      resolveRegionBase.mockResolvedValue("https://fleet-api.prd.na.vn.cloud.tesla.com");
      fetchVehicleLocationReading.mockResolvedValue({ latitude: 33.45, longitude: -111.94 });
    });

    it("rejects a second immediate call for the same vehicle with 429", async () => {
      const first = await GET(request("sealed-session"), context);
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toMatchObject({ state: "reading" });

      const second = await GET(request("sealed-session"), context);
      expect(second.status).toBe(429);
      await expect(second.json()).resolves.toEqual({ state: "rate_limited" });
      // The rate-limited call never touches Tesla again.
      expect(fetchVehicleLocationReading).toHaveBeenCalledTimes(1);
    });

    it("allows a call again once the cooldown has expired", async () => {
      vi.useFakeTimers();
      try {
        const first = await GET(request("sealed-session"), context);
        expect(first.status).toBe(200);

        vi.advanceTimersByTime(LOCATE_SETUP_COOLDOWN_MS + 1);

        const second = await GET(request("sealed-session"), context);
        expect(second.status).toBe(200);
        await expect(second.json()).resolves.toMatchObject({ state: "reading" });
        expect(fetchVehicleLocationReading).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("tracks the cooldown independently per vehicle", async () => {
      const otherVehicleId = "00000000-0000-4000-8000-000000000003";
      createClient.mockResolvedValue(
        makeSupabase({ id: vehicleId, vin: "5YJ3E1EA0PF000001" }, writes),
      );
      const first = await GET(request("sealed-session"), context);
      expect(first.status).toBe(200);

      createClient.mockResolvedValue(
        makeSupabase({ id: otherVehicleId, vin: "5YJ3E1EA0PF000002" }, writes),
      );
      const second = await GET(request("sealed-session"), contextFor(otherVehicleId));
      expect(second.status).toBe(200);
    });
  });

  describe("malformed or missing vehicle id", () => {
    it("returns a clean 4xx for a non-UUID vehicle id", async () => {
      const response = await GET(request("sealed-session"), contextFor("not-a-uuid"));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ state: "vehicle_not_found" });
      expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
    });

    it("returns a clean 4xx for an empty vehicle id", async () => {
      const response = await GET(request("sealed-session"), contextFor(""));
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ state: "vehicle_not_found" });
      expect(fetchVehicleLocationReading).not.toHaveBeenCalled();
    });
  });
});
