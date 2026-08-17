/**
 * Cross-trip guest rollup stats (Phase 7, guest detail hierarchy — design
 * review Issue 1 / 1A): identity header -> trip history list -> rollup
 * stats, history before aggregates because disputes reference trips, not
 * averages. This section renders last, and only once the premise P4
 * key-stability validation (design doc: "one SQL query over onlyevs_trips
 * joined to guest bindings... if ANY known repeat guest maps to more than
 * one verified_email_hash, cross-trip rollups stay off") has actually run
 * and passed — a binary bar, no partial credit.
 *
 * That validation is a one-time server-side query, not a runtime check this
 * client component can perform, so the gate here is a build-time flag: flip
 * it to true only after the validation query has been run and passed (see
 * the design doc's P4 method). Until then this module renders nothing —
 * "hidden" means absent, not a disabled/greyed section.
 */

import { tripWindowRollup } from "@/lib/owner/derive";
import type { Trip } from "@/lib/owner/types";

/** Flip only after the Phase 3 / P4 key-stability validation query has been
 * run against real guest bindings and passed. See lib/owner/guest-linking.ts
 * and the design doc's "P4 key-stability validation" section. */
export const GUEST_CROSS_TRIP_ROLLUPS_ENABLED = false;

export interface GuestRollupStatsProps {
  trips: Trip[];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Pure rollup computation over a guest's own completed trips — miles driven
 * and trip count only (no fabricated averages when there is nothing to
 * average). Mirrors lib/owner/derive.ts's `tripWindowRollup` (also used by
 * ledger-view.ts) for the odometer math so an odometer regression
 * (odometerEndMi < odometerStartMi, e.g. a bad manual entry) renders as its
 * `data-error` state and contributes zero miles to the total rather than a
 * negative figure — never a second, drifted copy of that rule. Exported for
 * testing independent of the flag/rendering. */
export function computeGuestRollup(trips: Trip[]): { tripCount: number; totalMiles: number } {
  const milesPerTrip = trips.map((trip) => {
    const rollup = tripWindowRollup({
      odometerStartMi: trip.odometerStartMi,
      odometerEndMi: trip.odometerEndMi,
      batteryStartPct: null,
      batteryEndPct: null,
    });
    return rollup.odometer.kind === "complete" ? rollup.odometer.milesDriven : 0;
  });
  return { tripCount: trips.length, totalMiles: sum(milesPerTrip) };
}

/** Renders nothing when the validation gate is closed — never a disabled or
 * teaser state, since a wrong cross-guest average is worse than no section
 * at all. */
export function GuestRollupStats({ trips }: GuestRollupStatsProps) {
  if (!GUEST_CROSS_TRIP_ROLLUPS_ENABLED) return null;
  const rollup = computeGuestRollup(trips);
  return (
    <div className="rounded-md border border-line bg-white p-3.5">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
        Across all trips
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <div>
          <div className="text-lg font-semibold text-ink">{rollup.tripCount}</div>
          <div className="text-xs text-muted">Trips</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-ink">{Math.round(rollup.totalMiles)}</div>
          <div className="text-xs text-muted">Miles driven</div>
        </div>
      </div>
    </div>
  );
}
