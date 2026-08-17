import { describe, expect, it } from "vitest";
import {
  applyManualChargeCostOverride,
  applyManualChargeCostOverrides,
  BATTERY_CAPACITY_MISSING_KWH_COPY,
  formatSessionKwhLabel,
  isChargeSessionKwhUnknown,
  reconcileChargingInvoices,
  reconcileHomeRateCost,
  segmentChargeSessions,
  toLegacyChargingSessions,
  totalDcFastKwh,
  type ChargingInvoice,
} from "@/lib/owner/charge-sessions";
import { CHARGE_SESSION_GAP_MS } from "@/lib/owner/telemetry-policy";
import type { VehicleStatsHistoryPoint } from "@/lib/owner/access-types";
import type { DerivedChargeSession } from "@/lib/owner/types";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

function point(overrides: Partial<VehicleStatsHistoryPoint> & Pick<VehicleStatsHistoryPoint, "observedAt">): VehicleStatsHistoryPoint {
  return {
    vehicleId: "veh-1",
    batteryPct: null,
    estimatedRangeMi: null,
    odometerMi: null,
    chargingState: null,
    locked: null,
    ...overrides,
  };
}

describe("segmentChargeSessions", () => {
  it("closes a session on a non-charging state", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 50 }),
      point({ observedAt: T0 + 10 * MIN, chargingState: "Charging", batteryPct: 60 }),
      point({ observedAt: T0 + 20 * MIN, chargingState: "Complete", batteryPct: 65 }),
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows: [] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      startedAt: T0,
      endedAt: T0 + 20 * MIN,
      gapAffected: false,
      kind: "ac_home",
      tripId: null,
    });
  });

  it("keeps one session across a stream gap but flags it gap-affected, never splitting it", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 50 }),
      // gap > CHARGE_SESSION_GAP_MS with no interceding signal
      point({ observedAt: T0 + CHARGE_SESSION_GAP_MS + 5 * MIN, chargingState: "Charging", batteryPct: 70 }),
      point({ observedAt: T0 + CHARGE_SESSION_GAP_MS + 15 * MIN, chargingState: "Stopped", batteryPct: 72 }),
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows: [] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].gapAffected).toBe(true);
  });

  it("caveats a session still open at the end of the queried window", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Starting", batteryPct: 40 }),
      point({ observedAt: T0 + 5 * MIN, chargingState: "Charging", batteryPct: 55 }),
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows: [] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].gapAffected).toBe(true);
    expect(sessions[0].endedAt).toBe(T0 + 5 * MIN);
  });

  it("attributes a session by observed_at overlap, straddling toward the trip active at the start", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 50 }),
      point({ observedAt: T0 + 30 * MIN, chargingState: "Complete", batteryPct: 80 }),
    ];
    const tripWindows = [
      { tripId: "trip-a", startsAtMs: T0 - 10 * MIN, endsAtMs: T0 + 10 * MIN },
      { tripId: "trip-b", startsAtMs: T0 + 20 * MIN, endsAtMs: T0 + 60 * MIN },
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows });
    // Session started inside trip-a's window (even though it ended inside
    // trip-b's) — attribution follows the trip active at the start.
    expect(sessions[0].tripId).toBe("trip-a");
  });

  it("attributes by end when the start falls outside every trip window", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 50 }),
      point({ observedAt: T0 + 30 * MIN, chargingState: "Complete", batteryPct: 80 }),
    ];
    const tripWindows = [{ tripId: "trip-b", startsAtMs: T0 + 20 * MIN, endsAtMs: T0 + 60 * MIN }];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows });
    expect(sessions[0].tripId).toBe("trip-b");
  });

  it("leaves tripId null (attaches to the vehicle only) when neither endpoint overlaps a trip", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 50 }),
      point({ observedAt: T0 + 5 * MIN, chargingState: "Complete", batteryPct: 55 }),
    ];
    const tripWindows = [{ tripId: "trip-a", startsAtMs: T0 + 100 * MIN, endsAtMs: T0 + 200 * MIN }];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows });
    expect(sessions[0].tripId).toBeNull();
  });

  it("segments every session as ac_home by default (no rate-power signal in the ingested history)", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 20 }),
      point({ observedAt: T0 + 90 * MIN, chargingState: "Complete", batteryPct: 90 }),
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows: [] });
    expect(sessions[0].kind).toBe("ac_home");
  });

  it("renders kWhAdded as an honest unknown (never a fabricated 0) when no battery capacity is supplied", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 20 }),
      point({ observedAt: T0 + 90 * MIN, chargingState: "Complete", batteryPct: 90 }),
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows: [] });
    expect(isChargeSessionKwhUnknown(sessions[0])).toBe(true);
  });

  it("estimates kWhAdded from the battery delta when a capacity is supplied", () => {
    const history: VehicleStatsHistoryPoint[] = [
      point({ observedAt: T0, chargingState: "Charging", batteryPct: 20 }),
      point({ observedAt: T0 + 90 * MIN, chargingState: "Complete", batteryPct: 70 }),
    ];
    const sessions = segmentChargeSessions({ vehicleId: "veh-1", history, tripWindows: [], batteryCapacityKwh: 80 });
    expect(sessions[0].kWhAdded).toBeCloseTo(40, 5); // 50% of an 80kWh pack
  });
});

