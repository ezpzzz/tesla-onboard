"use client";

import { createClient } from "@/lib/supabase/client";
import type { Driver, OwnerSnapshot, Trip, TripStatus } from "./types";
import type { VehicleWorkspaceScope } from "./vehicle-repository";

export interface CalendarCandidate {
  id: string;
  summary: string;
  startAt: number;
  endAt: number;
  timezone: string;
  status: "pending" | "needs_review";
  changeKind: "schedule" | "cancel" | null;
  sourceUpdatedAt: number | null;
}

interface TripRow {
  id: string;
  vehicle_id: string;
  guest_name: string;
  guest_email: string;
  status: "confirmed" | "armed" | "active" | "completed" | "cancelled" | "conflict";
  starts_at: string;
  ends_at: string;
}

function ownerTripStatus(status: TripRow["status"]): TripStatus | null {
  if (status === "cancelled" || status === "conflict") return null;
  if (status === "active") return "active";
  if (status === "completed") return "completed";
  return "upcoming";
}

export async function fetchWorkspaceOperationalSnapshot(
  scope: VehicleWorkspaceScope,
): Promise<OwnerSnapshot> {
  const { data, error } = await createClient()
    .from("onlyevs_trips")
    .select("id,vehicle_id,guest_name,guest_email,status,starts_at,ends_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .order("starts_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as TripRow[];
  const trips: Trip[] = [];
  const drivers: Driver[] = [];
  for (const row of rows) {
    const status = ownerTripStatus(row.status);
    if (!status) continue;
    const driverId = `trip-guest:${row.id}`;
    drivers.push({
      id: driverId,
      name: row.guest_name,
      email: row.guest_email,
      source: "live",
      progress: null,
    });
    trips.push({
      id: row.id,
      driverId,
      vehicleId: row.vehicle_id,
      status,
      startAt: Date.parse(row.starts_at),
      endAt: Date.parse(row.ends_at),
      odometerStartMi: null,
      odometerEndMi: null,
      batteryStartPct: null,
      batteryEndPct: null,
      chargingSessionIds: [],
    });
  }
  return { drivers, trips, chargingSessions: [], vehicles: [] };
}

export async function fetchCalendarCandidates(
  scope: VehicleWorkspaceScope,
): Promise<CalendarCandidate[]> {
  const { data, error } = await createClient()
    .from("onlyevs_calendar_candidates")
    .select("id,summary,starts_at,ends_at,timezone,status,change_kind,source_updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .in("status", ["pending", "needs_review"])
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    id: string;
    summary: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    status: CalendarCandidate["status"];
    change_kind: CalendarCandidate["changeKind"];
    source_updated_at: string | null;
  }>).map((row) => ({
    id: row.id,
    summary: row.summary,
    startAt: Date.parse(row.starts_at),
    endAt: Date.parse(row.ends_at),
    timezone: row.timezone,
    status: row.status,
    changeKind: row.change_kind,
    sourceUpdatedAt: row.source_updated_at ? Date.parse(row.source_updated_at) : null,
  }));
}

export async function resolveCalendarCandidateChange(
  candidateId: string,
  action: "apply" | "cancel",
): Promise<void> {
  const { error } = await createClient().rpc("resolve_onlyevs_calendar_candidate_change", {
    p_candidate_id: candidateId,
    p_action: action,
  });
  if (error) {
    if (error.message.includes("vehicle_schedule_conflict")) {
      throw new Error("The updated times overlap another confirmed trip for this vehicle.");
    }
    throw new Error(error.message);
  }
}

export async function dismissCalendarCandidate(candidateId: string): Promise<void> {
  const { error } = await createClient().rpc("dismiss_onlyevs_calendar_candidate", {
    p_candidate_id: candidateId,
  });
  if (error) throw new Error(error.message);
}

export async function confirmCalendarCandidate(input: {
  candidateId: string;
  vehicleId: string;
  guestName: string;
  guestEmail: string;
}): Promise<{ tripId: string; guestUrl: string }> {
  const response = await fetch("/api/owner/trips/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as {
    tripId?: string;
    guestUrl?: string;
    error?: string;
  } | null;
  if (!response.ok || !result?.tripId || !result.guestUrl) {
    throw new Error(result?.error ?? "The calendar event could not be confirmed.");
  }
  return { tripId: result.tripId, guestUrl: result.guestUrl };
}
