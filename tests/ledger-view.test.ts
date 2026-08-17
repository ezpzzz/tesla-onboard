import { describe, expect, it } from "vitest";
import { batteryCaptureNote, buildLedgerRows, classifyLedgerRow, formatKwh, lifetimeKwh, odometerCaptureNote } from "@/components/owner/ledger-view";
import { tripWindowRollup } from "@/lib/owner/derive";
import type { ChargingSession, Trip, Vehicle } from "@/lib/owner/types";

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    driverId: "guest-1",
    vehicleId: "veh-1",
    status: "completed",
    startAt: 1_000,
    endAt: 2_000,
    odometerStartMi: null,
    odometerEndMi: null,
    batteryStartPct: null,
    batteryEndPct: null,
    chargingSessionIds: [],
    ...overrides,
  };
}

describe("classifyLedgerRow", () => {
  it("badges a completed trip with full bookends and battery at/above policy as Clean return", () => {
    const t = trip({ odometerStartMi: 100, odometerEndMi: 200, batteryStartPct: 90, batteryEndPct: 85 });
    const rollup = tripWindowRollup({
      odometerStartMi: t.odometerStartMi, odometerEndMi: t.odometerEndMi,
      batteryStartPct: t.batteryStartPct, batteryEndPct: t.batteryEndPct,
      milesAllowance: null, policyPct: 80,
    });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "good", label: "Clean return" });
  });

  it("badges a completed trip returned below policy as Needs attention", () => {
    const t = trip({ odometerStartMi: 100, odometerEndMi: 200, batteryStartPct: 90, batteryEndPct: 60 });
    const rollup = tripWindowRollup({
      odometerStartMi: t.odometerStartMi, odometerEndMi: t.odometerEndMi,
      batteryStartPct: t.batteryStartPct, batteryEndPct: t.batteryEndPct,
      milesAllowance: null, policyPct: 80,
    });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "warn", label: "Needs attention" });
  });

  it("badges an odometer regression as a data-error, never a mileage claim", () => {
    const t = trip({ odometerStartMi: 500, odometerEndMi: 480, batteryStartPct: 90, batteryEndPct: 85 });
    const rollup = tripWindowRollup({
      odometerStartMi: t.odometerStartMi, odometerEndMi: t.odometerEndMi,
      batteryStartPct: t.batteryStartPct, batteryEndPct: t.batteryEndPct,
      milesAllowance: null, policyPct: 80,
    });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "danger", label: "Data error" });
  });

  it("badges a fully pre-telemetry completed trip as Recorded manually", () => {
    const t = trip({ status: "completed" });
    const rollup = tripWindowRollup({ odometerStartMi: null, odometerEndMi: null, batteryStartPct: null, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "neutral", label: "Recorded manually" });
  });

  it("badges an active trip with only a start bookend as In progress, not an error", () => {
    const t = trip({ status: "active", odometerStartMi: 100, batteryStartPct: 90 });
    const rollup = tripWindowRollup({ odometerStartMi: 100, odometerEndMi: null, batteryStartPct: 90, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "neutral", label: "In progress" });
  });

  it("badges a completed trip stuck at start-only as Return not captured", () => {
    const t = trip({ status: "completed", odometerStartMi: 100, batteryStartPct: 90 });
    const rollup = tripWindowRollup({ odometerStartMi: 100, odometerEndMi: null, batteryStartPct: 90, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "warn", label: "Return not captured" });
  });

  it("badges an end-only trip (rollout straddle) as Start not captured, pre-telemetry", () => {
    const t = trip({ odometerEndMi: 200, batteryEndPct: 85 });
    const rollup = tripWindowRollup({ odometerStartMi: null, odometerEndMi: 200, batteryStartPct: null, batteryEndPct: 85, milesAllowance: null, policyPct: 80 });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "neutral", label: "Start not captured (pre-telemetry)" });
  });

  it("badges an upcoming trip with no bookends as Upcoming", () => {
    const t = trip({ status: "upcoming" });
    const rollup = tripWindowRollup({ odometerStartMi: null, odometerEndMi: null, batteryStartPct: null, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(classifyLedgerRow(t, rollup)).toEqual({ tone: "neutral", label: "Upcoming" });
  });
});