function dcFast(overrides: Partial<DerivedChargeSession> & Pick<DerivedChargeSession, "id" | "vehicleId" | "startedAt" | "endedAt">): DerivedChargeSession {
  return {
    tripId: null,
    kind: "ac_home",
    kWhAdded: 0,
    gapAffected: false,
    costUsd: null,
    costProvenance: null,
    ...overrides,
  };
}

describe("reconcileHomeRateCost", () => {
  it("prices an ac_home session at kWh x the configured rate", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: 20 });
    const priced = reconcileHomeRateCost({ session, ratePerKwh: 0.25 });
    expect(priced.costUsd).toBe(5);
    expect(priced.costProvenance).toBe("rate");
  });

  it("renders kWh-only (no guessed price) when no rate is configured", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: 20 });
    const priced = reconcileHomeRateCost({ session, ratePerKwh: null });
    expect(priced.costUsd).toBeNull();
    expect(priced.costProvenance).toBeNull();
  });

  it("never rate-prices a dc_fast session", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: 20, kind: "dc_fast" });
    const priced = reconcileHomeRateCost({ session, ratePerKwh: 0.25 });
    expect(priced.costProvenance).toBeNull();
  });

  it("never prices an ac_home session with an unknown kWh (no battery capacity), even with a rate configured", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: NaN });
    const priced = reconcileHomeRateCost({ session, ratePerKwh: 0.25 });
    expect(priced.costUsd).toBeNull();
    expect(priced.costProvenance).toBeNull();
  });
});

describe("isChargeSessionKwhUnknown / formatSessionKwhLabel", () => {
  it("is false, and formats a normal decimal, for a known kWh", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: 12.34 });
    expect(isChargeSessionKwhUnknown(session)).toBe(false);
    expect(formatSessionKwhLabel(session)).toBe("12.3 kWh");
  });

  it("is true, and renders the honest-absence copy, for an unknown kWh", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: NaN });
    expect(isChargeSessionKwhUnknown(session)).toBe(true);
    expect(formatSessionKwhLabel(session)).toBe(BATTERY_CAPACITY_MISSING_KWH_COPY);
  });
});

function invoice(overrides: Partial<ChargingInvoice> & Pick<ChargingInvoice, "providerInvoiceId" | "startedAtMs" | "endedAtMs">): ChargingInvoice {
  return { vehicleId: "veh-1", kWhAdded: 30, costUsd: 15, ...overrides };
}

