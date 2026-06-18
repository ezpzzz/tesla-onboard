import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertConfigured, buildAuthorizeUrl, getConfig } from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start sign-in: mint a CSRF `state`, stash it in an httpOnly cookie, and
 * redirect the browser to Tesla's authorize page.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const c = getConfig();

  const missing = assertConfigured(c);
  if (missing) {
    return NextResponse.redirect(
      new URL(`/?tesla_error=config&missing=${missing}`, origin),
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
      new URL(`/?tesla_error=config&missing=TESLA_REDIRECT_URI`, origin),
    );
  }
  if (redirectOrigin !== origin) {
    return NextResponse.redirect(new URL(`/?tesla_error=origin_mismatch`, origin));
  }

  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(c, state));
  res.cookies.set("rtr_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
