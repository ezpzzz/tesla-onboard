/**
 * Durable-guest roster reads for the drivers pages (Phase 7, T11 UI half).
 *
 * Workspace mode only: public.onlyevs_guests and public.onlyevs_trips (via
 * its guest_id column) already grant direct authenticated SELECT under
 * manager RLS -- see the migration's grants block and the
 * get_onlyevs_guest_identity_key_counts comment, which documents that
 * decision precisely so the client can read durable guests + their linked
 * trips with ordinary table selects, no RPC needed for that half. Demo mode
 * (no active workspace) keeps the existing per-trip synthesized driver ids
 * from useOwnerData() untouched and honest, since there is no durable guest
 * table to read there.
 *
 * This module deliberately never imports/edits lib/owner/trip-repository.ts,
 * lib/owner/types.ts, lib/owner/use-owner-data.ts, or
 * components/owner/owner-ui.tsx (outside this lane's file ownership).
 * Instead it fetches its own {tripId -> guestId} map and remaps the
 * Driver[]/Trip[] the drivers pages already get from useOwnerData() into one
 * row per durable guest, entirely inside this lane's files.
 * `components/owner/owner-ui.tsx`'s DriverTable only ever consumes opaque
 * `Driver.id` / `Trip.driverId` strings (see buildDriverRows there), so
 * substituting a durable guest id for the synthesized `trip-guest:<tripId>`
 * id is enough to switch the roster to durable identity without touching
 * that file.
 */

import { createClient } from "@/lib/supabase/client";
import type { Driver, Trip } from "@/lib/owner/types";

export interface GuestRosterScope {
  workspaceId: string;
  shopSlug: string;
}

interface GuestRow {
  id: string;
  display_name: string;
}

interface TripGuestRow {
  id: string;
  guest_id: string | null;
}

interface GuestKeyCountRow {
  guest_id: string;
  key_count: number;
}

export interface WorkspaceGuestLinks {
  /** trip id -> durable guest id, only for trips the worker's exact-match
   * sweep (or the Phase 7 backfill) has already linked. A trip absent from
   * this map keeps rendering under its existing per-trip synthesized id --
   * an honest partial state, never a fabricated guest. */
  tripToGuestId: Map<string, string>;
  guestDisplayNames: Map<string, string>;
}

export const EMPTY_GUEST_LINKS: WorkspaceGuestLinks = {
  tripToGuestId: new Map(),
  guestDisplayNames: new Map(),
};

/** A read failure here must never break the rest of the drivers page --
 * every caller falls back to EMPTY_GUEST_LINKS, the honest "no durable
 * links resolved yet" state (every trip keeps its own per-trip row), same
 * degrade rule as fetchWorkspaceOperationalSnapshot's bookend join. */
export async function fetchWorkspaceGuestLinks(scope: GuestRosterScope): Promise<WorkspaceGuestLinks> {
  const supabase = createClient();
  const [guestsResult, tripsResult] = await Promise.all([
    supabase.from("onlyevs_guests").select("id,display_name").eq("workspace_id", scope.workspaceId),
    supabase
      .from("onlyevs_trips")
      .select("id,guest_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("shop_slug", scope.shopSlug)
      .not("guest_id", "is", null),
  ]);
  if (guestsResult.error || tripsResult.error) return EMPTY_GUEST_LINKS;

  const guestDisplayNames = new Map<string, string>();
  for (const row of (guestsResult.data ?? []) as GuestRow[]) {
    guestDisplayNames.set(row.id, row.display_name);
  }
  const tripToGuestId = new Map<string, string>();
  for (const row of (tripsResult.data ?? []) as TripGuestRow[]) {
    if (row.guest_id) tripToGuestId.set(row.id, row.guest_id);
  }
  return { tripToGuestId, guestDisplayNames };
}

/** Identity-key counts per guest (Phase 7 merge dialog's real-counts copy).
 * private.onlyevs_guest_identity_keys itself never reaches the client --
 * this RPC (schema lane, get_onlyevs_guest_identity_key_counts) is the one
 * hardened read path that returns counts only, never key_value. Returns an
 * empty map on any error, so the merge dialog degrades to "0 identity keys"
 * rather than crashing -- never a guessed count. */
export async function fetchWorkspaceGuestKeyCounts(scope: GuestRosterScope): Promise<Map<string, number>> {
  const { data, error } = await createClient().rpc("get_onlyevs_guest_identity_key_counts", {
    p_workspace_id: scope.workspaceId,
  });
  if (error) return new Map();
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as GuestKeyCountRow[]) {
    counts.set(row.guest_id, Number(row.key_count));
  }
  return counts;
}

const TRIP_GUEST_PREFIX = "trip-guest:";

/**
 * Regroups the existing per-trip Driver[]/Trip[] (from useOwnerData()) into
 * one row per durable guest wherever a link exists. Progress/status is
 * picked from the most recently-started linked trip, since a guest's
 * onboarding progress is inherently per-trip (one walkthrough per booking)
 * -- there is no single "guest progress" in the schema; this is a
 * documented display choice, not a fabricated aggregate.
 */
export function applyGuestLinks(
  drivers: Driver[],
  trips: Trip[],
  links: WorkspaceGuestLinks,
): { drivers: Driver[]; trips: Trip[] } {
  if (links.tripToGuestId.size === 0) return { drivers, trips };

  const driverByOriginalId = new Map(drivers.map((driver) => [driver.id, driver]));
  const tripsByGuestId = new Map<string, Trip[]>();
  const remappedTrips: Trip[] = trips.map((trip) => {
    const guestId = links.tripToGuestId.get(trip.id);
    if (!guestId) return trip;
    const remapped: Trip = { ...trip, driverId: guestId };
    const list = tripsByGuestId.get(guestId) ?? [];
    list.push(remapped);
    tripsByGuestId.set(guestId, list);
    return remapped;
  });

  const guestDrivers: Driver[] = [];
  for (const [guestId, guestTrips] of tripsByGuestId) {
    const latestTrip = guestTrips.reduce((a, b) => (a.startAt >= b.startAt ? a : b));
    const originalDriver = driverByOriginalId.get(`${TRIP_GUEST_PREFIX}${latestTrip.id}`);
    guestDrivers.push({
      id: guestId,
      name: links.guestDisplayNames.get(guestId) ?? originalDriver?.name ?? "Unnamed guest",
      email: originalDriver?.email ?? "",
      source: "live",
      progress: originalDriver?.progress ?? null,
    });
  }

  // Keep every driver this pass didn't consume: the browser-local guest
  // ("guest-local", from useOwnerData's own merge logic) and any per-trip
  // driver whose trip never got a durable link yet.
  const unlinkedDrivers = drivers.filter((driver) => {
    if (!driver.id.startsWith(TRIP_GUEST_PREFIX)) return true;
    const tripId = driver.id.slice(TRIP_GUEST_PREFIX.length);
    return !links.tripToGuestId.has(tripId);
  });

  return { drivers: [...unlinkedDrivers, ...guestDrivers], trips: remappedTrips };
}