describe("reconcileChargingInvoices", () => {
  it("matches an invoice to the overlapping session and promotes it to dc_fast", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + 30 * MIN })];
    const invoices = [invoice({ providerInvoiceId: "inv-1", startedAtMs: T0, endedAtMs: T0 + 30 * MIN })];
    const result = reconcileChargingInvoices(sessions, invoices);
    expect(result.sessions[0]).toMatchObject({ kind: "dc_fast", kWhAdded: 30, costUsd: 15, costProvenance: "invoice" });
    expect(result.unmatchedInvoices).toHaveLength(0);
  });

  it("collects an invoice with no overlapping session as unmatched, attached to the vehicle only", () => {
    const sessions: DerivedChargeSession[] = [];
    const invoices = [invoice({ providerInvoiceId: "inv-1", startedAtMs: T0, endedAtMs: T0 + 30 * MIN })];
    const result = reconcileChargingInvoices(sessions, invoices);
    expect(result.sessions).toHaveLength(0);
    expect(result.unmatchedInvoices).toEqual(invoices);
  });

  it("matches on a partial time-window overlap", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + 30 * MIN })];
    const invoices = [invoice({ providerInvoiceId: "inv-1", startedAtMs: T0 + 20 * MIN, endedAtMs: T0 + 50 * MIN })];
    const result = reconcileChargingInvoices(sessions, invoices);
    expect(result.sessions[0].kind).toBe("dc_fast");
    expect(result.unmatchedInvoices).toHaveLength(0);
  });

  it("is idempotent against a duplicate invoice id — applies it only once", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + 30 * MIN })];
    const invoices = [
      invoice({ providerInvoiceId: "inv-1", startedAtMs: T0, endedAtMs: T0 + 30 * MIN, kWhAdded: 30, costUsd: 15 }),
      invoice({ providerInvoiceId: "inv-1", startedAtMs: T0, endedAtMs: T0 + 30 * MIN, kWhAdded: 999, costUsd: 999 }),
    ];
    const result = reconcileChargingInvoices(sessions, invoices);
    expect(result.sessions[0].kWhAdded).toBe(30);
    expect(result.sessions[0].costUsd).toBe(15);
  });

  it("leaves an unattributed session's tripId null after reconciliation (invoice-outside-trip)", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + 30 * MIN, tripId: null })];
    const invoices = [invoice({ providerInvoiceId: "inv-1", startedAtMs: T0, endedAtMs: T0 + 30 * MIN })];
    const result = reconcileChargingInvoices(sessions, invoices);
    expect(result.sessions[0].tripId).toBeNull();
    expect(result.sessions[0].kind).toBe("dc_fast");
  });
});

describe("applyManualChargeCostOverride", () => {
  it("sets an owner-entered cost with manual provenance", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN });
    const overridden = applyManualChargeCostOverride(session, { sessionId: "s1", costUsd: 12.5, enteredBy: "owner-1" });
    expect(overridden.costUsd).toBe(12.5);
    expect(overridden.costProvenance).toBe("manual");
  });

  it("ignores an override targeting a different session id", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN });
    const unchanged = applyManualChargeCostOverride(session, { sessionId: "s2", costUsd: 12.5, enteredBy: "owner-1" });
    expect(unchanged).toBe(session);
  });
});

describe("applyManualChargeCostOverrides (precedence matrix: manual > invoice > rate)", () => {
  it("overrides a rate-priced session's cost/provenance to manual", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: 20, costUsd: 5, costProvenance: "rate" })];
    const [result] = applyManualChargeCostOverrides(sessions, [{ sessionId: "s1", costUsd: 9.99, enteredBy: "owner-1" }]);
    expect(result).toMatchObject({ costUsd: 9.99, costProvenance: "manual" });
  });

  it("overrides an invoice-priced (dc_fast) session's cost/provenance to manual", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, kind: "dc_fast", kWhAdded: 30, costUsd: 15, costProvenance: "invoice" })];
    const [result] = applyManualChargeCostOverrides(sessions, [{ sessionId: "s1", costUsd: 20, enteredBy: "owner-1" }]);
    expect(result).toMatchObject({ costUsd: 20, costProvenance: "manual", kind: "dc_fast", kWhAdded: 30 });
  });

  it("is a no-op when no override targets any session in the list", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN, costUsd: 5, costProvenance: "rate" })];
    const [result] = applyManualChargeCostOverrides(sessions, [{ sessionId: "s-other", costUsd: 99, enteredBy: "owner-1" }]);
    expect(result).toMatchObject({ costUsd: 5, costProvenance: "rate" });
  });

  it("leaves sessions unchanged with an empty override list", () => {
    const sessions = [dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0 + MIN })];
    expect(applyManualChargeCostOverrides(sessions, [])).toEqual(sessions);
  });
});

