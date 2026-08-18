"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "./vehicle-repository";
import type { BucketedVehicleStatsSeries, VehicleStatsHistoryBucket } from "./access-types";

/**
 * Reads for public.onlyevs_vehicle_stats_history.
 *
 * Chart reads MUST always go through the bucketed aggregation RPC
 * (public.get_onlyevs_vehicle_stats_history_buckets) — never a raw select
 * of history rows. The RPC caps every series at <=300 points regardless of
 * the requested range or the 13-month retention depth (Performance Issue 5A,
 * `HISTORY_RETENTION_MS` in telemetry-policy.ts). Fetch lazily on the
 * vehicle details page only; never prefetch fleet-wide in use-owner-data.
 */

interface HistoryBucketRow {
  bucket_at: string;
  battery_pct: number | null;
  estimated_range_mi: number | null;
  odometer_mi: number | null;
  charging_state: string | null;
  locked: boolean | null;
}

export async function fetchVehicleStatsHistoryBuckets(
  scope: VehicleWorkspaceScope,
  vehicleId: string,
  sinceMs: number,
  untilMs: number = Date.now(),
): Promise<BucketedVehicleStatsSeries> {
  const { data, error } = await createClient().rpc("get_onlyevs_vehicle_stats_history_buckets", {
    p_workspace_id: scope.workspaceId,
    p_vehicle_id: vehicleId,
    p_since: new Date(sinceMs).toISOString(),
    p_until: new Date(untilMs).toISOString(),
  });
  if (error) {
    // Pre-migration / not-yet-applied schema: honest empty, matching
    // fetchWorkspaceVehicleStats's fallback in vehicle-stats-repository.ts —
    // never a fabricated series.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { vehicleId, since: sinceMs, until: untilMs, buckets: [] };
    }
    throw new Error(error.message);
  }
  const buckets: VehicleStatsHistoryBucket[] = ((data ?? []) as HistoryBucketRow[]).map((row) => ({
    bucketAt: Date.parse(row.bucket_at),
    batteryPct: row.battery_pct,
    estimatedRangeMi: row.estimated_range_mi,
    odometerMi: row.odometer_mi,
    chargingState: row.charging_state,
    locked: row.locked,
  }));
  return { vehicleId, since: sinceMs, until: untilMs, buckets };
}
