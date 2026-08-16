import { afterEach, describe, expect, it, vi } from "vitest";
import { abortEmailRevocation, buildPrefilledCreateTripHref, deriveAppliedCandidateTrip } from "@/lib/owner/email-actions-repository";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";

describe("buildPrefilledCreateTripHref", () => {
  it("encodes every present fact into the frozen query-param shape", () => {
    const href = buildPrefilledCreateTripHref({
      guestName: "Taylor Reyes",
      guestEmail: "taylor@example.com",
      vehicleId: "00000000-0000-4000-8000-000000000001",
      startsAt: "2026-09-15T18:00:00.000Z",
      endsAt: "2026-09-21T18:00:00.000Z",
    });
    const [path, rest] = href.split("#");
    expect(rest).toBe("new-guest");
    const params = new URLSearchParams(path.replace("/owner?", ""));
    expect(params.get("guestName")).toBe("Taylor Reyes");
    expect(params.get("guestEmail")).toBe("taylor@example.com");
    expect(params.get("vehicleId")).toBe("00000000-0000-4000-8000-000000000001");
    expect(params.get("startsAt")).toBe("2026-09-15T18:00:00.000Z");
    expect(params.get("endsAt")).toBe("2026-09-21T18:00:00.000Z");
  });

  it("omits missing or blank facts instead of emitting empty params", () => {
    const href = buildPrefilledCreateTripHref({ guestName: "Taylor Reyes", guestEmail: "  ", vehicleId: null });
    expect(href).toBe("/owner?guestName=Taylor+Reyes#new-guest");
  });

  it("falls back to a bare anchor link when no facts are present", () => {
    expect(buildPrefilledCreateTripHref({})).toBe("/owner#new-guest");
  });

  it("trims whitespace around each fact before encoding", () => {
    const href = buildPrefilledCreateTripHref({ guestName: "  Taylor Reyes  " });
    expect(href).toBe("/owner?guestName=Taylor+Reyes#new-guest");
  });
});

describe("deriveAppliedCandidateTrip", () => {
  const trip = {
    id: "00000000-0000-4000-8000-000000000002",
    guest_name: "Taylor Reyes",
    guest_email: "taylor@example.com",
    starts_at: "2026-09-15T18:00:00.000Z",
    ends_at: "2026-09-21T18:00:00.000Z",
    status: "confirmed",
  };

  it("resolves the trip summary once the candidate is applied and points at it", () => {
    const result = deriveAppliedCandidateTrip({ state: "applied", effective_trip_id: trip.id }, trip);
    expect(result).toEqual({
      tripId: trip.id,
      guestName: "Taylor Reyes",
      guestEmail: "taylor@example.com",
      startAt: Date.parse(trip.starts_at),
      endAt: Date.parse(trip.ends_at),
      status: "confirmed",
    });
  });

  it("resolves to null while the candidate is still mid-flight", () => {
    expect(deriveAppliedCandidateTrip({ state: "applying", effective_trip_id: trip.id }, trip)).toBeNull();
  });

  it("resolves to null when the candidate carries no effective_trip_id yet", () => {
    expect(deriveAppliedCandidateTrip({ state: "applied", effective_trip_id: null }, trip)).toBeNull();
  });

  it("resolves to null when the linked trip row cannot be found", () => {
    expect(deriveAppliedCandidateTrip({ state: "applied", effective_trip_id: trip.id }, null)).toBeNull();
  });

  it("resolves to null rather than a mismatched trip if the ids disagree", () => {
    expect(deriveAppliedCandidateTrip({ state: "applied", effective_trip_id: "other-id" }, trip)).toBeNull();
  });

  it("resolves to null for a dismissed or superseded candidate even with a stale effective_trip_id", () => {
    expect(deriveAppliedCandidateTrip({ state: "dismissed", effective_trip_id: trip.id }, trip)).toBeNull();
    expect(deriveAppliedCandidateTrip({ state: "superseded", effective_trip_id: trip.id }, trip)).toBeNull();
  });

  it("resolves to null when there is no candidate at all", () => {
    expect(deriveAppliedCandidateTrip(null, trip)).toBeNull();
  });
});

describe("abortEmailRevocation", () => {
  const scope: VehicleWorkspaceScope = { workspaceId: "workspace-id", shopSlug: "desert-ev", key: "workspace-id~desert-ev" };
  const actionId = "00000000-0000-4000-8000-000000000030";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("goes through the dedicated abort-revocation route, not a direct RPC call", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ aborted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await abortEmailRevocation(scope, actionId, 3, "Guest confirmed by phone; keep the original trip.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/owner/email-actions/${actionId}/abort-revocation`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      workspaceId: "workspace-id",
      shopSlug: "desert-ev",
      expectedRevision: 3,
      reason: "Guest confirmed by phone; keep the original trip.",
    });
  });

  it("surfaces the route's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "This revocation can no longer be aborted." }), { status: 409 })));

    await expect(abortEmailRevocation(scope, actionId, 3, "reason")).rejects.toThrow("This revocation can no longer be aborted.");
  });
});
