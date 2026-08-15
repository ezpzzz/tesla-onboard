"use client";

/**
 * Vehicle list — every car in the fleet, active first with lifetime stats,
 * removed vehicles below de-emphasized. Vehicle CRUD state comes from
 * useVehicleState() directly (not the merged snapshot in useOwnerData())
 * so mutations here render immediately in this same tree; trips/charging
 * data for the stat tiles still comes from useOwnerData().
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useOwnerSetupState } from "@/lib/owner/setup-state";
import { vehicleStats, formatMiles, formatUsd, formatPct } from "@/lib/owner/derive";
import { Badge, Button, Card } from "@/components/ui";
import { IconChevronRight } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import type { ChargingSession, Trip, Vehicle } from "@/lib/owner/types";
import type { VehicleStatsCurrent } from "@/lib/owner/access-types";
import { tenantCarMatchesVehicle } from "@/lib/tenant-vehicle";
import { PageHeader, StatePanel } from "@/components/evhost-ui";

function VehicleStatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function VehicleCard({
  vehicle,
  trips,
  chargingSessions,
  isGuestVehicle,
  guestSnapshotCurrent,
  telemetry,
}: {
  vehicle: Vehicle;
  trips: Trip[];
  chargingSessions: ChargingSession[];
  isGuestVehicle: boolean;
  guestSnapshotCurrent: boolean;
  telemetry?: VehicleStatsCurrent;
}) {
  const stats = vehicleStats(vehicle.id, trips, chargingSessions);
  return (
    <Link
      href={`/owner/vehicles/${vehicle.id}`}
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
    >
      <Card className="overflow-hidden bg-white transition-colors duration-200 group-hover:border-ink/30">
        <VehicleArtwork
          model={vehicle.model}
          color={vehicle.color}
          trim={vehicle.trim}
          wheelType={vehicle.wheelType}
          interior={vehicle.interior}
          interiorCode={vehicle.teslaInteriorCode}
          paintCode={vehicle.teslaPaintCode}
          year={vehicle.year}
          decorative
          className="h-36 rounded-none border-0 md:h-40"
        />
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate font-medium text-ink">{vehicle.displayName}</div>
                {isGuestVehicle ? (
                  <Badge tone={guestSnapshotCurrent ? "brand" : "warn"}>
                    {guestSnapshotCurrent ? "Guest vehicle" : "Guest sync pending"}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 text-sm text-muted">
                {[vehicle.trim, vehicle.color, vehicle.interior].filter(Boolean).join(" · ")}
              </div>
              {vehicle.wheelType && (
                <div className="mt-1 truncate text-xs text-muted">{vehicle.wheelType}</div>
              )}
            </div>
            <IconChevronRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
            />
          </div>
          {telemetry ? (
            <div className="mt-4 grid grid-cols-4 gap-2 rounded-md bg-surface p-3">
              <VehicleStatCell label="Battery" value={telemetry.batteryPct === null ? "—" : `${Math.round(telemetry.batteryPct)}%`} />
              <VehicleStatCell label="Range" value={telemetry.estimatedRangeMi === null ? "—" : `${Math.round(telemetry.estimatedRangeMi)} mi`} />
              <VehicleStatCell label="Odometer" value={telemetry.odometerMi === null ? "—" : `${Math.round(telemetry.odometerMi).toLocaleString()} mi`} />
              <VehicleStatCell label="State" value={telemetry.connectivity === "connected" ? telemetry.locked === null ? "Online" : telemetry.locked ? "Locked" : "Unlocked" : telemetry.connectivity} />
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-4 gap-2">
            <VehicleStatCell label="Trips" value={String(stats.tripCount)} />
            <VehicleStatCell label="Miles" value={formatMiles(stats.milesRented)} />
            <VehicleStatCell label="Energy" value={formatUsd(stats.energyCostUsd)} />
            <VehicleStatCell
              label="Avg return"
              value={stats.avgReturnChargePct === null ? "—" : formatPct(stats.avgReturnChargePct)}
            />
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function VehiclesPage() {
  const router = useRouter();
  const { config } = useTenantConfig();
  const {
    vehicles,
    hydrated: vehicleHydrated,
    error: vehicleError,
    unarchiveVehicle,
  } = useVehicleState();
  const [mutationError, setMutationError] = useState<string | null>(null);
  const { trips, chargingSessions, vehicleTelemetry, hydrated: dataHydrated, operationalError } = useOwnerData();
  const { hydrated: setupHydrated, update: updateSetupState } = useOwnerSetupState();
  const ready = vehicleHydrated && dataHydrated;

  if (!ready) {
    return <StatePanel title="Loading vehicles…" />;
  }

  if (vehicleError) {
    return <StatePanel tone="danger" title="Vehicle data is unavailable" detail={vehicleError} />;
  }

  if (operationalError) {
    return <StatePanel tone="danger" title="Vehicle statistics are unavailable" detail={operationalError} />;
  }

  const active = vehicles.filter((v) => v.status === "active");
  const removed = vehicles.filter((v) => v.status === "archived");
  const guestVehicle = config.car.sourceVehicleId
    ? vehicles.find((vehicle) => vehicle.guestSourceId === config.car.sourceVehicleId)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Fleet" title="Vehicles" description="Product stages, verified presentation, live signal freshness, and utilization." action={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              // Force the wizard straight to Import — otherwise it resumes
              // wherever it last left off (e.g. "All set" for a host who
              // already finished setup once), making this button look broken.
              // The wizard is idempotent via the import ledger, so jumping
              // there directly is safe whether or not setup was completed.
              if (setupHydrated) updateSetupState({ step: "import" });
              router.push("/owner/setup");
            }}
          >
            Import from Tesla
          </Button>
          <Button variant="primary" onClick={() => router.push("/owner/vehicles/new")}>
            Add vehicle
          </Button>
        </div>
      } />

      {mutationError ? (
        <Card role="alert" className="border-danger/20 bg-danger/[0.04] p-4 text-sm text-danger">
          {mutationError}
        </Card>
      ) : null}

      {!config.car.sourceVehicleId ? (
        <Card className="border-brand/20 bg-brand/[0.04] p-4 text-sm leading-relaxed text-muted">
          Guest onboarding is paused until an active workspace vehicle is linked and fleet setup
          is published. <Link href="/owner/settings" className="font-medium text-brand hover:underline">Link a fleet vehicle in Settings.</Link>
        </Card>
      ) : !guestVehicle || guestVehicle.status !== "active" ? (
        <Card className="border-warn/20 bg-warn/[0.04] p-4 text-sm leading-relaxed text-muted">
          Guest onboarding is paused because its linked vehicle is unavailable in this workspace fleet.
          <Link href="/owner/settings" className="ml-1 font-medium text-ink hover:underline">Choose an active source vehicle.</Link>
        </Card>
      ) : null}

      {active.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">No active vehicles.</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {active.map((vehicle) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              trips={trips}
              chargingSessions={chargingSessions}
              isGuestVehicle={config.car.sourceVehicleId === vehicle.guestSourceId}
              guestSnapshotCurrent={tenantCarMatchesVehicle(config.car, vehicle)}
              telemetry={vehicleTelemetry[vehicle.id]}
            />
          ))}
        </div>
      )}

      {removed.length > 0 && (
        <div>
          <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
            Removed vehicles
          </div>
          <div className="space-y-2">
            {removed.map((vehicle) => (
              <Card
                key={vehicle.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3.5 opacity-70"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Link
                    href={`/owner/vehicles/${vehicle.id}`}
                    className="truncate font-medium text-ink hover:text-brand"
                  >
                    {vehicle.displayName}
                  </Link>
                  <Badge>Removed</Badge>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMutationError(null);
                    void unarchiveVehicle(vehicle.id).catch((error) => {
                      setMutationError(error instanceof Error ? error.message : "The vehicle could not be restored.");
                    });
                  }}
                >
                  Restore
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
