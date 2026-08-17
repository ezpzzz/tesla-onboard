/**
 * Pure view-model derivations for the vehicle details page's telemetry
 * surfaces (T17/Phase 5 status strip, live-state freshness, active-trip
 * pace/location row, health-chart data + aria-label sentences). No I/O here
 * — the co-located components own fetching; everything below takes plain
 * inputs so it is trivially testable without jsdom (this repo's Vitest runs
 * in a node environment, no component-rendering tests).
 *
 * Every threshold used for a decision comes from lib/owner/telemetry-policy.ts
 * or lib/owner/telemetry-ingest.ts — never an inline literal here.
 */

import { isWithinCurrentStatsFreshnessWindow } from "@/lib/owner/telemetry-ingest";
import { tripWindowRollup, type TripWindowRollup } from "@/lib/owner/derive";
import type { ChargingSession } from "@/lib/owner/types";
import type { VehicleStatsHistoryBucket } from "@/lib/owner/access-types";

/* ── Age labels ────────────────────────────────────────────────────────── */

/** "3m ago" / "2h ago" / "5d ago" — shared by the live card, the active-trip
 * card, and the location evidence row so freshness reads consistently. */
export function freshnessAgeLabel(sinceMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - sinceMs);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** "enrolled 2h ago" — the setup strip's cold-start narrative (design review
 * Issue 3, 3A). */
export function enrolledAgeLabel(sinceMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - sinceMs);
  if (diffMs < 60_000) return "enrolled just now";
  return `enrolled ${freshnessAgeLabel(sinceMs, nowMs)}`;
}

/* ── Telemetry setup status strip (T17) ───────────────────────────────── */

export type TelemetryEnrollmentStatus =
  | "requested"
  | "configuring"
  | "pending_sync"
  | "active"
  | "unsupported"
  | "error"
  | "removal_requested";

export interface TelemetryEnrollmentRow {
  status: TelemetryEnrollmentStatus;
  lastErrorCode: string | null;
  createdAt: number;
}

export type TelemetryStripState =
  | { kind: "hidden" }
  | { kind: "setting-up"; ageLabel: string }
  | { kind: "pending-pairing"; ageLabel: string }
  | { kind: "error"; ageLabel: string }
  | { kind: "limit-reached" }
  | { kind: "unsupported-firmware" };

/**
 * Reads onlyevs_telemetry_enrollments.status in plain words (design review
 * Issue 3, 3A). Subtraction default: once `hasLiveSignal` is true the strip
 * never returns for this vehicle again, regardless of what the enrollment
 * row does afterward. A vehicle with no enrollment row at all (never
 * enrolled — no VIN, or Tesla not connected) renders as manual-era: no
 * strip, handled by the live-state card's own empty state instead.
 */
export function deriveTelemetryStripState(args: {
  enrollment: TelemetryEnrollmentRow | null;
  hasLiveSignal: boolean;
  nowMs: number;
}): TelemetryStripState {
  const { enrollment, hasLiveSignal, nowMs } = args;
  if (hasLiveSignal) return { kind: "hidden" };
  if (!enrollment) return { kind: "hidden" };

  if (enrollment.status === "unsupported") {
    return enrollment.lastErrorCode === "tesla_telemetry_limit_reached"
      ? { kind: "limit-reached" }
      : { kind: "unsupported-firmware" };
  }
  if (enrollment.status === "error") {
    return { kind: "error", ageLabel: enrolledAgeLabel(enrollment.createdAt, nowMs) };
  }
  if (enrollment.status === "pending_sync") {
    return { kind: "pending-pairing", ageLabel: enrolledAgeLabel(enrollment.createdAt, nowMs) };
  }
  // requested / configuring / removal_requested (the last only appears
  // briefly while an inactive vehicle's enrollment is being torn down) all
  // read as the same "no action needed" narrative.
  return { kind: "setting-up", ageLabel: enrolledAgeLabel(enrollment.createdAt, nowMs) };
}

/* ── Live-state per-field freshness ───────────────────────────────────── */

export type LiveFieldFreshness = "fresh" | "stale" | "absent";

/** Reuses the worker's own 24h current-stats freshness window
 * (telemetry-ingest.ts) so the card's "stale" flag means exactly what the
 * ingestion pipeline means by it. */
export function liveFieldFreshness(observedAtMs: number | null, nowMs: number): LiveFieldFreshness {
  if (observedAtMs === null) return "absent";
  return isWithinCurrentStatsFreshnessWindow(observedAtMs, nowMs) ? "fresh" : "stale";
}

/* ── Active-trip pace ─────────────────────────────────────────────────── */

export interface StartBookendPace {
  odometerMi: number | null;
  batteryPct: number | null;
}

/**
 * Mid-trip pace uses the trip's captured start bookend against the
 * vehicle's *current* live reading as a stand-in "in-progress end" — the
 * real end bookend does not exist until the trip actually ends. Reuses
 * tripWindowRollup so a live odometer regression (should never happen, but
 * a bad manual entry elsewhere could still cause one) renders the same
 * honest data-error state instead of a negative mile count. No mileage
 * allowance data source exists anywhere in this codebase yet (verified: no
 * config or vehicle field carries one) — `milesAllowance` is always null
 * here rather than a fabricated number.
 */
