import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { fetchMailMessageContent } from "@/lib/owner/mail-content-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" },
  });
}

/**
 * Decrypt-on-read for one workspace mail message (T11, design doc
 * alex-email-inbox-design-20260817-123909.md). Demo-mode guard, session
 * auth, then membership + row resolution -- both enforced inside
 * public.get_onlyevs_email_message_envelope /
 * public.list_onlyevs_email_message_attachments
 * (20260817160000_onlyevs_workspace_mail_read_rpcs.sql) -- so a non-member
 * or a message id from another workspace both resolve to the same honest
 * not_found this route returns, never a 500 or a leaked row.
 *
 * `Cache-Control: no-store` is load-bearing for Premise 3's purge
 * guarantee: a purge must not be defeated by a cached decrypt response.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/owner/mail/[id]/content">,
) {
  const { id } = await context.params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "";
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(workspaceId)) {
    return reply({ state: "not_found" }, 400);
  }

  // Demo mode (Supabase unconfigured) has no owner session at all -- same
  // honest empty state as every other owner mail surface, never a raw
  // Supabase-client-construction error. Matches isOwnerAuthConfigured() use
  // elsewhere (e.g. app/api/owner/vehicles/[id]/locate-setup/route.ts).
  if (!isOwnerAuthConfigured()) return reply({ state: "not_found" });

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);

  const content = await fetchMailMessageContent({ supabase, workspaceId, messageId: id });

  switch (content.kind) {
    case "not_found":
      return reply({ state: "not_found" }, 404);
    case "unconfigured":
      return reply({ state: "unconfigured" });
    case "too_large":
      return reply({ state: "too_large" });
    case "decrypt_error":
      // Explicit, handled state -- never let a decrypt failure surface as an
      // unhandled 500 with a stack trace or ciphertext in the response body.
      return reply({ state: "decrypt_error" });
    case "content":
      return reply({
        state: "content",
        subject: content.subject,
        sender: content.sender,
        sentAtMs: content.sentAtMs,
        html: content.html,
        text: content.text,
        attachments: content.attachments,
        inline: content.inline,
        remoteImagesAllowed: content.remoteImagesAllowed,
      });
  }
}
