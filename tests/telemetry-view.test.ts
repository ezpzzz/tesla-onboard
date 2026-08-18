import { describe, expect, it } from "vitest";
import {
  activeTripPace,
  batteryHistoryPoints,
  batteryRangeAriaLabel,
  bucketChargingSessionsByDay,
  chargingBarsAriaLabel,
  deriveLocationRowView,
  deriveTelemetryCause,
  deriveTelemetryStripState,
  enrolledAgeLabel,
  freshnessAgeLabel,
  liveFieldFreshness,
  liveStateEmptyCopy,
  msToWholeDays,
  msToWholeMonths,
  type LocationEvidenceApiState,
  type TelemetryEnrollmentRow,
} from "@/components/owner/telemetry-view";
import type { ChargingSession } from "@/lib/owner/types";
import type { VehicleStatsHistoryBucket } from "@/lib/owner/access-types";
import { BOOKEND_FRESHNESS_WINDOW_MS } from "@/lib/owner/telemetry-policy";

const NOW = Date.parse("2026-08-16T12:00:00Z");
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

describe("freshnessAgeLabel / enrolledAgeLabel", () => {
  it("renders just now for sub-minute ages", () => {
    expect(freshnessAgeLabel(NOW - 10_000, NOW)).toBe("just now");
  });
  it("renders minutes under an hour", () => {
    expect(freshnessAgeLabel(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  });
  it("renders hours under 48h", () => {
    expect(freshnessAgeLabel(NOW - 5 * HOUR, NOW)).toBe("5h ago");
  });
  it("renders days at/after 48h", () => {
    expect(freshnessAgeLabel(NOW - 3 * DAY, NOW)).toBe("3d ago");
  });
  it("clamps a future timestamp to zero age rather than a negative label", () => {
    expect(freshnessAgeLabel(NOW + 60_000, NOW)).toBe("just now");
  });
  it("prefixes the enrollment narrative", () => {
    expect(enrolledAgeLabel(NOW - 2 * HOUR, NOW)).toBe("enrolled 2h ago");
    expect(enrolledAgeLabel(NOW - 1_000, NOW)).toBe("enrolled just now");
  });
});

describe("deriveTelemetryStripState", () => {
  const base: TelemetryEnrollmentRow = { status: "requested", lastErrorCode: null, createdAt: NOW - HOUR };

  it("hides once a live signal has ever been seen, regardless of enrollment status", () => {
    expect(deriveTelemetryStripState({ enrollment: { ...base, status: "error" }, hasLiveSignal: true, nowMs: NOW }))
      .toEqual({ kind: "hidden" });
  });

  it("hides for a never-enrolled vehicle (renders as manual-era elsewhere)", () => {
    expect(deriveTelemetryStripState({ enrollment: null, hasLiveSignal: false, nowMs: NOW }))
      .toEqual({ kind: "hidden" });
  });

  it("renders setting-up for requested/configuring", () => {
    expect(deriveTelemetryStripState({ enrollment: base, hasLiveSignal: false, nowMs: NOW }))
      .toEqual({ kind: "setting-up", ageLabel: "enrolled 1h ago" });
    expect(deriveTelemetryStripState({ enrollment: { ...base, status: "configuring" }, hasLiveSignal: false, nowMs: NOW }))
      .toEqual({ kind: "setting-up", ageLabel: "enrolled 1h ago" });
  });

  it("renders pending-sync (accepted, no owner action) for a plain pending_sync row", () => {
    expect(deriveTelemetryStripState({ enrollment: { ...base, status: "pending_sync" }, hasLiveSignal: false, nowMs: NOW }))
      .toEqual({ kind: "pending-sync", ageLabel: "enrolled 1h ago" });
  });

  it("renders error with age", () => {
    expect(deriveTelemetryStripState({ enrollment: { ...base, status: "error" }, hasLiveSignal: false, nowMs: NOW }))
      .toEqual({ kind: "error", ageLabel: "enrolled 1h ago" });
  });

  it("distinguishes limit_reached from firmware-unsupported, both under status=unsupported", () => {
    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "unsupported", lastErrorCode: "telemetry_max_configs" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "limit-reached" });

    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "unsupported", lastErrorCode: null },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "unsupported-firmware" });
  });

  it("renders unsupported-hardware distinctly from unsupported-firmware when lastErrorCode says so", () => {
    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "unsupported", lastErrorCode: "telemetry_unsupported_hardware" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "unsupported-hardware" });

    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "unsupported", lastErrorCode: "telemetry_unsupported_firmware" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "unsupported-firmware" });
  });

  it("renders the honest generic error state (never unsupported-firmware/hardware) for the unrecognized telemetry_vehicle_skipped fallback, even under status=unsupported", () => {
    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "error", lastErrorCode: "telemetry_vehicle_skipped" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "error", ageLabel: "enrolled 1h ago" });

    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "unsupported", lastErrorCode: "telemetry_vehicle_skipped" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "error", ageLabel: "enrolled 1h ago" });
  });

  it("renders needs-pairing (self-healing, not an error) for telemetry_missing_key regardless of status", () => {
    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "pending_sync", lastErrorCode: "telemetry_missing_key" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "needs-pairing", ageLabel: "enrolled 1h ago" });

    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "error", lastErrorCode: "telemetry_missing_key" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "needs-pairing", ageLabel: "enrolled 1h ago" });
  });

  it("never routes a missing_key row to the 365-day unsupported park, even if status says unsupported", () => {
    expect(deriveTelemetryStripState({
      enrollment: { ...base, status: "unsupported", lastErrorCode: "telemetry_missing_key" },
      hasLiveSignal: false,
      nowMs: NOW,
    })).toEqual({ kind: "needs-pairing", ageLabel: "enrolled 1h ago" });
  });
});

