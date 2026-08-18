import { describe, expect, it } from "vitest";
import { deriveAlerts } from "@/lib/owner/alerts";
import { initialOwnerState } from "@/lib/owner/owner-state";
import { SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD } from "@/lib/owner/telemetry-policy";
import type { DerivedChargeSession, Driver, Trip, Vehicle } from "@/lib/owner/types";

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function trip(overrides: Partial<Trip> & Pick<Trip, "id" | "vehicleId" | "status">): Trip {
  return {
    driverId: "drv-1",
    startAt: NOW - 5 * DAY_MS,
    endAt: NOW - 1 * DAY_MS,
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

const drivers: Driver[] = [{ id: "drv-1", name: "Sam K.", email: "sam@example.com", source: "live", progress: null }];
const vehicles: Vehicle[] = [vehicle({ id: "veh-1" })];

function dcFastSession(overrides: Partial<DerivedChargeSession> & Pick<DerivedChargeSession, "tripId">): DerivedChargeSession {
  return {
    id: `session-${overrides.tripId}`,
    vehicleId: "veh-1",
    kind: "dc_fast",
    startedAt: NOW - 2 * DAY_MS,
    endedAt: NOW - 2 * DAY_MS + 1000,
    kWhAdded: 0,
    gapAffected: false,
    costUsd: null,
    costProvenance: null,
    ...overrides,
  };
}

describe("CRITICAL regression: return-below-policy never false-fires on manual-era trips", () => {
  it("skips a completed trip with no captured battery bookend (manual-era / pre-telemetry)", () => {
    const trips: Trip[] = [
      trip({ id: "trip-1", vehicleId: "veh-1", status: "completed", batteryEndPct: null }),
    ];
    const alerts = deriveAlerts({
      drivers,
      trips,
      chargingSessions: [],
      vehicles,
      ownerState: initialOwnerState,
      policyPct: 80,
      now: NOW,
    });
    expect(alerts.filter((a) => a.kind === "return-below-policy")).toHaveLength(0);
  });

  it("still fires once a real battery bookend is below policy (regression guard for the real case)", () => {
    const trips: Trip[] = [
      trip({ id: "trip-1", vehicleId: "veh-1", status: "completed", batteryEndPct: 55 }),
    ];
    const alerts = deriveAlerts({
      drivers,
      trips,
      chargingSessions: [],
      vehicles,
      ownerState: initialOwnerState,
      policyPct: 80,
      now: NOW,
    });
    expect(alerts.filter((a) => a.kind === "return-below-policy")).toHaveLength(1);
  });
});

describe("supercharging-unrecovered alert, re-keyed to kWh", () => {
  it("does not fire when no chargeSessions are supplied at all (honest absence, never a false fire)", () => {
    const trips: Trip[] = [trip({ id: "trip-1", vehicleId: "veh-1", status: "completed" })];
    const alerts = deriveAlerts({
      drivers,
      trips,
      chargingSessions: [],
      vehicles,
      ownerState: initialOwnerState,
      policyPct: 80,
      now: NOW,
    });
    expect(alerts.filter((a) => a.kind === "supercharging-unrecovered")).toHaveLength(0);
  });

  it(`does not fire below the ${SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD} kWh threshold`, () => {
    const trips: Trip[] = [trip({ id: "trip-1", vehicleId: "veh-1", status: "completed" })];
    const alerts = deriveAlerts({
      drivers,
      trips,
      chargingSessions: [],
      vehicles,
      ownerState: initialOwnerState,
      policyPct: 80,
      now: NOW,
      chargeSessions: [dcFastSession({ tripId: "trip-1", kWhAdded: SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD - 0.1 })],
    });
    expect(alerts.filter((a) => a.kind === "supercharging-unrecovered")).toHaveLength(0);
  });

  it(`fires at or above the ${SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD} kWh threshold, keyed to the trip's DC-fast sessions only`, () => {
    const trips: Trip[] = [
      trip({ id: "trip-1", vehicleId: "veh-1", status: "completed" }),
      trip({ id: "trip-2", vehicleId: "veh-1", status: "completed" }),
    ];
    const alerts = deriveAlerts({
      drivers,
      trips,
      chargingSessions: [],
      vehicles,
      ownerState: initialOwnerState,
      policyPct: 80,
      now: NOW,
      chargeSessions: [
        dcFastSession({ tripId: "trip-1", kWhAdded: SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD }),
        // AC/home session on the same trip must never count toward the DC-fast total.
        { ...dcFastSession({ tripId: "trip-1" }), id: "ac-session", kind: "ac_home", kWhAdded: 999 },
        // A large DC-fast session on a different trip must not leak into trip-1's total.
        dcFastSession({ tripId: "trip-2", kWhAdded: 999 }),
      ],
    });
    const fired = alerts.filter((a) => a.kind === "supercharging-unrecovered");
    expect(fired.map((a) => a.tripId)).toEqual(["trip-1", "trip-2"]);
    expect(fired[0].message).toContain("10.0 kWh");
  });

  it("ignores a completed trip older than the 14-day window", () => {
    const trips: Trip[] = [
      trip({ id: "trip-1", vehicleId: "veh-1", status: "completed", endAt: NOW - 20 * DAY_MS }),
    ];
    const alerts = deriveAlerts({
      drivers,
      trips,
      chargingSessions: [],
      vehicles,
      ownerState: initialOwnerState,
      policyPct: 80,
      now: NOW,
      chargeSessions: [dcFastSession({ tripId: "trip-1", kWhAdded: 50, endedAt: NOW - 20 * DAY_MS })],
    });
    expect(alerts.filter((a) => a.kind === "supercharging-unrecovered")).toHaveLength(0);
  });
});
