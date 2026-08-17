"use client";

/**
 * Trip evidence ledger (Phase 5, design review Issue 4/6/7): opens with the
 * four lifetime tiles as its summary row (T18 — same numbers, moved from
 * the old page-top tile row, killing the double tile row) and continues
 * with bookend rows — a desktop table, and stacked two-line tap-through
 * entries on mobile (T20; never a horizontal-scroll table).
 */

import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { EmptyState, StatTile, formatDate } from "@/components/owner/owner-ui";
import type { ChargingSession, Driver, Trip, Vehicle } from "@/lib/owner/types";
import { formatMiles, formatPct, vehicleStats } from "@/lib/owner/derive";
import { batteryCaptureNote, buildLedgerRows, formatKwh, lifetimeKwh, odometerCaptureNote, type LedgerRowModel } from "./ledger-view";

function driverName(drivers: Driver[], driverId: string | null): string {
  if (!driverId) return "Unassigned guest";
  return drivers.find((d) => d.id === driverId)?.name || "Guest";
}

/** Renders "—" for an absent field, but — when exactly one edge was
 * captured — carries the committed "Not captured at pickup/return" phrase
 * as the visible dash's title/aria-label (G6): compact on-screen, full
 * phrase for anyone (or any test) reading the accessible name. */
function AbsentField({ note }: { note: string | null }) {
  if (!note) return <>—</>;
  return (
    <span title={note} aria-label={note}>
      —
    </span>
  );
}

function milesLabel(rollup: LedgerRowModel["rollup"]) {
  if (rollup.odometer.kind === "complete") {
    return <>{Math.round(rollup.odometer.milesDriven).toLocaleString()} mi</>;
  }
  return <AbsentField note={odometerCaptureNote(rollup)} />;
}

function batteryDeltaLabel(trip: Trip, rollup: LedgerRowModel["rollup"]) {
  if (rollup.batteryDeltaPct === null) {
    return <AbsentField note={batteryCaptureNote(trip.batteryStartPct, trip.batteryEndPct)} />;
  }
  const rounded = Math.round(rollup.batteryDeltaPct);
  return <>{`${rounded > 0 ? "+" : ""}${rounded}%`}</>;
}

export function LedgerSection({
  vehicle,
  trips,
  drivers,
  chargingSessions,
  policyPct,
}: {
  vehicle: Vehicle;
  trips: Trip[];
  drivers: Driver[];
  chargingSessions: ChargingSession[];
  policyPct: number;
}) {
  const linkedTrips = trips.filter((t) => t.vehicleId === vehicle.id);
  const stats = vehicleStats(vehicle.id, linkedTrips, chargingSessions);
  const rows = buildLedgerRows(linkedTrips, chargingSessions, vehicle, policyPct);
  const kWh = lifetimeKwh(rows);

  return (
    <div className="space-y-3">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Trip evidence ledger</div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Trips" value={stats.tripCount} />
        <StatTile label="Miles rented" value={formatMiles(stats.milesRented)} />
        {/* Energy tile renders kWh permanently — never a dollar amount
            (design review Issue 7, 7A). Dollar amounts, when a trusted cost
            source exists, only ever appear at session/trip granularity with
            their provenance, which this summary tile has no room for. */}
        <StatTile label="Energy" value={formatKwh(kWh)} />
        <StatTile
          label="Avg return charge"
          value={stats.avgReturnChargePct === null ? "—" : formatPct(stats.avgReturnChargePct)}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No trips yet. Evidence starts recording with your first trip." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-white md:block">
            <table className="w-full min-w-[820px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th scope="col" className="px-4 py-3 font-medium">Dates</th>
                  <th scope="col" className="px-4 py-3 font-medium">Guest</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Miles</th>
                  <th scope="col" className="px-4 py-3 font-medium">Battery Δ</th>
                  <th scope="col" className="px-4 py-3 font-medium">Energy</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ trip, rollup, badge, kWh: rowKwh }) => (
                  <tr key={trip.id} className="border-b border-line last:border-0 hover:bg-surface">
                    <td className="px-4 py-3">
                      <Link
                        href={`/owner/trips/${trip.id}`}
                        className="inline-flex min-h-[28px] items-center font-medium text-ink hover:text-brand"
                      >
                        {formatDate(trip.startAt)} – {formatDate(trip.endAt)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{driverName(drivers, trip.driverId)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{milesLabel(rollup)}</td>
                    <td className="px-4 py-3 text-ink-soft">{batteryDeltaLabel(trip, rollup)}</td>
                    <td className="px-4 py-3 text-ink-soft">{formatKwh(rowKwh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5 md:hidden">
            {rows.map(({ trip, rollup, badge, kWh: rowKwh }) => (
              <Link key={trip.id} href={`/owner/trips/${trip.id}`} className="block">
                <Card className="p-4 transition-colors hover:bg-surface">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[14px] font-medium text-ink">
                      {formatDate(trip.startAt)} – {formatDate(trip.endAt)} · {driverName(drivers, trip.driverId)}
                    </span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{milesLabel(rollup)}</span>
                    <span>{batteryDeltaLabel(trip, rollup)} battery</span>
                    <span>{formatKwh(rowKwh)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
