import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { canonicalOnlyEvsOrigin } from "@/lib/onlyevs-origin";
import { createClient } from "@/lib/supabase/server";
import { allowRequest } from "@/lib/owner-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/owner/trips/[id]/link">,
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return reply({ error: "Cross-origin link generation was rejected." }, 403);
  }
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return reply({ error: "Trip not found." }, 404);

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);
  if (!allowRequest(`owner-trip-link:${authData.user.id}:${id}`, 30, 60 * 60 * 1_000)) {
    return reply({ error: "Too many replacement links were generated. Try again later." }, 429);
  }
  const { data: trip, error: tripError } = await supabase
    .from("onlyevs_trips")
    .select("id,ends_at,status")
    .eq("id", id)
    .maybeSingle();
  if (tripError || !trip?.ends_at) return reply({ error: "Trip not found." }, 404);
  if (!["confirmed", "armed"].includes(trip.status) || Date.parse(trip.ends_at) <= Date.now()) {
    return reply({ error: "A new link is available only before the trip ends." }, 409);
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const tokenExpiresAt = new Date(Date.parse(trip.ends_at) + 24 * 60 * 60 * 1_000).toISOString();
  const { error } = await supabase.rpc("rotate_onlyevs_trip_public_token", {
    p_trip_id: id,
    p_public_token_hash: tokenHash,
    p_token_expires_at: tokenExpiresAt,
  });
  if (error) {
    return reply({
      error: error.code === "42501"
        ? "Your workspace role does not allow link generation."
        : "A new guest link could not be generated.",
    }, error.code === "42501" ? 403 : 409);
  }
  return reply({ guestUrl: `${canonicalOnlyEvsOrigin(request)}/trip/${token}` });
}
