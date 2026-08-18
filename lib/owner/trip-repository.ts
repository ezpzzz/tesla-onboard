"use client";

import { createClient } from "@/lib/supabase/client";
import type { ProgressSummary } from "@/lib/flow";
import type { Driver, OwnerSnapshot, Trip, TripStatus } from "./types";
import type { BookendEdge, TripBookend } from "./access-types";
import type { VehicleWorkspaceScope } from "./vehicle-repository";

export const OWNER_TRIPS_CHANGED_EVENT = "onlyevs:owner-trips-changed";

export interface CalendarCandidate {
  id: string;
  summary: string;
  startAt: number;
  endAt: number;
  timezone: string;
  status: "pending" | "needs_review";
  changeKind: "schedule" | "cancel" | null;
  sourceUpdatedAt: number | null;
  location: string | null;
}

interface TripRow {
  id: string;
  vehicle_id: string;
  guest_name: string;
  guest_email: string;
  status: "confirmed" | "armed" | "active" | "completed" | "cancelled" | "conflict";
  starts_at: string;
  ends_at: string;
  pickup_location?: string | null;
  return_location?: string | null;
  access_status?: string | null;
  reminder_last_sent_at?: string | null;
  onboarding_progress?: unknown;
  progress_updated_at?: string | null;
  guest_bound_at?: string | null;
  onboarding_completed_at?: string | null;
}

export interface ManualGuestOnboardingInput {
  workspaceId: string;
  shopSlug: string;
  vehicleId: string;
  guestName: string;
  guestEmail: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  pickupLocation?: string;
  returnLocation?: string;
}

export interface GuestOnboardingLink {
  tripId: string;
  guestUrl: string;
}

function ownerTripStatus(status: TripRow["status"]): TripStatus | null {
  // "conflict" (a provider-reported double-booking pending manager review)
  // stays hidden from the dashboard -- out of scope here, unchanged from
  // before. "cancelled" is now surfaced rather than dropped: an owner who
  // cancels a trip needs to see it land in the cancelled state, not vanish.
  if (status === "conflict") return null;
  if (status === "cancelled") return "cancelled";
  if (status === "active") return "active";
  if (status === "completed") return "completed";
  return "upcoming";
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  return value.every((item) => typeof item === "string" && item.length <= 120)
    ? value as string[]
    : null;
}

function checklist(value: unknown): Record<string, boolean> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key, checked]) => key.length > 120 || typeof checked !== "boolean")) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, boolean>;
}

/** Treat database JSON as untrusted input before it reaches owner UI logic. */
export function parseStoredProgress(value: unknown): ProgressSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const pct = finiteNumber(row.pct, 0, 100);
  const completed = stringArray(row.completed);
  const checked = checklist(row.checklist);
  const integers = [
    row.moduleTotal,
    row.checklistDone,
    row.checklistTotal,
    row.requiredChecklistDone,
    row.requiredChecklistTotal,
  ];
  if (
    typeof row.stepId !== "string" || !row.stepId || row.stepId.length > 120 ||
    pct === null || typeof row.isDone !== "boolean" || !completed || !checked ||
    integers.some((item) => !Number.isInteger(item) || (item as number) < 0 || (item as number) > 64) ||
    !Number.isSafeInteger(row.updatedAt)
  ) return null;
  return {
    stepId: row.stepId,
    pct,
    isDone: row.isDone,
    completed,
    checklist: checked,
    moduleTotal: row.moduleTotal as number,
    checklistDone: row.checklistDone as number,
    checklistTotal: row.checklistTotal as number,
    requiredChecklistDone: row.requiredChecklistDone as number,
    requiredChecklistTotal: row.requiredChecklistTotal as number,
    experience: row.experience === "owner" || row.experience === "account" || row.experience === "new"
      ? row.experience
      : null,
    pathMode: row.pathMode === "full" || row.pathMode === "essentials" ? row.pathMode : null,
    startedAt: Number.isSafeInteger(row.startedAt) ? row.startedAt as number : null,
    newToTesla: row.newToTesla === true,
    guestName: typeof row.guestName === "string" && row.guestName.length <= 240 ? row.guestName : null,
    updatedAt: row.updatedAt as number,
  };
}

