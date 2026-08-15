import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { credentialKeyringFromEnv, decryptCredential } from "@/lib/owner/credential-envelope";
import { isTeslaInvitationUrl } from "@/lib/owner/tesla-access-client";
import { createClient } from "@/lib/supabase/server";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";
import { isSameOriginRequest } from "@/lib/request-origin";

interface ReadyInviteRow {
  workspace_id: string;
  shop_slug: string;
  invite_url_ciphertext: string;
}

export async function POST(request: NextRequest) {
  if (!ONLYEVS_OPERATIONS_ENABLED) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "origin_mismatch" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (token.length < 32 || token.length > 256) return NextResponse.json({ error: "invalid_invitation" }, { status: 400 });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_onlyevs_ready_invite", { p_public_token_hash: tokenHash });
  const row = (Array.isArray(data) ? data[0] : data) as ReadyInviteRow | null;
  if (error || !row?.invite_url_ciphertext) {
    return NextResponse.json({ ready: false }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const url = decryptCredential(row.invite_url_ciphertext, credentialKeyringFromEnv(), {
      workspaceId: row.workspace_id,
      shopSlug: row.shop_slug,
      provider: "tesla",
      field: "invite_url",
    });
    if (!isTeslaInvitationUrl(url)) throw new Error("invalid_invite_url");
    return NextResponse.json({ ready: true, url }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "invitation_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
