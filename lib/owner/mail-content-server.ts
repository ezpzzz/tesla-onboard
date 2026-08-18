import "server-only";

import { createHash } from "node:crypto";
import { decodeEvmailPlaintext, type NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptEvmailObject,
  fetchEncryptedObjectBytes,
  MailDecryptError,
} from "./mail-crypto";

/**
 * Decrypt-on-read orchestration for GET /api/owner/mail/[id]/content (T11).
 * Membership enforcement lives in the RPCs this calls
 * (public.get_onlyevs_email_message_envelope /
 * public.list_onlyevs_email_message_attachments,
 * 20260817160000_onlyevs_workspace_mail_read_rpcs.sql) -- this module never
 * re-derives authorization, it only shapes an honest response state from
 * whatever those RPCs and R2/KEK return.
 *
 * Per-message inline-image budget (design doc Premise 2 / T11): image/*
 * attachments that carry a content_id are embedded as `data:` URLs up to
 * this many total bytes (decrypted size); anything over budget, non-image,
 * or without a content_id stays manifest-only and is fetched on demand via
 * the same-origin, authed attachment route.
 */
export const MAIL_INLINE_IMAGE_BUDGET_BYTES = 1_048_576;

/**
 * Strict allowlist for the `content_type` value we are willing to splice into
 * a `data:` URL for cid inlining. `content_type` is attacker-controlled
 * (postal-mime's raw, unsanitized MIME header, stored verbatim) -- without
 * this allowlist a header value containing `"` or `>` could break out of the
 * `src="cid:token"` attribute once `rewriteCidReferences` string-replaces the
 * token, injecting markup the DOMParser strip pass (which runs *before* cid
 * rewriting) never saw. Anything not matching this exact shape is treated as
 * ineligible for inlining and falls back to the same-origin attachment
 * route, which serves it with its own `Content-Type` response header (a safe
 * context; no attribute-injection surface).
 */