export function notifyOwnerTripsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OWNER_TRIPS_CHANGED_EVENT));
}

interface BookendRow {
  trip_id: string;
  edge: BookendEdge;
  odometer_mi: number | null;
  odometer_observed_at: string | null;
  battery_pct: number | null;
  battery_observed_at: string | null;
  captured_at: string;
  stale: boolean;
}

function mapBookendRow(row: BookendRow): TripBookend {
  return {
    tripId: row.trip_id,
    edge: row.edge,
    odometerMi: row.odometer_mi,
    odometerObservedAt: row.odometer_observed_at ? Date.parse(row.odometer_observed_at) : null,
    batteryPct: row.battery_pct,
    batteryObservedAt: row.battery_observed_at ? Date.parse(row.battery_observed_at) : null,
    capturedAt: Date.parse(row.captured_at),
    stale: row.stale,
  };
}

/**
 * Reads both bookend edges for one trip via the hardened
 * get_onlyevs_trip_bookends() RPC (manager membership enforced in SQL, no
 * location data involved). Kept for single-trip surfaces (e.g. the
 * active-trip card, which only ever needs its own trip's bookends) —
 * fetchWorkspaceOperationalSnapshot below uses the workspace-scoped
 * get_onlyevs_workspace_trip_bookends() RPC instead of calling this per trip.
 */
export async function fetchTripBookends(tripId: string): Promise<TripBookend[]> {
  const { data, error } = await createClient().rpc("get_onlyevs_trip_bookends", {
    p_trip_id: tripId,
  });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as BookendRow[]).map(mapBookendRow);
}

/**
 * Reads every bookend row for a workspace in one round trip via
 * get_onlyevs_workspace_trip_bookends() — the single-select join the design
 * calls for, replacing an earlier N-per-trip fan-out of
 * get_onlyevs_trip_bookends(). Exported standalone for testability.
 */
export async function fetchWorkspaceTripBookends(
  scope: VehicleWorkspaceScope,
): Promise<TripBookend[]> {
  const { data, error } = await createClient().rpc("get_onlyevs_workspace_trip_bookends", {
    p_workspace_id: scope.workspaceId,
    p_shop_slug: scope.shopSlug,
  });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as BookendRow[]).map(mapBookendRow);
}

