"use client";

/**
 * Active trip card (Phase 5) — guest, window, live-vs-start pace, and the
 * location evidence row. Hidden entirely when there is no active trip
 * (interaction-state table, design review Issue 2). Fetches once per active
 * trip (start bookend) and once per vehicle (location evidence) — never
 * fleet-wide, matching Issue 5A's lazy-fetch discipline.
 */

import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import { StatTile, formatDate } from "@/components/owner/owner-ui";
import { IconMapPin } from "@/components/icons";
import type { Driver, Trip, Vehicle } from "@/lib/owner/types";
import type { VehicleStatsCurrent } from "@/lib/owner/access-types";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { fetchTripBookends } from "@/lib/owner/trip-repository";
import { resolveVehiclePolicyPct } from "@/lib/owner/derive";
import {
  activeTripPace,
  deriveLocationRowView,
  freshnessAgeLabel,
  type LocationEvidenceApiState,
  type StartBookendPace,
} from "./telemetry-view";

function useActiveTripStart(tripId: string): StartBookendPace | null | undefined {
  const [start, setStart] = useState<StartBookendPace | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setStart(undefined);
    fetchTripBookends(tripId)
      .then((bookends) => {
        if (cancelled) return;
        const edge = bookends.find((b) => b.edge === "start") ?? null;
        setStart(edge ? { odometerMi: edge.odometerMi, batteryPct: edge.batteryPct } : null);
      })
      .catch(() => {
        if (!cancelled) setStart(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);
  return start;
}

function useLocationEvidence(
  scope: VehicleWorkspaceScope | null,
  vehicleId: string,
): LocationEvidenceApiState | null {
  const [state, setState] = useState<LocationEvidenceApiState | null>(null);
  useEffect(() => {
    if (!scope) {
      setState(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/owner/vehicles/${encodeURIComponent(vehicleId)}/location?workspaceId=${encodeURIComponent(scope.workspaceId)}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setState(body as LocationEvidenceApiState);
      })
      .catch(() => {
        if (!cancelled) setState({ state: "absent" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope.key is
    // the stable identity; see telemetry-status-strip.tsx for why.
  }, [scope?.key, vehicleId]);
  return state;
}

function LocationRow({
  scope,
  vehicleId,
  nowMs,
}: {
  scope: VehicleWorkspaceScope | null;
  vehicleId: string;
  nowMs: number;
}) {
  const api = useLocationEvidence(scope, vehicleId);
  const view = deriveLocationRowView(api, nowMs);

  return (
    <div className="mt-3 flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-white px-3.5 py-2.5 text-[13px]">
      <IconMapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
      {view === null ? (
        <span className="text-muted">Checking location evidence…</span>
      ) : view.kind === "unavailable" ? (
        <span className="text-muted">Location evidence isn&apos;t available for this trip.</span>
      ) : view.kind === "error" ? (
        <span className="text-danger">Location evidence couldn&apos;t be read right now.</span>
      ) : view.kind === "no-home-area" ? (
        <span className="text-muted">No home area set — add one to enable out-of-area alerts. (as of {view.ageLabel})</span>
      ) : view.kind === "out-of-area" ? (
        <span className="font-medium text-danger">Out of area — as of {view.ageLabel}</span>
      ) : (
        <span className="font-medium text-good">In area — as of {view.ageLabel}</span>
      )}
    </div>
  );
}

export function TelemetryActiveTripCard({
  trip,
  driver,
  vehicle,
  live,
  scope,
  policyPct,
  nowMs,
}: {
  trip: Trip;
  driver: Driver | null;
  vehicle: Vehicle;
  live: VehicleStatsCurrent | undefined;
  scope: VehicleWorkspaceScope | null;
  policyPct: number;
  nowMs: number;
}) {
  const start = useActiveTripStart(trip.id);
  const loadingStart = start === undefined;
  const rollup = loadingStart
    ? null
    : activeTripPace({
        start,
        liveOdometerMi: live?.odometerMi ?? null,
        liveBatteryPct: live?.batteryPct ?? null,
        policyPct: resolveVehiclePolicyPct(vehicle, policyPct),
      });

  const milesValue = loadingStart
    ? "…"
    : rollup?.odometer.kind === "complete"
      ? `${Math.round(rollup.odometer.milesDriven).toLocaleString()} mi`
      : rollup?.odometer.kind === "data-error"
        ? "Data error"
        : "—";
  const milesSub =
    !loadingStart && rollup?.odometer.kind === "start-only"
      ? "Waiting on odometer signal"
      : !loadingStart && rollup?.odometer.kind === "none"
        ? "Start not captured"
        : undefined;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Active trip</div>
        <Badge tone="brand">
          {formatDate(trip.startAt)} – {formatDate(trip.endAt)}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{driver?.name || "Unassigned guest"}</p>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile
          label="Battery now"
          value={!live || live.batteryPct === null ? "—" : `${Math.round(live.batteryPct)}%`}
        />
        <StatTile label="Miles this trip" value={milesValue} sub={milesSub} />
        <StatTile
          label="Last signal"
          value={live?.observedAt ? freshnessAgeLabel(live.observedAt, nowMs) : "No signal yet"}
        />
      </div>

      <LocationRow scope={scope} vehicleId={vehicle.id} nowMs={nowMs} />
    </Card>
  );
}
