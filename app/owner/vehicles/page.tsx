"use client";

/**
 * Vehicle list — every car in the fleet, active first with lifetime stats,
 * archived below de-emphasized. Vehicle CRUD state comes from
 * useVehicleState() directly (not the merged snapshot in useOwnerData())
 * so mutations here render immediately in this same tree; trips/charging
 * data for the stat tiles still comes from useOwnerData().
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { vehicleStats, formatMiles, formatUsd, formatPct } from "@/lib/owner/derive";
import { Badge, Button, Card } from "@/components/ui";
import { IconChevronRight } from "@/components/icons";
import type { ChargingSession, Trip, Vehicle } from "@/lib/owner/types";

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
}: {
  vehicle: Vehicle;
  trips: Trip[];
  chargingSessions: ChargingSession[];
}) {
  const stats = vehicleStats(vehicle.id, trips, chargingSessions);
  return (
    <Link href={`/owner/vehicles/${vehicle.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-surface">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{vehicle.displayName}</div>
            <div className="mt-0.5 text-sm text-muted">
              {vehicle.trim} · {vehicle.color}
            </div>
          </div>
          <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          <VehicleStatCell label="Trips" value={String(stats.tripCount)} />
          <VehicleStatCell label="Miles" value={formatMiles(stats.milesRented)} />
          <VehicleStatCell label="Energy" value={formatUsd(stats.energyCostUsd)} />
          <VehicleStatCell
            label="Avg return"
            value={stats.avgReturnChargePct === null ? "—" : formatPct(stats.avgReturnChargePct)}
          />
        </div>
      </Card>
    </Link>
  );
}

export default function VehiclesPage() {
  const router = useRouter();
  const { vehicles, hydrated: vehicleHydrated, unarchiveVehicle } = useVehicleState();
  const { trips, chargingSessions, hydrated: dataHydrated } = useOwnerData();
  const ready = vehicleHydrated && dataHydrated;

  if (!ready) {
    return <Card className="p-6 text-center text-sm text-muted">Loading vehicles…</Card>;
  }

  const active = vehicles.filter((v) => v.status === "active");
  const archived = vehicles.filter((v) => v.status === "archived");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Vehicles</h1>
          <p className="mt-1 text-sm text-muted">Every car in your fleet, with lifetime stats.</p>
        </div>
        <Button variant="primary" onClick={() => router.push("/owner/vehicles/new")}>
          Add vehicle
        </Button>
      </div>

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
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
            Archived
          </div>
          <div className="space-y-2">
            {archived.map((vehicle) => (
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
                  <Badge>Archived</Badge>
                </div>
                <Button variant="secondary" onClick={() => unarchiveVehicle(vehicle.id)}>
                  Unarchive
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
