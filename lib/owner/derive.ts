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

/**
 * Overloaded so every existing (browser) call site — which always passes a
 * real `globalPolicyPct` number, since parseReturnPolicyPct always returns
 * one — keeps getting a non-null `number` back, unchanged. The
 * `number | null` overload exists only for callers that genuinely cannot
 * resolve a fleet-wide fallback: services/onlyevs-worker/index.ts's
 * composeTripEvidencePacket calls this with `null` because the worker's
 * scoped DB role has no readable access to workspace_branding (the
 * tenant-config table the app's own
 * parseReturnPolicyPct(config.rental.returnChargeLevel) reads) — only the
 * vehicle's own return_charge_level_pct override. A vehicle with no
 * override and no reachable global fallback resolves to null there rather
 * than guessing a default percentage.
 */
export function resolveVehiclePolicyPct(
  vehicle: Pick<Vehicle, "returnChargeLevelPct"> | null | undefined,
  globalPolicyPct: number
): number;
export function resolveVehiclePolicyPct(
  vehicle: Pick<Vehicle, "returnChargeLevelPct"> | null | undefined,
  globalPolicyPct: number | null
): number | null;
export function resolveVehiclePolicyPct(
  vehicle: Pick<Vehicle, "returnChargeLevelPct"> | null | undefined,
  globalPolicyPct: number | null
): number | null {
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

// --- Phase 3: windowed trip rollups (odometer/battery vs. bookends) -------
//
// Additive to the tripMiles/vehicleStats functions above (unchanged — CRITICAL
// regression coverage keeps their existing signatures/behavior locked). This
// is the honest-partial-data cousin: the ledger, active-trip card, and
// evidence packets all need to render start-only/end-only/absent bookend
// combinations without guessing, and an odometer regression (end < start,
// e.g. a bad manual entry) must render as a data-error state rather than a
// negative mile count.

export type OdometerRollupState =
  | { kind: "complete"; milesDriven: number }
  | { kind: "start-only" }
  | { kind: "end-only" }
  | { kind: "none" }
  | { kind: "data-error"; reason: "odometer-regression" };

export interface TripRollupInput {
  odometerStartMi: number | null;
  odometerEndMi: number | null;
  batteryStartPct: number | null;
  batteryEndPct: number | null;
  /** Optional policy context, so the same call site can also render
   * "miles over allowance" / "below return policy" without a second pass. */
  milesAllowance?: number | null;
  policyPct?: number | null;
}

export interface TripWindowRollup {
  odometer: OdometerRollupState;
  /** null unless odometer is `complete` and an allowance was supplied. */
  milesOverAllowance: number | null;
  /** null unless both battery readings are present. */
  batteryDeltaPct: number | null;
  /** null unless the end battery reading and a policy pct are both present. */
  batteryBelowPolicy: boolean | null;
}

/** Windowed delta derivation shared by the ledger, the active-trip card, and
 * evidence packets. Full/start-only/end-only/absent bookend combinations
 * each render an honest partial result, never a guessed one; an odometer
 * regression renders `data-error`, never negative miles. */
export function tripWindowRollup(input: TripRollupInput): TripWindowRollup {
  const { odometerStartMi, odometerEndMi, batteryStartPct, batteryEndPct, milesAllowance, policyPct } = input;

  let odometer: OdometerRollupState;
  if (odometerStartMi !== null && odometerEndMi !== null) {
    odometer = odometerEndMi < odometerStartMi
      ? { kind: "data-error", reason: "odometer-regression" }
      : { kind: "complete", milesDriven: odometerEndMi - odometerStartMi };
  } else if (odometerStartMi !== null) {
    odometer = { kind: "start-only" };
  } else if (odometerEndMi !== null) {
    odometer = { kind: "end-only" };
  } else {
    odometer = { kind: "none" };
  }

  const milesOverAllowance =
    odometer.kind === "complete" && milesAllowance != null
      ? Math.max(0, odometer.milesDriven - milesAllowance)
      : null;

  const batteryDeltaPct =
    batteryStartPct !== null && batteryEndPct !== null ? batteryEndPct - batteryStartPct : null;

  const batteryBelowPolicy =
    batteryEndPct !== null && policyPct != null ? batteryEndPct < policyPct : null;

  return { odometer, milesOverAllowance, batteryDeltaPct, batteryBelowPolicy };
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
