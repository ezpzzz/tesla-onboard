import { NextResponse } from "next/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { safeOwnerNextPath } from "@/lib/owner-auth-redirect";
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

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

/**
 * Creates a password-backed owner account without exposing whether the email
 * already exists. Valid requests always receive the same response and the
 * hosted confirmation template completes verification on evhost.app.
 */
export async function POST(request: Request) {
  if (!isOwnerAuthConfigured()) {
    return NextResponse.json({ ok: true });
  }

  const ipAllowed = allowRequest(`register-ip:${clientIp(request)}`, IP_LIMIT, WINDOW_MS);
  let email: unknown;
  let password: unknown;
  let next: unknown;
  try {
    const body = await request.json();
    email = body?.email;
    password = body?.password;
    next = body?.next;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  if (typeof email !== "string" || !email.trim() || !validPassword(password)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailAllowed = allowRequest(`register-email:${normalizedEmail}`, EMAIL_LIMIT, WINDOW_MS);
  if (ipAllowed && emailAllowed) {
    const callback = new URL("/auth/callback", new URL(request.url).origin);
    callback.searchParams.set("next", safeOwnerNextPath(next));
    try {
      const supabase = await createClient();
      await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callback.toString() },
      });
    } catch {
      // Duplicate users and provider failures intentionally share the same
      // browser response as successful registration.
    }
  }

  return NextResponse.json({ ok: true });
}
