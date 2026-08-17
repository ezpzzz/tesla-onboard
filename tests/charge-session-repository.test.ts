import { describe, expect, it, vi } from "vitest";

interface FakeResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const routeHandlers = new Map<string, () => FakeResult>();
const rpcHandlers = new Map<string, (params: Record<string, unknown>) => FakeResult>();

function makeQueryBuilder(result: FakeResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    order: () => builder,
    maybeSingle: () => Promise.resolve(result),
    insert: () => Promise.resolve(result),
    then: (resolve: (value: FakeResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function route(table: string, handler: () => FakeResult) {
  routeHandlers.set(table, handler);
}

/** Registers a fake handler for a `.rpc(fnName, params)` call — used by the
 * fetchWorkspaceChargeSessions tests below to stand in for
 * public.get_onlyevs_charge_sessions without a live database. */
function routeRpc(fnName: string, handler: (params: Record<string, unknown>) => FakeResult) {
  rpcHandlers.set(fnName, handler);
}

function resetRoutes() {
  routeHandlers.clear();
  rpcHandlers.clear();
}

const createClient = vi.fn(() => ({
  from: (table: string) => {
    const handler = routeHandlers.get(table);
    return makeQueryBuilder(handler ? handler() : { data: [], error: null });
  },
  rpc: (fnName: string, params: Record<string, unknown>) => {
    const handler = rpcHandlers.get(fnName);
    return Promise.resolve(handler ? handler(params) : { data: [], error: null });
  },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => createClient() }));

const {
  fetchVehicleStatsHistoryRaw,
  fetchHomeChargeRatePerKwh,
  fetchWorkspaceChargingInvoices,
  fetchWorkspaceChargeSessions,
  fetchVehicleBatteryCapacitiesKwh,
  fetchWorkspaceManualChargeCostOverrides,
  saveManualChargeCostOverride,
} = await import("@/lib/owner/charge-session-repository");

const SCOPE = { workspaceId: "ws-1", shopSlug: "shop-1", key: "ws-1~shop-1" };

describe("fetchVehicleStatsHistoryRaw", () => {
  it("maps history rows into the typed points", async () => {
    resetRoutes();
    route("onlyevs_vehicle_stats_history", () => ({
      data: [{
        vehicle_id: "veh-1", observed_at: "2026-08-15T10:00:00Z", battery_pct: 80,
        estimated_range_mi: 250, odometer_mi: 1000, charging_state: "Charging", locked: false,
      }],
      error: null,
    }));
    const points = await fetchVehicleStatsHistoryRaw(SCOPE, Date.now() - 1000);
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ vehicleId: "veh-1", batteryPct: 80, chargingState: "Charging" });
  });

  it("returns an honest empty array when the table isn't available yet", async () => {
    resetRoutes();
    route("onlyevs_vehicle_stats_history", () => ({ data: null, error: { message: "missing", code: "42P01" } }));
    expect(await fetchVehicleStatsHistoryRaw(SCOPE, Date.now())).toEqual([]);
  });

  it("throws on an unexpected error (not swallowed as empty)", async () => {
    resetRoutes();
    route("onlyevs_vehicle_stats_history", () => ({ data: null, error: { message: "permission denied", code: "42501" } }));
    await expect(fetchVehicleStatsHistoryRaw(SCOPE, Date.now())).rejects.toThrow("permission denied");
  });
});

describe("fetchHomeChargeRatePerKwh", () => {
  it("returns the configured rate", async () => {
    resetRoutes();
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: 0.18 }, error: null }));
    expect(await fetchHomeChargeRatePerKwh(SCOPE)).toBe(0.18);
  });

  it("returns null when unset", async () => {
    resetRoutes();
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: null }, error: null }));
    expect(await fetchHomeChargeRatePerKwh(SCOPE)).toBeNull();
  });

  it("returns null (never throws) when the column doesn't exist yet", async () => {
    resetRoutes();
    route("workspace_branding", () => ({ data: null, error: { message: "missing", code: "42703" } }));
    expect(await fetchHomeChargeRatePerKwh(SCOPE)).toBeNull();
  });
});

