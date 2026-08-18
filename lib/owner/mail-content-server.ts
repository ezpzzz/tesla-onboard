import "server-only";

import { createHash } from "node:crypto";
import { decodeEvmailPlaintext, evmailAad, type NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAttachmentAad } from "@/lib/email/mail-attachment-aad";
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
 * or without a content_id stays manifest-only.
 *
 * Correction (fix-before-merge review finding): a prior version of this
 * comment claimed an oversized/failed inline image "falls back to a
 * same-origin fetch." That is not actually possible for the sandboxed
 * renderer (components/owner/MailContentFrame.tsx): the message HTML is
 * rendered inside a `sandbox=""` srcdoc iframe with an opaque origin and a
 * CSP whose img-src is `data:` only (widened to `data: https:` when this
 * message's remote-image loading is on -- components/owner/mail-render-
 * prep.ts's buildMailCsp -- still never same-origin) -- an opaque-origin
 * document cannot issue a same-origin fetch to anything, and img-src
 * forbids it from loading the authed attachment route directly even if it
 * could (that route is same-origin, not `data:`/`https:`). The
 * honest behavior is: the manifest entry's `inlineState` tells the PARENT
 * page (not the sandboxed iframe) whether that image was inlined, and the
 * parent renders an explicit placeholder for anything that wasn't --
 * fetching the real bytes on demand, if the guest chooses to, only ever
 * happens through the parent's own authed GET to the attachment download
 * route, never from inside the sandbox.
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

/**
 * Why a content_id-bearing image did or didn't end up in `inline` (fix-
 * before-merge review finding): a prior version collapsed every non-success
 * outcome -- ineligible, over budget, and a genuine decrypt/hash failure --
 * into the same `inlined: false`, via a bare `catch {}` that swallowed the
 * failure with no signal at all. That is both dishonest (a real decrypt
 * error looks identical to "this was never going to be inlined") and a
 * silent-degradation risk (nothing distinguishes an expected non-candidate
 * from an unexpected crypto failure worth alerting on). No crypto detail
 * (error codes, R2 key names, KEK versions) ever leaks into this field --
 * it is exactly one of these three values.
 *   - "inlined": embedded in `inline` as a verified, byte-matching data: URL.
 *   - "too_large": doesn't fit the per-message inline budget, or isn't an
 *     inline candidate at all (not an image, or no content_id) -- the
 *     ordinary, expected case for most non-inline attachments.
 *   - "error": WAS an eligible candidate (image, has a content_id, within
 *     budget) but the fetch/decrypt/hash-verify failed unexpectedly.
 */
export type MailAttachmentInlineState = "inlined" | "too_large" | "error";

export interface MailAttachmentManifestEntry {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
  contentId: string | null;
  inlined: boolean;
  inlineState: MailAttachmentInlineState;
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
      aad: evmailAad({
        inboundId: envelope.inbound_email_id,
        aliasHash: envelope.alias_hash,
        rawSha256: envelope.raw_sha256 ?? "",
        normalizedSha256: envelope.normalized_sha256 ?? "",
        objectKey: envelope.r2_object_key,
      }),
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
    // Default for every non-candidate (not an image, no content_id, or
    // already over budget before even attempting a fetch): "too_large" --
    // the ordinary, expected reason an attachment stays out of `inline`,
    // never confused with a genuine crypto failure below.
    let inlineState: MailAttachmentInlineState = "too_large";
    if (eligible) {
      try {
        const encryptedAttachment = await fetchEncryptedObjectBytes({
          r2ObjectKey: attachment.r2_object_key,
          capBytes: budgetRemaining,
        });
        const attachmentBytes = decryptEvmailObject({
          encrypted: encryptedAttachment,
          // Attachment-shape AAD (buildAttachmentAad), NOT the message
          // envelope's evmailAad shape used above -- this is exactly the
          // fix-before-merge review finding: workspaceId/messageIndexId are
          // the caller's own membership-checked context (args.workspaceId,
          // args.messageId -- p_message_id is already private.onlyevs_
          // email_message_index's own primary key, i.e. messageIndexId, per
          // that RPC's join), attachmentId/r2ObjectKey come straight off
          // this attachment's own RPC row.
          aad: buildAttachmentAad({
            workspaceId: args.workspaceId,
            messageIndexId: args.messageId,
            attachmentId: attachment.id,
            r2ObjectKey: attachment.r2_object_key,
          }),
        });
        if (attachmentBytes.byteLength > budgetRemaining) {
          inlineState = "too_large";
        } else if (attachment.sha256 && createHash("sha256").update(attachmentBytes).digest("hex") !== attachment.sha256) {
          inlineState = "error";
        } else {
          inline[attachment.content_id as string] =
            `data:${attachment.content_type};base64,${attachmentBytes.toString("base64")}`;
          budgetRemaining -= attachmentBytes.byteLength;
          inlineState = "inlined";
        }
      } catch (error) {
        // Honest per-attachment state (fix-before-merge review finding):
        // this used to be a bare `catch {}` that swallowed every decrypt/
        // fetch failure identically to "never eligible," so a genuine AAD
        // mismatch or R2 error silently looked like an ordinary non-inline
        // attachment. No crypto detail (MailDecryptError.code, R2 key
        // names, KEK versions) leaves this function -- only the coarse
        // too_large/error distinction below.
        inlineState = error instanceof MailDecryptError && error.code === "email_envelope_too_large"
          ? "too_large"
          : "error";
      }
    }
    manifestEntries.push({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.content_type,
      sizeBytes: attachment.size_bytes,
      contentId: attachment.content_id,
      inlined: inlineState === "inlined",
      inlineState,
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
