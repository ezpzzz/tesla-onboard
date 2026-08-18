import { describe, expect, it, vi } from "vitest";

type RpcParams = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const rpcHandlers = new Map<string, (params: RpcParams) => RpcResult>();

function fakeSupabaseClient() {
  return {
    rpc: (name: string, params: RpcParams) => {
      const handler = rpcHandlers.get(name);
      if (!handler) return Promise.resolve({ data: null, error: { message: `no handler registered for ${name}` } });
      return Promise.resolve(handler(params));
    },
  };
}

const createClient = vi.fn(() => fakeSupabaseClient());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => createClient() }));

const { fetchWorkspaceOperationalSnapshot, fetchTripBookends, fetchWorkspaceTripBookends } = await import("@/lib/owner/trip-repository");

const SCOPE = { workspaceId: "ws-1", shopSlug: "shop-1", key: "ws-1~shop-1" };

interface TripRowFixture {
  id: string;
  vehicle_id: string;
  guest_name: string;
  guest_email: string;
  status: "confirmed" | "armed" | "active" | "completed" | "cancelled" | "conflict";
  starts_at: string;
  ends_at: string;
}

function tripRow(overrides: Partial<TripRowFixture> & Pick<TripRowFixture, "id" | "status">): TripRowFixture {
  return {
    vehicle_id: "veh-1",
    guest_name: "Sam K.",
    guest_email: "sam@example.com",
    starts_at: "2026-08-01T00:00:00Z",
    ends_at: "2026-08-03T00:00:00Z",
    ...overrides,
  };
}

interface BookendRowFixture {
  trip_id: string;
  edge: "start" | "end";
  odometer_mi: number | null;
  odometer_observed_at: string | null;
  battery_pct: number | null;
  battery_observed_at: string | null;
  captured_at: string;
  stale: boolean;
}

function bookendRow(overrides: Partial<BookendRowFixture> & Pick<BookendRowFixture, "trip_id" | "edge">): BookendRowFixture {
  return {
    odometer_mi: null,
    odometer_observed_at: null,
    battery_pct: null,
    battery_observed_at: null,
    captured_at: "2026-08-01T00:05:00Z",
    stale: false,
    ...overrides,
  };
}

function resetHandlers() {
  rpcHandlers.clear();
}

describe("fetchTripBookends", () => {
  it("maps both edges of a real bookend row set", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_trip_bookends", () => ({
      data: [
        bookendRow({ trip_id: "trip-1", edge: "start", odometer_mi: 1000, odometer_observed_at: "2026-08-01T00:00:00Z", battery_pct: 90 }),
        bookendRow({ trip_id: "trip-1", edge: "end", odometer_mi: 1300, battery_pct: 55, stale: true }),
      ],
      error: null,
    }));
    const bookends = await fetchTripBookends("trip-1");
    expect(bookends).toHaveLength(2);
    expect(bookends[0]).toMatchObject({ edge: "start", odometerMi: 1000, batteryPct: 90, stale: false });
    expect(bookends[1]).toMatchObject({ edge: "end", odometerMi: 1300, batteryPct: 55, stale: true });
  });

  it("returns an honest empty array when the table isn't available yet (pre-migration)", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_trip_bookends", () => ({ data: null, error: { message: "missing", code: "42P01" } }));
    expect(await fetchTripBookends("trip-1")).toEqual([]);
  });
});

describe("fetchWorkspaceTripBookends", () => {
  it("reads every bookend row for the workspace in one call, not one per trip", async () => {
    resetHandlers();
    let calls = 0;
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", (params) => {
      calls += 1;
      expect(params).toEqual({ p_workspace_id: "ws-1", p_shop_slug: "shop-1" });
      return {
        data: [
          bookendRow({ trip_id: "trip-1", edge: "start", odometer_mi: 1000 }),
          bookendRow({ trip_id: "trip-2", edge: "start", odometer_mi: 500 }),
        ],
        error: null,
      };
    });
    const bookends = await fetchWorkspaceTripBookends(SCOPE);
    expect(calls).toBe(1);
    expect(bookends).toHaveLength(2);
  });

  it("returns an honest empty array when the RPC isn't available yet (pre-migration)", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", () => ({ data: null, error: { message: "missing", code: "42P01" } }));
    expect(await fetchWorkspaceTripBookends(SCOPE)).toEqual([]);
  });
});

