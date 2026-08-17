import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createClient = vi.fn();
const credentialKeyringFromEnv = vi.fn(() => ({}));
const decryptCredential = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner/credential-envelope", () => ({ credentialKeyringFromEnv, decryptCredential }));

const {
  isWorkspaceLocationEvidenceAllowed,
  fetchVehicleLocationEvidence,
  haversineMiles,
} = await import("@/lib/owner/location-evidence-server");

const workspaceId = "00000000-0000-4000-8000-000000000001";
const vehicleId = "00000000-0000-4000-8000-000000000002";
const tripId = "00000000-0000-4000-8000-000000000003";
const userId = "00000000-0000-4000-8000-000000000004";

function makeSupabase(opts: {
  rpc?: { data?: unknown; error?: { code?: string } | null };
  trip?: { data?: unknown; error?: unknown };
  vehicle?: { data?: unknown; error?: unknown };
}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpc ?? { data: [], error: null });
  const from = vi.fn((table: string) => {
    if (table === "onlyevs_trips") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(opts.trip ?? { data: null, error: null }),
          })),
        })),
      };
    }
    if (table === "onlyevs_vehicles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue(opts.vehicle ?? { data: null, error: null }),
          })),
        })),
      };
    }
    throw new Error(`unexpected table read: ${table}`);
  });
  return { rpc, from };
}

describe("isWorkspaceLocationEvidenceAllowed", () => {
  const ORIGINAL = process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES;
    else process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES = ORIGINAL;
  });

  it("fails closed when the allowlist env is absent", () => {
    delete process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES;
    expect(isWorkspaceLocationEvidenceAllowed(workspaceId)).toBe(false);
  });

  it("fails closed when the allowlist env is empty", () => {
    process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES = "";
    expect(isWorkspaceLocationEvidenceAllowed(workspaceId)).toBe(false);
  });

  it("allows only listed workspace ids", () => {
    process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES = `other-id, ${workspaceId}`;
    expect(isWorkspaceLocationEvidenceAllowed(workspaceId)).toBe(true);
    expect(isWorkspaceLocationEvidenceAllowed("not-listed")).toBe(false);
  });
});

describe("haversineMiles", () => {
  it("is zero for identical coordinates", () => {
    expect(haversineMiles(33.45, -111.94, 33.45, -111.94)).toBeCloseTo(0, 5);
  });

  it("computes a known distance (Phoenix to Tucson, roughly 110mi)", () => {
    const distance = haversineMiles(33.4484, -112.074, 32.2226, -110.9747);
    expect(distance).toBeGreaterThan(95);
    expect(distance).toBeLessThan(120);
  });
});

describe("fetchVehicleLocationEvidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialKeyringFromEnv.mockReturnValue({});
  });

  it("returns denied when the RPC raises workspace_manager_required (42501) — non-member", async () => {
    createClient.mockResolvedValue(makeSupabase({ rpc: { data: null, error: { code: "42501" } } }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({ kind: "denied" });
  });

  it("returns absent when there is no active/consented trip (no rows, no error)", async () => {
    createClient.mockResolvedValue(makeSupabase({ rpc: { data: [], error: null } }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({ kind: "absent" });
  });

  it("treats other RPC errors as an honest absent, never leaking which precondition failed", async () => {
    createClient.mockResolvedValue(makeSupabase({ rpc: { data: null, error: { code: "XX000" } } }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({ kind: "absent" });
  });

  it("returns decrypt_error, never a leaked exception, when the envelope fails to decrypt", async () => {
    createClient.mockResolvedValue(makeSupabase({
      rpc: {
        data: [{ trip_id: tripId, observed_at: "2026-08-16T20:00:00Z", coordinates_ciphertext: "bad", key_version: 1 }],
        error: null,
      },
      trip: { data: { shop_slug: "desert-ev" }, error: null },
    }));
    decryptCredential.mockImplementation(() => { throw new Error("credential_decryption_failed"); });
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({ kind: "decrypt_error" });
  });

  it("returns decrypt_error when the trip's shop_slug (needed for AAD) cannot be read", async () => {
    createClient.mockResolvedValue(makeSupabase({
      rpc: {
        data: [{ trip_id: tripId, observed_at: "2026-08-16T20:00:00Z", coordinates_ciphertext: "sealed", key_version: 1 }],
        error: null,
      },
      trip: { data: null, error: null },
    }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({ kind: "decrypt_error" });
    expect(decryptCredential).not.toHaveBeenCalled();
  });

  it("returns decrypt_error when decrypted coordinates are malformed", async () => {
    createClient.mockResolvedValue(makeSupabase({
      rpc: {
        data: [{ trip_id: tripId, observed_at: "2026-08-16T20:00:00Z", coordinates_ciphertext: "sealed", key_version: 1 }],
        error: null,
      },
      trip: { data: { shop_slug: "desert-ev" }, error: null },
    }));
    decryptCredential.mockReturnValue("not json");
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({ kind: "decrypt_error" });
  });

  it("returns evidence with outOfArea=null when no home area is configured — unset", async () => {
    createClient.mockResolvedValue(makeSupabase({
      rpc: {
        data: [{ trip_id: tripId, observed_at: "2026-08-16T20:00:00Z", coordinates_ciphertext: "sealed", key_version: 1 }],
        error: null,
      },
      trip: { data: { shop_slug: "desert-ev" }, error: null },
      vehicle: { data: { home_area_center_lat: null, home_area_center_lng: null, home_area_radius_mi: null }, error: null },
    }));
    decryptCredential.mockReturnValue(JSON.stringify({ latitude: 33.4, longitude: -111.9 }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toEqual({
      kind: "evidence",
      tripId,
      observedAtMs: Date.parse("2026-08-16T20:00:00Z"),
      latitude: 33.4,
      longitude: -111.9,
      outOfArea: null,
    });
  });

  it("returns evidence with outOfArea=false when inside the configured home area", async () => {
    createClient.mockResolvedValue(makeSupabase({
      rpc: {
        data: [{ trip_id: tripId, observed_at: "2026-08-16T20:00:00Z", coordinates_ciphertext: "sealed", key_version: 1 }],
        error: null,
      },
      trip: { data: { shop_slug: "desert-ev" }, error: null },
      vehicle: { data: { home_area_center_lat: 33.45, home_area_center_lng: -111.94, home_area_radius_mi: 25 }, error: null },
    }));
    decryptCredential.mockReturnValue(JSON.stringify({ latitude: 33.46, longitude: -111.95 }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toMatchObject({ kind: "evidence", outOfArea: false });
  });

  it("returns evidence with outOfArea=true when outside the configured home area", async () => {
    createClient.mockResolvedValue(makeSupabase({
      rpc: {
        data: [{ trip_id: tripId, observed_at: "2026-08-16T20:00:00Z", coordinates_ciphertext: "sealed", key_version: 1 }],
        error: null,
      },
      trip: { data: { shop_slug: "desert-ev" }, error: null },
      vehicle: { data: { home_area_center_lat: 33.45, home_area_center_lng: -111.94, home_area_radius_mi: 5 }, error: null },
    }));
    decryptCredential.mockReturnValue(JSON.stringify({ latitude: 34.2, longitude: -112.6 }));
    const result = await fetchVehicleLocationEvidence({ workspaceId, vehicleId, requestingUserId: userId });
    expect(result).toMatchObject({ kind: "evidence", outOfArea: true });
  });
});
