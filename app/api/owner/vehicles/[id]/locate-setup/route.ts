import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TeslaProfile } from "@/lib/tesla";
import {
  fetchVehicleLocationReading,
  getConfig,
  resolveRegionBase,
  unseal,
} from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  const response = NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
  return response;
}

interface OwnerTransientFleetSession {
  kind: "transient_fleet";
  accessToken: string;
  verifiedSubject: string;
  expiresAt: number;
}

function isTransientFleetSession(value: unknown): value is OwnerTransientFleetSession {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OwnerTransientFleetSession>;
  return row.kind === "transient_fleet"
    && typeof row.accessToken === "string"
    && row.accessToken.length > 0
    && typeof row.expiresAt === "number";
}

/**
 * Home-area setup sub-task (Phase 4, design-review 8A): the vehicle-form
 * "Use car's current location" button. Deliberately a one-shot, owner-
 * initiated `vehicle_data` location read — copy: "Tap while the car is
 * parked at home" — that fills the home-area form fields ONLY. This route
 * never writes to any table, location or otherwise; it is pure read-and-
 * return. It reuses the same short-lived sealed `rtr_owner_tesla` transient-
 * fleet session the owner Tesla connect flow already produces (see
 * app/auth/owner/tesla/callback/route.ts, app/api/owner/tesla/me/route.ts)
 * rather than inventing a second credential path, and consumes it exactly
 * once by clearing the cookie regardless of outcome.
 *
 * Known gap (routes lane, documented rather than guessed at): when
 * operations are enabled, the owner Tesla session instead resolves through
 * the durable `private.onlyevs_owner_import_sessions` handle, which the web
 * app can only read back as a TeslaProfile (no live access token) via
 * get_onlyevs_owner_import_profile — that path cannot serve a live
 * coordinate read from this module without worker-side work outside this
 * lane's file ownership. In that mode this route reports
 * `reconnect_required`, the same honest state as an expired/absent session,
 * never a fabricated coordinate.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/owner/vehicles/[id]/locate-setup">,
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return reply({ state: "vehicle_not_found" }, 404);

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);

  const { data: vehicle, error: vehicleError } = await supabase
    .from("onlyevs_vehicles")
    .select("id,vin")
    .eq("id", id)
    .maybeSingle<{ id: string; vin: string | null }>();
  if (vehicleError || !vehicle) return reply({ state: "vehicle_not_found" }, 404);
  if (!vehicle.vin) return reply({ state: "vin_unknown" });

  const cookieToken = request.cookies.get("rtr_owner_tesla")?.value ?? "";
  const config = getConfig();
  const session = cookieToken && config.sessionSecret
    ? unseal<TeslaProfile | OwnerTransientFleetSession>(cookieToken, config.sessionSecret, "rtr_owner_tesla")
    : null;

  const response = (body: unknown, status = 200) => {
    const res = reply(body, status);
    // One-shot: the transient session is consumed on this single read,
    // success or failure, exactly like /api/owner/tesla/me.
    res.cookies.delete("rtr_owner_tesla");
    return res;
  };

  if (!isTransientFleetSession(session) || session.expiresAt <= Date.now()) {
    return response({ state: "reconnect_required" });
  }

  try {
    const base = await resolveRegionBase(config.audience, session.accessToken);
    const reading = await fetchVehicleLocationReading(base, session.accessToken, vehicle.vin);
    if (!reading) return response({ state: "read_failed" });
    return response({
      state: "reading",
      latitude: reading.latitude,
      longitude: reading.longitude,
    });
  } catch {
    return response({ state: "read_failed" });
  }
}
