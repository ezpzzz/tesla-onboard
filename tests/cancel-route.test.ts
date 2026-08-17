import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ownerRpc = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { POST } = await import("@/app/api/owner/trips/[id]/cancel/route");
const tripId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: tripId }) } as RouteContext<"/api/owner/trips/[id]/cancel">;

function request(body: unknown = {}, origin = "https://evhost.app") {
  return new NextRequest(`https://evhost.app/api/owner/trips/${tripId}/cancel`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("owner trip cancellation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } } }) },
      rpc: ownerRpc,
    });
    ownerRpc.mockResolvedValue({ data: { id: tripId, status: "cancelled" }, error: null });
  });

  it("rejects cross-origin cancellation before touching the session", async () => {
    const response = await POST(request({}, "https://attacker.example"), context);
    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed trip id without a database round trip", async () => {
    const badContext = { params: Promise.resolve({ id: "not-a-uuid" }) } as RouteContext<"/api/owner/trips/[id]/cancel">;
    const response = await POST(request(), badContext);
    expect(response.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires an owner session", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: ownerRpc,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(401);
    expect(ownerRpc).not.toHaveBeenCalled();
  });

  it("cancels the trip and passes a trimmed reason through to the RPC", async () => {
    const response = await POST(request({ reason: "  guest requested  " }), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(ownerRpc).toHaveBeenCalledWith("cancel_onlyevs_trip", {
      p_trip_id: tripId,
      p_reason: "guest requested",
    });
  });

  it("omits an empty reason", async () => {
    await POST(request({ reason: "   " }), context);
    expect(ownerRpc).toHaveBeenCalledWith("cancel_onlyevs_trip", { p_trip_id: tripId, p_reason: null });
  });

  it("maps trip_not_found to 404", async () => {
    ownerRpc.mockResolvedValue({ data: null, error: { message: "trip_not_found" } });
    const response = await POST(request(), context);
    expect(response.status).toBe(404);
  });

  it("maps workspace_manager_required to 403", async () => {
    ownerRpc.mockResolvedValue({ data: null, error: { message: "workspace_manager_required" } });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
  });

  it("maps trip_not_cancellable to 409", async () => {
    ownerRpc.mockResolvedValue({ data: null, error: { message: "trip_not_cancellable" } });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
  });

  it("rejects an oversized cancellation reason before calling the database", async () => {
    const response = await POST(request({ reason: "x".repeat(1001) }), context);
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });
});
