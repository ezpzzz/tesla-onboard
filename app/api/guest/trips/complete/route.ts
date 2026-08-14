import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { oauthStateSecretFromEnv } from "@/lib/owner/credential-envelope";
import { createClient } from "@/lib/supabase/server";
import { getConfig, unseal } from "@/lib/tesla-server";
import type { TeslaProfile } from "@/lib/tesla";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
}

export async function POST(request: NextRequest) {
  if (!ONLYEVS_OPERATIONS_ENABLED) return reply({ error: "Not available." }, 404);
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return reply({ error: "Cross-origin completion was rejected." }, 403);
  }
  const body = (await request.json().catch(() => null)) as { token?: string; consent?: boolean } | null;
  const token = body?.token?.trim() ?? "";
  if (!TOKEN_PATTERN.test(token) || body?.consent !== true) {
    return reply({ error: "Tesla access consent is required." }, 400);
  }
  const config = getConfig();
  const sealedProfile = request.cookies.get("rtr_tesla")?.value;
  const profile = sealedProfile && config.sessionSecret
    ? unseal<TeslaProfile>(sealedProfile, config.sessionSecret, "rtr_tesla")
    : null;
  if (!profile?.id.startsWith("live_") || profile.id.length <= 5) {
    return reply({ error: "Connect the Tesla account that should receive vehicle access first." }, 409);
  }
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return reply({ error: "Verify the booking email first." }, 401);

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const bindingSecret = process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET
    ?? oauthStateSecretFromEnv();
  if (bindingSecret.length < 32) return reply({ error: "Trip access is not configured securely." }, 503);
  const teslaSubjectHmac = crypto
    .createHmac("sha256", bindingSecret)
    .update(profile.id.slice(5))
    .digest("hex");
  const { data, error } = await supabase.rpc("complete_onlyevs_guest_onboarding", {
    p_public_token_hash: tokenHash,
    p_access_consent: true,
    p_tesla_subject_hmac: teslaSubjectHmac,
  });
  if (error) {
    const message = error.message.includes("binding")
      ? "Verify the booking email before scheduling Tesla access."
      : "Tesla access could not be scheduled for this trip.";
    return reply({ error: message }, error.code === "42501" ? 403 : 400);
  }
  const grant = data as { status?: string; issue_at?: string; revoke_at?: string } | null;
  return reply({
    status: grant?.status ?? "scheduled",
    issueAt: grant?.issue_at ?? null,
    revokeAt: grant?.revoke_at ?? null,
  });
}
