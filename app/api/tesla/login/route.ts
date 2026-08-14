import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { assertConfigured, buildAuthorizeUrl, getConfig, seal } from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start sign-in: mint a CSRF `state`, stash it in an httpOnly cookie, and
 * redirect the browser to Tesla's authorize page.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const requestedReturn = requestUrl.searchParams.get("return") ?? "/";
  const returnTo = requestedReturn.startsWith("/")
    && !requestedReturn.startsWith("//")
    && !requestedReturn.startsWith("/\\")
    ? requestedReturn
    : "/";
  const tenant = requestUrl.searchParams.get("tenant")?.trim();
  const tenantReturn = new URL(returnTo, "https://evhost.invalid");
  if (tenant) tenantReturn.searchParams.set("tenant", tenant);
  const canonicalReturnTo = `${tenantReturn.pathname}${tenantReturn.search}${tenantReturn.hash}`;
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
    const broker = new URL("/api/tesla/login", redirectOrigin);
    broker.searchParams.set("return", canonicalReturnTo);
    return NextResponse.redirect(broker);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(c, state, { nonce }));
  res.cookies.set("rtr_state", seal({ state, nonce, returnTo: canonicalReturnTo, issuedAt: Date.now() }, c.sessionSecret, "rtr_state"), {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