describe("totalDcFastKwh", () => {
  it("sums only dc_fast sessions, ignoring ac_home", () => {
    const sessions = [
      dcFast({ id: "s1", vehicleId: "veh-1", startedAt: T0, endedAt: T0, kind: "dc_fast", kWhAdded: 12 }),
      dcFast({ id: "s2", vehicleId: "veh-1", startedAt: T0, endedAt: T0, kind: "ac_home", kWhAdded: 40 }),
      dcFast({ id: "s3", vehicleId: "veh-1", startedAt: T0, endedAt: T0, kind: "dc_fast", kWhAdded: 8 }),
    ];
    expect(totalDcFastKwh(sessions)).toBe(20);
  });

  it("returns 0 for an empty session list", () => {
    expect(totalDcFastKwh([])).toBe(0);
  });
});

describe("toLegacyChargingSessions", () => {
  it("maps a dc_fast session to a Supercharger-labeled legacy session", () => {
    const session = dcFast({ id: "s1", vehicleId: "veh-1", tripId: "trip-1", startedAt: T0, endedAt: T0 + MIN, kind: "dc_fast", kWhAdded: 20, costUsd: 8, costProvenance: "invoice" });
    const [legacy] = toLegacyChargingSessions([session]);
    expect(legacy).toEqual({
      id: "s1", tripId: "trip-1", startedAt: T0, endedAt: T0 + MIN,
      location: "Supercharging", isSupercharger: true, kWhAdded: 20, costUsd: 8,
    });
  });

  it("maps an ac_home session to a Home/AC-labeled legacy session", () => {
    const session = dcFast({ id: "s2", vehicleId: "veh-1", tripId: "trip-1", startedAt: T0, endedAt: T0 + MIN, kind: "ac_home", kWhAdded: 10, costUsd: 1.4, costProvenance: "rate" });
    const [legacy] = toLegacyChargingSessions([session]);
    expect(legacy.location).toBe("Home / AC charging");
    expect(legacy.isSupercharger).toBe(false);
  });

  it("maps a null tripId (unreconciled, vehicle-only invoice) to an empty string, never fabricating a trip attribution", () => {
    const session = dcFast({ id: "s3", vehicleId: "veh-1", tripId: null, startedAt: T0, endedAt: T0 + MIN });
    const [legacy] = toLegacyChargingSessions([session]);
    expect(legacy.tripId).toBe("");
  });

  it("falls back costUsd to 0 for an unpriced session (costProvenance null), never a guessed price", () => {
    const session = dcFast({ id: "s4", vehicleId: "veh-1", tripId: "trip-1", startedAt: T0, endedAt: T0 + MIN, costUsd: null, costProvenance: null });
    const [legacy] = toLegacyChargingSessions([session]);
    expect(legacy.costUsd).toBe(0);
  });

  it("falls back kWhAdded to 0 for an unknown-kWh session, since the legacy shape has no unknown sentinel", () => {
    const session = dcFast({ id: "s5", vehicleId: "veh-1", tripId: "trip-1", startedAt: T0, endedAt: T0 + MIN, kWhAdded: NaN });
    const [legacy] = toLegacyChargingSessions([session]);
    expect(legacy.kWhAdded).toBe(0);
  });
});
