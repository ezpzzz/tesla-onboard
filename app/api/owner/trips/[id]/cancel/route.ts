import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";

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
  context: RouteContext<"/api/owner/trips/[id]/cancel">,
) {
  if (!isSameOriginRequest(request)) {
    return reply({ error: "Cross-origin trip cancellation was rejected." }, 403);
  }
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return reply({ error: "Trip not found." }, 404);

  let reason: string | undefined;
  const body = await request.json().catch(() => null) as { reason?: unknown } | null;
  if (body && typeof body.reason === "string") {
    const trimmed = body.reason.trim();
    if (trimmed.length > 1000) return reply({ error: "The cancellation reason is too long." }, 400);
    reason = trimmed || undefined;
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);

  const { data, error } = await supabase.rpc("cancel_onlyevs_trip", {
    p_trip_id: id,
    p_reason: reason ?? null,
  });
  if (error) {
    if (error.message.includes("trip_not_found")) return reply({ error: "Trip not found." }, 404);
    if (error.message.includes("workspace_manager_required")) {
      return reply({ error: "Your workspace role does not allow cancelling trips." }, 403);
    }
    if (error.message.includes("trip_not_cancellable")) {
      return reply({ error: "This trip can no longer be cancelled." }, 409);
    }
    return reply({ error: "The trip could not be cancelled." }, 409);
  }
  const trip = data as { id?: string } | null;
  if (!trip?.id) return reply({ error: "The trip could not be cancelled." }, 500);
  return reply({ ok: true });
}
