"use client";

/**
 * Vehicle detail: telemetry setup strip → live state → active trip → trip
 * evidence ledger (lifetime tiles as its summary row) → health charts →
 * consent/retention footer (Phase 5 of the Vehicle Telemetry & Trip
 * Evidence Ledger design) → the vehicle edit form and a reversible remove
 * control. Vehicle CRUD state comes from useVehicleState() directly (same
 * instance renders + mutates, so removing/restoring reflects immediately);
 * trip/charging/live-telemetry data comes from useOwnerData(). Follows the
 * useParams()/not-found/SSR-hydration-guard pattern from
 * app/owner/drivers/[id]/page.tsx.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useVehicleState,
} from "@/lib/owner/vehicle-state";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import {
  parseReturnPolicyPct,
} from "@/lib/owner/derive";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { HISTORY_RETENTION_MS, LOCATION_RETENTION_MS } from "@/lib/owner/telemetry-policy";
import { VehicleForm } from "@/components/owner/vehicle-form";
import { EmptyState } from "@/components/owner/owner-ui";
import { Badge, Button, Card } from "@/components/ui";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import type { VehicleInput } from "@/lib/owner/types";
import { PageHeader } from "@/components/evhost-ui";
import { TelemetryStatusStrip } from "@/components/owner/telemetry-status-strip";
import { TelemetryLiveStateCard } from "@/components/owner/telemetry-live-state-card";
import { TelemetryActiveTripCard } from "@/components/owner/telemetry-active-trip-card";
import { TelemetryHealthCharts } from "@/components/owner/telemetry-health-charts";
import { LedgerSection } from "@/components/owner/ledger-section";
import { msToWholeDays, msToWholeMonths } from "@/components/owner/telemetry-view";

export default function VehicleDetailPage() {
  const { config, tenantSlug } = useTenantConfig();
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
  const { drivers, trips, chargingSessions, vehicleTelemetry, hydrated: dataHydrated } = useOwnerData();
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const removeTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const restoreButtonRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingRef = useRef(false);
  const hasMountedRemoveRef = useRef(false);

  const policyPct = useMemo(
    () => parseReturnPolicyPct(config.rental.returnChargeLevel),
    [config.rental.returnChargeLevel],
  );
  const ready = vehicleHydrated && dataHydrated;
  const vehicle = vehicles.find((v) => v.id === id) ?? null;

  // Move focus to whichever control just became relevant when the remove
  // confirmation step opens, cancels, or completes — otherwise focus
  // is dropped to <body> when the trigger button unmounts (see review finding).
  useEffect(() => {
    if (!hasMountedRemoveRef.current) {
      hasMountedRemoveRef.current = true;
      wasConfirmingRef.current = confirmRemove;
      return;
    }
    if (confirmRemove && !wasConfirmingRef.current) {
      confirmButtonRef.current?.focus();
    } else if (!confirmRemove && wasConfirmingRef.current) {
      if (vehicle?.status === "archived") {
        restoreButtonRef.current?.focus();
      } else {
        removeTriggerRef.current?.focus();
      }
    }
    wasConfirmingRef.current = confirmRemove;
  }, [confirmRemove, vehicle?.status]);

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

  const live = vehicleTelemetry[vehicle.id];
  const scope = vehicleWorkspaceScope(tenantSlug);
  const nowMs = Date.now();
  const linkedTrips = trips.filter((t) => t.vehicleId === vehicle.id);
  const activeOrUpcomingTrips = linkedTrips.filter(
    (t) => t.status === "upcoming" || t.status === "active",
  );
  const activeTrip = linkedTrips.find((t) => t.status === "active") ?? null;
  const activeDriver = activeTrip ? drivers.find((d) => d.id === activeTrip.driverId) ?? null : null;

  const removable = activeOrUpcomingTrips.length === 0;

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

  async function handleRemoveClick() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setStatusSaving(true);
    setStatusError(null);
    try {
      await archiveVehicle(vehicle!.id);
      setConfirmRemove(false);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The vehicle could not be removed.");
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
      <div className="space-y-4">
        <Link
          href="/owner/vehicles"
          className="text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          ← Vehicles
        </Link>
        <PageHeader
          eyebrow="Fleet vehicle"
          title={vehicle.displayName}
          description={`${vehicle.year} ${vehicle.color} ${vehicle.model}${vehicle.trim ? ` · ${vehicle.trim}` : ""}`}
          action={vehicle.status === "archived" ? <Badge>Removed</Badge> : undefined}
        />
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
        className="h-52 md:h-60"
      />

      <TelemetryStatusStrip scope={scope} vehicleId={vehicle.id} hasLiveSignal={live?.observedAt != null} />

      <TelemetryLiveStateCard live={live} nowMs={nowMs} />

      {activeTrip ? (
        <TelemetryActiveTripCard
          trip={activeTrip}
          driver={activeDriver}
          vehicle={vehicle}
          live={live}
          scope={scope}
          policyPct={policyPct}
          nowMs={nowMs}
        />
      ) : null}

      <LedgerSection
        vehicle={vehicle}
        trips={trips}
        drivers={drivers}
        chargingSessions={chargingSessions}
        policyPct={policyPct}
      />

      <TelemetryHealthCharts scope={scope} vehicleId={vehicle.id} chargingSessions={chargingSessions} />

      <p className="max-w-[68ch] text-xs leading-relaxed text-muted">
        Guests are shown this disclosure during onboarding before any telemetry streams. Live
        vehicle history is retained for {msToWholeMonths(HISTORY_RETENTION_MS)} months. Location
        evidence, where enabled for this workspace, is retained for only{" "}
        {msToWholeDays(LOCATION_RETENTION_MS)} days and is visible only during an active,
        guest-consented trip window — never as a route history.
      </p>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Vehicle details
        </div>
        <div className="mt-3">
          <VehicleForm
            mode="edit"
            vehicleId={vehicle.id}
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
          Remove from fleet
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {confirmRemove
            ? "Confirm removal: this vehicle will be hidden from the active fleet and guest onboarding."
            : ""}
        </p>
        {statusError ? (
          <p role="alert" className="mt-3 rounded-md border border-danger/20 bg-danger/[0.04] p-3 text-sm text-danger">
            {statusError}
          </p>
        ) : null}
        {vehicle.status === "archived" ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-muted">
              This vehicle is removed from the active fleet. Its history is retained and it can be restored.
            </p>
            <Button ref={restoreButtonRef} variant="secondary" onClick={handleUnarchive} disabled={statusSaving}>
              {statusSaving ? "Restoring…" : "Restore vehicle"}
            </Button>
          </div>
        ) : !removable ? (
          <p className="mt-3 text-sm text-muted">
            This vehicle has {activeOrUpcomingTrips.length} active or upcoming trip{activeOrUpcomingTrips.length === 1 ? "" : "s"}.
            Cancel, complete, or reassign {activeOrUpcomingTrips.length === 1 ? "it" : "them"} before removing the vehicle.
          </p>
        ) : confirmRemove ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-ink-soft">
              Remove this vehicle from the active fleet? Historical trips stay intact. If it is
              linked to guest onboarding, that walkthrough will pause automatically. You can
              restore the vehicle later.
            </p>
            <div className="flex gap-2">
              <Button ref={confirmButtonRef} variant="secondary" onClick={handleRemoveClick} disabled={statusSaving}>
                {statusSaving ? "Removing…" : "Confirm removal"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Button ref={removeTriggerRef} variant="secondary" onClick={handleRemoveClick}>
              Remove vehicle
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
