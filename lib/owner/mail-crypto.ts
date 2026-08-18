import "server-only";

import { createDecipheriv, createHash } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { decodeEvmailEnvelope } from "@evhost/email-ingest-contract";

/**
 * Shared EVMAIL envelope decrypt for the owner-app read path (T11), mirroring
 * services/onlyevs-worker/email.ts's loadAndDecrypt/attachment decrypt --
 * same envelope format, same two-layer KEK-wrapped-DEK AES-256-GCM.
 * Deliberately re-implemented here rather than imported from the worker:
 * services/onlyevs-worker is a separate deployable with its own dependency
 * surface, and this module runs inside the Next server (`runtime =
 * "nodejs"`) where "no new dependencies" already permits @aws-sdk/client-s3
 * and @evhost/email-ingest-contract -- both are already root package.json
 * dependencies, not worker-only.
 *
 * AAD is NOT built here (fix-before-merge review finding: a prior version
 * hand-built one hardcoded shape -- the message-envelope evmailAad shape --
 * for every call, including attachment decrypts, which actually need a
 * different, domain-separated shape the write side
 * (services/onlyevs-worker/email.ts) uses for its own encrypted attachment
 * objects. Every attachment decrypt failed as a result. decryptEvmailObject
 * below now takes fully-precomputed AAD bytes; callers select the correct
 * builder for what they are decrypting -- evmailAad
 * (@evhost/email-ingest-contract) for the message envelope,
 * buildAttachmentAad (lib/email/mail-attachment-aad.ts, the SAME function
 * the worker's write path imports) for an attachment. Routing both the
 * worker's write path and every read call site here through that one
 * shared builder is what makes this class of AAD drift structurally
 * impossible going forward -- see that module's own doc comment.
 *
 * KEK posture matches lib/owner/location-evidence-server.ts: keys live only
 * in server-only env (EVHOST_EMAIL_KEK_KEYS), are parsed fresh per call
 * (never cached to disk), and a decrypt failure of any kind collapses to one
 * honest error rather than a stack trace or partial-plaintext leak.
 */

/** Hard ceiling on the ciphertext object this module will fetch+decrypt,
 * independent of what the object claims to be. Matches the email-ingest
 * contract's own bounds (EMAIL_MAX_RAW_BYTES 2 MiB + EMAIL_MAX_NORMALIZED_BYTES
 * 256 KiB) plus generous envelope/wrapped-DEK overhead -- a defense-in-depth
 * cap the read route enforces itself rather than trusting the stored object,
 * per the design's "explicit size cap on the envelope" requirement (T11). */
export const MAIL_ENVELOPE_MAX_CIPHERTEXT_BYTES = 3 * 1024 * 1024;

export class MailDecryptError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MailDecryptError";
  }
}

function parseKeks(raw: string): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    const version = Number(entry.slice(0, separator));
    const key = Buffer.from(entry.slice(separator + 1), "base64");
    if (!Number.isInteger(version) || version < 1 || key.length !== 32 || keys.has(version)) {
      throw new MailDecryptError("invalid_email_kek_keyring");
    }
    keys.set(version, key);
  }
  if (!keys.size) throw new MailDecryptError("missing_email_kek_keyring");
  return keys;
}

function decryptGcm(ciphertextWithTag: Uint8Array, key: Buffer, iv: Uint8Array, aad: Uint8Array): Buffer {
  if (ciphertextWithTag.length < 16) throw new MailDecryptError("email_ciphertext_truncated");
  const ciphertext = Buffer.from(ciphertextWithTag.slice(0, -16));
  const tag = Buffer.from(ciphertextWithTag.slice(-16));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function s3Client(): S3Client {
  const endpoint = process.env.EVHOST_EMAIL_R2_ENDPOINT;
  const accessKeyId = process.env.EVHOST_EMAIL_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.EVHOST_EMAIL_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new MailDecryptError("email_r2_not_configured");
  return new S3Client({ endpoint, region: "auto", credentials: { accessKeyId, secretAccessKey } });
}

async function bodyBytes(body: unknown, capBytes: number): Promise<Uint8Array> {
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!stream?.transformToByteArray) throw new MailDecryptError("email_r2_body_missing");
  const bytes = await stream.transformToByteArray();
  if (bytes.byteLength > capBytes) throw new MailDecryptError("email_envelope_too_large");
  return bytes;
}

