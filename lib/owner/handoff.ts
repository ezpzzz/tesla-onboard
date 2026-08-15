import type { Driver, Trip, Vehicle } from "@/lib/owner/types";

export type HandoffBoundaryKind = "pickup" | "return";

export interface OwnerHandoff {
  trip: Trip;
  driver: Driver | null;
  vehicle: Vehicle | null;
  kind: HandoffBoundaryKind;
  boundaryAt: number;
  location: string | null;
}

/** The next operational boundary is an active trip's return or an upcoming
 * trip's pickup, whichever occurs first. Completed/cancelled projections are
 * already removed by the repository. */
export function selectNextHandoff(
  trips: Trip[],
  drivers: Driver[],
  vehicles: Vehicle[],
  now: number,
): OwnerHandoff | null {
  const candidates: Array<Omit<OwnerHandoff, "driver" | "vehicle">> = [];
  for (const trip of trips) {
    if (trip.status === "active" && trip.endAt > now) {
      candidates.push({ trip, kind: "return", boundaryAt: trip.endAt, location: trip.returnLocation ?? null });
    }
    else if (trip.status === "upcoming" && trip.startAt > now) {
      candidates.push({ trip, kind: "pickup", boundaryAt: trip.startAt, location: trip.pickupLocation ?? null });
    }
  }
  candidates.sort((a, b) => a.boundaryAt - b.boundaryAt || a.trip.id.localeCompare(b.trip.id));
  const next = candidates[0];
  if (!next) return null;
  return {
    ...next,
    driver: drivers.find((driver) => driver.id === next.trip.driverId) ?? null,
    vehicle: vehicles.find((vehicle) => vehicle.id === next.trip.vehicleId) ?? null,
  };
}

export function handoffSteps(handoff: OwnerHandoff) {
  const progress = handoff.driver?.progress;
  const accessComplete = ["invite_ready", "redeemed", "active"].includes(handoff.trip.accessStatus ?? "");
  const pct = Math.round(progress?.pct ?? 0);
  return [
    { label: "Link", detail: progress ? "Trip link opened" : "Waiting for first open", value: progress ? "Complete" : "Pending", state: progress ? "complete" as const : "current" as const },
    { label: "Tesla", detail: accessComplete ? "Tesla access ready" : handoff.trip.accessStatus ? handoff.trip.accessStatus.replaceAll("_", " ") : "No access grant", value: accessComplete ? "Complete" : "Pending", state: accessComplete ? "complete" as const : "pending" as const },
    { label: "Guide", detail: "Walkthrough progress", value: `${pct}%`, state: progress?.isDone ? "complete" as const : progress ? "current" as const : "pending" as const },
    { label: handoff.kind === "pickup" ? "Pickup" : "Return", detail: handoff.kind === "pickup" ? "Ready for pickup" : "Ready for return", value: "Pending", state: "pending" as const },
  ];
}
