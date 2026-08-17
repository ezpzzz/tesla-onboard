import { describe, expect, it, vi } from "vitest";

type RpcParams = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

let handler: ((params: RpcParams) => RpcResult) | null = null;

const createClient = vi.fn(() => ({
  rpc: (name: string, params: RpcParams) => {
    if (name !== "get_onlyevs_vehicle_stats_history_buckets") {
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    }
    return Promise.resolve(handler ? handler(params) : { data: null, error: { message: "no handler" } });
  },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => createClient() }));

const { fetchVehicleStatsHistoryBuckets } = await import("@/lib/owner/history-repository");

const SCOPE = { workspaceId: "ws-1", shopSlug: "shop-1", key: "ws-1~shop-1" };

describe("fetchVehicleStatsHistoryBuckets", () => {
  it("maps bucket rows into the typed series, passing since/until through as ISO strings", async () => {
    let capturedParams: RpcParams | null = null;
    handler = (params) => {
      capturedParams = params;
      return {
        data: [
          { bucket_at: "2026-08-01T00:00:00Z", battery_pct: 80, estimated_range_mi: 250, odometer_mi: 1000, charging_state: "Complete", locked: true },
        ],
        error: null,
      };
    };
    const since = Date.parse("2026-08-01T00:00:00Z");
    const until = Date.parse("2026-08-02T00:00:00Z");
    const series = await fetchVehicleStatsHistoryBuckets(SCOPE, "veh-1", since, until);

    expect(capturedParams).toMatchObject({
      p_workspace_id: "ws-1",
      p_vehicle_id: "veh-1",
      p_since: new Date(since).toISOString(),
      p_until: new Date(until).toISOString(),
    });
    expect(series.vehicleId).toBe("veh-1");
    expect(series.buckets).toHaveLength(1);
    expect(series.buckets[0]).toMatchObject({ batteryPct: 80, estimatedRangeMi: 250, odometerMi: 1000, chargingState: "Complete", locked: true });
  });

  it("renders an honest empty series (never fabricated) when the table isn't available yet", async () => {
    handler = () => ({ data: null, error: { message: "missing", code: "42P01" } });
    const since = Date.now() - 1000;
    const until = Date.now();
    const series = await fetchVehicleStatsHistoryBuckets(SCOPE, "veh-1", since, until);
    expect(series).toEqual({ vehicleId: "veh-1", since, until, buckets: [] });
  });

  it("throws for an RPC error that isn't the pre-migration missing-schema case", async () => {
    handler = () => ({ data: null, error: { message: "permission denied for function", code: "42501" } });
    const since = Date.now() - 1000;
    const until = Date.now();
    await expect(fetchVehicleStatsHistoryBuckets(SCOPE, "veh-1", since, until)).rejects.toThrow(
      "permission denied for function",
    );
  });
});