describe("fetchWorkspaceOperationalSnapshot: bookend join", () => {
  it("keeps the OwnerSnapshot shape unchanged for existing consumers", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_workspace_trip_snapshot", () => ({
      data: [tripRow({ id: "trip-1", status: "completed" })],
      error: null,
    }));
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", () => ({ data: [], error: null }));

    const snapshot = await fetchWorkspaceOperationalSnapshot(SCOPE);

    expect(Object.keys(snapshot).sort()).toEqual(["chargingSessions", "drivers", "trips", "vehicles"]);
    expect(snapshot.chargingSessions).toEqual([]);
    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.drivers).toHaveLength(1);
    expect(snapshot.trips).toHaveLength(1);
    const [trip] = snapshot.trips;
    expect(Object.keys(trip).sort()).toEqual(
      [
        "accessStatus",
        "batteryEndPct",
        "batteryStartPct",
        "chargingSessionIds",
        "driverId",
        "endAt",
        "id",
        "odometerEndMi",
        "odometerStartMi",
        "pickupLocation",
        "reminderLastSentAt",
        "returnLocation",
        "startAt",
        "status",
        "vehicleId",
      ].sort(),
    );
  });

  it("populates odometer/battery start+end from real bookend rows instead of hardcoded nulls", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_workspace_trip_snapshot", () => ({
      data: [tripRow({ id: "trip-1", status: "completed" })],
      error: null,
    }));
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", () => ({
      data: [
        bookendRow({ trip_id: "trip-1", edge: "start", odometer_mi: 1000, battery_pct: 90 }),
        bookendRow({ trip_id: "trip-1", edge: "end", odometer_mi: 1300, battery_pct: 55 }),
      ],
      error: null,
    }));

    const snapshot = await fetchWorkspaceOperationalSnapshot(SCOPE);
    expect(snapshot.trips[0]).toMatchObject({
      odometerStartMi: 1000,
      odometerEndMi: 1300,
      batteryStartPct: 90,
      batteryEndPct: 55,
    });
  });

  it("renders an honest 'not captured' null (never fabricated) for a trip with no bookend rows at all", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_workspace_trip_snapshot", () => ({
      data: [tripRow({ id: "trip-1", status: "confirmed" })],
      error: null,
    }));
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", () => ({ data: [], error: null }));

    const snapshot = await fetchWorkspaceOperationalSnapshot(SCOPE);
    expect(snapshot.trips[0]).toMatchObject({
      odometerStartMi: null,
      odometerEndMi: null,
      batteryStartPct: null,
      batteryEndPct: null,
    });
  });

  it("reads bookends for every trip in exactly one RPC call, not one per trip", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_workspace_trip_snapshot", () => ({
      data: [tripRow({ id: "trip-1", status: "completed" }), tripRow({ id: "trip-2", status: "completed" })],
      error: null,
    }));
    let calls = 0;
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", () => {
      calls += 1;
      return {
        data: [bookendRow({ trip_id: "trip-2", edge: "start", odometer_mi: 500 })],
        error: null,
      };
    });

    const snapshot = await fetchWorkspaceOperationalSnapshot(SCOPE);
    expect(calls).toBe(1);
    expect(snapshot.trips).toHaveLength(2);
    const trip1 = snapshot.trips.find((t) => t.id === "trip-1");
    const trip2 = snapshot.trips.find((t) => t.id === "trip-2");
    expect(trip1?.odometerStartMi).toBeNull();
    expect(trip2?.odometerStartMi).toBe(500);
  });

  it("does not let a bookend read failure break the rest of the snapshot (honest 'not captured' for every trip)", async () => {
    resetHandlers();
    rpcHandlers.set("get_onlyevs_workspace_trip_snapshot", () => ({
      data: [tripRow({ id: "trip-1", status: "completed" }), tripRow({ id: "trip-2", status: "completed" })],
      error: null,
    }));
    rpcHandlers.set("get_onlyevs_workspace_trip_bookends", () => ({
      data: null,
      error: { message: "workspace_manager_required", code: "42501" },
    }));

    const snapshot = await fetchWorkspaceOperationalSnapshot(SCOPE);
    expect(snapshot.trips).toHaveLength(2);
    expect(snapshot.trips.every((t) => t.odometerStartMi === null)).toBe(true);
  });
});