describe("fetchWorkspaceChargingInvoices", () => {
  it("maps invoice rows into the typed shape", async () => {
    resetRoutes();
    route("onlyevs_charging_invoices", () => ({
      data: [{
        provider_invoice_id: "inv-1", vehicle_id: "veh-1",
        started_at: "2026-08-15T10:00:00Z", ended_at: "2026-08-15T10:45:00Z",
        kwh_added: 22.5, cost_usd: 8.1,
      }],
      error: null,
    }));
    const invoices = await fetchWorkspaceChargingInvoices(SCOPE, Date.now() - 1000);
    expect(invoices).toEqual([{
      providerInvoiceId: "inv-1", vehicleId: "veh-1",
      startedAtMs: Date.parse("2026-08-15T10:00:00Z"), endedAtMs: Date.parse("2026-08-15T10:45:00Z"),
      kWhAdded: 22.5, costUsd: 8.1,
    }]);
  });

  it("returns an honest empty array pre-migration", async () => {
    resetRoutes();
    route("onlyevs_charging_invoices", () => ({ data: null, error: { message: "missing", code: "42P01" } }));
    expect(await fetchWorkspaceChargingInvoices(SCOPE, Date.now())).toEqual([]);
  });
});

describe("fetchVehicleBatteryCapacitiesKwh", () => {
  it("maps vehicle rows into a capacity-by-id map, excluding null/zero capacities", async () => {
    resetRoutes();
    route("onlyevs_vehicles", () => ({
      data: [
        { id: "veh-1", battery_capacity_kwh: 75 },
        { id: "veh-2", battery_capacity_kwh: null },
        { id: "veh-3", battery_capacity_kwh: 0 },
      ],
      error: null,
    }));
    const capacities = await fetchVehicleBatteryCapacitiesKwh(SCOPE);
    expect(capacities.get("veh-1")).toBe(75);
    expect(capacities.has("veh-2")).toBe(false);
    expect(capacities.has("veh-3")).toBe(false);
  });

  it("returns an honest empty map when the column doesn't exist yet", async () => {
    resetRoutes();
    route("onlyevs_vehicles", () => ({ data: null, error: { message: "missing", code: "42703" } }));
    expect((await fetchVehicleBatteryCapacitiesKwh(SCOPE)).size).toBe(0);
  });
});

describe("fetchWorkspaceManualChargeCostOverrides", () => {
  it("keeps only the latest entry per (vehicle, session start) by created_at", async () => {
    resetRoutes();
    route("onlyevs_manual_charge_cost_entries", () => ({
      data: [
        { vehicle_id: "veh-1", session_started_at: "2026-08-15T10:10:00Z", cost_usd: 10, created_at: "2026-08-15T12:00:00Z" },
        { vehicle_id: "veh-1", session_started_at: "2026-08-15T10:10:00Z", cost_usd: 25, created_at: "2026-08-16T00:00:00Z" },
      ],
      error: null,
    }));
    const overrides = await fetchWorkspaceManualChargeCostOverrides(SCOPE, Date.now() - 1000);
    expect(overrides).toEqual([{
      sessionId: `veh-1:${Date.parse("2026-08-15T10:10:00Z")}`,
      costUsd: 25,
      enteredBy: "owner",
    }]);
  });

  it("returns an honest empty array pre-migration", async () => {
    resetRoutes();
    route("onlyevs_manual_charge_cost_entries", () => ({ data: null, error: { message: "missing", code: "42P01" } }));
    expect(await fetchWorkspaceManualChargeCostOverrides(SCOPE, Date.now())).toEqual([]);
  });
});

describe("saveManualChargeCostOverride", () => {
  it("resolves without throwing on a successful insert", async () => {
    resetRoutes();
    route("onlyevs_manual_charge_cost_entries", () => ({ data: null, error: null }));
    await expect(saveManualChargeCostOverride(SCOPE, {
      vehicleId: "veh-1", tripId: "trip-1", sessionStartedAtMs: Date.now(), costUsd: 12.5,
    })).resolves.toBeUndefined();
  });

  it("throws on a write failure rather than silently discarding the correction", async () => {
    resetRoutes();
    route("onlyevs_manual_charge_cost_entries", () => ({ data: null, error: { message: "permission denied" } }));
    await expect(saveManualChargeCostOverride(SCOPE, {
      vehicleId: "veh-1", tripId: null, sessionStartedAtMs: Date.now(), costUsd: 12.5,
    })).rejects.toThrow("permission denied");
  });
});

