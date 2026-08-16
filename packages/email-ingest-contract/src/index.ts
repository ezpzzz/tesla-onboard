export const EMAIL_CONTRACT_VERSION = 1 as const;
export const EMAIL_MAX_RAW_BYTES = 2 * 1024 * 1024;
export const EMAIL_MAX_NORMALIZED_BYTES = 256 * 1024;
export const EMAIL_SIGNATURE_WINDOW_SECONDS = 300;
export const EVMAIL_MAGIC = "EVMAIL1" as const;

export type EmailCapturePhase = "authorize" | "init" | "finalize";
export type EmailSourceKind = "turo_email" | "google_calendar";
export type EmailCandidateEvent = "booking" | "change" | "cancellation" | "guest_message" | "noise" | "unknown";
export type EmailCapability = "create" | "pretrip" | "active_safe" | "active_destructive";

export interface AuthorizeManifest {
  version: 1;
  aliasId: string;
  envelopeRecipientHash: string;
  sourceMessageId: string | null;
  requestedInboundId: string;
  timestamp: number;
  nonce: string;
}

export interface CaptureInitManifest {
  version: 1;
  phase: "init";
  inboundId: string;
  acceptedAliasRevision: number;
  rawSha256: string;
  normalizedSha256: string;
  rawBytes: number;
  normalizedBytes: number;
  authVerdict: "pass" | "review" | "fail";
  kekVersion: number;
  timestamp: number;
  nonce: string;
}

export interface CaptureFinalizeManifest {
  version: 1;
  phase: "finalize";
  inboundId: string;
  objectKey: string;
  ciphertextSha256: string;
  ciphertextBytes: number;
  wrappedDekSha256: string;
  kekVersion: number;
  deleteAfter: string;
  timestamp: number;
  nonce: string;
}

export interface NormalizedEmailManifest {
  version: 1;
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  date: string | null;
  text: string;
  html: string | null;
  receiverAuth: {
    dkim: "pass" | "fail" | "unknown";
    dmarc: "pass" | "fail" | "unknown";
    spf: "pass" | "fail" | "unknown";
    arc: "pass" | "fail" | "unknown";
  };
}

export interface EvmailEnvelopeParts {
  kekVersion: number;
  wrapIv: Uint8Array;
  wrappedDek: Uint8Array;
  contentIv: Uint8Array;
  ciphertext: Uint8Array;
}

const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical_json_non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  }
  throw new TypeError("canonical_json_unsupported_value");
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalJson(value));
}

export function parseCanonicalJson<T>(raw: Uint8Array, allowedKeys: readonly string[]): T {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const value = JSON.parse(text) as unknown;
  if (!isPlainObject(value)) throw new TypeError("canonical_json_object_required");
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) throw new TypeError("canonical_json_unknown_field");
  if (canonicalJson(value) !== text) throw new TypeError("canonical_json_bytes_mismatch");
  return value as T;
}

