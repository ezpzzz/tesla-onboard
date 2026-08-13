import { NextResponse } from "next/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { allowRequest } from "@/lib/owner-throttle";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

// First hop of x-forwarded-for is the client the edge/proxy saw directly —
// later hops are attacker-controllable by whoever sends the request, so only
// the first entry is trustworthy as a throttle key.
function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || "unknown";
}

function isRateLimitError(error: { code?: string; status?: number } | null): boolean {
  if (!error) return false;
  return error.code === "over_request_rate_limit" || error.status === 429;
}

/**
 * Proxies password sign-in server-side, mirroring
 * app/api/owner/magic-link/route.ts's conventions.
 *
 * Calling `supabase.auth.signInWithPassword` directly from the browser (as
 * /login used to) collapses "wrong password" and "no such user" into the
 * SAME UI message already, but the two failures are still distinguishable
 * over the wire: Supabase returns `invalid_credentials` for one and
 * `email_not_confirmed` for the other (a signal that an account with that
 * email exists but hasn't verified). Routing through this app-owned
 * endpoint means every failure except an explicit 429 collapses into one
 * identical `{ ok: false, error: "invalid" }` response — closing that
 * wire-level enumeration leak. Also gives the server-side Supabase client
 * (lib/supabase/server.ts) a chance to set the session cookies on the
 * response via its cookie adapter, same as the middleware refresh path.
 */
export async function POST(request: Request) {
  if (!isOwnerAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }

  let email: unknown;
  let password: unknown;
  try {
    const body = await request.json();
    email = body?.email;
    password = body?.password;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ipAllowed = allowRequest(`ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  const emailAllowed = allowRequest(`email:${normalizedEmail}`, EMAIL_LIMIT, WINDOW_MS);

  if (!ipAllowed || !emailAllowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    if (isRateLimitError(error)) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
    // Collapse invalid_credentials AND email_not_confirmed (and anything
    // else) into one identical response — never let the failure reason
    // leak over the wire.
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
