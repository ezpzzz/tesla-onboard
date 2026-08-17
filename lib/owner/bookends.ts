import type { BookendEdge } from "./access-types";
import { BOOKEND_END_TRACKING_GRACE_MS, BOOKEND_FRESHNESS_WINDOW_MS } from "./telemetry-policy";

/**
 * Pure trip-bookend capture-decision helpers (Phase 2).
 *
 * No I/O here — the worker (services/onlyevs-worker/index.ts, T1 worker
 * lane) owns the runOnce sweep, the grant-edge on-conflict SQL, and the
 * actual write. These signatures exist so the worker lane, the ledger
 * components, and tests all compile against one fixed contract:
 *   - freshness: per-field `observed_at` vs. BOOKEND_FRESHNESS_WINDOW_MS
 *     (30 min) from telemetry-policy.ts, never an inline literal.
 *   - absent-data rule: no stats row, or a field that never streamed,
 *     yields null for that field — never fabricated or carried forward.
 *   - late-return rule (outside-voice Issue 6B): the end bookend keeps
 *     upserting until the trip completes, capped at
 *     ends_at + BOOKEND_END_TRACKING_GRACE_MS (24h).
 *
 * `captureBookendField`'s `capturedAtMs`/`deriveBookendDelta` freshness
 * reference is the trip's own edge time (starts_at for edge=start, ends_at
 * for edge=end) — the plan's freshness spec is "within 30 minutes of the
 * edge", not of wall-clock write time. The worker passes the edge time here
 * and records the actual wall-clock write moment separately in the
 * bookend row's own `captured_at` column.
 */

export interface BookendFieldSample {
  value: number | null;
  observedAt: number | null;
}

export interface BookendFieldCapture {
  value: number | null;
  observedAt: number | null;
  /** true when observedAt is older than BOOKEND_FRESHNESS_WINDOW_MS
   * relative to capturedAtMs. Always false when value/observedAt are null
   * (there is no age to be stale about — render "Not captured" instead). */
  stale: boolean;
}

/** Absent-data + freshness rule for a single bookend field (Code Quality
 * Issue 3, 3A). */
export function captureBookendField(
  sample: BookendFieldSample,
  capturedAtMs: number,
): BookendFieldCapture {
  if (sample.value === null || sample.observedAt === null) {
    return { value: null, observedAt: null, stale: false };
  }
  const ageMs = capturedAtMs - sample.observedAt;
  return {
    value: sample.value,
    observedAt: sample.observedAt,
    stale: ageMs > BOOKEND_FRESHNESS_WINDOW_MS,
  };
}

export interface BookendWindowDueArgs {
  nowMs: number;
  startsAtMs: number;
  endsAtMs: number;
}

/** Sweep trigger (eng-review Issue 1, 1A): every trip has a schedule, so
 * every trip gets bookends, grant or not. True once "now" has reached the
 * relevant edge's trip-window boundary. Grant-issue/revoke edges refine
 * through the DB's own on-conflict rules, not through branching here. */
export function isBookendWindowDue(edge: BookendEdge, args: BookendWindowDueArgs): boolean {
  return args.nowMs >= (edge === "start" ? args.startsAtMs : args.endsAtMs);
}

export interface EndBookendTrackingArgs {
  nowMs: number;
  endsAtMs: number;
  tripCompleted: boolean;
}

/** Late-return rule (outside-voice Issue 6, 6B): whether the end bookend
 * should still upsert on this sweep. */
export function isEndBookendStillTracking(args: EndBookendTrackingArgs): boolean {
  if (args.tripCompleted) return false;
  return args.nowMs <= args.endsAtMs + BOOKEND_END_TRACKING_GRACE_MS;
}

export interface BookendDeltaInput {
  startOdometerMi: number | null;
  endOdometerMi: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
}

export interface BookendDelta {
  milesDriven: number | null;
  batteryDeltaPct: number | null;
  /** true when endOdometerMi < startOdometerMi — a data-error state to
   * render explicitly, never negative miles (Success Criteria checklist). */
  odometerRegression: boolean;
}

/** Windowed delta derivation shared by the ledger, the active-trip card, and
 * evidence packets. Full/start-only/end-only bookend combinations must each
 * render an honest partial result, never a guessed one. */
export function deriveBookendDelta(input: BookendDeltaInput): BookendDelta {
  const { startOdometerMi, endOdometerMi, startBatteryPct, endBatteryPct } = input;
  const bothOdometer = startOdometerMi !== null && endOdometerMi !== null;
  const odometerRegression = bothOdometer && endOdometerMi! < startOdometerMi!;
  return {
    milesDriven: bothOdometer && !odometerRegression ? endOdometerMi! - startOdometerMi! : null,
    batteryDeltaPct: startBatteryPct !== null && endBatteryPct !== null
      ? endBatteryPct - startBatteryPct
      : null,
    odometerRegression,
  };
}
