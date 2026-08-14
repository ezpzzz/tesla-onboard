import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { allowRequest } from "@/lib/owner-throttle";
import { createClient } from "@/lib/supabase/server";
import { canonicalOnlyEvsOrigin } from "@/lib/onlyevs-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const WINDOW_MS = 60 * 60 * 1_000;

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: Request) {
  const generic = () => NextResponse.json({ ok: true }, {
    headers: { "Cache-Control": "no-store, private" },
  });
  if (request.headers.get("origin") !== new URL(request.url).origin) return generic();
  const body = (await request.json().catch(() => null)) as { token?: string; email?: string } | null;
  const token = body?.token?.trim() ?? "";
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!TOKEN_PATTERN.test(token) || !/^\S+@\S+\.\S+$/.test(email)) return generic();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (
    !allowRequest(`trip-ip:${clientIp(request)}`, 10, WINDOW_MS) ||
    !allowRequest(`trip-token:${tokenHash}`, 5, WINDOW_MS)
  ) return generic();

  const supabase = await createClient();
  const { data: matches } = await supabase.rpc("onlyevs_trip_email_matches", {
    p_public_token_hash: tokenHash,
    p_email: email,
  });
  if (matches === true) {
    // Guest auth always completes on the platform's canonical allowlisted
    // origin. Custom domains remain tenant-branded entry points without
    // requiring an unbounded shared-Supabase redirect allowlist.
    const callback = new URL("/auth/callback", canonicalOnlyEvsOrigin(request));
    callback.searchParams.set("next", `/trip/${token}`);
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
      });
    } catch {
      // Anti-enumeration: every provider outcome returns the same response.
    }
  }
  return generic();
}
