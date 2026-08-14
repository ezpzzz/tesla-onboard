import { describe, expect, it } from "vitest";
import { parseConnectivityPayload, parseTelemetryPayload, telemetryFields } from "@/lib/owner/telemetry-ingest";

describe("Tesla decoded telemetry ingestion", () => {
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
});
