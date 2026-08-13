import { NextResponse } from "next/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxies the magic-link OTP request server-side.
 *
 * Calling `supabase.auth.signInWithOtp` directly from the browser (as
 * /login used to) leaks account existence over the network even though the
 * rendered UI shows an identical "check your email" interstitial either
 * way: Supabase's own `/auth/v1/otp` returns HTTP 200 for a real account and
 * HTTP 422 `otp_disabled` ("Signups not allowed for otp") for one that
 * doesn't exist, both visible in devtools. Routing the request through this
 * app-owned endpoint means the browser only ever sees THIS response, which
 * is identical (200, `{ ok: true }`) regardless of whether the address has
 * an account, whether Supabase Auth errored, or whether the request body
 * was malformed. See QA finding: magic-link email enumeration.
 */
export async function POST(request: Request) {
  if (!isOwnerAuthConfigured()) {
    return NextResponse.json({ ok: true });
  }

  let email: unknown;
  let next: unknown;
  try {
    const body = await request.json();
    email = body?.email;
    next = body?.next;
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (typeof email === "string" && email.trim()) {
    // Mirror app/login/page.tsx's safeNextPath: same-origin path only.
    const safeNext =
      typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
        ? next
        : "/owner";
    const origin = new URL(request.url).origin;
    const supabase = await createClient();
    try {
      await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${origin}/login?next=${encodeURIComponent(safeNext)}`,
          shouldCreateUser: false,
        },
      });
    } catch {
      // Fall through to the identical success response below — never let a
      // Supabase-side failure produce a different response than success.
    }
  }

  return NextResponse.json({ ok: true });
}
