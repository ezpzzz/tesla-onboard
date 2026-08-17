import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptEvmailObject, fetchEncryptedObjectBytes, MailDecryptError } from "./mail-crypto";

/**
 * Decrypt-on-read orchestration for
 * GET /api/owner/mail/[id]/attachments/[aid] (T11). Same RPC-bridge +
 * server-only-KEK posture as lib/owner/mail-content-server.ts; kept as a
 * separate module because the download route serves exactly one attachment
 * and streams raw bytes rather than shaping a JSON envelope.
 */

export type MailAttachmentState =
  | { kind: "not_found" }
  | { kind: "unconfigured" }
  | { kind: "too_large" }
  | { kind: "decrypt_error" }
  | { kind: "bytes"; bytes: Buffer; filename: string; contentType: string };

interface EnvelopeRpcRow {
  inbound_email_id: string;
  alias_hash: string;
  raw_sha256: string | null;
  normalized_sha256: string | null;
}

interface AttachmentRpcRow {
  id: string;
  filename: string | null;
  content_type: string | null;
  r2_object_key: string;
  sha256: string | null;
}

export interface FetchMailAttachmentArgs {
  supabase: SupabaseClient;
  workspaceId: string;
  messageId: string;
  attachmentId: string;
}

function isMailUnconfigured(): boolean {
  return !(
    process.env.EVHOST_EMAIL_R2_ENDPOINT
    && process.env.EVHOST_EMAIL_R2_ACCESS_KEY_ID
    && process.env.EVHOST_EMAIL_R2_SECRET_ACCESS_KEY
    && process.env.EVHOST_EMAIL_KEK_KEYS
  );
}

export async function fetchMailAttachmentBytes(args: FetchMailAttachmentArgs): Promise<MailAttachmentState> {
  if (isMailUnconfigured()) return { kind: "unconfigured" };

  const [envelopeResult, attachmentResult] = await Promise.all([
    args.supabase.rpc("get_onlyevs_email_message_envelope", {
      p_workspace_id: args.workspaceId,
      p_message_id: args.messageId,
    }),
    args.supabase.rpc("get_onlyevs_email_message_attachment", {
      p_workspace_id: args.workspaceId,
      p_message_id: args.messageId,
      p_attachment_id: args.attachmentId,
    }),
  ]);
  if (envelopeResult.error || attachmentResult.error) return { kind: "not_found" };

  const envelopeRows = (
    Array.isArray(envelopeResult.data) ? envelopeResult.data : envelopeResult.data ? [envelopeResult.data] : []
  ) as EnvelopeRpcRow[];
  const attachmentRows = (
    Array.isArray(attachmentResult.data) ? attachmentResult.data : attachmentResult.data ? [attachmentResult.data] : []
  ) as AttachmentRpcRow[];
  const envelope = envelopeRows[0];
  const attachment = attachmentRows[0];
  if (!envelope || !attachment) return { kind: "not_found" };

  try {
    const encrypted = await fetchEncryptedObjectBytes({ r2ObjectKey: attachment.r2_object_key });
    const bytes = decryptEvmailObject({
      encrypted,
      aad: {
        inboundId: envelope.inbound_email_id,
        aliasHash: envelope.alias_hash,
        rawSha256: envelope.raw_sha256 ?? "",
        normalizedSha256: envelope.normalized_sha256 ?? "",
        objectKey: attachment.r2_object_key,
      },
    });
    if (
      attachment.sha256
      && createHash("sha256").update(bytes).digest("hex") !== attachment.sha256
    ) {
      throw new MailDecryptError("email_attachment_hash_mismatch");
    }
    return {
      kind: "bytes",
      bytes,
      filename: attachment.filename && attachment.filename.trim() ? attachment.filename : "attachment",
      contentType: attachment.content_type ?? "application/octet-stream",
    };
  } catch (error) {
    if (error instanceof MailDecryptError && error.code === "email_envelope_too_large") {
      return { kind: "too_large" };
    }
    return { kind: "decrypt_error" };
  }
}
