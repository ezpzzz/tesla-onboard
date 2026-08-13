import { NextResponse } from "next/server";
import { logOwnerAuthEvent } from "@/lib/owner-auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign the owner out of THIS app only. scope: "local" is mandatory — the
 * Supabase project (zwkqgcqtahyehsryqrfl) is shared with the user's other
 * sophosic-platform apps, and a "global" sign-out would revoke sessions there
 * too. Never change this to "global".
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  logOwnerAuthEvent({ type: "signout" });

  const origin = new URL(request.url).origin;
  return NextResponse.redirect(new URL("/login", origin), 303);
}
