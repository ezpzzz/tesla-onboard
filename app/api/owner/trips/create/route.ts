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

function validTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return reply({ error: "Cross-origin onboarding creation was rejected." }, 403);
  }
  const body = (await request.json().catch(() => null)) as {
    workspaceId?: string;
    shopSlug?: string;
    vehicleId?: string;
    guestName?: string;
    guestEmail?: string;
    timezone?: string;
    startsAt?: string;
    endsAt?: string;
  } | null;
  const workspaceId = body?.workspaceId?.trim() ?? "";
  const shopSlug = body?.shopSlug?.trim() ?? "";
  const vehicleId = body?.vehicleId?.trim() ?? "";
  const guestName = body?.guestName?.trim() ?? "";
  const guestEmail = body?.guestEmail?.trim().toLowerCase() ?? "";
  const timezone = body?.timezone?.trim() ?? "";
  const startsAt = Date.parse(body?.startsAt ?? "");
  const endsAt = Date.parse(body?.endsAt ?? "");
  const now = Date.now();
  if (
    !UUID_PATTERN.test(workspaceId) ||
    !UUID_PATTERN.test(vehicleId) ||
    shopSlug.length < 1 ||
    shopSlug.length > 160 ||
    guestName.length < 1 ||
    guestName.length > 240 ||
    guestEmail.length < 3 ||
    guestEmail.length > 320 ||
    !/^\S+@\S+\.\S+$/.test(guestEmail) ||
    !validTimezone(timezone) ||
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    startsAt < now - 24 * 60 * 60 * 1_000 ||
    startsAt > now + 2 * 365 * 24 * 60 * 60 * 1_000 ||
    endsAt <= startsAt ||
    endsAt > startsAt + 90 * 24 * 60 * 60 * 1_000
  ) {
    return reply({ error: "Enter a valid guest, vehicle, pickup time, and return time." }, 400);
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);
  if (!allowRequest(`owner-trip-create:${authData.user.id}`, 30, 60 * 60 * 1_000)) {
    return reply({ error: "Too many onboarding links were created. Try again later." }, 429);
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const tokenExpiresAt = new Date(endsAt + 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabase.rpc("create_onlyevs_manual_trip", {
    p_workspace_id: workspaceId,
    p_shop_slug: shopSlug,
    p_vehicle_id: vehicleId,
    p_guest_name: guestName,
    p_guest_email: guestEmail,
    p_timezone: timezone,
    p_starts_at: new Date(startsAt).toISOString(),
    p_ends_at: new Date(endsAt).toISOString(),
    p_public_token_hash: tokenHash,
    p_token_expires_at: tokenExpiresAt,
  });
  if (error) {
    const message = error.message.includes("vehicle_schedule_conflict")
      ? "That vehicle already has a trip during this time."
      : error.message.includes("guest_onboarding_not_published")
        ? "Finish and publish fleet setup before inviting a guest."
        : error.message.includes("active_workspace_vehicle_required")
          ? "Choose an active vehicle in this workspace."
          : error.code === "42501"
            ? "Your workspace role does not allow guest onboarding creation."
            : "The guest onboarding could not be created.";
    return reply({ error: message }, error.code === "23P01" ? 409 : error.code === "42501" ? 403 : 400);
  }
  const trip = data as { id?: string } | null;
  if (!trip?.id) return reply({ error: "The onboarding record returned no trip." }, 500);

  return reply({
    tripId: trip.id,
    guestUrl: `${canonicalOnlyEvsOrigin(request)}/trip/${token}`,
  }, 201);
}
