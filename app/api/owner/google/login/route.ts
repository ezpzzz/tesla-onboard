import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  assertGoogleCalendarConfigured,
  buildGoogleCalendarAuthorizeUrl,
  createPkce,
  getGoogleCalendarConfig,
} from "@/lib/google-calendar-server";
import { oauthStateSecretFromEnv } from "@/lib/owner/credential-envelope";
import { requireOwnerWorkspace } from "@/lib/owner/server-auth";
import { seal } from "@/lib/tesla-server";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!ONLYEVS_OPERATIONS_ENABLED) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const url = new URL(request.url);
  const origin = url.origin;
  const workspaceId = url.searchParams.get("workspace") ?? "";
  const shopSlug = url.searchParams.get("shop") ?? "";
  const returnPath = "/owner/settings";
  try {
    const owner = await requireOwnerWorkspace(workspaceId, shopSlug, "admin");
    const config = getGoogleCalendarConfig();
    if (assertGoogleCalendarConfigured(config)) {
      return NextResponse.redirect(
        new URL(`${returnPath}?google_calendar_error=config`, origin),
      );
    }
    if (new URL(config.redirectUri).origin !== origin) {
      return NextResponse.redirect(
        new URL(`${returnPath}?google_calendar_error=origin_mismatch`, origin),
      );
    }

    const state = crypto.randomBytes(16).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    const pkce = createPkce();
    const stateSecret = oauthStateSecretFromEnv();
    const response = NextResponse.redirect(buildGoogleCalendarAuthorizeUrl({
      config,
      state,
      nonce,
      codeChallenge: pkce.challenge,
      loginHint: owner.email,
    }));
    response.cookies.set("rtr_owner_google_state", seal({
      state,
      nonce,
      codeVerifier: pkce.verifier,
      workspaceId,
      shopSlug,
      returnPath,
      issuedAt: Date.now(),
    }, stateSecret, "rtr_owner_google_state"), {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    const reason = error instanceof Error && error.message === "unauthenticated"
      ? "session"
      : "workspace_access";
    return NextResponse.redirect(
      new URL(`${returnPath}?google_calendar_error=${reason}`, origin),
    );
  }
}