export function lengthPrefixedBytes(parts: readonly (string | Uint8Array)[]): Uint8Array {
  const encoded = parts.map((part) => typeof part === "string" ? encoder.encode(part) : part);
  const total = encoded.reduce((sum, part) => sum + 4 + part.byteLength, 0);
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const part of encoded) {
    view.setUint32(offset, part.byteLength, false);
    offset += 4;
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function captureSignaturePayload(input: {
  phase: EmailCapturePhase;
  keyId: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}): Uint8Array {
  return lengthPrefixedBytes([
    `evhost-email-signature-v${EMAIL_CONTRACT_VERSION}`,
    input.phase,
    input.keyId,
    input.timestamp,
    input.nonce,
    input.bodySha256,
  ]);
}

export function evmailAad(input: {
  inboundId: string;
  aliasHash: string;
  rawSha256: string;
  normalizedSha256: string;
  objectKey: string;
}): Uint8Array {
  return lengthPrefixedBytes([
    `evhost-evmail-aad-v${EMAIL_CONTRACT_VERSION}`,
    input.inboundId,
    input.aliasHash,
    input.rawSha256,
    input.normalizedSha256,
    input.objectKey,
  ]);
}

export function encodeEvmailEnvelope(parts: EvmailEnvelopeParts): Uint8Array {
  if (!Number.isInteger(parts.kekVersion) || parts.kekVersion < 1 || parts.kekVersion > 0xffff) throw new RangeError("evmail_kek_version");
  if (parts.wrapIv.byteLength !== 12 || parts.contentIv.byteLength !== 12) throw new RangeError("evmail_iv_length");
  if (parts.wrappedDek.byteLength < 32 || parts.wrappedDek.byteLength > 512) throw new RangeError("evmail_wrapped_dek_length");
  const magic = encoder.encode(EVMAIL_MAGIC);
  const output = new Uint8Array(magic.byteLength + 2 + 2 + 12 + parts.wrappedDek.byteLength + 12 + parts.ciphertext.byteLength);
  const view = new DataView(output.buffer);
  let offset = 0;
  output.set(magic, offset); offset += magic.byteLength;
  view.setUint16(offset, parts.kekVersion, false); offset += 2;
  view.setUint16(offset, parts.wrappedDek.byteLength, false); offset += 2;
  output.set(parts.wrapIv, offset); offset += 12;
  output.set(parts.wrappedDek, offset); offset += parts.wrappedDek.byteLength;
  output.set(parts.contentIv, offset); offset += 12;
  output.set(parts.ciphertext, offset);
  return output;
}

export function decodeEvmailEnvelope(raw: Uint8Array): EvmailEnvelopeParts {
  const magic = encoder.encode(EVMAIL_MAGIC);
  if (raw.byteLength < magic.byteLength + 2 + 2 + 12 + 32 + 12 + 16) throw new RangeError("evmail_truncated");
  for (let index = 0; index < magic.byteLength; index += 1) {
    if (raw[index] !== magic[index]) throw new TypeError("evmail_magic");
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let offset = magic.byteLength;
  const kekVersion = view.getUint16(offset, false); offset += 2;
  const wrappedLength = view.getUint16(offset, false); offset += 2;
  if (wrappedLength < 32 || wrappedLength > 512 || offset + 12 + wrappedLength + 12 + 16 > raw.byteLength) throw new RangeError("evmail_wrapped_dek_length");
  const wrapIv = raw.slice(offset, offset + 12); offset += 12;
  const wrappedDek = raw.slice(offset, offset + wrappedLength); offset += wrappedLength;
  const contentIv = raw.slice(offset, offset + 12); offset += 12;
  return { kekVersion, wrapIv, wrappedDek, contentIv, ciphertext: raw.slice(offset) };
}

export function encodeEvmailPlaintext(rawMessage: Uint8Array, normalizedJson: Uint8Array): Uint8Array {
  if (rawMessage.byteLength > EMAIL_MAX_RAW_BYTES) throw new RangeError("email_raw_too_large");
  if (normalizedJson.byteLength > EMAIL_MAX_NORMALIZED_BYTES) throw new RangeError("email_normalized_too_large");
  const output = new Uint8Array(4 + rawMessage.byteLength + normalizedJson.byteLength);
  new DataView(output.buffer).setUint32(0, rawMessage.byteLength, false);
  output.set(rawMessage, 4);
  output.set(normalizedJson, 4 + rawMessage.byteLength);
  return output;
}

export function decodeEvmailPlaintext(plaintext: Uint8Array): { rawMessage: Uint8Array; normalizedJson: Uint8Array } {
  if (plaintext.byteLength < 4) throw new RangeError("evmail_plaintext_truncated");
  const rawLength = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength).getUint32(0, false);
  if (rawLength > EMAIL_MAX_RAW_BYTES || 4 + rawLength > plaintext.byteLength) throw new RangeError("evmail_plaintext_raw_length");
  const normalizedLength = plaintext.byteLength - 4 - rawLength;
  if (normalizedLength > EMAIL_MAX_NORMALIZED_BYTES) throw new RangeError("evmail_plaintext_normalized_length");
  return {
    rawMessage: plaintext.slice(4, 4 + rawLength),
    normalizedJson: plaintext.slice(4 + rawLength),
  };
}

export function assertEmailAliasToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]{20,64}\.[a-z0-9_-]{16,86}$/.test(normalized)) throw new TypeError("email_alias_invalid");
  return normalized;
}
