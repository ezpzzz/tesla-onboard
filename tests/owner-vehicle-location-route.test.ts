import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClient = vi.fn();
const fetchVehicleLocationEvidence = vi.fn();
const isWorkspaceLocationEvidenceAllowed = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner/location-evidence-server", () => ({
  fetchVehicleLocationEvidence,
  isWorkspaceLocationEvidenceAllowed,
}));

const { GET } = await import("@/app/api/owner/vehicles/[id]/location/route");

const vehicleId = "00000000-0000-4000-8000-000000000002";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: vehicleId }) } as RouteContext<"/api/owner/vehicles/[id]/location">;

function request(id = vehicleId, qs = `workspaceId=${workspaceId}`) {
  return new NextRequest(`https://evhost.app/api/owner/vehicles/${id}/location?${qs}`);
}

describe("GET /api/owner/vehicles/[id]/location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } } }) },
    });
  });

  it("rejects unauthenticated requests before checking the allowlist", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(isWorkspaceLocationEvidenceAllowed).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before touching the database", async () => {
    const response = await GET(
      request("not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) } as RouteContext<"/api/owner/vehicles/[id]/location">,
    );
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns not_allowlisted without ever calling the evidence fetch — non-allowlisted", async () => {
    isWorkspaceLocationEvidenceAllowed.mockReturnValue(false);
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "not_allowlisted" });
    expect(fetchVehicleLocationEvidence).not.toHaveBeenCalled();
  });

  it("returns 403 denied when the requester is not a workspace member", async () => {
    isWorkspaceLocationEvidenceAllowed.mockReturnValue(true);
    fetchVehicleLocationEvidence.mockResolvedValue({ kind: "denied" });
    const response = await GET(request(), context);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ state: "denied" });
  });

  it("returns an honest absent state with no active/consented trip", async () => {
    isWorkspaceLocationEvidenceAllowed.mockReturnValue(true);
    fetchVehicleLocationEvidence.mockResolvedValue({ kind: "absent" });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "absent" });
  });

  it("returns a decrypt_error state without a 500 or leaked ciphertext", async () => {
    isWorkspaceLocationEvidenceAllowed.mockReturnValue(true);
    fetchVehicleLocationEvidence.mockResolvedValue({ kind: "decrypt_error" });
    const response = await GET(request(), context);
    expect(response.status).not.toBe(500);
    const body = await response.json();
    expect(body).toEqual({ state: "decrypt_error" });
    expect(Object.keys(body)).toEqual(["state"]);
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|stack trace/i);
  });

  it("returns evidence fields on success", async () => {
    isWorkspaceLocationEvidenceAllowed.mockReturnValue(true);
    fetchVehicleLocationEvidence.mockResolvedValue({
      kind: "evidence",
      tripId: "trip-1",
      observedAtMs: 1_755_374_400_000,
      latitude: 33.4,
      longitude: -111.9,
      outOfArea: false,
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      state: "evidence",
      tripId: "trip-1",
      observedAtMs: 1_755_374_400_000,
      latitude: 33.4,
      longitude: -111.9,
      outOfArea: false,
    });
  });
});
