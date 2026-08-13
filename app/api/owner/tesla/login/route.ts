import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertConfigured, buildAuthorizeUrl, getConfig } from "@/lib/tesla-server";

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
  const origin = new URL(request.url).origin;

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

  const c = { ...getConfig(), redirectUri: ownerRedirectUri };

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
  const res = NextResponse.redirect(buildAuthorizeUrl(c, state));
  res.cookies.set("rtr_owner_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