const INLINE_IMAGE_CONTENT_TYPE_PATTERN =
  /^image\/(?:png|jpeg|gif|webp|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;

export interface MailAttachmentManifestEntry {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
  contentId: string | null;
  inlined: boolean;
}

export type MailContentState =
  | { kind: "not_found" }
  | { kind: "unconfigured" }
  | { kind: "too_large" }
  | { kind: "decrypt_error" }
  | {
      kind: "content";
      subject: string;
      sender: string;
      sentAtMs: number;
      html: string | null;
      text: string;
      attachments: MailAttachmentManifestEntry[];
      inline: Record<string, string>;
      remoteImagesAllowed: boolean;
    };

interface EnvelopeRpcRow {
  inbound_email_id: string;
  subject: string;
  sender: string;
  sent_at: string;
  r2_object_key: string | null;
  kek_version: number | null;
  ciphertext_sha256: string | null;
  raw_sha256: string | null;
  normalized_sha256: string | null;
  alias_hash: string;
  remote_images_allowed: boolean | null;
}

interface AttachmentRpcRow {
  id: string;
  filename: string | null;
  content_type: string | null;
  size_bytes: number;
  content_id: string | null;
  sha256: string | null;
  r2_object_key: string;
}

export interface FetchMailMessageContentArgs {
  supabase: SupabaseClient;
  workspaceId: string;
  messageId: string;
}

function isMailUnconfigured(): boolean {
  return !(
    process.env.EVHOST_EMAIL_R2_ENDPOINT
    && process.env.EVHOST_EMAIL_R2_ACCESS_KEY_ID
    && process.env.EVHOST_EMAIL_R2_SECRET_ACCESS_KEY
    && process.env.EVHOST_EMAIL_KEK_KEYS
  );
}

export async function fetchMailMessageContent(args: FetchMailMessageContentArgs): Promise<MailContentState> {
  if (isMailUnconfigured()) return { kind: "unconfigured" };

  const { data: envelopeRows, error: envelopeError } = await args.supabase.rpc(
    "get_onlyevs_email_message_envelope",
    { p_workspace_id: args.workspaceId, p_message_id: args.messageId },
  );
  if (envelopeError) return { kind: "not_found" };
  const rows = (Array.isArray(envelopeRows) ? envelopeRows : envelopeRows ? [envelopeRows] : []) as EnvelopeRpcRow[];
  const envelope = rows[0];
  if (!envelope || !envelope.r2_object_key) return { kind: "not_found" };

  const { data: attachmentRows, error: attachmentError } = await args.supabase.rpc(
    "list_onlyevs_email_message_attachments",
    { p_workspace_id: args.workspaceId, p_message_id: args.messageId },
  );
  if (attachmentError) return { kind: "decrypt_error" };
  const attachments = (
    Array.isArray(attachmentRows) ? attachmentRows : []
  ) as AttachmentRpcRow[];

  let manifest: NormalizedEmailManifest;
  try {
    const encrypted = await fetchEncryptedObjectBytes({
      r2ObjectKey: envelope.r2_object_key,
      expectedCiphertextSha256: envelope.ciphertext_sha256,
    });
    const plaintext = decryptEvmailObject({
      encrypted,
      aad: {
        inboundId: envelope.inbound_email_id,
        aliasHash: envelope.alias_hash,
        rawSha256: envelope.raw_sha256 ?? "",
        normalizedSha256: envelope.normalized_sha256 ?? "",
        objectKey: envelope.r2_object_key,
      },
      expectedKekVersion: envelope.kek_version,
    });
    const decoded = decodeEvmailPlaintext(plaintext);
    if (
      envelope.normalized_sha256
      && createHash("sha256").update(decoded.normalizedJson).digest("hex") !== envelope.normalized_sha256
    ) {
      throw new MailDecryptError("email_normalized_hash_mismatch");
    }
    manifest = JSON.parse(Buffer.from(decoded.normalizedJson).toString("utf8")) as NormalizedEmailManifest;
  } catch (error) {
    if (error instanceof MailDecryptError && error.code === "email_envelope_too_large") {
      return { kind: "too_large" };
    }
    return { kind: "decrypt_error" };
  }

  const inline: Record<string, string> = {};
  let budgetRemaining = MAIL_INLINE_IMAGE_BUDGET_BYTES;
  const manifestEntries: MailAttachmentManifestEntry[] = [];

  for (const attachment of attachments) {
    const isImage = Boolean(
      attachment.content_type && INLINE_IMAGE_CONTENT_TYPE_PATTERN.test(attachment.content_type),
    );
    const eligible = isImage && Boolean(attachment.content_id) && attachment.size_bytes <= budgetRemaining;
    let inlined = false;
    if (eligible) {
      try {
        const encryptedAttachment = await fetchEncryptedObjectBytes({
          r2ObjectKey: attachment.r2_object_key,
          capBytes: budgetRemaining,
        });
        const attachmentBytes = decryptEvmailObject({
          encrypted: encryptedAttachment,
          aad: {
            inboundId: envelope.inbound_email_id,
            aliasHash: envelope.alias_hash,
            rawSha256: envelope.raw_sha256 ?? "",
            normalizedSha256: envelope.normalized_sha256 ?? "",
            objectKey: attachment.r2_object_key,
          },
        });
        if (attachmentBytes.byteLength <= budgetRemaining) {
          if (
            !attachment.sha256
            || createHash("sha256").update(attachmentBytes).digest("hex") === attachment.sha256
          ) {
            inline[attachment.content_id as string] =
              `data:${attachment.content_type};base64,${attachmentBytes.toString("base64")}`;
            budgetRemaining -= attachmentBytes.byteLength;
            inlined = true;
          }
        }
      } catch {
        // Falls through to manifest-only -- the same-origin attachment route
        // remains the honest fallback, never a broken inline reference.
      }
    }
    manifestEntries.push({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type,
      sizeBytes: attachment.size_bytes,
      contentId: attachment.content_id,
      inlined,
    });
  }

  return {
    kind: "content",
    subject: manifest.subject ?? envelope.subject,
    sender: manifest.from ?? envelope.sender,
    sentAtMs: Date.parse(envelope.sent_at),
    html: manifest.html,
    text: manifest.text,
    attachments: manifestEntries,
    inline,
    remoteImagesAllowed: envelope.remote_images_allowed === true,
  };
}