describe("fetchWorkspaceChargeSessions", () => {
  // D2 remediation: segmentation happens server-side via the
  // get_onlyevs_charge_sessions RPC now, so these tests stand in a
  // pre-segmented RPC row directly (routeRpc) instead of raw
  // onlyevs_vehicle_stats_history rows + a client-side segmentChargeSessions
  // call. What's still exercised here, unchanged: pricing at the configured
  // rate, invoice reconciliation, and manual-override precedence.
  it("returns an empty array with no trips (nothing to derive against, no query issued)", async () => {
    resetRoutes();
    expect(await fetchWorkspaceChargeSessions(SCOPE, [])).toEqual([]);
  });

  it("leaves an RPC-segmented session kWh-only unpriced when the RPC reports no capacity/rate on file (honest absence, not a guess)", async () => {
    resetRoutes();
    const tripStart = Date.parse("2026-08-15T10:00:00Z");
    const tripEnd = Date.parse("2026-08-15T12:00:00Z");
    routeRpc("get_onlyevs_charge_sessions", () => ({
      data: [{
        vehicle_id: "veh-1", trip_id: "trip-1",
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        kwh_added: null, gap_affected: false, kind: "ac_home",
      }],
      error: null,
    }));
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: 0.20 }, error: null }));
    route("onlyevs_charging_invoices", () => ({ data: [], error: null }));
    // No route registered for onlyevs_manual_charge_cost_entries -> the
    // shared default { data: [], error: null } applies, i.e. no manual
    // corrections.

    const sessions = await fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: tripStart, endAt: tripEnd },
    ]);

    expect(sessions).toHaveLength(1);
    // The RPC reported kwh_added: null (no battery capacity on file server-
    // side), so kWhAdded is an honest unknown (NaN sentinel) rather than a
    // fabricated 0 -- and with an unknown kWh, reconcileHomeRateCost
    // correctly leaves the session entirely unpriced (never 0 x rate = 0,
    // which would look like a real "no cost" measurement instead of
    // "nothing to price").
    expect(sessions[0].tripId).toBe("trip-1");
    expect(sessions[0].vehicleId).toBe("veh-1");
    expect(sessions[0].kind).toBe("ac_home");
    expect(Number.isNaN(sessions[0].kWhAdded)).toBe(true);
    expect(sessions[0].costUsd).toBeNull();
    expect(sessions[0].costProvenance).toBeNull();
  });

  it("prices an RPC-segmented session's kWh at the configured rate when the RPC reports a battery-delta estimate", async () => {
    resetRoutes();
    const tripStart = Date.parse("2026-08-15T10:00:00Z");
    const tripEnd = Date.parse("2026-08-15T12:00:00Z");
    routeRpc("get_onlyevs_charge_sessions", () => ({
      data: [{
        vehicle_id: "veh-1", trip_id: "trip-1",
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        // The RPC already computed this server-side from the vehicle's own
        // battery_capacity_kwh -- this repository trusts it, it doesn't
        // re-derive it (that math is covered by the migration's own SQL
        // validation, not re-tested here).
        kwh_added: 24, gap_affected: false, kind: "ac_home",
      }],
      error: null,
    }));
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: 0.20 }, error: null }));
    route("onlyevs_charging_invoices", () => ({ data: [], error: null }));

    const sessions = await fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: tripStart, endAt: tripEnd },
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].kWhAdded).toBeCloseTo(24, 5);
    expect(sessions[0].costProvenance).toBe("rate");
    expect(sessions[0].costUsd).toBeCloseTo(4.8, 5);
  });

  it("applies a persisted manual override last, overriding an invoice-priced session (manual > invoice > rate)", async () => {
    resetRoutes();
    const tripStart = Date.parse("2026-08-15T10:00:00Z");
    const tripEnd = Date.parse("2026-08-15T12:00:00Z");
    routeRpc("get_onlyevs_charge_sessions", () => ({
      data: [{
        vehicle_id: "veh-1", trip_id: "trip-1",
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        kwh_added: null, gap_affected: false, kind: "ac_home",
      }],
      error: null,
    }));
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: null }, error: null }));
    route("onlyevs_charging_invoices", () => ({
      data: [{
        provider_invoice_id: "inv-1", vehicle_id: "veh-1",
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        kwh_added: 30, cost_usd: 12,
      }],
      error: null,
    }));
    route("onlyevs_manual_charge_cost_entries", () => ({
      data: [{
        vehicle_id: "veh-1",
        session_started_at: "2026-08-15T10:10:00Z",
        cost_usd: 20,
        created_at: "2026-08-16T00:00:00Z",
      }],
      error: null,
    }));

    const sessions = await fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: tripStart, endAt: tripEnd },
    ]);

    expect(sessions).toHaveLength(1);
    // The invoice would have priced this at $12/kind dc_fast; the manual
    // entry wins on cost/provenance but the invoice-sourced kind/kWh stand.
    expect(sessions[0]).toMatchObject({ kind: "dc_fast", kWhAdded: 30, costUsd: 20, costProvenance: "manual" });
  });

  it("reconciles a synced invoice onto the overlapping session, promoting it to dc_fast", async () => {
    resetRoutes();
    const tripStart = Date.parse("2026-08-15T10:00:00Z");
    const tripEnd = Date.parse("2026-08-15T12:00:00Z");
    routeRpc("get_onlyevs_charge_sessions", () => ({
      data: [{
        vehicle_id: "veh-1", trip_id: "trip-1",
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        kwh_added: null, gap_affected: false, kind: "ac_home",
      }],
      error: null,
    }));
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: null }, error: null }));
    route("onlyevs_charging_invoices", () => ({
      data: [{
        provider_invoice_id: "inv-1", vehicle_id: "veh-1",
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        kwh_added: 30, cost_usd: 12,
      }],
      error: null,
    }));

    const sessions = await fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: tripStart, endAt: tripEnd },
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: "dc_fast", costProvenance: "invoice", costUsd: 12, kWhAdded: 30 });
  });

  it("a gap_affected session from the RPC round-trips that flag unchanged", async () => {
    resetRoutes();
    const tripStart = Date.parse("2026-08-15T10:00:00Z");
    const tripEnd = Date.parse("2026-08-15T12:00:00Z");
    routeRpc("get_onlyevs_charge_sessions", () => ({
      data: [{
        vehicle_id: "veh-1", trip_id: null,
        started_at: "2026-08-15T10:10:00Z", ended_at: "2026-08-15T10:40:00Z",
        kwh_added: null, gap_affected: true, kind: "ac_home",
      }],
      error: null,
    }));
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: null }, error: null }));
    route("onlyevs_charging_invoices", () => ({ data: [], error: null }));

    const sessions = await fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: tripStart, endAt: tripEnd },
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].gapAffected).toBe(true);
    expect(sessions[0].tripId).toBeNull();
  });

  it("a segmentation RPC failure never throws (falls back to empty for that call, no crash)", async () => {
    resetRoutes();
    routeRpc("get_onlyevs_charge_sessions", () => ({ data: null, error: { message: "permission denied", code: "42501" } }));
    await expect(fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: Date.now() - 1000, endAt: Date.now() },
    ])).rejects.toThrow();
    // Callers (use-owner-data.ts) are the layer responsible for catching
    // this and falling back to []; this repository function itself is
    // honest about a real read failure rather than silently hiding it.
  });

  it("returns an honest empty array when the RPC isn't applied yet (pre-migration schema)", async () => {
    resetRoutes();
    routeRpc("get_onlyevs_charge_sessions", () => ({ data: null, error: { message: "missing", code: "PGRST205" } }));
    route("workspace_branding", () => ({ data: { home_charge_rate_usd_per_kwh: null }, error: null }));
    route("onlyevs_charging_invoices", () => ({ data: [], error: null }));
    const sessions = await fetchWorkspaceChargeSessions(SCOPE, [
      { id: "trip-1", vehicleId: "veh-1", startAt: Date.now() - 1000, endAt: Date.now() },
    ]);
    expect(sessions).toEqual([]);
  });
});