describe("liveFieldFreshness", () => {
  it("is absent when never observed", () => {
    expect(liveFieldFreshness(null, NOW)).toBe("absent");
  });
  it("is fresh within the 24h current-stats window", () => {
    expect(liveFieldFreshness(NOW - HOUR, NOW)).toBe("fresh");
  });
  it("is stale beyond the 24h current-stats window", () => {
    expect(liveFieldFreshness(NOW - 25 * HOUR, NOW)).toBe("stale");
  });
});

describe("deriveTelemetryCause", () => {
  it("no-enrollment for undefined (loading) and null (never enrolled)", () => {
    expect(deriveTelemetryCause(undefined)).toBe("no-enrollment");
    expect(deriveTelemetryCause(null)).toBe("no-enrollment");
  });

  it("setting-up for requested / configuring / removal_requested", () => {
    for (const status of ["requested", "configuring", "removal_requested"] as const) {
      expect(deriveTelemetryCause({ status, lastErrorCode: null, createdAt: NOW })).toBe("setting-up");
    }
  });

  it("pending-sync for a plain pending_sync row -- the normal, self-resolving sleeping-car state", () => {
    expect(deriveTelemetryCause({ status: "pending_sync", lastErrorCode: null, createdAt: NOW })).toBe(
      "pending-sync",
    );
  });

  it("deployment-config-blocked only for status error + telemetry_proxy_not_configured", () => {
    expect(
      deriveTelemetryCause({ status: "error", lastErrorCode: "telemetry_proxy_not_configured", createdAt: NOW }),
    ).toBe("deployment-config-blocked");
  });

  it("other-error for status error with any other (or no) error code", () => {
    expect(deriveTelemetryCause({ status: "error", lastErrorCode: "tesla_refresh_failed", createdAt: NOW })).toBe(
      "other-error",
    );
    expect(deriveTelemetryCause({ status: "error", lastErrorCode: null, createdAt: NOW })).toBe("other-error");
  });

  it("limit-reached for the documented telemetry_max_configs skip reason, any status", () => {
    expect(
      deriveTelemetryCause({ status: "unsupported", lastErrorCode: "telemetry_max_configs", createdAt: NOW }),
    ).toBe("limit-reached");
  });

  it("unsupported-firmware for the documented telemetry_unsupported_firmware skip reason", () => {
    expect(
      deriveTelemetryCause({ status: "unsupported", lastErrorCode: "telemetry_unsupported_firmware", createdAt: NOW }),
    ).toBe("unsupported-firmware");
  });

  it("unsupported-firmware as the fallback for status=unsupported with an unrecognized/absent reason", () => {
    expect(
      deriveTelemetryCause({ status: "unsupported", lastErrorCode: "some_future_code", createdAt: NOW }),
    ).toBe("unsupported-firmware");
    expect(deriveTelemetryCause({ status: "unsupported", lastErrorCode: null, createdAt: NOW })).toBe(
      "unsupported-firmware",
    );
  });

  it("unsupported-hardware for the documented telemetry_unsupported_hardware skip reason -- genuinely permanent, distinct from firmware", () => {
    expect(
      deriveTelemetryCause({ status: "unsupported", lastErrorCode: "telemetry_unsupported_hardware", createdAt: NOW }),
    ).toBe("unsupported-hardware");
  });

  it("other-error (never unsupported-firmware/hardware) for the generic telemetry_vehicle_skipped fallback -- a reason this build doesn't recognize is not evidence of a firmware or hardware cause, regardless of which status column value carries it", () => {
    expect(
      deriveTelemetryCause({ status: "error", lastErrorCode: "telemetry_vehicle_skipped", createdAt: NOW }),
    ).toBe("other-error");
    // Defense in depth for a legacy/pre-fix row that still has status
    // 'unsupported' from before the worker stopped writing that combination.
    expect(
      deriveTelemetryCause({ status: "unsupported", lastErrorCode: "telemetry_vehicle_skipped", createdAt: NOW }),
    ).toBe("other-error");
  });

  it("needs-pairing for the documented telemetry_missing_key skip reason, regardless of which status column value carries it -- self-healing, never the 365-day park", () => {
    for (const status of ["pending_sync", "error", "unsupported", "requested", "configuring"] as const) {
      expect(
        deriveTelemetryCause({ status, lastErrorCode: "telemetry_missing_key", createdAt: NOW }),
      ).toBe("needs-pairing");
    }
  });
});

