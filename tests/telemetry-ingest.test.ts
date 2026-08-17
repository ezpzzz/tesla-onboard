import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  isWithinCurrentStatsFreshnessWindow,
  parseConnectivityPayload,
  parseTelemetryPayload,
  telemetryFields,
} from "@/lib/owner/telemetry-ingest";
import { HISTORY_LATE_EVENT_BACKFILL_MS } from "@/lib/owner/telemetry-policy";

describe("Tesla decoded telemetry ingestion", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T18:00:00Z"));
  });

  afterAll(() => vi.useRealTimers());

  it("extracts only the bounded current-stat and location fields", () => {
    expect(parseTelemetryPayload({
      vin: "5YJ3E1EA7KF000001",
      createdAt: { seconds: "1786723200", nanos: 500_000_000 },
      data: [
        { key: "Soc", value: { doubleValue: 72.5 } },
        { key: "Odometer", value: { doubleValue: 12345.6 } },
        { key: "EstBatteryRange", value: { floatValue: 201.2 } },
        { key: "DetailedChargeState", value: { detailedChargeStateValue: "DetailedChargeStateCharging" } },
        { key: "Locked", value: { booleanValue: true } },
        { key: "Location", value: { locationValue: { latitude: 33.4484, longitude: -112.074 } } },
        { key: "VehicleSpeed", value: { doubleValue: 88 } },
      ],
    })).toEqual({
      vin: "5YJ3E1EA7KF000001",
      observedAt: 1786723200500,
      batteryPct: 72.5,
      odometerMi: 12345.6,
      estimatedRangeMi: 201.2,
      chargingState: "DetailedChargeStateCharging",
      locked: true,
      location: { latitude: 33.4484, longitude: -112.074 },
    });
  });

  it("rejects malformed identity and ignores invalid signals", () => {
    expect(parseTelemetryPayload({ vin: "bad", createdAt: new Date().toISOString(), data: [] })).toBeNull();
    expect(parseTelemetryPayload({
      vin: "5YJ3E1EA7KF000001",
      created_at: "2026-08-14T12:00:00Z",
      data: [{ key: "Soc", value: { invalid: true, double_value: 100 } }],
    })).toEqual({ vin: "5YJ3E1EA7KF000001", observedAt: Date.parse("2026-08-14T12:00:00Z") });
  });

  it("pins the approved low-frequency location policy", () => {
    expect(telemetryFields(true)).toMatchObject({
      Location: { interval_seconds: 300, minimum_delta: 500 },
    });
  });

  it("normalizes connectivity events without accepting unknown states", () => {
    expect(parseConnectivityPayload({ vin: "5YJ3E1EA7KF000001", connectionStatus: "CONNECTED", createdAt: "2026-08-14T12:00:00Z" }))
      .toEqual({ vin: "5YJ3E1EA7KF000001", connectivity: "connected", observedAt: Date.parse("2026-08-14T12:00:00Z") });
    expect(parseConnectivityPayload({ vin: "5YJ3E1EA7KF000001", status: "unknown" })).toBeNull();
  });

  it("rejects a connectivity event older than 24h even though the vehicle-stats parser now accepts up to 7 days late", () => {
    // Connectivity only ever feeds onlyevs_vehicle_stats_current (never
    // history), so it keeps the original 24h bound -- unaffected by T3's
    // split late-event policy for vehicle-stats telemetry.
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString();
    expect(parseConnectivityPayload({ vin: "5YJ3E1EA7KF000001", connectionStatus: "CONNECTED", createdAt: stale })).toBeNull();
  });

  describe("split late-event policy (T3, outside-voice Issue 7A)", () => {
    it("accepts a vehicle-stats event well past 24h old, up to the 7-day history backfill bound", () => {
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1_000).toISOString();
      expect(parseTelemetryPayload({
        vin: "5YJ3E1EA7KF000001",
        createdAt: fourDaysAgo,
        data: [{ key: "Soc", value: { doubleValue: 55 } }],
      })).toEqual({ vin: "5YJ3E1EA7KF000001", observedAt: Date.parse(fourDaysAgo), batteryPct: 55 });
    });

    it("rejects a vehicle-stats event older than HISTORY_LATE_EVENT_BACKFILL_MS (7 days) outright -- not even history accepts it", () => {
      const tooOld = new Date(Date.now() - HISTORY_LATE_EVENT_BACKFILL_MS - 60_000).toISOString();
      expect(parseTelemetryPayload({
        vin: "5YJ3E1EA7KF000001",
        createdAt: tooOld,
        data: [{ key: "Soc", value: { doubleValue: 55 } }],
      })).toBeNull();
    });

    it("accepts an event exactly at the 7-day backfill boundary", () => {
      const atBoundary = new Date(Date.now() - HISTORY_LATE_EVENT_BACKFILL_MS).toISOString();
      expect(parseTelemetryPayload({
        vin: "5YJ3E1EA7KF000001",
        createdAt: atBoundary,
        data: [],
      })).not.toBeNull();
    });

    it("isWithinCurrentStatsFreshnessWindow: true within 24h, false just past it", () => {
      const now = Date.now();
      expect(isWithinCurrentStatsFreshnessWindow(now - 23 * 60 * 60 * 1_000, now)).toBe(true);
      expect(isWithinCurrentStatsFreshnessWindow(now - 24 * 60 * 60 * 1_000, now)).toBe(true);
      expect(isWithinCurrentStatsFreshnessWindow(now - 24 * 60 * 60 * 1_000 - 1, now)).toBe(false);
    });

    it("isWithinCurrentStatsFreshnessWindow: an event within the 7-day history bound but past 24h is not current-stats-fresh", () => {
      const now = Date.now();
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1_000;
      expect(isWithinCurrentStatsFreshnessWindow(threeDaysAgo, now)).toBe(false);
    });
  });
});
