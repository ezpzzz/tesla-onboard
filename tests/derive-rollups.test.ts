import { describe, expect, it } from "vitest";
import {
  fleetStats,
  tripEnergy,
  tripMiles,
  tripWindowRollup,
  vehicleStats,
} from "@/lib/owner/derive";
import type { ChargingSession, OwnerSnapshot, Trip, Vehicle } from "@/lib/owner/types";

function trip(overrides: Partial<Trip> & Pick<Trip, "id" | "vehicleId" | "status">): Trip {
  return {
    driverId: null,
    startAt: 0,
    endAt: 0,
    pickupLocation: null,
    returnLocation: null,
    accessStatus: null,
    reminderLastSentAt: null,
    odometerStartMi: null,
    odometerEndMi: null,
    batteryStartPct: null,
    batteryEndPct: null,
    chargingSessionIds: [],
    ...overrides,
  };
}

function vehicle(overrides: Partial<Vehicle> & Pick<Vehicle, "id">): Vehicle {
  return {
    guestSourceId: `src-${overrides.id}`,
    displayName: "Model 3",
    model: "Model 3",
    trim: "Long Range",
    year: 2024,
    color: "White",
    shifter: "stalk",
    licensePlate: null,
    vin: null,
    returnChargeLevelPct: null,
    notes: "",
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// --- CRITICAL regressions (T6): these functions must keep working exactly
// as before once real bookend/history data starts flowing through them.

describe("CRITICAL regression: tripMiles/tripEnergy/vehicleStats with real inputs", () => {
  it("tripMiles computes the odometer delta for a completed trip", () => {
    const t = trip({
      id: "trip-1",
      vehicleId: "veh-1",
      status: "completed",
      odometerStartMi: 12_000,
      odometerEndMi: 12_430,
    });
    expect(tripMiles(t)).toBe(430);
  });

  it("tripMiles is null when either odometer bookend is missing", () => {
    expect(tripMiles(trip({ id: "trip-1", vehicleId: "veh-1", status: "completed", odometerStartMi: 100 }))).toBeNull();
    expect(tripMiles(trip({ id: "trip-1", vehicleId: "veh-1", status: "upcoming" }))).toBeNull();
  });

  it("tripEnergy sums kWh/cost/supercharger cost across real sessions", () => {
    const sessions: ChargingSession[] = [
      { id: "cs-1", tripId: "trip-1", startedAt: 0, endedAt: 1, location: "Home", isSupercharger: false, kWhAdded: 20, costUsd: 4 },
      { id: "cs-2", tripId: "trip-1", startedAt: 2, endedAt: 3, location: "Supercharger", isSupercharger: true, kWhAdded: 30, costUsd: 12 },
    ];
    expect(tripEnergy(sessions)).toEqual({ kWh: 50, costUsd: 16, superchargerCostUsd: 12 });
  });

  it("vehicleStats rolls up real completed trips for one vehicle", () => {
    const trips: Trip[] = [
      trip({ id: "trip-1", vehicleId: "veh-1", status: "completed", odometerStartMi: 100, odometerEndMi: 300, batteryEndPct: 70 }),
      trip({ id: "trip-2", vehicleId: "veh-1", status: "completed", odometerStartMi: 300, odometerEndMi: 550, batteryEndPct: 90 }),
      trip({ id: "trip-3", vehicleId: "veh-2", status: "completed", odometerStartMi: 0, odometerEndMi: 1000, batteryEndPct: 50 }),
    ];
    const sessions: ChargingSession[] = [
      { id: "cs-1", tripId: "trip-1", startedAt: 0, endedAt: 1, location: "Home", isSupercharger: false, kWhAdded: 10, costUsd: 5 },
    ];
    const stats = vehicleStats("veh-1", trips, sessions);
    expect(stats).toEqual({
      vehicleId: "veh-1",
      tripCount: 2,
      milesRented: 450,
      energyCostUsd: 5,
      avgReturnChargePct: 80,
    });
  });

  it("fleetStats aggregates real trips/sessions/vehicles without manufacturing data", () => {
    const snapshot: OwnerSnapshot = {
      drivers: [],
      vehicles: [vehicle({ id: "veh-1" })],
      trips: [
        trip({ id: "trip-1", vehicleId: "veh-1", status: "completed", odometerStartMi: 0, odometerEndMi: 200, endAt: 1000, batteryEndPct: 60 }),
      ],
      chargingSessions: [],
    };
    const stats = fleetStats(snapshot, 80);
    expect(stats.totalMilesRented).toBe(200);
    expect(stats.avgReturnChargePct).toBe(60);
    expect(stats.tripsBelowPolicy).toBe(1);
    expect(stats.tripCounts).toEqual({ upcoming: 0, active: 0, completed: 1, cancelled: 0 });
  });
});

// --- New Phase 3 additive rollup -------------------------------------------

describe("tripWindowRollup", () => {
  it("renders a complete window with an allowance and policy check", () => {
    const rollup = tripWindowRollup({
      odometerStartMi: 1000,
      odometerEndMi: 1300,
      batteryStartPct: 90,
      batteryEndPct: 55,
      milesAllowance: 200,
      policyPct: 70,
    });
    expect(rollup.odometer).toEqual({ kind: "complete", milesDriven: 300 });
    expect(rollup.milesOverAllowance).toBe(100);
    expect(rollup.batteryDeltaPct).toBe(-35);
    expect(rollup.batteryBelowPolicy).toBe(true);
  });

  it("never reports negative miles — an odometer regression is a data-error state", () => {
    const rollup = tripWindowRollup({
      odometerStartMi: 1300,
      odometerEndMi: 1000,
      batteryStartPct: null,
      batteryEndPct: null,
    });
    expect(rollup.odometer).toEqual({ kind: "data-error", reason: "odometer-regression" });
    expect(rollup.milesOverAllowance).toBeNull();
  });

  it.each([
    [{ odometerStartMi: 1000, odometerEndMi: null }, "start-only"],
    [{ odometerStartMi: null, odometerEndMi: 1000 }, "end-only"],
    [{ odometerStartMi: null, odometerEndMi: null }, "none"],
  ] as const)("renders an honest partial state for %o -> %s", (partial, kind) => {
    const rollup = tripWindowRollup({
      odometerStartMi: partial.odometerStartMi,
      odometerEndMi: partial.odometerEndMi,
      batteryStartPct: null,
      batteryEndPct: null,
    });
    expect(rollup.odometer.kind).toBe(kind);
    expect(rollup.milesOverAllowance).toBeNull();
  });

  it("battery delta and below-policy stay null until both readings are present", () => {
    const startOnly = tripWindowRollup({
      odometerStartMi: null,
      odometerEndMi: null,
      batteryStartPct: 90,
      batteryEndPct: null,
      policyPct: 80,
    });
    expect(startOnly.batteryDeltaPct).toBeNull();
    expect(startOnly.batteryBelowPolicy).toBeNull();

    const endOnlyBelowPolicy = tripWindowRollup({
      odometerStartMi: null,
      odometerEndMi: null,
      batteryStartPct: null,
      batteryEndPct: 65,
      policyPct: 80,
    });
    expect(endOnlyBelowPolicy.batteryDeltaPct).toBeNull();
    expect(endOnlyBelowPolicy.batteryBelowPolicy).toBe(true);
  });

  it("clamps milesOverAllowance at zero rather than reporting a negative surplus", () => {
    const rollup = tripWindowRollup({
      odometerStartMi: 0,
      odometerEndMi: 50,
      batteryStartPct: null,
      batteryEndPct: null,
      milesAllowance: 200,
    });
    expect(rollup.milesOverAllowance).toBe(0);
  });
});
