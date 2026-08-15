"use client";

import { PageHeader, StatePanel } from "@/components/evhost-ui";
import { Card } from "@/components/ui";
import { formatMiles, formatPct, formatUsd, vehicleStats } from "@/lib/owner/derive";
import { useOwnerData } from "@/lib/owner/use-owner-data";

export default function OwnerInsightsPage() {
  const { stats, trips, vehicles, chargingSessions, hydrated, operationalError } = useOwnerData();
  if (operationalError) return <StatePanel tone="danger" title="Insights are unavailable" detail={operationalError} />;
  if (!hydrated) return <StatePanel title="Loading insights…" />;
  const completed = trips.filter((trip) => trip.status === "completed");
  if (!completed.length) {
    return <div className="space-y-6"><PageHeader title="Insights" description="Persisted trip and charging performance—never demo estimates." /><StatePanel title="Insights begin after a completed trip" detail="Miles, return charge, energy cost, and charging activity will appear here once they are recorded for a completed trip." /></div>;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Insights" description="Persisted fleet performance from completed trips and recorded charging sessions." />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Fleet totals">
        <Metric label="Miles rented" value={formatMiles(stats.totalMilesRented)} />
        <Metric label="Energy cost" value={formatUsd(stats.totalEnergyCostUsd)} />
        <Metric label="Supercharging" value={formatUsd(stats.totalSuperchargingCostUsd)} />
        <Metric label="Average return" value={stats.avgReturnChargePct === null ? "—" : formatPct(stats.avgReturnChargePct)} />
      </section>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="overflow-hidden rounded-lg border border-line bg-white" aria-labelledby="utilization-heading">
          <div className="border-b border-line px-5 py-4"><h2 id="utilization-heading" className="font-semibold">Vehicle utilization</h2><p className="mt-1 text-xs text-muted">Only recorded trips and charging costs are included.</p></div>
          {vehicles.filter((vehicle) => vehicle.status === "active").map((vehicle) => {
            const vehicleTrips = trips.filter((trip) => trip.vehicleId === vehicle.id && trip.status === "completed");
            const vehicleMetrics = vehicleStats(vehicle.id, trips, chargingSessions);
            return <div key={vehicle.id} className="grid grid-cols-[1fr_repeat(3,auto)] items-center gap-5 border-b border-line px-5 py-4 text-sm last:border-0"><div><div className="font-semibold">{vehicle.displayName}</div><div className="mt-1 text-xs text-muted">{vehicleTrips.length} completed trip{vehicleTrips.length === 1 ? "" : "s"}</div></div><div className="text-right"><span className="block text-xs text-muted">Miles</span>{formatMiles(vehicleMetrics.milesRented)}</div><div className="text-right"><span className="block text-xs text-muted">Energy</span>{formatUsd(vehicleMetrics.energyCostUsd)}</div><div className="hidden text-right sm:block"><span className="block text-xs text-muted">Return</span>{vehicleMetrics.avgReturnChargePct === null ? "—" : formatPct(vehicleMetrics.avgReturnChargePct)}</div></div>;
          })}
        </section>
        <section className="rounded-lg border border-line bg-white p-5" aria-labelledby="return-heading">
          <h2 id="return-heading" className="font-semibold">Return condition</h2>
          <div className="mt-6 flex items-end gap-3"><span className="text-4xl font-semibold tracking-[-0.04em]">{stats.tripsBelowPolicy}</span><span className="pb-1 text-sm text-muted">below-policy return{stats.tripsBelowPolicy === 1 ? "" : "s"}</span></div>
          <p className="mt-4 border-t border-line pt-4 text-sm leading-6 text-muted">This view reflects saved end-of-trip charge values. Missing return telemetry is left out instead of inferred.</p>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="p-5"><div className="text-xs text-muted">{label}</div><div className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{value}</div></Card>;
}