describe("liveStateEmptyCopy", () => {
  const NO_TELEMETRY_TITLE = "No telemetry yet";
  const AUTOMATIC_DETAIL =
    "This vehicle hasn't streamed a signal yet. Once Tesla telemetry is connected for it, live state and trip evidence start capturing automatically.";

  it("stays byte-identical to the original automatic-capture copy when there is no enrollment row at all (undefined = still loading, null = no row), including its action", () => {
    expect(liveStateEmptyCopy(undefined)).toEqual({
      title: NO_TELEMETRY_TITLE,
      detail: AUTOMATIC_DETAIL,
      showManageLink: true,
    });
    expect(liveStateEmptyCopy(null)).toEqual({
      title: NO_TELEMETRY_TITLE,
      detail: AUTOMATIC_DETAIL,
      showManageLink: true,
    });
  });

  it("setting-up: defers to the strip above, no action (the strip itself offers none for this state)", () => {
    const copy = liveStateEmptyCopy({ status: "requested", lastErrorCode: null, createdAt: NOW });
    expect(copy.title).toBe(NO_TELEMETRY_TITLE);
    expect(copy.showManageLink).toBe(false);
  });

  it("pending-sync: defers to the strip above, no action -- this is the normal sleeping-car state, not a problem", () => {
    const copy = liveStateEmptyCopy({ status: "pending_sync", lastErrorCode: null, createdAt: NOW });
    expect(copy.title).toBe(NO_TELEMETRY_TITLE);
    expect(copy.showManageLink).toBe(false);
  });

  it("needs-pairing: defers to the strip above, no action (the strip carries the pairing instructions)", () => {
    const copy = liveStateEmptyCopy({ status: "pending_sync", lastErrorCode: "telemetry_missing_key", createdAt: NOW });
    expect(copy.title).toBe(NO_TELEMETRY_TITLE);
    expect(copy.showManageLink).toBe(false);
  });

  it("deployment-config-blocked: defers to the notice above, no automatic-capture promise, no action", () => {
    const copy = liveStateEmptyCopy({ status: "error", lastErrorCode: "telemetry_proxy_not_configured", createdAt: NOW });
    expect(copy.title).toBe(NO_TELEMETRY_TITLE);
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.detail).toMatch(/configured/i);
    expect(copy.showManageLink).toBe(false);
    // Don't re-explain the whole error -- the strip above already does.
    expect(copy.detail.length).toBeLessThan(AUTOMATIC_DETAIL.length + 60);
  });

  it("other-error: must NOT claim the deployment is unconfigured, defers to the setup-failed notice, no action (the strip carries the reconnect action)", () => {
    const copy = liveStateEmptyCopy({ status: "error", lastErrorCode: "tesla_refresh_failed", createdAt: NOW });
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.detail).not.toMatch(/deployment/i);
    expect(copy.showManageLink).toBe(false);
  });

  it("other-error with no error code at all behaves the same as any other error code", () => {
    const copy = liveStateEmptyCopy({ status: "error", lastErrorCode: null, createdAt: NOW });
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.detail).not.toMatch(/deployment/i);
    expect(copy.showManageLink).toBe(false);
  });

  it("unrecognized skip reason (telemetry_vehicle_skipped): must NOT claim firmware or hardware are the cause, defers to the setup-failed notice, no action", () => {
    const copy = liveStateEmptyCopy({ status: "error", lastErrorCode: "telemetry_vehicle_skipped", createdAt: NOW });
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.detail).not.toMatch(/deployment/i);
    expect(copy.detail).not.toMatch(/firmware/i);
    expect(copy.detail).not.toMatch(/hardware/i);
    expect(copy.showManageLink).toBe(false);
  });

  it("limit-reached: must NOT say capture starts automatically, defers to the strip's owner-actionable explanation, no action", () => {
    const copy = liveStateEmptyCopy({ status: "unsupported", lastErrorCode: "telemetry_max_configs", createdAt: NOW });
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.showManageLink).toBe(false);
  });

  it("unsupported-firmware: must NOT say capture starts automatically, defers to the strip's owner-actionable explanation, no action", () => {
    const copy = liveStateEmptyCopy({ status: "unsupported", lastErrorCode: "telemetry_unsupported_firmware", createdAt: NOW });
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.showManageLink).toBe(false);
  });

  it("unsupported-hardware: must NOT say capture starts automatically, defers to the strip's owner-actionable explanation, no action", () => {
    const copy = liveStateEmptyCopy({ status: "unsupported", lastErrorCode: "telemetry_unsupported_hardware", createdAt: NOW });
    expect(copy.detail).not.toMatch(/automatically/i);
    expect(copy.showManageLink).toBe(false);
  });

  it("no card copy claims a deployment-configuration cause unless lastErrorCode says so", () => {
    const nonDeploymentEnrollments: (TelemetryEnrollmentRow | null | undefined)[] = [
      undefined,
      null,
      { status: "requested", lastErrorCode: null, createdAt: NOW },
      { status: "pending_sync", lastErrorCode: null, createdAt: NOW },
      { status: "pending_sync", lastErrorCode: "telemetry_missing_key", createdAt: NOW },
      { status: "error", lastErrorCode: "tesla_refresh_failed", createdAt: NOW },
      { status: "error", lastErrorCode: null, createdAt: NOW },
      { status: "error", lastErrorCode: "telemetry_vehicle_skipped", createdAt: NOW },
      { status: "unsupported", lastErrorCode: "telemetry_max_configs", createdAt: NOW },
      { status: "unsupported", lastErrorCode: "telemetry_unsupported_firmware", createdAt: NOW },
      { status: "unsupported", lastErrorCode: "telemetry_unsupported_hardware", createdAt: NOW },
    ];
    for (const enrollment of nonDeploymentEnrollments) {
      expect(liveStateEmptyCopy(enrollment).detail).not.toMatch(/deployment/i);
    }
  });

  it("no state's card copy contains the word 'automatically' unless it is genuinely automatic (only the no-enrollment case)", () => {
    const nonAutomaticEnrollments: (TelemetryEnrollmentRow | null | undefined)[] = [
      { status: "requested", lastErrorCode: null, createdAt: NOW },
      { status: "configuring", lastErrorCode: null, createdAt: NOW },
      { status: "removal_requested", lastErrorCode: null, createdAt: NOW },
      { status: "pending_sync", lastErrorCode: null, createdAt: NOW },
      { status: "pending_sync", lastErrorCode: "telemetry_missing_key", createdAt: NOW },
      { status: "error", lastErrorCode: "telemetry_proxy_not_configured", createdAt: NOW },
      { status: "error", lastErrorCode: "tesla_refresh_failed", createdAt: NOW },
      { status: "error", lastErrorCode: "telemetry_vehicle_skipped", createdAt: NOW },
      { status: "unsupported", lastErrorCode: "telemetry_max_configs", createdAt: NOW },
      { status: "unsupported", lastErrorCode: "telemetry_unsupported_firmware", createdAt: NOW },
      { status: "unsupported", lastErrorCode: "telemetry_unsupported_hardware", createdAt: NOW },
    ];
    for (const enrollment of nonAutomaticEnrollments) {
      expect(liveStateEmptyCopy(enrollment).detail).not.toMatch(/automatically/i);
    }
    // The only genuinely-automatic case: no enrollment row at all.
    expect(liveStateEmptyCopy(undefined).detail).toMatch(/automatically/i);
    expect(liveStateEmptyCopy(null).detail).toMatch(/automatically/i);
  });
});

