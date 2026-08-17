/**
 * Pure view-model derivations for the vehicle details page's trip evidence
 * ledger (Phase 5 + design review Issue 4/6/7 — lifetime tiles as the
 * ledger's summary row, mobile stacked rows, kWh-permanent Energy tile).
 * No I/O — see components/owner/ledger-section.tsx for the presentational
 * half. Vitest-testable without jsdom (this repo's Vitest runs node-only).
 */

import { resolveVehiclePolicyPct, sessionsForTrip, tripEnergy, tripWindowRollup, type TripWindowRollup } from "@/lib/owner/derive";
import type { ChargingSession, Trip, Vehicle } from "@/lib/owner/types";

export type LedgerBadgeTone = "good" | "warn" | "danger" | "neutral";

export interface LedgerBadge {
  tone: LedgerBadgeTone;
  label: string;
}

export interface LedgerRowModel {
  trip: Trip;
  rollup: TripWindowRollup;
  badge: LedgerBadge;
  kWh: number;
}

/**
 * One badge per row, covering every bookend combination in the design's
 * degraded-state checklist: complete (clean/needs-attention), start-only,
 * end-only (pre-telemetry straddle), none (manual-era or in-progress), and
 * the odometer-regression data-error state.
 */
export function classifyLedgerRow(trip: Trip, rollup: TripWindowRollup): LedgerBadge {
  if (rollup.odometer.kind === "data-error") {
    return { tone: "danger", label: "Data error" };
  }

  if (rollup.odometer.kind === "none") {
    if (trip.status === "completed") return { tone: "neutral", label: "Recorded manually" };
    return { tone: "neutral", label: trip.status === "active" ? "In progress" : "Upcoming" };
  }

  if (rollup.odometer.kind === "start-only") {
    // Trip already has a start bookend but no end one yet.
    if (trip.status === "completed") return { tone: "warn", label: "Return not captured" };
    return { tone: "neutral", label: trip.status === "active" ? "In progress" : "Upcoming" };
  }

  if (rollup.odometer.kind === "end-only") {
    // Straddle rule: rollout landed mid-trip, or the trip predates it.
    return { tone: "neutral", label: "Start not captured (pre-telemetry)" };
  }

  // complete
  if (rollup.batteryBelowPolicy === true) {
    return { tone: "warn", label: "Needs attention" };
  }
  return { tone: "good", label: "Clean return" };
}

/** Newest-first rows for one vehicle, each carrying its windowed rollup,
 * status badge, and this trip's kWh (from the legacy per-trip
 * ChargingSession list — see ledger-section.tsx's header comment for why
 * this is currently always an honest zero in workspace mode). */
export function buildLedgerRows(
  trips: Trip[],
  chargingSessions: ChargingSession[],
  vehicle: Vehicle | null,
  policyPct: number,
): LedgerRowModel[] {
  const effectivePolicyPct = resolveVehiclePolicyPct(vehicle, policyPct);
  return trips
    .slice()
    .sort((a, b) => b.startAt - a.startAt)
    .map((trip) => {
      const rollup = tripWindowRollup({
        odometerStartMi: trip.odometerStartMi,
        odometerEndMi: trip.odometerEndMi,
        batteryStartPct: trip.batteryStartPct,
        batteryEndPct: trip.batteryEndPct,
        milesAllowance: null,
        policyPct: effectivePolicyPct,
      });
      const kWh = tripEnergy(sessionsForTrip(chargingSessions, trip.id)).kWh;
      return { trip, rollup, badge: classifyLedgerRow(trip, rollup), kWh };
    });
}

/* ── Lifetime Energy tile (design review Issue 7, 7A) ─────────────────────
 * The tile renders kWh permanently, never a dollar amount — dollars only
 * ever appear at session/trip granularity with their provenance, which this
 * tile deliberately has no room for. */

export function lifetimeKwh(rows: LedgerRowModel[]): number {
  return rows.reduce((sum, row) => sum + row.kWh, 0);
}

export function formatKwh(n: number): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} kWh`;
}

/* ── Absent-bookend-field labels (G6 — "state what is true" over a bare
 * dash) ──────────────────────────────────────────────────────────────────
 * When exactly one edge of a bookend pair was captured, the ledger names
 * which edge is missing instead of rendering an unexplained "—". Both edges
 * absent (kind "none") stays a bare dash — the row's status badge already
 * says why (Recorded manually / In progress / Upcoming), and naming a
 * specific "not captured" edge there would imply a capture attempt was
 * made when none has happened yet. */

/** Which edge is missing for the odometer/miles field, or null when both
 * edges are present (or both absent — the badge covers that case). */
export function odometerCaptureNote(rollup: TripWindowRollup): string | null {
  if (rollup.odometer.kind === "start-only") return "Not captured at return";
  if (rollup.odometer.kind === "end-only") return "Not captured at pickup";
  return null;
}

/** Which edge is missing for the battery field, or null when both edges are
 * present (or both absent). Takes the raw trip fields directly — the
 * derived rollup only exposes a single nullable delta, not per-edge state. */
export function batteryCaptureNote(
  batteryStartPct: number | null,
  batteryEndPct: number | null,
): string | null {
  if (batteryStartPct === null && batteryEndPct === null) return null;
  if (batteryStartPct === null) return "Not captured at pickup";
  if (batteryEndPct === null) return "Not captured at return";
  return null;
}