export async function fetchWorkspaceOperationalSnapshot(
  scope: VehicleWorkspaceScope,
): Promise<OwnerSnapshot> {
  const { data, error } = await createClient().rpc("get_onlyevs_workspace_trip_snapshot", {
    p_workspace_id: scope.workspaceId,
    p_shop_slug: scope.shopSlug,
  });
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
      progress: (() => {
        const parsed = parseStoredProgress(row.onboarding_progress);
        const receivedAt = row.progress_updated_at ? Date.parse(row.progress_updated_at) : Number.NaN;
        return parsed && Number.isFinite(receivedAt) ? { ...parsed, updatedAt: receivedAt } : parsed;
      })(),
    });
    trips.push({
      id: row.id,
      driverId,
      vehicleId: row.vehicle_id,
      status,
      startAt: Date.parse(row.starts_at),
      endAt: Date.parse(row.ends_at),
      pickupLocation: row.pickup_location ?? null,
      returnLocation: row.return_location ?? row.pickup_location ?? null,
      accessStatus: row.access_status ?? null,
      reminderLastSentAt: row.reminder_last_sent_at ? Date.parse(row.reminder_last_sent_at) : null,
      // Populated below from private.onlyevs_trip_bookends via
      // fetchTripBookends — null here is only the pre-join placeholder, not
      // the final "not captured" state.
      odometerStartMi: null,
      odometerEndMi: null,
      batteryStartPct: null,
      batteryEndPct: null,
      chargingSessionIds: [],
    });
  }

  // Join bookends (Phase 2): one workspace-scoped select, not an N-per-trip
  // RPC fan-out. A read failure must never break the rest of the snapshot —
  // the tiles, other trips, and drivers still need to render. Falling back
  // to "no bookend" for every trip is already a valid, honest state
  // (absent-data rule: renders as "Not captured at pickup/return"), never a
  // fabricated one.
  let bookends: TripBookend[] = [];
  try {
    bookends = await fetchWorkspaceTripBookends(scope);
  } catch {
    bookends = [];
  }
  const bookendsByTrip = new Map<string, TripBookend[]>();
  for (const bookend of bookends) {
    const list = bookendsByTrip.get(bookend.tripId);
    if (list) list.push(bookend);
    else bookendsByTrip.set(bookend.tripId, [bookend]);
  }
  const tripsWithBookends: Trip[] = trips.map((trip) => {
    const tripBookends = bookendsByTrip.get(trip.id) ?? [];
    const start = tripBookends.find((bookend) => bookend.edge === "start") ?? null;
    const end = tripBookends.find((bookend) => bookend.edge === "end") ?? null;
    return {
      ...trip,
      odometerStartMi: start?.odometerMi ?? null,
      odometerEndMi: end?.odometerMi ?? null,
      batteryStartPct: start?.batteryPct ?? null,
      batteryEndPct: end?.batteryPct ?? null,
    };
  });

  return { drivers, trips: tripsWithBookends, chargingSessions: [], vehicles: [] };
}

export async function createManualGuestOnboarding(
  input: ManualGuestOnboardingInput,
): Promise<GuestOnboardingLink> {
  const response = await fetch("/api/owner/trips/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as Partial<GuestOnboardingLink> & {
    error?: string;
  } | null;
  if (!response.ok || !result?.tripId || !result.guestUrl) {
    throw new Error(result?.error ?? "The guest onboarding could not be created.");
  }
  notifyOwnerTripsChanged();
  return { tripId: result.tripId, guestUrl: result.guestUrl };
}

export async function regenerateGuestOnboardingLink(tripId: string): Promise<string> {
  const response = await fetch(`/api/owner/trips/${encodeURIComponent(tripId)}/link`, {
    method: "POST",
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as {
    guestUrl?: string;
    error?: string;
  } | null;
  if (!response.ok || !result?.guestUrl) {
    throw new Error(result?.error ?? "A new guest link could not be generated.");
  }
  return result.guestUrl;
}

export async function fetchCalendarCandidates(
  scope: VehicleWorkspaceScope,
): Promise<CalendarCandidate[]> {
  const { data, error } = await createClient()
    .from("onlyevs_calendar_candidates")
    .select("id,summary,location,starts_at,ends_at,timezone,status,change_kind,source_updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .in("status", ["pending", "needs_review"])
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    id: string;
    summary: string;
    location: string | null;
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
    location: row.location,
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

export async function cancelTrip(tripId: string, reason?: string): Promise<void> {
  const response = await fetch(`/api/owner/trips/${encodeURIComponent(tripId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: reason?.trim() || undefined }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error ?? "The trip could not be cancelled.");
  }
  notifyOwnerTripsChanged();
}

export async function sendGuestReminder(tripId: string): Promise<{ recipient: string; sentAt: number }> {
  const response = await fetch(`/api/owner/trips/${encodeURIComponent(tripId)}/reminder`, {
    method: "POST",
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { recipient?: string; sentAt?: string; error?: string } | null;
  if (!response.ok || !result?.recipient || !result.sentAt) {
    throw new Error(result?.error ?? "The reminder could not be sent.");
  }
  notifyOwnerTripsChanged();
  return { recipient: result.recipient, sentAt: Date.parse(result.sentAt) };
}