describe("activeTripPace", () => {
  it("renders complete + battery delta when start bookend and live readings are both present", () => {
    const rollup = activeTripPace({
      start: { odometerMi: 100, batteryPct: 90 },
      liveOdometerMi: 150,
      liveBatteryPct: 70,
      policyPct: 80,
    });
    expect(rollup.odometer).toEqual({ kind: "complete", milesDriven: 50 });
    expect(rollup.batteryDeltaPct).toBe(-20);
    expect(rollup.batteryBelowPolicy).toBe(true);
    // No mileage-allowance data source exists yet — must never be guessed.
    expect(rollup.milesOverAllowance).toBeNull();
  });

  it("renders start-only when no live odometer reading exists yet", () => {
    const rollup = activeTripPace({
      start: { odometerMi: 100, batteryPct: 90 },
      liveOdometerMi: null,
      liveBatteryPct: null,
      policyPct: 80,
    });
    expect(rollup.odometer).toEqual({ kind: "start-only" });
  });

  it("renders end-only when there is a live reading but no start bookend at all", () => {
    const rollup = activeTripPace({ start: null, liveOdometerMi: 150, liveBatteryPct: 70, policyPct: 80 });
    expect(rollup.odometer).toEqual({ kind: "end-only" });
  });

  it("renders none when neither a start bookend nor a live reading exists", () => {
    const rollup = activeTripPace({ start: null, liveOdometerMi: null, liveBatteryPct: null, policyPct: 80 });
    expect(rollup.odometer).toEqual({ kind: "none" });
  });

  it("renders a data-error, never negative miles, on a live odometer regression", () => {
    const rollup = activeTripPace({
      start: { odometerMi: 500, batteryPct: 90 },
      liveOdometerMi: 490,
      liveBatteryPct: 85,
      policyPct: 80,
    });
    expect(rollup.odometer).toEqual({ kind: "data-error", reason: "odometer-regression" });
  });
});

