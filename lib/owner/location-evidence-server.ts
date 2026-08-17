import "server-only";

import { createClient } from "@/lib/supabase/server";
import { credentialKeyringFromEnv, decryptCredential } from "./credential-envelope";
import { validCoordinates } from "./telemetry-policy";

/**
 * Server-only location evidence read path (Phase 4).
 *
 * Backs app/api/owner/vehicles/[id]/location (API routes lane): (a) checks
 * the founder-workspace allowlist below, (b) fetches ciphertext via the
 * hardened public.get_onlyevs_vehicle_location_evidence() RPC — manager
 * membership AND an active consented trip window are enforced in SQL, not
 * here — and (c) decrypts with the location KEK, which must live only in
 * the web app's server-only environment, never NEXT_PUBLIC_*. The same key
 * material and `key_version` rotation as the worker's location encryption
 * (lib/owner/credential-envelope.ts). No breadcrumb/history read exists:
 * this module can only ever return the single latest evidence point.
 *
 * Scope stance: user-visible activation is gated by
 * ONLYEVS_LOCATION_EVIDENCE_WORKSPACES until counsel reviews AB 1197 beyond
 * the founder's own workspace — a technical gate, not a policy hope.
 */

/** Comma-separated workspace ids in ONLYEVS_LOCATION_EVIDENCE_WORKSPACES.
 * Absent/empty env means the allowlist is empty — fail closed, not open. */
export function isWorkspaceLocationEvidenceAllowed(workspaceId: string): boolean {
  const raw = process.env.ONLYEVS_LOCATION_EVIDENCE_WORKSPACES ?? "";
  const allowed = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(workspaceId);
}

export type LocationEvidenceState =
  | { kind: "not_allowlisted" }
  | { kind: "denied" }
  | { kind: "absent" }
  | { kind: "decrypt_error" }
  | {
      kind: "evidence";
      tripId: string;
      observedAtMs: number;
      latitude: number;
      longitude: number;
      /** Computed against the vehicle's optional home area (Phase 4
       * sub-task); null when no home area is configured — render "No home
       * area set", never a guessed in/out-of-area boolean. */
      outOfArea: boolean | null;
    };

export interface FetchVehicleLocationEvidenceArgs {
  workspaceId: string;
  vehicleId: string;
  /** Supabase auth uid of the requesting owner, so the caller's own
   * membership can be surfaced as `denied` distinctly from `absent`. Held
   * for callers/tests; membership enforcement itself runs inside the RPC
   * against the request's authenticated session, not this value. */
  requestingUserId: string;
}

interface LocationEvidenceRpcRow {
  trip_id: string;
  observed_at: string;
  coordinates_ciphertext: string;
  key_version: number;
}

interface VehicleHomeAreaRow {
  home_area_center_lat: number | null;
  home_area_center_lng: number | null;
  home_area_radius_mi: number | null;
}

/** Great-circle distance in miles. Local to this module — the only caller
 * needing an in/out-of-area comparison against a small radius, so it is not
 * worth a shared geo module for the routes lane's scope. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const EARTH_RADIUS_MI = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  return EARTH_RADIUS_MI * c;
}

/** Evidence states only — current position during an active consented trip,
 * out-of-area boolean (or null if no home area is set), last-known-at for
 * locate-unreturned. Never a breadcrumb/history set (NOT In Scope, P1). */
export async function fetchVehicleLocationEvidence(
  args: FetchVehicleLocationEvidenceArgs,
): Promise<LocationEvidenceState> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_onlyevs_vehicle_location_evidence", {
    p_workspace_id: args.workspaceId,
    p_vehicle_id: args.vehicleId,
  });
  if (error) {
    // The RPC raises 42501 (workspace_manager_required) before touching any
    // sealed data when the requester isn't at least a manager of the
    // workspace — everything else is treated as an honest "absent" rather
    // than leaking which precondition failed.
    return error.code === "42501" ? { kind: "denied" } : { kind: "absent" };
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as LocationEvidenceRpcRow[];
  const row = rows[0];
  if (!row) return { kind: "absent" };

  // AAD binds the ciphertext to workspace + shop_slug + provider + field,
  // matching exactly what the worker used to encrypt it (services/onlyevs-
  // worker/index.ts). shop_slug lives on the trip, not the RPC row, so it is
  // read separately through the trips-managers-select RLS policy.
  const { data: trip, error: tripError } = await supabase
    .from("onlyevs_trips")
    .select("shop_slug")
    .eq("id", row.trip_id)
    .maybeSingle();
  if (tripError || !trip?.shop_slug) return { kind: "decrypt_error" };

  let plaintext: string;
  try {
    plaintext = decryptCredential(row.coordinates_ciphertext, credentialKeyringFromEnv(), {
      workspaceId: args.workspaceId,
      shopSlug: trip.shop_slug,
      provider: "tesla",
      field: "location",
    });
  } catch {
    return { kind: "decrypt_error" };
  }

  let latitude: number;
  let longitude: number;
  try {
    const parsed = JSON.parse(plaintext) as { latitude?: unknown; longitude?: unknown };
    latitude = Number(parsed.latitude);
    longitude = Number(parsed.longitude);
  } catch {
    return { kind: "decrypt_error" };
  }
  if (!validCoordinates(latitude, longitude)) return { kind: "decrypt_error" };

  const { data: vehicle } = await supabase
    .from("onlyevs_vehicles")
    .select("home_area_center_lat,home_area_center_lng,home_area_radius_mi")
    .eq("id", args.vehicleId)
    .maybeSingle<VehicleHomeAreaRow>();

  const outOfArea =
    vehicle?.home_area_center_lat != null
    && vehicle?.home_area_center_lng != null
    && vehicle?.home_area_radius_mi != null
      ? haversineMiles(
          latitude,
          longitude,
          vehicle.home_area_center_lat,
          vehicle.home_area_center_lng,
        ) > vehicle.home_area_radius_mi
      : null;

  return {
    kind: "evidence",
    tripId: row.trip_id,
    observedAtMs: Date.parse(row.observed_at),
    latitude,
    longitude,
    outOfArea,
  };
}
