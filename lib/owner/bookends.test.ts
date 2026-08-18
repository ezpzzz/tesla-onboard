import { describe, expect, it } from "vitest";
import {
  captureBookendField,
  deriveBookendDelta,
  isBookendWindowDue,
  isEndBookendStillTracking,
} from "./bookends";
import { BOOKEND_END_TRACKING_GRACE_MS, BOOKEND_FRESHNESS_WINDOW_MS } from "./telemetry-policy";

const EDGE_AT = 1_700_000_000_000;

describe("captureBookendField", () => {
  it("records a fresh field within the freshness window of the edge", () => {
    const result = captureBookendField(
      { value: 12_345.6, observedAt: EDGE_AT - 5 * 60_000 },
      EDGE_AT,
    );
    expect(result).toEqual({ value: 12_345.6, observedAt: EDGE_AT - 5 * 60_000, stale: false });
  });

  it("flags a field older than BOOKEND_FRESHNESS_WINDOW_MS relative to the edge as stale, never dropping it", () => {
    const observedAt = EDGE_AT - BOOKEND_FRESHNESS_WINDOW_MS - 1;
    const result = captureBookendField({ value: 41, observedAt }, EDGE_AT);
    expect(result).toEqual({ value: 41, observedAt, stale: true });
  });

  it("is exactly-at-the-boundary fresh, not stale (30 minutes is still fresh)", () => {
    const observedAt = EDGE_AT - BOOKEND_FRESHNESS_WINDOW_MS;
    expect(captureBookendField({ value: 50, observedAt }, EDGE_AT).stale).toBe(false);
  });

  it("absent-data rule: no value yields null and never stale, never fabricated", () => {
    expect(captureBookendField({ value: null, observedAt: null }, EDGE_AT))
      .toEqual({ value: null, observedAt: null, stale: false });
  });

  it("absent-data rule: a value with no observedAt is treated as absent, not fresh", () => {
    // Defensive: sample shape should never occur in practice (a value
    // without an observedAt), but must never be reported as a fresh 0-age
    // reading.
    expect(captureBookendField({ value: 10, observedAt: null }, EDGE_AT))
      .toEqual({ value: null, observedAt: null, stale: false });
  });

  it("a reading newer than the edge (clock skew) is fresh, not stale", () => {
    const observedAt = EDGE_AT + 60_000;
    expect(captureBookendField({ value: 70, observedAt }, EDGE_AT).stale).toBe(false);
  });
});

describe("isBookendWindowDue", () => {
  const args = { startsAtMs: 1_000_000, endsAtMs: 2_000_000 };

  it("start edge is due once now reaches starts_at, not before", () => {
    expect(isBookendWindowDue("start", { ...args, nowMs: args.startsAtMs - 1 })).toBe(false);
    expect(isBookendWindowDue("start", { ...args, nowMs: args.startsAtMs })).toBe(true);
    expect(isBookendWindowDue("start", { ...args, nowMs: args.startsAtMs + 1 })).toBe(true);
  });

  it("end edge is due once now reaches ends_at, not before", () => {
    expect(isBookendWindowDue("end", { ...args, nowMs: args.endsAtMs - 1 })).toBe(false);
    expect(isBookendWindowDue("end", { ...args, nowMs: args.endsAtMs })).toBe(true);
  });
});

describe("isEndBookendStillTracking (late-return rule, outside-voice Issue 6B)", () => {
  const endsAtMs = 2_000_000;

  it("keeps tracking immediately after ends_at while the trip has not completed", () => {
    expect(isEndBookendStillTracking({ nowMs: endsAtMs + 1, endsAtMs, tripCompleted: false })).toBe(true);
  });

  it("keeps tracking right up to the grace cap", () => {
    expect(isEndBookendStillTracking({
      nowMs: endsAtMs + BOOKEND_END_TRACKING_GRACE_MS,
      endsAtMs,
      tripCompleted: false,
    })).toBe(true);
  });

  it("stops tracking past the grace cap even if still not completed", () => {
    expect(isEndBookendStillTracking({
      nowMs: endsAtMs + BOOKEND_END_TRACKING_GRACE_MS + 1,
      endsAtMs,
      tripCompleted: false,
    })).toBe(false);
  });

  it("stops the instant the trip is completed, regardless of grace remaining", () => {
    expect(isEndBookendStillTracking({ nowMs: endsAtMs + 1, endsAtMs, tripCompleted: true })).toBe(false);
  });
});

describe("deriveBookendDelta", () => {
  it("computes miles driven and battery delta from a full start+end pair", () => {
    expect(deriveBookendDelta({
      startOdometerMi: 1_000,
      endOdometerMi: 1_250,
      startBatteryPct: 90,
      endBatteryPct: 62,
    })).toEqual({ milesDriven: 250, batteryDeltaPct: -28, odometerRegression: false });
  });

  it("renders a data-error state for odometer regression, never negative miles", () => {
    const result = deriveBookendDelta({
      startOdometerMi: 1_000,
      endOdometerMi: 990,
      startBatteryPct: null,
      endBatteryPct: null,
    });
    expect(result.odometerRegression).toBe(true);
    expect(result.milesDriven).toBeNull();
  });

  it("start-only bookend renders an honest partial result, no guessed delta", () => {
    expect(deriveBookendDelta({
      startOdometerMi: 1_000,
      endOdometerMi: null,
      startBatteryPct: 90,
      endBatteryPct: null,
    })).toEqual({ milesDriven: null, batteryDeltaPct: null, odometerRegression: false });
  });

  it("end-only bookend (rollout straddle: no start captured) renders an honest partial result", () => {
    expect(deriveBookendDelta({
      startOdometerMi: null,
      endOdometerMi: 1_250,
      startBatteryPct: null,
      endBatteryPct: 62,
    })).toEqual({ milesDriven: null, batteryDeltaPct: null, odometerRegression: false });
  });

  it("equal odometer readings (zero miles) is not a regression", () => {
    expect(deriveBookendDelta({
      startOdometerMi: 1_000,
      endOdometerMi: 1_000,
      startBatteryPct: null,
      endBatteryPct: null,
    })).toEqual({ milesDriven: 0, batteryDeltaPct: null, odometerRegression: false });
  });
});
