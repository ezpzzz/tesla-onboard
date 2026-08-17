/**
 * Pure derivations over an OwnerSnapshot — status classification, fleet-wide
 * stats, and small formatters. Nothing here touches localStorage or the
 * network; everything takes its inputs as arguments so it's trivially
 * testable and safe to call during render.
 */

import type {
  ChargingSession,
  Driver,
  DriverStatus,
  FleetStats,
  OwnerSnapshot,
  Trip,
  TripStatus,
  Vehicle,
  VehicleStats,
} from "./types";
import type { OwnerState } from "./owner-state";

export const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function driverStatus(driver: Driver, now: number): DriverStatus {
  const progress = driver.progress;
  if (!progress || (progress.pct === 0 && progress.completed.length === 0)) {
    return "not-started";
  }
  if (progress.isDone) return "ready";
  return now - progress.updatedAt > STALL_THRESHOLD_MS ? "stalled" : "in-progress";
}

export function tripMiles(trip: Trip): number | null {
  if (trip.odometerStartMi === null || trip.odometerEndMi === null) return null;
  return trip.odometerEndMi - trip.odometerStartMi;
}

export function sessionsForTrip(sessions: ChargingSession[], tripId: string): ChargingSession[] {
  return sessions.filter((s) => s.tripId === tripId);
}

export function tripEnergy(sessions: ChargingSession[]): {
  kWh: number;
  costUsd: number;
  superchargerCostUsd: number;
} {
  let kWh = 0;
  let costUsd = 0;
  let superchargerCostUsd = 0;
  for (const s of sessions) {
    kWh += s.kWhAdded;
    costUsd += s.costUsd;
    if (s.isSupercharger) superchargerCostUsd += s.costUsd;
  }
  return { kWh, costUsd, superchargerCostUsd };
}

/** First integer found in the tenant return-charge policy; fallback 80. */
export function parseReturnPolicyPct(text: string): number {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : 80;
}

/** A vehicle's own return-charge override, falling back to the fleet-wide
 * policy when it has none set. */
/** Same states `cancel_onlyevs_trip` accepts server-side (`confirmed`,
 * `armed`, `active` map to owner-visible `upcoming`/`active`) -- pulled out
 * as a pure function so the "Cancel trip" action's visibility is unit
 * testable without a React render harness. */
export function isTripCancellable(status: TripStatus): boolean {
  return status === "upcoming" || status === "active";
}

export function resolveVehiclePolicyPct(
  vehicle: Vehicle | null | undefined,
  globalPolicyPct: number
): number {
  return vehicle?.returnChargeLevelPct ?? globalPolicyPct;
}

export function fleetStats(snapshot: OwnerSnapshot, policyPct: number): FleetStats {
  const tripCounts: Record<TripStatus, number> = { upcoming: 0, active: 0, completed: 0, cancelled: 0 };
  let totalMilesRented = 0;
  let totalEnergyCostUsd = 0;
  let totalSuperchargingCostUsd = 0;
  let returnChargeSum = 0;
  let returnChargeCount = 0;
  let tripsBelowPolicy = 0;

  for (const trip of snapshot.trips) {
    tripCounts[trip.status] += 1;

    const miles = tripMiles(trip);
    if (miles !== null) totalMilesRented += miles;

    const sessions = sessionsForTrip(snapshot.chargingSessions, trip.id);
    const energy = tripEnergy(sessions);
    totalEnergyCostUsd += energy.costUsd;
    totalSuperchargingCostUsd += energy.superchargerCostUsd;

    if (trip.status === "completed" && trip.batteryEndPct !== null) {
      returnChargeSum += trip.batteryEndPct;
      returnChargeCount += 1;
      const vehicle = snapshot.vehicles.find((v) => v.id === trip.vehicleId);
      const effectivePolicyPct = resolveVehiclePolicyPct(vehicle, policyPct);
      if (trip.batteryEndPct < effectivePolicyPct) tripsBelowPolicy += 1;
    }
  }

  return {
    totalMilesRented,
    totalEnergyCostUsd,
    totalSuperchargingCostUsd,
    avgReturnChargePct: returnChargeCount > 0 ? returnChargeSum / returnChargeCount : null,
    tripsBelowPolicy,
    tripCounts,
  };
}

/** Per-vehicle rollup — same building blocks as fleetStats (tripMiles,
 * sessionsForTrip, tripEnergy), scoped to one vehicle's trips. */
export function vehicleStats(
  vehicleId: string,
  trips: Trip[],
  sessions: ChargingSession[]
): VehicleStats {
  const vehicleTrips = trips.filter((t) => t.vehicleId === vehicleId);
  let milesRented = 0;
  let energyCostUsd = 0;
  let returnChargeSum = 0;
  let returnChargeCount = 0;

  for (const trip of vehicleTrips) {
    const miles = tripMiles(trip);
    if (miles !== null) milesRented += miles;

    energyCostUsd += tripEnergy(sessionsForTrip(sessions, trip.id)).costUsd;

    if (trip.status === "completed" && trip.batteryEndPct !== null) {
      returnChargeSum += trip.batteryEndPct;
      returnChargeCount += 1;
    }
  }

  return {
    vehicleId,
    tripCount: vehicleTrips.length,
    milesRented,
    energyCostUsd,
    avgReturnChargePct: returnChargeCount > 0 ? returnChargeSum / returnChargeCount : null,
  };
}

/** Owner-side return-checklist completion score. `total` is 4 — notes excluded. */
export function ownerChecklistScore(
  state: OwnerState,
  tripId: string
): { done: number; total: number } {
  const c = state.tripChecklists[tripId];
  if (!c) return { done: 0, total: 4 };
  const done = [c.chargedToPolicy, c.keysReturned, c.cleaned, c.noDamage].filter(Boolean).length;
  return { done, total: 4 };
}

export function formatMiles(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} mi`;
}

export function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}
