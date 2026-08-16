import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { aliasKeyringFromEnv, createWorkspaceAlias } from "@/lib/email/security";
import { encryptCredential, credentialKeyringFromEnv } from "@/lib/owner/credential-envelope";
import { requireOwnerWorkspace, OwnerWorkspaceAuthError } from "@/lib/owner/server-auth";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
}

function authStatus(error: unknown): number {
  return error instanceof OwnerWorkspaceAuthError ? error.kind === "unauthenticated" ? 401 : 403 : 500;
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspace") ?? "";
  const shopSlug = request.nextUrl.searchParams.get("shop") ?? "";
  try {
    await requireOwnerWorkspace(workspaceId, shopSlug, "manager");
    const { data, error } = await (await createClient()).from("onlyevs_email_integrations")
      .select("id,status,mode,alias_address,last_receipt_at,last_test_at,last_error_code,revision")
      .eq("workspace_id", workspaceId).eq("shop_slug", shopSlug).maybeSingle();
    if (error) return reply({ error: "Email forwarding setup could not be loaded." }, 503);
    return reply({ integration: data });
  } catch (error) {
    return reply({ error: "Your workspace session is not authorized." }, authStatus(error));
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return reply({ error: "Cross-origin integration changes were rejected." }, 403);
  const body = await request.json().catch(() => null) as {
    workspaceId?: string; shopSlug?: string; action?: string; revision?: number; mode?: "review" | "auto";
  } | null;
  const workspaceId = body?.workspaceId?.trim() ?? "";
  const shopSlug = body?.shopSlug?.trim() ?? "";
  try {
    const owner = await requireOwnerWorkspace(workspaceId, shopSlug, "admin");
    const supabase = await createClient();
    if (body?.action === "setup" || body?.action === "rotate") {
      const alias = createWorkspaceAlias(aliasKeyringFromEnv());
      const encrypted = encryptCredential(owner.email.toLowerCase(), credentialKeyringFromEnv(), {
        workspaceId, shopSlug, provider: "evhost", field: "owner_alert_email", entityId: workspaceId,
      });
      const { data, error } = await supabase.rpc("configure_onlyevs_email_integration", {
        p_workspace_id: workspaceId, p_shop_slug: shopSlug, p_alias_address: alias.address,
        p_alias_hash: alias.aliasHash, p_alias_hint: alias.aliasHint, p_hmac_key_version: alias.keyVersion,
        p_owner_alert_email_ciphertext: encrypted.ciphertext,
        p_owner_alert_email_hash: createHash("sha256").update(owner.email.toLowerCase()).digest("hex"),
      });
      if (error) throw error;
      return reply({ integration: data }, body.action === "setup" ? 201 : 200);
    }
    const revision = body?.revision;
    const status = body?.action === "pause" ? "paused" : body?.action === "resume" ? "active" : body?.action === "test" ? "testing" : body?.action === "disconnect" ? "disconnected" : null;
    const mode = body?.action === "mode" ? body.mode ?? null : null;
    if (!Number.isSafeInteger(revision) || (status === null && mode === null)) return reply({ error: "Invalid integration change." }, 400);
    const { data, error } = await supabase.rpc("update_onlyevs_email_integration", {
      p_workspace_id: workspaceId, p_integration_id: request.nextUrl.searchParams.get("id"),
      p_expected_revision: revision, p_mode: mode, p_status: status,
    });
    if (error) return reply({ error: error.code === "40001" ? "This integration changed. Refresh and try again." : "The integration could not be updated." }, error.code === "40001" ? 409 : 400);
    return reply({ integration: data });
  } catch (error) {
    const status = authStatus(error);
    return reply({ error: status === 500 ? "Email intake is not configured on this deployment." : "Your workspace session is not authorized." }, status === 500 ? 503 : status);
  }
}
