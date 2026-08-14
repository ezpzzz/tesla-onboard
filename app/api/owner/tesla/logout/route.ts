import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_IMPORT_TOKEN_PATTERN,
  ownerImportTokenHash,
} from "@/lib/owner/import-session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the opaque browser handle and its private import session. */
export async function POST(request: NextRequest) {
  const token = request.cookies.get("rtr_owner_tesla")?.value ?? "";
  if (OWNER_IMPORT_TOKEN_PATTERN.test(token)) {
    const supabase = await createClient();
    await supabase.rpc("delete_onlyevs_owner_import_session", {
      p_token_hash: ownerImportTokenHash(token),
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("rtr_owner_tesla");
  return res;
}