describe("deriveLocationRowView", () => {
  it("returns null while still loading", () => {
    expect(deriveLocationRowView(null, NOW)).toBeNull();
  });

  it("collapses not_allowlisted/denied/absent to the same unavailable state", () => {
    const states: LocationEvidenceApiState[] = [{ state: "not_allowlisted" }, { state: "denied" }, { state: "absent" }];
    for (const state of states) {
      expect(deriveLocationRowView(state, NOW)).toEqual({ kind: "unavailable" });
    }
  });

  it("surfaces decrypt_error as an explicit error, not a leak", () => {
    expect(deriveLocationRowView({ state: "decrypt_error" }, NOW)).toEqual({ kind: "error" });
  });

  it("renders no-home-area when outOfArea is null", () => {
    expect(deriveLocationRowView(
      { state: "evidence", tripId: "t1", observedAtMs: NOW - 5 * 60_000, latitude: 1, longitude: 2, outOfArea: null },
      NOW,
    )).toEqual({ kind: "no-home-area", ageLabel: "5m ago" });
  });

  it("renders in-area / out-of-area from the boolean", () => {
    expect(deriveLocationRowView(
      { state: "evidence", tripId: "t1", observedAtMs: NOW - 60_000, latitude: 1, longitude: 2, outOfArea: false },
      NOW,
    )).toEqual({ kind: "in-area", ageLabel: "1m ago" });
    expect(deriveLocationRowView(
      { state: "evidence", tripId: "t1", observedAtMs: NOW - 60_000, latitude: 1, longitude: 2, outOfArea: true },
      NOW,
    )).toEqual({ kind: "out-of-area", ageLabel: "1m ago" });
  });
});

