import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchVehicleLocationEvidence,
  isWorkspaceLocationEvidenceAllowed,
} from "@/lib/owner/location-evidence-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
}

/**
 * Phase 4 location evidence read. Evidence states ONLY — current position
 * during an active consented trip, an out-of-area boolean (or null if no
 * home area is set), and last-known-at for locate-unreturned. There is no
 * breadcrumb/history endpoint anywhere in this codebase (NOT In Scope, P1)
 * and this route must never grow one: it can only ever return the single
 * latest evidence point behind the founder-workspace allowlist.
 *
 * `workspaceId` is passed as a query param (not inferred from the vehicle
 * row) because a non-member's SELECT on onlyevs_vehicles is invisible under
 * RLS — the allowlist and manager-membership checks below must run
 * independently of vehicle-row visibility so "denied" stays distinguishable
 * from "absent".
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/owner/vehicles/[id]/location">,
) {
  const { id } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(workspaceId)) {
    return reply({ state: "absent" }, 400);
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);

  if (!isWorkspaceLocationEvidenceAllowed(workspaceId)) {
    return reply({ state: "not_allowlisted" });
  }

  const evidence = await fetchVehicleLocationEvidence({
    workspaceId,
    vehicleId: id,
    requestingUserId: authData.user.id,
  });

  switch (evidence.kind) {
    case "not_allowlisted":
      return reply({ state: "not_allowlisted" });
    case "denied":
      return reply({ state: "denied" }, 403);
    case "absent":
      return reply({ state: "absent" });
    case "decrypt_error":
      // Explicit, handled state — never let a decrypt failure surface as an
      // unhandled 500 with a stack trace or ciphertext in the response body.
      return reply({ state: "decrypt_error" });
    case "evidence":
      return reply({
        state: "evidence",
        tripId: evidence.tripId,
        observedAtMs: evidence.observedAtMs,
        latitude: evidence.latitude,
        longitude: evidence.longitude,
        outOfArea: evidence.outOfArea,
      });
  }
}
