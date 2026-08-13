import { NextResponse } from "next/server";
import { isOwnerAuthConfigured, logOwnerAuthEvent } from "@/lib/owner-auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This is a plain <form action="/auth/signout" method="post"> submit (see
 * app/not-authorized/page.tsx and OwnerShell), so the browser doesn't send
 * the custom header that would let a framework CSRF middleware recognize a
 * same-origin fetch. Cross-site forms can't be blocked by SameSite cookies
 * alone if the cookie is ever Lax+top-level-POST-exempt, so check the
 * standard browser-supplied same-origin signals ourselves: Sec-Fetch-Site
 * when present (modern browsers), falling back to Origin (older/other
 * clients). No header at all (e.g. non-browser client) is allowed through —
 * this mirrors "fail open on missing signal, fail closed on a mismatched
 * one", which is the same posture Next's own server actions use.
 */
function isSameOriginRequest(request: Request): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * Sign the owner out of THIS app only. scope: "local" is mandatory — the
 * Supabase project (zwkqgcqtahyehsryqrfl) is shared with the user's other
 * sophosic-platform apps, and a "global" sign-out would revoke sessions there
 * too. Never change this to "global".
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const origin = new URL(request.url).origin;

  if (!isOwnerAuthConfigured()) {
    // Demo mode: no Supabase client is ever constructed here, matching the
    // rest of the auth surface (see lib/owner-auth.ts, middleware.ts).
    return NextResponse.redirect(new URL("/login", origin), 303);
  }

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  logOwnerAuthEvent({ type: "signout" });

  return NextResponse.redirect(new URL("/login", origin), 303);
}
