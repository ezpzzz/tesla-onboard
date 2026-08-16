"use client";

/**
 * Trip list — every trip across the fleet, filterable by status. Composes
 * useOwnerData() + useOwnerState() and hands the current snapshot straight to
 * TripTable, which owns the two responsive renderings (table on md+, cards
 * below it).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useOwnerState } from "@/lib/owner/owner-state";
import { TripTable } from "@/components/owner/owner-ui";
import { Card, Segmented } from "@/components/ui";
import type { TripStatus } from "@/lib/owner/types";
import { CalendarReviewQueue } from "@/components/owner/CalendarReviewQueue";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";
import { PageHeader, ReadinessRail, StatePanel, TripRibbon } from "@/components/evhost-ui";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import { ReminderButton } from "@/components/owner/ReminderButton";
import { IconChevronRight, IconMapPin } from "@/components/icons";
import { formatTripDuration } from "@/lib/trip-format";

type Filter = "all" | TripStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

export default function TripsPage() {
  const { trips, drivers, vehicles, chargingSessions, policyPct, hydrated, operationalError } = useOwnerData();
  const { state: ownerState } = useOwnerState();
  const [filter, setFilter] = useState<Filter>("all");
  const [vehicleFilter, setVehicleFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => v.status === "active"),
    [vehicles],
  );

  const vehicleFilterOptions = useMemo(
    () => [
      { value: "all", label: "All vehicles" },
      ...activeVehicles.map((v) => ({ value: v.id, label: v.displayName })),
    ],
    [activeVehicles],
  );

  const filtered = useMemo(() => {
    let list = filter === "all" ? trips : trips.filter((t) => t.status === filter);
    if (vehicleFilter !== "all") {
      list = list.filter((t) => t.vehicleId === vehicleFilter);
    }
    return list;
  }, [trips, filter, vehicleFilter]);
  const selected = filtered.find((trip) => trip.id === selectedId) ?? filtered[0] ?? null;
  const selectedGuest = selected ? drivers.find((driver) => driver.id === selected.driverId) ?? null : null;
  const selectedVehicle = selected ? vehicles.find((vehicle) => vehicle.id === selected.vehicleId) ?? null : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Handoffs" title="Trips" description="Review each handoff, guest readiness, locations, and return history." action={<Link href="/owner#new-guest" className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-white">New guest</Link>} />

      <Segmented options={FILTERS} value={filter} onChange={setFilter} />

      {activeVehicles.length > 1 && (
        <Segmented
          options={vehicleFilterOptions}
          value={vehicleFilter}
          onChange={setVehicleFilter}
        />
      )}

      <CalendarReviewQueue
        vehicles={vehicles}
        confirmationEnabled={ONLYEVS_OPERATIONS_ENABLED}
      />

      {operationalError ? <StatePanel tone="danger" title="Trip data is unavailable" detail={operationalError} /> : !hydrated ? <StatePanel title="Loading trips…" /> : (
        <>
          {selected ? <div className="hidden min-h-[470px] grid-cols-[minmax(260px,0.72fr)_minmax(440px,1.28fr)] overflow-hidden rounded-lg border border-line bg-white lg:grid">
            <div className="border-r border-line p-3" aria-label="Trip master list">
              {filtered.map((trip) => {
                const guest = drivers.find((driver) => driver.id === trip.driverId);
                const vehicle = vehicles.find((item) => item.id === trip.vehicleId);
                const active = trip.id === selected.id;
                return <button key={trip.id} type="button" onClick={() => setSelectedId(trip.id)} className={`flex w-full items-center gap-3 rounded-md px-4 py-4 text-left ${active ? "bg-surface" : "hover:bg-surface/60"}`} aria-current={active ? "true" : undefined}><span className={`h-10 w-1 rounded-sm ${trip.status === "active" ? "bg-brand" : trip.status === "upcoming" ? "bg-ink" : "bg-line"}`} /><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{guest?.name || "Guest"}</span><span className="mt-1 block truncate text-xs text-muted">{vehicle?.displayName || "Vehicle"} · {formatTripRange(trip.startAt, trip.endAt)}</span></span><IconChevronRight className="h-4 w-4 text-muted" /></button>;
              })}
            </div>
            <div className="grid grid-cols-[1fr_280px]">
              <div className="min-w-0 border-r border-line">
                <div className="px-6 pt-6"><div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{selected.status}</div><h2 className="mt-2 text-2xl font-semibold">{selectedGuest?.name || "Guest"}</h2><p className="mt-1 text-sm text-muted">{formatTripRange(selected.startAt, selected.endAt)}</p></div>
                {selectedVehicle ? <VehicleArtwork model={selectedVehicle.model} color={selectedVehicle.color} trim={selectedVehicle.trim} wheelType={selectedVehicle.wheelType} interior={selectedVehicle.interior} interiorCode={selectedVehicle.teslaInteriorCode} paintCode={selectedVehicle.teslaPaintCode} year={selectedVehicle.year} decorative className="h-48 border-0 bg-white" /> : null}
                <TripRibbon pickup={formatDateTime(selected.startAt)} pickupLocation={selected.pickupLocation ?? "Instructions"} duration={formatTripDuration(selected.startAt, selected.endAt)} dropoff={formatDateTime(selected.endAt)} />
              </div>
              <aside className="p-5"><h3 className="font-semibold">Handoff status</h3><div className="mt-4"><ReadinessRail steps={[{ label: "Link", detail: selectedGuest?.progress ? "Opened" : "Not opened", value: selectedGuest?.progress ? "Complete" : "Pending", state: selectedGuest?.progress ? "complete" : "current" }, { label: "Guide", detail: "Guest walkthrough", value: `${Math.round(selectedGuest?.progress?.pct ?? 0)}%`, state: selectedGuest?.progress?.isDone ? "complete" : selectedGuest?.progress ? "current" : "pending" }, { label: "Access", detail: "Tesla access", value: selected.accessStatus?.replaceAll("_", " ") ?? "Unavailable", state: selected.accessStatus ? "current" : "pending" }]} /></div><div className="mt-5 flex items-start gap-2 text-sm text-muted"><IconMapPin className="mt-0.5 h-4 w-4 shrink-0" />{selected.pickupLocation ?? "Location is in the trip instructions"}</div>{selected.status !== "completed" && !selectedGuest?.progress?.isDone ? <ReminderButton tripId={selected.id} className="mt-5" fullWidth /> : null}<Link href={`/owner/trips/${selected.id}`} className="mt-2 flex min-h-11 items-center justify-center text-sm font-semibold text-brand">Open trip detail</Link></aside>
            </div>
          </div> : null}
          <h2 className="pt-2 text-[17px] font-semibold">All trips</h2>
        <TripTable
          trips={filtered}
          drivers={drivers}
          vehicles={vehicles}
          chargingSessions={chargingSessions}
          ownerState={ownerState}
          policyPct={policyPct}
        />
        </>
      )}
    </div>
  );
}

function formatDateTime(ms: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

function formatTripRange(start: number, end: number) {
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(start))} – ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(end))}`;
}
