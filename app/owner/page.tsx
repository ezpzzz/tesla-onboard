"use client";

/**
 * Owner dashboard overview — attention-first: alerts before anything else,
 * then fleet-wide stats, a quick energy-cost chart, and two "glance" lists
 * that each link out to their full page (drivers / trips).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useOwnerState } from "@/lib/owner/owner-state";
import { useOwnerSetupState, needsSetup } from "@/lib/owner/setup-state";
import { deriveAlerts } from "@/lib/owner/alerts";
import {
  driverStatus,
  formatMiles,
  formatPct,
  formatUsd,
  sessionsForTrip,
  tripEnergy,
} from "@/lib/owner/derive";
import {
  AlertsPanel,
  StatTile,
  StatusPill,
  TripStatusBadge,
} from "@/components/owner/owner-ui";
import { MiniBarChart } from "@/components/owner/charts";
import { Button, Card } from "@/components/ui";
import { IconBolt, IconChevronRight } from "@/components/icons";
import type { DriverStatus } from "@/lib/owner/types";

// Stable pre-hydration fallback so SSR markup matches the first client paint —
// `now` only becomes the real clock after mount, same pattern as the alerts
// and stalled-driver math that depend on it.
const SSR_FALLBACK_NOW = 0;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Lower rank = needs attention sooner. "ready" drivers never show up here.
const NEEDS_ATTENTION_RANK: Record<DriverStatus, number> = {
  stalled: 0,
  "not-started": 1,
  "in-progress": 2,
  ready: 3,
};

export default function OwnerOverviewPage() {
  const router = useRouter();
  const { drivers, trips, vehicles, chargingSessions, stats, policyPct } = useOwnerData();
  const { state: ownerState, hydrated: ownerHydrated } = useOwnerState();
  const { state: setupState, hydrated: setupHydrated, update: updateSetup } = useOwnerSetupState();
  const [now, setNow] = useState(SSR_FALLBACK_NOW);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  const hydrated = ownerHydrated && now !== SSR_FALLBACK_NOW;

  const alerts = hydrated
    ? deriveAlerts({ drivers, trips, vehicles, chargingSessions, ownerState, policyPct, now })
    : [];

  const needsAttention = drivers
    .map((driver) => ({ driver, status: driverStatus(driver, hydrated ? now : SSR_FALLBACK_NOW) }))
    .filter((row) => row.status !== "ready")
    .sort((a, b) => NEEDS_ATTENTION_RANK[a.status] - NEEDS_ATTENTION_RANK[b.status])
    .slice(0, 4);

  const recentTrips = trips.slice().sort((a, b) => b.startAt - a.startAt).slice(0, 4);

  const completedTrips = trips.filter((t) => t.status === "completed");
  const energyChartData = completedTrips
    .slice()
    .sort((a, b) => a.startAt - b.startAt)
    .map((trip) => ({
      label: formatShortDate(trip.startAt),
      value: tripEnergy(sessionsForTrip(chargingSessions, trip.id)).costUsd,
    }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Overview</h1>
          <p className="mt-1 text-sm text-muted">What needs you, at a glance.</p>
        </div>
        <Link
          href="/owner/setup"
          className="text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          Fleet setup
        </Link>
      </div>

      {setupHydrated && needsSetup(setupState) && (
        <section>
          <Card className="flex flex-wrap items-center justify-between gap-4 border-brand/20 bg-brand/5 p-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <IconBolt aria-hidden="true" className="h-4 w-4 text-brand" />
                Set up your fleet
              </div>
              <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">
                Connect your Tesla account, import your vehicles, and confirm your rental
                settings — takes about a minute.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => updateSetup({ dismissedAt: Date.now() })}
                className="flex min-h-[44px] items-center px-1 text-sm font-medium text-muted hover:text-ink"
              >
                Not now
              </button>
              <Button onClick={() => router.push("/owner/setup")}>Start setup</Button>
            </div>
          </Card>
        </section>
      )}

      <section>
        <AlertsPanel alerts={alerts} />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total miles rented" value={formatMiles(stats.totalMilesRented)} />
        <StatTile label="Energy cost" value={formatUsd(stats.totalEnergyCostUsd)} />
        <StatTile
          label="Avg return charge"
          value={stats.avgReturnChargePct === null ? "—" : formatPct(stats.avgReturnChargePct)}
        />
        <StatTile
          label="Active + upcoming trips"
          value={stats.tripCounts.active + stats.tripCounts.upcoming}
        />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Energy cost per trip</h2>
          <Link
            href="/owner/trips"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            All trips
            <IconChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
        <Card className="p-4">
          <MiniBarChart
            data={energyChartData}
            formatValue={formatUsd}
            ariaLabel="Energy cost per completed trip"
          />
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Needs attention</h2>
          <Link
            href="/owner/drivers"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            All drivers
            <IconChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
        {needsAttention.length === 0 ? (
          <Card className="p-4 text-sm text-muted">Every driver is on track or ready.</Card>
        ) : (
          <ul className="space-y-2">
            {needsAttention.map(({ driver, status }) => (
              <li key={driver.id}>
                <Link
                  href={`/owner/drivers/${driver.id}`}
                  className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line bg-white p-3.5 transition-colors hover:bg-surface"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                    {driver.name || "Unnamed guest"}
                  </span>
                  <StatusPill status={status} />
                  <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recent trips</h2>
          <Link
            href="/owner/trips"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            All trips
            <IconChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
        {recentTrips.length === 0 ? (
          <Card className="p-4 text-sm text-muted">No trips yet.</Card>
        ) : (
          <ul className="space-y-2">
            {recentTrips.map((trip) => {
              const driver = drivers.find((d) => d.id === trip.driverId);
              return (
                <li key={trip.id}>
                  <Link
                    href={`/owner/trips/${trip.id}`}
                    className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line bg-white p-3.5 transition-colors hover:bg-surface"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink-soft">
                      <span className="font-medium text-ink">
                        {formatShortDate(trip.startAt)}
                      </span>
                      {" · "}
                      {driver ? driver.name || "Unnamed guest" : "Unassigned"}
                    </span>
                    <TripStatusBadge status={trip.status} />
                    <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
