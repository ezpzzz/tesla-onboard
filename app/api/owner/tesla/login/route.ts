import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  assertConfigured,
  buildAuthorizeUrl,
  getConfig,
  OWNER_PERSISTENT_SCOPES,
  seal,
} from "@/lib/tesla-server";
import { requireOwnerWorkspace } from "@/lib/owner/server-auth";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-side mirror of `/api/tesla/login`. Same authorization-code flow, but
 * used by the host to connect their own Tesla account from the fleet setup
 * wizard rather than by a guest. Kept as a structurally separate route (own
 * redirect URI, own CSRF cookie, own error target) so the two identities can
 * never cross.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const workspaceId = requestUrl.searchParams.get("workspace") ?? "";
  const shopSlug = requestUrl.searchParams.get("shop") ?? "";
  const requestedReturn = requestUrl.searchParams.get("return") ?? "/owner/setup";
  const returnPath = requestedReturn.startsWith("/owner/") && !requestedReturn.startsWith("//")
    ? requestedReturn
    : "/owner/setup";

  try {
    await requireOwnerWorkspace(workspaceId, shopSlug, "admin");
  } catch (error) {
    const reason = error instanceof Error && error.message === "unauthenticated"
      ? "session"
      : "workspace_access";
    return NextResponse.redirect(
      new URL(`${returnPath}?owner_tesla_error=${reason}`, origin),
    );
  }

  // TESLA_OWNER_REDIRECT_URI is owner-specific and not one of the vars
  // assertConfigured knows how to name, so it's checked here first.
  const ownerRedirectUri = process.env.TESLA_OWNER_REDIRECT_URI ?? "";
  if (!ownerRedirectUri) {
    return NextResponse.redirect(
      new URL(
        `/owner/setup?owner_tesla_error=config&missing=TESLA_OWNER_REDIRECT_URI`,
        origin,
      ),
    );
  }

  const c = {
    ...getConfig(),
    redirectUri: ownerRedirectUri,
    scope: ONLYEVS_OPERATIONS_ENABLED
      ? OWNER_PERSISTENT_SCOPES.join(" ")
      : "openid vehicle_device_data",
  };

  const missing = assertConfigured(c);
  if (missing) {
    return NextResponse.redirect(
      new URL(`/owner/setup?owner_tesla_error=config&missing=${missing}`, origin),
    );
  }

  // The state cookie is host-scoped to `origin`, but the callback runs on the
  // redirect_uri's origin. If they differ, the cookie won't be there and sign-in
  // fails closed with a confusing loop — catch it here with a clear message.
  let redirectOrigin: string;
  try {
    redirectOrigin = new URL(c.redirectUri).origin;
  } catch {
    return NextResponse.redirect(
      new URL(
        `/owner/setup?owner_tesla_error=config&missing=TESLA_OWNER_REDIRECT_URI`,
        origin,
      ),
    );
  }
  if (redirectOrigin !== origin) {
    return NextResponse.redirect(
      new URL(`/owner/setup?owner_tesla_error=origin_mismatch`, origin),
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(c, state, { nonce }));
  res.cookies.set("rtr_owner_integration_state", seal({
    state,
    nonce,
    workspaceId,
    shopSlug,
    returnPath,
    durable: ONLYEVS_OPERATIONS_ENABLED,
    issuedAt: Date.now(),
  }, c.sessionSecret, "rtr_owner_integration_state"), {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
