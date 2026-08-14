import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
}

export async function POST(request: NextRequest) {
  if (!ONLYEVS_OPERATIONS_ENABLED) return response({ error: "Not available." }, 404);
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return response({ error: "Cross-origin confirmation was rejected." }, 403);
  }
  const body = (await request.json().catch(() => null)) as {
    candidateId?: string;
    vehicleId?: string;
    guestName?: string;
    guestEmail?: string;
  } | null;
  const candidateId = body?.candidateId?.trim() ?? "";
  const vehicleId = body?.vehicleId?.trim() ?? "";
  const guestName = body?.guestName?.trim() ?? "";
  const guestEmail = body?.guestEmail?.trim().toLowerCase() ?? "";
  if (
    !UUID_PATTERN.test(candidateId) ||
    !UUID_PATTERN.test(vehicleId) ||
    guestName.length < 1 ||
    guestName.length > 240 ||
    guestEmail.length < 3 ||
    guestEmail.length > 320 ||
    !/^\S+@\S+\.\S+$/.test(guestEmail)
  ) {
    return response({ error: "Enter a valid guest name, email, and vehicle." }, 400);
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return response({ error: "Your owner session expired." }, 401);
  const { data: candidate, error: candidateError } = await supabase
    .from("onlyevs_calendar_candidates")
    .select("ends_at")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError || !candidate?.ends_at) {
    return response({ error: "That calendar event is no longer available." }, 404);
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.parse(candidate.ends_at) + 24 * 60 * 60 * 1_000);
  const { data: tripData, error } = await supabase.rpc(
    "confirm_onlyevs_calendar_candidate",
    {
      p_candidate_id: candidateId,
      p_vehicle_id: vehicleId,
      p_guest_name: guestName,
      p_guest_email: guestEmail,
      p_public_token_hash: tokenHash,
      p_token_expires_at: expiresAt.toISOString(),
    },
  );
  if (error) {
    const message = error.message.includes("vehicle_schedule_conflict")
      ? "This vehicle already has a confirmed trip during that time."
      : error.message.includes("calendar_schedule_change_requires_manual_review")
        ? "This event changed after its trip was confirmed. Review the existing trip before changing its access window."
      : error.message.includes("not_confirmable")
        ? "This calendar event was already handled."
        : "The trip could not be confirmed.";
    return response({ error: message }, error.code === "23P01" ? 409 : 400);
  }
  const trip = tripData as { id?: string } | null;
  if (!trip?.id) return response({ error: "The trip confirmation returned no trip." }, 500);
  return response({
    tripId: trip.id,
    guestUrl: `${new URL(request.url).origin}/trip/${token}`,
  }, 201);
}