const VEHICLE: Vehicle = {
  id: "veh-1", guestSourceId: "src-1", displayName: "Model 3", model: "Model 3", trim: "", year: 2024,
  color: "White", shifter: "screen", licensePlate: null, vin: null, returnChargeLevelPct: null,
  notes: "", status: "active", createdAt: 0, updatedAt: 0,
};

describe("buildLedgerRows", () => {
  it("sorts rows newest-first and carries each row's own kWh from its sessions", () => {
    const older = trip({ id: "t-old", startAt: 100, endAt: 200 });
    const newer = trip({ id: "t-new", startAt: 500, endAt: 600 });
    const sessions: ChargingSession[] = [
      { id: "s1", tripId: "t-new", startedAt: 500, endedAt: 550, location: "", isSupercharger: false, kWhAdded: 12, costUsd: 4 },
    ];
    const rows = buildLedgerRows([older, newer], sessions, VEHICLE, 80);
    expect(rows.map((r) => r.trip.id)).toEqual(["t-new", "t-old"]);
    expect(rows[0].kWh).toBe(12);
    expect(rows[1].kWh).toBe(0);
  });

  it("resolves policy through the vehicle's own override, matching resolveVehiclePolicyPct", () => {
    const overridden: Vehicle = { ...VEHICLE, returnChargeLevelPct: 90 };
    const t = trip({ odometerStartMi: 100, odometerEndMi: 200, batteryStartPct: 95, batteryEndPct: 85 });
    const [row] = buildLedgerRows([t], [], overridden, 80);
    expect(row.rollup.batteryBelowPolicy).toBe(true); // 85 < 90 (vehicle override), even though 85 >= 80 (fleet policy)
  });
});

describe("lifetimeKwh / formatKwh", () => {
  it("sums every row's kWh", () => {
    const rows = buildLedgerRows(
      [trip({ id: "a" }), trip({ id: "b" })],
      [
        { id: "s1", tripId: "a", startedAt: 1, endedAt: 2, location: "", isSupercharger: false, kWhAdded: 4, costUsd: 0 },
        { id: "s2", tripId: "b", startedAt: 1, endedAt: 2, location: "", isSupercharger: true, kWhAdded: 6, costUsd: 0 },
      ],
      VEHICLE,
      80,
    );
    expect(lifetimeKwh(rows)).toBe(10);
  });

  it("never renders a currency symbol", () => {
    expect(formatKwh(1234.5)).not.toMatch(/\$/);
    expect(formatKwh(1234.5)).toBe("1,234.5 kWh");
    expect(formatKwh(0)).toBe("0 kWh");
  });
});

describe("odometerCaptureNote / batteryCaptureNote (G6 — absent-bookend-field copy)", () => {
  it("names the missing return edge when only the start odometer bookend was captured", () => {
    const rollup = tripWindowRollup({ odometerStartMi: 100, odometerEndMi: null, batteryStartPct: null, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(odometerCaptureNote(rollup)).toBe("Not captured at return");
  });

  it("names the missing pickup edge when only the end odometer bookend was captured", () => {
    const rollup = tripWindowRollup({ odometerStartMi: null, odometerEndMi: 200, batteryStartPct: null, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(odometerCaptureNote(rollup)).toBe("Not captured at pickup");
  });

  it("has no note when both odometer edges are present or both are absent", () => {
    const complete = tripWindowRollup({ odometerStartMi: 100, odometerEndMi: 200, batteryStartPct: null, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    const none = tripWindowRollup({ odometerStartMi: null, odometerEndMi: null, batteryStartPct: null, batteryEndPct: null, milesAllowance: null, policyPct: 80 });
    expect(odometerCaptureNote(complete)).toBeNull();
    expect(odometerCaptureNote(none)).toBeNull();
  });

  it("names the missing return edge when only the start battery bookend was captured", () => {
    expect(batteryCaptureNote(90, null)).toBe("Not captured at return");
  });

  it("names the missing pickup edge when only the end battery bookend was captured", () => {
    expect(batteryCaptureNote(null, 85)).toBe("Not captured at pickup");
  });

  it("has no note when both battery edges are present or both are absent", () => {
    expect(batteryCaptureNote(90, 85)).toBeNull();
    expect(batteryCaptureNote(null, null)).toBeNull();
  });
});
