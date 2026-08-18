import { lengthPrefixedBytes } from "@evhost/email-ingest-contract";

/**
 * Single source of truth for the AAD (additional authenticated data) bound
 * to one attachment's own encrypted R2 envelope (design doc
 * alex-email-inbox-design-20260817-123909.md, 3A: "each attachment written
 * as its own encrypted R2 object ... keep AAD binding to the attachment row
 * identity"). Deliberately a distinct domain-separated shape from evmailAad
 * (@evhost/email-ingest-contract) -- an attachment envelope and its parent
 * message envelope must never decrypt with each other's AAD even if some
 * field values coincided.
 *
 * BOTH sides of the write/read split import this exact function rather than
 * each building the same byte layout independently:
 *   - write: services/onlyevs-worker/email.ts's storeEmailAttachment (via
 *     encryptEmailBytes) calls this when it PUTs the encrypted object to R2.
 *   - read: lib/owner/mail-content-server.ts (inline cid images) and
 *     lib/owner/mail-attachment-server.ts (the download route) call this
 *     when they GET + decrypt that same object.
 * A prior version of this codebase hand-built the read-side shape
 * independently (a copy of the ENVELOPE aad, evmailAad's shape) instead of
 * importing this function, and it silently drifted from the write side --
 * every attachment decrypt failed. Routing both sides through one exported
 * function makes that class of drift structurally impossible: there is
 * nowhere left for a second, divergent implementation to live.
 */
export interface MailAttachmentAadInput {
  workspaceId: string;
  messageIndexId: string;
  attachmentId: string;
  r2ObjectKey: string;
}

export function buildAttachmentAad(input: MailAttachmentAadInput): Uint8Array {
  return lengthPrefixedBytes([
    "evhost-evmail-attachment-aad-v1",
    input.workspaceId,
    input.messageIndexId,
    input.attachmentId,
    input.r2ObjectKey,
  ]);
}
