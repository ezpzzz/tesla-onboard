/**
 * Alert derivation — pure. Takes a snapshot + owner state + policy and returns
 * the sorted list of things a host should look at. No I/O, no clocks read
 * internally (`now` is passed in) so this is trivially testable and safe to
 * call on every render.
 */

import { CHECKLIST } from "@/lib/content";
import {
  driverStatus,
  formatUsd,
  resolveVehiclePolicyPct,
  sessionsForTrip,
  tripEnergy,
} from "./derive";
import type { ChargingSession, Driver, OwnerAlert, Trip, Vehicle } from "./types";
import type { OwnerState } from "./owner-state";

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUIRED_CHECKLIST_IDS = CHECKLIST.filter((c) => c.required).map((c) => c.id);

function driverName(drivers: Driver[], driverId: string | null): string {
  if (!driverId) return "Unassigned guest";
  return drivers.find((d) => d.id === driverId)?.name ?? "Guest";
}

export function deriveAlerts(args: {
  drivers: Driver[];
  trips: Trip[];
  chargingSessions: ChargingSession[];
  vehicles: Vehicle[];
  ownerState: OwnerState;
  policyPct: number;
  now: number;
}): OwnerAlert[] {
  const { drivers, trips, chargingSessions, vehicles, ownerState, policyPct, now } = args;
  const alerts: OwnerAlert[] = [];

  // guest-not-started (danger): upcoming trip within 48h, progress null/pct 0
  for (const trip of trips) {
    if (trip.status !== "upcoming" || !trip.driverId) continue;
    const hoursUntilStart = (trip.startAt - now) / (60 * 60 * 1000);
    if (hoursUntilStart < 0 || hoursUntilStart > 48) continue;
    const driver = drivers.find((d) => d.id === trip.driverId);
    if (!driver) continue;
    const progress = driver.progress;
    const notStarted = !progress || (progress.pct === 0 && progress.completed.length === 0);
    if (!notStarted) continue;
    alerts.push({
      id: `guest-not-started:${trip.id}`,
      kind: "guest-not-started",
      severity: "danger",
      message: `${driverName(drivers, trip.driverId)} hasn't started onboarding and picks up within 48 hours.`,
      href: `/owner/drivers/${encodeURIComponent(driver.id)}`,
      driverId: driver.id,
      tripId: trip.id,
    });
  }

  // required-checklist-open (danger): upcoming trip within 24h, a required item unchecked
  for (const trip of trips) {
    if (trip.status !== "upcoming" || !trip.driverId) continue;
    const hoursOut = (trip.startAt - now) / (60 * 60 * 1000);
    if (hoursOut < 0 || hoursOut > 24) continue;
    const driver = drivers.find((d) => d.id === trip.driverId);
    if (!driver || !driver.progress) continue;
    const openRequired = REQUIRED_CHECKLIST_IDS.filter((id) => !driver.progress!.checklist[id]);
    if (openRequired.length === 0) continue;
    alerts.push({
      id: `required-checklist-open:${trip.id}`,
      kind: "required-checklist-open",
      severity: "danger",
      message: `${driverName(drivers, trip.driverId)} still has ${openRequired.length} required readiness item${openRequired.length === 1 ? "" : "s"} unchecked ahead of pickup.`,
      href: `/owner/drivers/${encodeURIComponent(driver.id)}`,
      driverId: driver.id,
      tripId: trip.id,
    });
  }

  // guest-stalled (warn): stalled status + upcoming/active trip
  for (const driver of drivers) {
    if (driverStatus(driver, now) !== "stalled") continue;
    const relevantTrip = trips.find(
      (t) => t.driverId === driver.id && (t.status === "upcoming" || t.status === "active")
    );
    if (!relevantTrip) continue;
    alerts.push({
      id: `guest-stalled:${driver.id}`,
      kind: "guest-stalled",
      severity: "warn",
      message: `${driver.name} has stalled mid-onboarding — no progress in over a day.`,
      href: `/owner/drivers/${encodeURIComponent(driver.id)}`,
      driverId: driver.id,
      tripId: relevantTrip.id,
    });
  }

  // return-below-policy (warn): completed trip, batteryEndPct < the vehicle's
  // effective policy (its own override, or the global fallback), not resolved by owner
  for (const trip of trips) {
    if (trip.status !== "completed" || trip.batteryEndPct === null) continue;
    const vehicle = vehicles.find((v) => v.id === trip.vehicleId);
    const effectivePolicyPct = resolveVehiclePolicyPct(vehicle, policyPct);
    if (trip.batteryEndPct >= effectivePolicyPct) continue;
    if (ownerState.tripChecklists[trip.id]?.chargedToPolicy) continue;
    const hasOverride = vehicle?.returnChargeLevelPct != null;
    const policyClause = hasOverride
      ? `below ${vehicle!.displayName}'s ${effectivePolicyPct}% return policy`
      : `below the ${effectivePolicyPct}% return policy`;
    alerts.push({
      id: `return-below-policy:${trip.id}`,
      kind: "return-below-policy",
      severity: "warn",
      message: `${trip.id} was returned by ${driverName(drivers, trip.driverId)} at ${trip.batteryEndPct}%, ${policyClause}.`,
      href: `/owner/trips/${trip.id}`,
      driverId: trip.driverId ?? undefined,
      tripId: trip.id,
    });
  }

  // supercharging-unrecovered (warn): completed trip ended within last 14 days, supercharger cost > 0
  for (const trip of trips) {
    if (trip.status !== "completed") continue;
    if (now - trip.endAt > 14 * DAY_MS || now - trip.endAt < 0) continue;
    const sessions = sessionsForTrip(chargingSessions, trip.id);
    const { superchargerCostUsd } = tripEnergy(sessions);
    if (superchargerCostUsd <= 0) continue;
    alerts.push({
      id: `supercharging-unrecovered:${trip.id}`,
      kind: "supercharging-unrecovered",
      severity: "warn",
      message: `${trip.id} (${driverName(drivers, trip.driverId)}) has ${formatUsd(superchargerCostUsd)} in Supercharging to pass through.`,
      href: `/owner/trips/${trip.id}`,
      driverId: trip.driverId ?? undefined,
      tripId: trip.id,
    });
  }

  const severityRank = { danger: 0, warn: 1 } as const;
  return alerts
    .slice()
    .sort((a, b) => {
      const sevDiff = severityRank[a.severity] - severityRank[b.severity];
      if (sevDiff !== 0) return sevDiff;
      // Within the same severity: most-recent relevance first — soonest-
      // starting trip for upcoming/active-trip alerts, most-recently-ended
      // trip for completed-trip alerts. Equal relevance (or no linked trip)
      // falls through to Array.prototype.sort's stability, which preserves
      // the rule-evaluation order the alerts were pushed in above — exactly
      // the tie-break the spec calls for.
      return relevanceKey(a, trips) - relevanceKey(b, trips);
    });
}

function relevanceKey(alert: OwnerAlert, trips: Trip[]): number {
  const trip = alert.tripId ? trips.find((t) => t.id === alert.tripId) : undefined;
  if (!trip) return 0;
  switch (alert.kind) {
    case "guest-not-started":
    case "required-checklist-open":
    case "guest-stalled":
      return trip.startAt; // soonest-starting trip sorts first
    case "return-below-policy":
    case "supercharging-unrecovered":
      return -trip.endAt; // most-recently-ended trip sorts first
    default:
      return 0;
  }
}
