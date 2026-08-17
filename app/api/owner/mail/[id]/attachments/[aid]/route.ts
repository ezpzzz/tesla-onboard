import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { fetchMailAttachmentBytes } from "@/lib/owner/mail-attachment-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonReply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
}

/** Strips CR/LF/quotes so a stored filename can never inject extra headers
 * or break out of the quoted-string in Content-Disposition. Falls back to
 * "attachment" (matching fetchMailAttachmentBytes's own fallback) when
 * stripping leaves nothing usable. */
function safeContentDisposition(filename: string): string {
  const cleaned = filename.replace(/[\r\n"]/g, "").trim() || "attachment";
  const encoded = encodeURIComponent(cleaned);
  return `attachment; filename="${cleaned}"; filename*=UTF-8''${encoded}`;
}

/**
 * Streamed, authed, workspace-scoped attachment download (T11). Same
 * demo-mode + session-auth + membership-via-RPC posture as
 * app/api/owner/mail/[id]/content/route.ts; [id] is the message index id
 * and [aid] the attachment id -- public.get_onlyevs_email_message_attachment
 * (20260817160000_onlyevs_workspace_mail_read_rpcs.sql) 404s an [aid] that
 * belongs to a different message than [id], not just a different workspace.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/owner/mail/[id]/attachments/[aid]">,
) {
  const { id, aid } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(aid) || !UUID_PATTERN.test(workspaceId)) {
    return jsonReply({ state: "not_found" }, 400);
  }

  if (!isOwnerAuthConfigured()) return jsonReply({ state: "not_found" });

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return jsonReply({ error: "Your owner session expired." }, 401);

  const attachment = await fetchMailAttachmentBytes({
    supabase,
    workspaceId,
    messageId: id,
    attachmentId: aid,
  });

  switch (attachment.kind) {
    case "not_found":
      return jsonReply({ state: "not_found" }, 404);
    case "unconfigured":
      return jsonReply({ state: "unconfigured" });
    case "too_large":
      return jsonReply({ state: "too_large" });
    case "decrypt_error":
      return jsonReply({ state: "decrypt_error" });
    case "bytes":
      return new NextResponse(new Uint8Array(attachment.bytes), {
        status: 200,
        headers: {
          "Content-Type": attachment.contentType,
          "Content-Disposition": safeContentDisposition(attachment.filename),
          "Content-Length": String(attachment.bytes.byteLength),
          "Cache-Control": "no-store, private",
          Pragma: "no-cache",
        },
      });
  }
}