function bucket(hoursAgo: number, batteryPct: number | null): VehicleStatsHistoryBucket {
  return {
    bucketAt: NOW - hoursAgo * HOUR,
    batteryPct,
    estimatedRangeMi: null,
    odometerMi: null,
    chargingState: null,
    locked: null,
  };
}

describe("batteryHistoryPoints / batteryRangeAriaLabel", () => {
  it("drops buckets outside the window and buckets missing a battery reading", () => {
    const buckets = [bucket(200, 50), bucket(3, 80), bucket(1, null)];
    const points = batteryHistoryPoints(buckets, NOW - 7 * DAY);
    expect(points).toEqual([{ atMs: NOW - 3 * HOUR, value: 80 }]);
  });

  it("sorts ascending by time", () => {
    const buckets = [bucket(1, 60), bucket(5, 90)];
    const points = batteryHistoryPoints(buckets, NOW - 7 * DAY);
    expect(points.map((p) => p.value)).toEqual([90, 60]);
  });

  it("renders an honest empty-data sentence with no points", () => {
    expect(batteryRangeAriaLabel([])).toBe("No battery data recorded in the last 7 days.");
  });

  it("renders a range sentence, and a steady sentence when min===max", () => {
    expect(batteryRangeAriaLabel([{ atMs: 1, value: 41 }, { atMs: 2, value: 94 }]))
      .toBe("Battery ranged 41–94% over the last 7 days.");
    expect(batteryRangeAriaLabel([{ atMs: 1, value: 60 }, { atMs: 2, value: 60 }]))
      .toBe("Battery held steady at 60% over the last 7 days.");
  });
});

function session(startedAt: number, kWhAdded: number): ChargingSession {
  return { id: `s:${startedAt}`, tripId: "t1", startedAt, endedAt: startedAt + HOUR, location: "", isSupercharger: false, kWhAdded, costUsd: 0 };
}

describe("bucketChargingSessionsByDay / chargingBarsAriaLabel", () => {
  it("drops zero-kWh and out-of-window days entirely (never a flat empty bar)", () => {
    const sessions = [session(NOW - 40 * DAY, 5), session(NOW - 1 * DAY, 0)];
    expect(bucketChargingSessionsByDay(sessions, NOW - 30 * DAY, NOW)).toEqual([]);
  });

  it("sums same-day sessions and sorts most-recent day first", () => {
    const dayAgo = NOW - 1 * DAY;
    const twoDaysAgo = NOW - 2 * DAY;
    const sessions = [session(twoDaysAgo, 10), session(dayAgo, 3), session(dayAgo + 60_000, 4)];
    const bars = bucketChargingSessionsByDay(sessions, NOW - 30 * DAY, NOW);
    expect(bars.length).toBe(2);
    expect(bars[0].value).toBe(7); // most recent day first
    expect(bars[1].value).toBe(10);
  });

  it("renders an honest empty sentence with no bars, and a totals sentence otherwise", () => {
    expect(chargingBarsAriaLabel([])).toBe("No charging sessions recorded in the last 30 days.");
    expect(chargingBarsAriaLabel([{ value: 10 }, { value: 5 }]))
      .toBe("2 charging days totaling 15.0 kWh over the last 30 days.");
    expect(chargingBarsAriaLabel([{ value: 10 }])).toBe("1 charging day totaling 10.0 kWh over the last 30 days.");
  });
});

describe("retention footer helpers derive from telemetry-policy.ts constants", () => {
  it("converts ms to whole days/months without an inline literal for the threshold itself", () => {
    expect(msToWholeDays(30 * DAY)).toBe(30);
    expect(msToWholeMonths(13 * 30 * DAY)).toBe(13);
    // Sanity: BOOKEND_FRESHNESS_WINDOW_MS still imports cleanly alongside
    // the other telemetry-policy constants this module and its sibling
    // components rely on.
    expect(BOOKEND_FRESHNESS_WINDOW_MS).toBeGreaterThan(0);
  });
});
