import { NextResponse, type NextRequest } from "next/server";
import {
  isOwnerAuthConfigured,
  logOwnerAuthEvent,
  warnOwnerAuthDisabledOnce,
} from "@/lib/owner-auth";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Gates /owner behind Supabase Auth. Tenant authorization is enforced by the
 * existing workspace_users/workspace_branding RLS policies after sign-in;
 * membership replaces the single-deployment OWNER_ALLOWED_EMAILS allowlist.
 *
 * Demo mode (no NEXT_PUBLIC_SUPABASE_* configured): /owner stays exactly as
 * open as it was before this feature existed — no Supabase client is ever
 * constructed, no cookies are touched, one console.warn per process.
 *
 * Configured mode: unauthenticated -> /login?next=<path>. Authenticated but
 * response is returned UNMODIFIED so the browser gets the updated cookies.
 *
 * Runs on the default Edge runtime. NOTE: getClaims() does NOT verify
 * locally via WebCrypto alone on this project — that fast path requires an
 * asymmetric JWT signing key (JWKS) configured on the Supabase project, and
 * this one still uses the legacy symmetric HS256 secret (empty JWKS), so
 * getClaims() falls back to a network getUser() call against Supabase Auth
 * on every check.
 */
// Covers the owner dashboard itself, the login page, AND the owner-side Tesla
// OAuth mirror (both its API routes and its browser-facing auth pages) — that
// mirror reads/writes the owner's own Tesla session and must sit behind the
// same gate as /owner. Deliberately does NOT cover /api/owner/magic-link or
// /api/owner/password-login — those are the pre-auth login endpoints
// themselves and must stay reachable by a signed-out visitor.
export const config = {
  matcher: [
    "/owner/:path*",
    "/login",
    "/api/owner/tesla/:path*",
    "/api/owner/google/:path*",
    "/api/owner/trips/:path*",
    "/api/owner/branding/:path*",
    "/auth/owner/:path*",
    "/trip/:path*",
  ],
};

// updateSession() may have queued a refreshed session cookie (and its
// no-store headers) onto `base`. A redirect built from scratch never carries
// those over, so the browser keeps sending a stale refresh token and the
// next legitimate refresh gets rejected as reused/rotated ("random logout").
// Every redirect issued after updateSession() runs must go through this.
const SESSION_HEADERS = ["cache-control", "pragma", "expires"];

function redirectWithSession(base: NextResponse, url: URL): NextResponse {
  const redirect = NextResponse.redirect(url);
  base.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  SESSION_HEADERS.forEach((name) => {
    const value = base.headers.get(name);
    if (value) redirect.headers.set(name, value);
  });
  return redirect;
}

export async function proxy(request: NextRequest) {
  const canonicalOrigin = process.env.ONLYEVS_CANONICAL_ORIGIN?.replace(/\/$/, "");
  const isOwnerSurface = request.nextUrl.pathname === "/login"
    || request.nextUrl.pathname.startsWith("/owner")
    || request.nextUrl.pathname.startsWith("/api/owner")
    || request.nextUrl.pathname.startsWith("/auth/owner");
  if (canonicalOrigin && isOwnerSurface && request.nextUrl.origin !== canonicalOrigin) {
    const canonical = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonicalOrigin);
    return NextResponse.redirect(canonical, 308);
  }

  if (!isOwnerAuthConfigured()) {
    warnOwnerAuthDisabledOnce();
    return NextResponse.next();
  }

  const { response, email } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  // Same gate for /owner itself and its Tesla OAuth mirror (API + auth pages) —
  // see the matcher comment above for why the mirror is included here.
  const isOwnerGated =
    pathname.startsWith("/owner") ||
    pathname.startsWith("/api/owner/tesla") ||
    pathname.startsWith("/api/owner/google") ||
    pathname.startsWith("/api/owner/trips") ||
    pathname.startsWith("/api/owner/branding") ||
    pathname.startsWith("/auth/owner");

  if (isOwnerGated) {
    if (!email) {
      logOwnerAuthEvent({ type: "signin_required", path: pathname });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
      return redirectWithSession(response, url);
    }
    return response;
  }

  if (pathname === "/login" && email) {
    const url = request.nextUrl.clone();
    url.pathname = "/owner";
    url.search = "";
    return redirectWithSession(response, url);
  }

  return response;
}
