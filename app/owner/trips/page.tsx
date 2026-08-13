"use client";

/**
 * Trip list — every trip across the fleet, filterable by status. Composes
 * useOwnerData() + useOwnerState() and hands the merged snapshot straight to
 * TripTable, which owns the two responsive renderings (table on md+, cards
 * below it).
 */

import { useMemo, useState } from "react";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useOwnerState } from "@/lib/owner/owner-state";
import { TripTable } from "@/components/owner/owner-ui";
import { Card, Segmented } from "@/components/ui";
import type { TripStatus } from "@/lib/owner/types";

type Filter = "all" | TripStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
];

export default function TripsPage() {
  const { trips, drivers, chargingSessions, policyPct, hydrated } = useOwnerData();
  const { state: ownerState } = useOwnerState();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(
    () => (filter === "all" ? trips : trips.filter((t) => t.status === filter)),
    [trips, filter],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Trips</h1>
        <p className="mt-1 text-sm text-muted">
          Every booking on the car, with energy cost and return condition at a glance.
        </p>
      </div>

      <Segmented options={FILTERS} value={filter} onChange={setFilter} />

      {!hydrated ? (
        <Card className="p-6 text-center text-sm text-muted">Loading trips…</Card>
      ) : (
        <TripTable
          trips={filtered}
          drivers={drivers}
          chargingSessions={chargingSessions}
          ownerState={ownerState}
          policyPct={policyPct}
        />
      )}
    </div>
  );
}
