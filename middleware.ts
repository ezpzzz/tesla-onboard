import { NextResponse, type NextRequest } from "next/server";
import {
  isAllowedOwnerEmail,
  isOwnerAuthConfigured,
  logOwnerAuthEvent,
  warnOwnerAuthDisabledOnce,
} from "@/lib/owner-auth";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Gates /owner behind Supabase Auth + a server-only email allowlist.
 *
 * Demo mode (no NEXT_PUBLIC_SUPABASE_* configured): /owner stays exactly as
 * open as it was before this feature existed — no Supabase client is ever
 * constructed, no cookies are touched, one console.warn per process.
 *
 * Configured mode: unauthenticated -> /login?next=<path>. Authenticated but
 * not on the allowlist -> /not-authorized. Otherwise the refreshed-session
 * response is returned UNMODIFIED so the browser gets the updated cookies.
 *
 * Runs on the default Edge runtime (getClaims() uses WebCrypto only).
 */
export const config = {
  matcher: ["/owner/:path*", "/login"],
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

export async function middleware(request: NextRequest) {
  if (!isOwnerAuthConfigured()) {
    warnOwnerAuthDisabledOnce();
    return NextResponse.next();
  }

  const { response, email } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/owner")) {
    if (!email) {
      logOwnerAuthEvent({ type: "signin_required", path: pathname });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
      return redirectWithSession(response, url);
    }
    if (!isAllowedOwnerEmail(email)) {
      logOwnerAuthEvent({ type: "denied", email, path: pathname });
      const url = request.nextUrl.clone();
      url.pathname = "/not-authorized";
      url.search = "";
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
