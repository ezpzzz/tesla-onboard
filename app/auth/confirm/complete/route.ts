import { NextResponse } from "next/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { ownerEmailOtpType } from "@/lib/owner-email-verification";
import { safeOwnerNextPath } from "@/lib/owner-auth-redirect";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loginErrorUrl(origin: string, next: string): URL {
  const login = new URL("/login", origin);
  login.searchParams.set("next", next);
  login.searchParams.set("error", "magic_link");
  return login;
}

function redirect(url: URL): NextResponse {
  // A successful form submission must become a GET on the destination.
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const requestOrigin = request.headers.get("origin");

  // Prevent login CSRF: only the EVhost confirmation page may submit a token.
  if (requestOrigin !== requestUrl.origin) {
    return redirect(loginErrorUrl(requestUrl.origin, "/owner"));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(loginErrorUrl(requestUrl.origin, "/owner"));
  }

  const tokenHash = form.get("token_hash");
  const type = ownerEmailOtpType(form.get("type"));
  const next = safeOwnerNextPath(form.get("next"));

  if (!isOwnerAuthConfigured() || typeof tokenHash !== "string" || !tokenHash || !type) {
    return redirect(loginErrorUrl(requestUrl.origin, next));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      return redirect(loginErrorUrl(requestUrl.origin, next));
    }
  } catch {
    return redirect(loginErrorUrl(requestUrl.origin, next));
  }

  return redirect(new URL(next, requestUrl.origin));
}
