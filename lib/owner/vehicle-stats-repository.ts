"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleStatsCurrent } from "@/lib/owner/access-types";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";

interface StatsRow {
  vehicle_id: string;
  battery_pct: number | null;
  estimated_range_mi: number | null;
  odometer_mi: number | null;
  charging_state: string | null;
  locked: boolean | null;
  battery_observed_at: string | null;
  range_observed_at: string | null;
  odometer_observed_at: string | null;
  charging_observed_at: string | null;
  locked_observed_at: string | null;
  connectivity_observed_at: string | null;
  connectivity: VehicleStatsCurrent["connectivity"];
  observed_at: string | null;
  ingested_at: string;
}

export async function fetchWorkspaceVehicleStats(scope: VehicleWorkspaceScope): Promise<Record<string, VehicleStatsCurrent>> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicle_stats_current")
    .select("vehicle_id,battery_pct,estimated_range_mi,odometer_mi,charging_state,locked,connectivity,battery_observed_at,range_observed_at,odometer_observed_at,charging_observed_at,locked_observed_at,connectivity_observed_at,observed_at,ingested_at")
    .eq("workspace_id", scope.workspaceId);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return {};
    throw new Error(error.message);
  }
  return Object.fromEntries(((data ?? []) as StatsRow[]).map((row) => [row.vehicle_id, {
    vehicleId: row.vehicle_id,
    batteryPct: row.battery_pct,
    estimatedRangeMi: row.estimated_range_mi,
    odometerMi: row.odometer_mi,
    chargingState: row.charging_state,
    locked: row.locked,
    connectivity: row.connectivity,
    fieldObservedAt: {
      battery: row.battery_observed_at ? Date.parse(row.battery_observed_at) : null,
      range: row.range_observed_at ? Date.parse(row.range_observed_at) : null,
      odometer: row.odometer_observed_at ? Date.parse(row.odometer_observed_at) : null,
      charging: row.charging_observed_at ? Date.parse(row.charging_observed_at) : null,
      locked: row.locked_observed_at ? Date.parse(row.locked_observed_at) : null,
      connectivity: row.connectivity_observed_at ? Date.parse(row.connectivity_observed_at) : null,
    },
    observedAt: row.observed_at ? Date.parse(row.observed_at) : null,
    ingestedAt: Date.parse(row.ingested_at),
  }]));
}