export interface FetchEncryptedObjectArgs {
  r2ObjectKey: string;
  /** Only checked when provided -- attachment objects (T8/T9, no per-row
   * ciphertext_sha256 column) skip this integrity check and rely on GCM's
   * authentication tag alone, same as any AEAD scheme is designed to. */
  expectedCiphertextSha256?: string | null;
  capBytes?: number;
}

/** Fetches one R2 object and returns its raw (still-encrypted) bytes,
 * enforcing the size cap before anything downstream ever runs. */
export async function fetchEncryptedObjectBytes(args: FetchEncryptedObjectArgs): Promise<Uint8Array> {
  const bucket = process.env.EVHOST_EMAIL_R2_BUCKET ?? "evhost-email-private";
  let result;
  try {
    result = await s3Client().send(new GetObjectCommand({ Bucket: bucket, Key: args.r2ObjectKey }));
  } catch {
    throw new MailDecryptError("email_r2_fetch_failed");
  }
  const encrypted = await bodyBytes(result.Body, args.capBytes ?? MAIL_ENVELOPE_MAX_CIPHERTEXT_BYTES);
  if (
    args.expectedCiphertextSha256
    && createHash("sha256").update(encrypted).digest("hex") !== args.expectedCiphertextSha256
  ) {
    throw new MailDecryptError("email_ciphertext_hash_mismatch");
  }
  return encrypted;
}

export interface DecryptEvmailObjectArgs {
  encrypted: Uint8Array;
  /**
   * Precomputed AAD bytes for this exact ciphertext object. This module
   * intentionally does not know or guess which shape to build -- the
   * message envelope and each attachment envelope are two different
   * domain-separated AAD layouts (see this file's header comment), and only
   * the caller knows which one it is decrypting. Build it with:
   *   - evmailAad({ inboundId, aliasHash, rawSha256, normalizedSha256,
   *     objectKey }) from @evhost/email-ingest-contract, for the raw
   *     message envelope.
   *   - buildAttachmentAad({ workspaceId, messageIndexId, attachmentId,
   *     r2ObjectKey }) from lib/email/mail-attachment-aad, for an
   *     attachment object -- the exact same function
   *     services/onlyevs-worker/email.ts's write path uses to encrypt it.
   */
  aad: Uint8Array;
  expectedKekVersion?: number | null;
}

/** Unwraps the DEK and decrypts the content layer of one EVMAIL envelope.
 * Returns the raw plaintext bytes -- callers interpret them (dual-part
 * rawMessage/normalizedJson for the message envelope via
 * decodeEvmailPlaintext, or as-is raw bytes for an attachment). */
export function decryptEvmailObject(args: DecryptEvmailObjectArgs): Buffer {
  let envelope;
  try {
    envelope = decodeEvmailEnvelope(args.encrypted);
  } catch {
    throw new MailDecryptError("email_envelope_malformed");
  }
  if (args.expectedKekVersion != null && envelope.kekVersion !== args.expectedKekVersion) {
    throw new MailDecryptError("email_kek_version_mismatch");
  }
  const key = parseKeks(process.env.EVHOST_EMAIL_KEK_KEYS ?? "").get(envelope.kekVersion);
  if (!key) throw new MailDecryptError("email_kek_missing");
  try {
    const dek = decryptGcm(envelope.wrappedDek, key, envelope.wrapIv, args.aad);
    return decryptGcm(envelope.ciphertext, dek, envelope.contentIv, args.aad);
  } catch (error) {
    if (error instanceof MailDecryptError) throw error;
    throw new MailDecryptError("email_decrypt_failed");
  }
}
