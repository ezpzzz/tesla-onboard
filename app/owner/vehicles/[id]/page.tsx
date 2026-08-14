"use client";

/**
 * Vehicle detail: edit form (saves in place, no navigation), lifetime stats,
 * linked trips, and a two-step archive control. Vehicle CRUD state comes
 * from useVehicleState() directly (same instance renders + mutates, so
 * archiving/unarchiving reflects immediately); trip/charging data for the
 * stat tiles and linked-trips list comes from useOwnerData(). Follows the
 * useParams()/not-found/SSR-hydration-guard pattern from
 * app/owner/drivers/[id]/page.tsx.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  canArchiveVehicle,
  useVehicleState,
  type VehicleState,
} from "@/lib/owner/vehicle-state";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import {
  formatMiles,
  formatPct,
  formatUsd,
  parseReturnPolicyPct,
  vehicleStats,
} from "@/lib/owner/derive";
import { VehicleForm } from "@/components/owner/vehicle-form";
import { EmptyState, formatDate, StatTile, TripStatusBadge } from "@/components/owner/owner-ui";
import { Badge, Button, Card } from "@/components/ui";
import { IconChevronRight } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import type { VehicleInput } from "@/lib/owner/types";

export default function VehicleDetailPage() {
  const { config } = useTenantConfig();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const {
    vehicles,
    hydrated: vehicleHydrated,
    error: vehicleError,
    updateVehicle,
    archiveVehicle,
    unarchiveVehicle,
  } = useVehicleState();
  const { trips, chargingSessions, hydrated: dataHydrated } = useOwnerData();
  const [saved, setSaved] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const archiveTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const unarchiveButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);
  const hasMountedArchiveRef = useRef(false);

  const policyPct = useMemo(
    () => parseReturnPolicyPct(config.rental.returnChargeLevel),
    [config.rental.returnChargeLevel],
  );
  const ready = vehicleHydrated && dataHydrated;
  const vehicle = vehicles.find((v) => v.id === id) ?? null;

  // Move focus to whichever control just became the relevant one when the
  // archive confirmation step opens, cancels, or completes — otherwise focus
  // is dropped to <body> when the trigger button unmounts (see review finding).
  useEffect(() => {
    if (!hasMountedArchiveRef.current) {
      hasMountedArchiveRef.current = true;
      wasConfirmingRef.current = confirmArchive;
      return;
    }
    if (confirmArchive && !wasConfirmingRef.current) {
      confirmButtonRef.current?.focus();
    } else if (!confirmArchive && wasConfirmingRef.current) {
      if (vehicle?.status === "archived") {
        unarchiveButtonRef.current?.focus();
      } else {
        archiveTriggerRef.current?.focus();
      }
    }
    wasConfirmingRef.current = confirmArchive;
  }, [confirmArchive, vehicle?.status]);

  // Saved-flash timeout: cleared on unmount so it never fires setSaved(false)
  // after the host has already navigated away.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  if (!ready) {
    return <Card className="p-6 text-center text-sm text-muted">Loading vehicle…</Card>;
  }

  if (vehicleError) {
    return <Card role="alert" className="border-danger/20 p-6 text-center text-sm text-danger">{vehicleError}</Card>;
  }

  if (!vehicle) {
    return (
      <EmptyState
        title="Vehicle not found."
        detail={`No vehicle with id "${id}" — it may have been removed or the link is stale.`}
      >
        <Link
          href="/owner/vehicles"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Back to vehicles
        </Link>
      </EmptyState>
    );
  }

  const stats = vehicleStats(vehicle.id, trips, chargingSessions);
  const linkedTrips = trips.filter((t) => t.vehicleId === vehicle.id);
  const activeOrUpcomingTrips = linkedTrips.filter(
    (t) => t.status === "upcoming" || t.status === "active",
  );

  const vehicleState: VehicleState = {
    version: 2,
    vehicles: Object.fromEntries(vehicles.map((v) => [v.id, v])),
  };
  const archivable = canArchiveVehicle(vehicleState, vehicle.id);

  const initialValues: Partial<VehicleInput> = {
    displayName: vehicle.displayName,
    model: vehicle.model,
    trim: vehicle.trim,
    year: vehicle.year,
    color: vehicle.color,
    shifter: vehicle.shifter,
    licensePlate: vehicle.licensePlate,
    vin: vehicle.vin,
    returnChargeLevelPct: vehicle.returnChargeLevelPct,
    notes: vehicle.notes,
    wheelType: vehicle.wheelType,
    interior: vehicle.interior,
    teslaInteriorCode: vehicle.teslaInteriorCode,
    teslaPaintCode: vehicle.teslaPaintCode,
    teslaSpecSource: vehicle.teslaSpecSource,
    teslaImportedSpec: vehicle.teslaImportedSpec,
    teslaImportKey: vehicle.teslaImportKey,
  };

  async function handleSubmit(input: VehicleInput) {
    await updateVehicle(vehicle!.id, input);
    setSaved(true);
  }

  async function handleArchiveClick() {
    if (!confirmArchive) {
      setConfirmArchive(true);
      return;
    }
    setStatusSaving(true);
    setStatusError(null);
    try {
      await archiveVehicle(vehicle!.id);
      setConfirmArchive(false);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The vehicle could not be archived.");
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleUnarchive() {
    setStatusSaving(true);
    setStatusError(null);
    try {
      await unarchiveVehicle(vehicle!.id);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The vehicle could not be restored.");
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/owner/vehicles"
          className="text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          ← Vehicles
        </Link>
        {vehicle.status === "archived" && <Badge>Archived</Badge>}
      </div>

      <VehicleArtwork
        model={vehicle.model}
        color={vehicle.color}
        trim={vehicle.trim}
        wheelType={vehicle.wheelType}
        interior={vehicle.interior}
        interiorCode={vehicle.teslaInteriorCode}
        paintCode={vehicle.teslaPaintCode}
        year={vehicle.year}
        className="h-64 md:h-72"
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Trips" value={stats.tripCount} />
        <StatTile label="Miles rented" value={formatMiles(stats.milesRented)} />
        <StatTile label="Energy cost" value={formatUsd(stats.energyCostUsd)} />
        <StatTile
          label="Avg return charge"
          value={stats.avgReturnChargePct === null ? "—" : formatPct(stats.avgReturnChargePct)}
        />
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Vehicle details
        </div>
        <div className="mt-3">
          <VehicleForm
            mode="edit"
            initialValues={initialValues}
            globalPolicyPct={policyPct}
            onSubmit={handleSubmit}
            submitLabel={saved ? "Saved" : "Save changes"}
          />
          <p role="status" aria-live="polite" className="sr-only">
            {saved ? "Vehicle saved." : ""}
          </p>
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Linked trips
        </div>
        {linkedTrips.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No trips linked to this vehicle yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {linkedTrips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/owner/trips/${trip.id}`}
                  className="flex min-h-[44px] items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5 transition-colors hover:bg-surface"
                >
                  <TripStatusBadge status={trip.status} />
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">
                    {formatDate(trip.startAt)} – {formatDate(trip.endAt)}
                  </span>
                  <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Archive
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {confirmArchive
            ? "Confirm archive: this vehicle will be archived and hidden from active lists."
            : ""}
        </p>
        {statusError ? (
          <p role="alert" className="mt-3 rounded-xl border border-danger/20 bg-danger/[0.04] p-3 text-sm text-danger">
            {statusError}
          </p>
        ) : null}
        {vehicle.status === "archived" ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">
              This vehicle is archived and hidden from active lists.
            </p>
            <Button ref={unarchiveButtonRef} variant="secondary" onClick={handleUnarchive} disabled={statusSaving}>
              {statusSaving ? "Restoring…" : "Unarchive"}
            </Button>
          </div>
        ) : !archivable ? (
          <p className="mt-3 text-sm text-muted">
            This is your only active vehicle — add another before archiving this one.
          </p>
        ) : confirmArchive ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-soft">
              {activeOrUpcomingTrips.length > 0
                ? `${activeOrUpcomingTrips.length} upcoming/active trip${
                    activeOrUpcomingTrips.length === 1 ? "" : "s"
                  } still reference this vehicle. Archiving won't unassign them.`
                : "No upcoming or active trips reference this vehicle."}
            </p>
            <div className="flex gap-2">
              <Button ref={confirmButtonRef} variant="secondary" onClick={handleArchiveClick} disabled={statusSaving}>
                {statusSaving ? "Archiving…" : "Confirm archive"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmArchive(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Button ref={archiveTriggerRef} variant="secondary" onClick={handleArchiveClick}>
              Archive vehicle
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
