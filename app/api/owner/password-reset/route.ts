import { NextResponse } from "next/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { allowRequest } from "@/lib/owner-throttle";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Supabase already suppresses user enumeration; this route preserves that
 * invariant at the app boundary and adds an app-owned rate limit. */
export async function POST(request: Request) {
  if (!isOwnerAuthConfigured()) {
    return NextResponse.json({ ok: true });
  }

  const ipAllowed = allowRequest(`reset-ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  let email: unknown;
  try {
    email = (await request.json())?.email;
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (typeof email === "string" && email.trim()) {
    const normalizedEmail = email.trim().toLowerCase();
    const emailAllowed = allowRequest(`reset-email:${normalizedEmail}`, EMAIL_LIMIT, WINDOW_MS);
    if (ipAllowed && emailAllowed) {
      const callback = new URL("/auth/callback", new URL(request.url).origin);
      callback.searchParams.set("next", "/reset-password");
      try {
        const supabase = await createClient();
        await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: callback.toString(),
        });
      } catch {
        // Always return the same response, whether or not the account exists.
      }
    }
  }

  return NextResponse.json({ ok: true });
}
