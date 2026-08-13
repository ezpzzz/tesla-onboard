"use client";

/**
 * Trip detail — header (driver, car, status, dates), stat row, battery
 * return gauge vs. policy, timeline, charging sessions, a cost-recovery
 * callout when there's money to pass through, and the return checklist for
 * trips that have actually started.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useOwnerState } from "@/lib/owner/owner-state";
import { hostConfig } from "@/lib/config";
import {
  formatMiles,
  formatUsd,
  parseReturnPolicyPct,
  resolveVehiclePolicyPct,
  sessionsForTrip,
  tripEnergy,
  tripMiles,
} from "@/lib/owner/derive";
import {
  ChargingSessionList,
  EmptyState,
  ReturnChecklistCard,
  StatTile,
  TripStatusBadge,
} from "@/components/owner/owner-ui";
import { BatteryReturnGauge, TripTimeline } from "@/components/owner/charts";
import { Badge, Button, Card } from "@/components/ui";
import { IconAlert } from "@/components/icons";

/* UTC-only formatting so server and first client paint always agree — see
 * the same convention in components/owner/owner-ui.tsx. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h12}:${String(m).padStart(2, "0")} ${ampm} UTC`;
}

function formatDateRange(startMs: number, endMs: number): string {
  return `${formatDateTime(startMs)} – ${formatDateTime(endMs)}`;
}

export default function TripDetailPage() {
  const params = useParams<{ id: string }>();
  const tripId = params.id;
  const { trips, drivers, vehicles, chargingSessions, hydrated } = useOwnerData();
  const { state: ownerState } = useOwnerState();
  const [copied, setCopied] = useState(false);

  const trip = trips.find((t) => t.id === tripId) ?? null;
  const driver = trip ? drivers.find((d) => d.id === trip.driverId) ?? null : null;
  const vehicle = trip ? vehicles.find((v) => v.id === trip.vehicleId) ?? null : null;
  const sessions = trip ? sessionsForTrip(chargingSessions, trip.id) : [];
  const energy = useMemo(() => tripEnergy(sessions), [sessions]);
  const miles = trip ? tripMiles(trip) : null;
  const globalPolicyPct = useMemo(
    () => parseReturnPolicyPct(hostConfig.rental.returnChargeLevel),
    [],
  );
  const policyPct = resolveVehiclePolicyPct(vehicle, globalPolicyPct);

  if (!hydrated) {
    return <Card className="p-6 text-center text-sm text-muted">Loading trip…</Card>;
  }

  if (!trip) {
    return (
      <EmptyState
        title="Trip not found."
        detail={`No trip with id "${tripId}" — it may have been reassigned or the link is stale.`}
      >
        <Link
          href="/owner/trips"
          className="text-sm font-medium text-brand hover:underline"
        >
          Back to trips
        </Link>
      </EmptyState>
    );
  }

  const belowPolicy = trip.batteryEndPct !== null && trip.batteryEndPct < policyPct;
  const showCostRecovery =
    trip.status === "completed" &&
    (energy.superchargerCostUsd > 0 || belowPolicy) &&
    !(belowPolicy && ownerState.tripChecklists[trip.id]?.chargedToPolicy);

  function copyGuestLink() {
    const url = `${window.location.origin}/?trip=${trip!.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {driver ? (
              <Link
                href={`/owner/drivers/${driver.id}`}
                className="text-lg font-semibold tracking-tight text-ink hover:text-brand"
              >
                {driver.name || "Unnamed guest"}
              </Link>
            ) : (
              <span className="text-lg font-semibold tracking-tight text-ink">Unassigned</span>
            )}
            <div className="mt-0.5 text-sm text-muted">
              {vehicle ? (
                <Link
                  href={`/owner/vehicles/${vehicle.id}`}
                  className="inline-flex items-center gap-1.5 hover:text-brand"
                >
                  <span>
                    {vehicle.displayName} {vehicle.trim} · {vehicle.color}
                  </span>
                  {vehicle.status === "archived" && <Badge tone="neutral">Archived</Badge>}
                </Link>
              ) : (
                `${hostConfig.car.year} ${hostConfig.car.model} ${hostConfig.car.trim} · ${hostConfig.car.color}`
              )}
            </div>
          </div>
          <TripStatusBadge status={trip.status} />
        </div>
        <div className="mt-3 text-sm text-ink-soft">
          {formatDateRange(trip.startAt, trip.endAt)}
        </div>

        {trip.status === "upcoming" && trip.driverId === null && (
          <div className="mt-4">
            <Button variant="secondary" onClick={copyGuestLink}>
              {copied ? "Copied!" : "Copy guest link"}
            </Button>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Miles driven" value={miles === null ? "—" : formatMiles(miles)} />
        <StatTile
          label="Energy cost"
          value={formatUsd(energy.costUsd)}
          sub={
            energy.superchargerCostUsd > 0
              ? `${formatUsd(energy.superchargerCostUsd)} Supercharging`
              : undefined
          }
        />
        <StatTile
          label="Battery start → end"
          value={
            trip.batteryStartPct === null
              ? "—"
              : `${trip.batteryStartPct}% → ${trip.batteryEndPct === null ? "…" : `${trip.batteryEndPct}%`}`
          }
        />
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Return charge vs. policy
        </div>
        <div className="mt-3">
          <BatteryReturnGauge
            startPct={trip.batteryStartPct}
            endPct={trip.batteryEndPct}
            policyPct={policyPct}
            ariaLabel={`Battery ${trip.batteryStartPct ?? "unknown"}% at pickup, ${trip.batteryEndPct ?? "not yet returned"}% at return, policy ${policyPct}%`}
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Trip timeline
        </div>
        <div className="mt-3">
          <TripTimeline
            trip={trip}
            sessions={sessions}
            ariaLabel={`Trip timeline with ${sessions.length} charging session${sessions.length === 1 ? "" : "s"}`}
          />
        </div>
      </Card>

      {showCostRecovery && (
        <Card className="border-warn/30 bg-warn/5 p-4">
          <div className="flex items-start gap-3">
            <IconAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div>
              <div className="text-[14px] font-semibold text-ink">Money to pass through</div>
              <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-ink-soft">
                {energy.superchargerCostUsd > 0 && (
                  <li>{formatUsd(energy.superchargerCostUsd)} in Supercharging billed to the car.</li>
                )}
                {belowPolicy && (
                  <li>
                    Returned at {trip.batteryEndPct}%, below the {policyPct}% return policy.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div>
        <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
          Charging sessions
        </div>
        <ChargingSessionList sessions={sessions} />
      </div>

      {(trip.status === "active" || trip.status === "completed") && (
        <ReturnChecklistCard tripId={trip.id} />
      )}
    </div>
  );
}