export function activeTripPace(input: {
  start: StartBookendPace | null;
  liveOdometerMi: number | null;
  liveBatteryPct: number | null;
  policyPct: number;
}): TripWindowRollup {
  return tripWindowRollup({
    odometerStartMi: input.start?.odometerMi ?? null,
    odometerEndMi: input.liveOdometerMi,
    batteryStartPct: input.start?.batteryPct ?? null,
    batteryEndPct: input.liveBatteryPct,
    milesAllowance: null,
    policyPct: input.policyPct,
  });
}

/* ── Location evidence row ────────────────────────────────────────────── */

/** Mirrors app/api/owner/vehicles/[id]/location's JSON body shapes exactly
 * (routes lane, Phase 4). */
export type LocationEvidenceApiState =
  | { state: "not_allowlisted" }
  | { state: "denied" }
  | { state: "absent" }
  | { state: "decrypt_error" }
  | {
      state: "evidence";
      tripId: string;
      observedAtMs: number;
      latitude: number;
      longitude: number;
      outOfArea: boolean | null;
    };

export type LocationRowView =
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "in-area"; ageLabel: string }
  | { kind: "out-of-area"; ageLabel: string }
  | { kind: "no-home-area"; ageLabel: string };

/**
 * `not_allowlisted` / `denied` / `absent` all collapse to the same honest
 * "not available" copy (design review + P1: never leak which precondition
 * failed to a viewer who isn't debugging the allowlist). `null` means the
 * caller is still loading — render a skeleton, not a state.
 */
export function deriveLocationRowView(
  api: LocationEvidenceApiState | null,
  nowMs: number,
): LocationRowView | null {
  if (!api) return null;
  switch (api.state) {
    case "not_allowlisted":
    case "denied":
    case "absent":
      return { kind: "unavailable" };
    case "decrypt_error":
      return { kind: "error" };
    case "evidence": {
      const ageLabel = freshnessAgeLabel(api.observedAtMs, nowMs);
      if (api.outOfArea === null) return { kind: "no-home-area", ageLabel };
      return api.outOfArea ? { kind: "out-of-area", ageLabel } : { kind: "in-area", ageLabel };
    }
  }
}

/* ── Health charts ────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ChartPoint {
  atMs: number;
  value: number;
}

/** Battery-only slice of the bucketed history series, oldest first, for the
 * 7-day line chart. Buckets without a battery reading in the window are
 * dropped rather than rendered as a fabricated zero. */
export function batteryHistoryPoints(
  buckets: VehicleStatsHistoryBucket[],
  sinceMs: number,
): ChartPoint[] {
  return buckets
    .filter((b) => b.bucketAt >= sinceMs && b.batteryPct !== null)
    .map((b) => ({ atMs: b.bucketAt, value: b.batteryPct as number }))
    .sort((a, b) => a.atMs - b.atMs);
}

export function batteryRangeAriaLabel(points: ChartPoint[]): string {
  if (points.length === 0) return "No battery data recorded in the last 7 days.";
  const values = points.map((p) => p.value);
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  return min === max
    ? `Battery held steady at ${min}% over the last 7 days.`
    : `Battery ranged ${min}–${max}% over the last 7 days.`;
}

/**
 * Daily kWh totals for the charging bar chart, most-recent non-zero day
 * first, capped to the 14 most recent days with any activity. Days with no
 * charging are dropped entirely (not rendered as flat zero bars) so an
 * honestly-empty vehicle renders MiniBarChart's built-in "No data yet"
 * state rather than a wall of empty bars.
 */
export function bucketChargingSessionsByDay(
  sessions: ChargingSession[],
  sinceMs: number,
  untilMs: number,
): { label: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    if (session.startedAt < sinceMs || session.startedAt > untilMs) continue;
    const day = new Date(session.startedAt);
    const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth()).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
    totals.set(key, (totals.get(key) ?? 0) + session.kWhAdded);
  }
  return Array.from(totals.entries())
    .filter(([, kWh]) => kWh > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
    .map(([key, value]) => {
      const [, month, date] = key.split("-").map(Number);
      return { label: `${MONTHS[month]} ${date}`, value };
    });
}

export function chargingBarsAriaLabel(bars: { value: number }[]): string {
  if (bars.length === 0) return "No charging sessions recorded in the last 30 days.";
  const totalKwh = bars.reduce((sum, bar) => sum + bar.value, 0);
  return `${bars.length} charging day${bars.length === 1 ? "" : "s"} totaling ${totalKwh.toFixed(1)} kWh over the last 30 days.`;
}

/* ── Retention footer copy (derived from telemetry-policy.ts, never an
   inline literal) ────────────────────────────────────────────────────── */

export function msToWholeDays(ms: number): number {
  return Math.round(ms / (24 * 60 * 60 * 1_000));
}

export function msToWholeMonths(ms: number): number {
  return Math.round(ms / (30 * 24 * 60 * 60 * 1_000));
}
