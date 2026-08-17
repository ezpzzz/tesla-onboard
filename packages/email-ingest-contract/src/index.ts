export const EMAIL_CONTRACT_VERSION = 1 as const;
export const EMAIL_MAX_RAW_BYTES = 2 * 1024 * 1024;
export const EMAIL_MAX_NORMALIZED_BYTES = 256 * 1024;
export const EMAIL_SIGNATURE_WINDOW_SECONDS = 300;
export const EVMAIL_MAGIC = "EVMAIL1" as const;

// Workspace email alias local-part sizing.
//
// This format exists because a real Turo-forwarding delivery path rejected
// aliases that satisfied RFC 5321's 64-octet local-part limit but were
// still too long for a validator neither Turo nor any other party
// documents publicly. There is no confirmed exact ceiling -- the field
// investigation that produced this format could not reach the validator's
// source (WAF-blocked live probing is out of scope; the historical page
// was unavailable via the Wayback Machine) -- so this format buys margin
// by shrinking aggressively rather than chasing a "discovered" limit:
// local-part 24 octets ("{15 chars}.{8 chars}"), whole address 40 octets
// (local-part + "@mail.evhost.app", 16 octets), both comfortably under
// every rejection point observed so far and under the 64-octet RFC 5321
// hard limit Cloudflare's inbound MX enforces (rejecting RCPT TO with
// "500 5.5.2 ... Invalid email user" before the email worker ever runs).
//
// REAL THREAT MODEL -- read this before "fixing" these sizes back up to a
// >=120-bit entropy floor; that dogma is what produced an alias too long
// for Turo's mail validators to accept in the first place. The properties
// this alias format actually needs to provide are:
//   1. HMAC-SHA256 unforgeability. The signing key never leaves the
//      server/Worker, so an attacker without the key cannot compute a
//      valid signature for a token of their choosing no matter how short
//      the truncated output is -- forging a signature is not the same
//      problem as brute-forcing a fixed secret.
//   2. SMTP-rate-limited guessing. The only channel available to test a
//      guess is sending an email and observing whether Cloudflare Email
//      Routing accepts or bounces it -- orders of magnitude slower than an
//      offline hash search, so a 40-bit truncated MAC is not practically
//      brute-forceable through this channel.
//   3. A guessed alias is not a successful attack by itself. Every inbound
//      email -- guessed alias or not -- starts in Review mode: it must
//      match the human-approved template-fingerprint allowlist AND pass an
//      explicit manager authorize action (see the Turo parser guardrails
//      and canAutoApply) before it can affect any trip or vehicle state.
//      The alias only gates which inbox a message lands in, not what it is
//      allowed to do once there.
// Given that model, EMAIL_ALIAS_SIGNATURE_CHARS below is sized for
// validator compatibility with headroom, not for a standalone >=120-bit
// guessing-resistance target -- do not re-inflate it to chase that figure,
// it is what broke Turo delivery the last time.
//
// The local-part is `${token}.${signature}`: a random lowercase base32
// token and an HMAC-SHA256 signature over it, both produced by
// lowerBase32Prefix below (RFC 4648 §6 alphabet "a-z2-7") so the whole
// local part is dot-atom-safe. Base32's 32 symbols are already
// all-lowercase and case-distinct (see BASE32_LOWER_ALPHABET below), so the
// unconditional .toLowerCase() both mint (createWorkspaceAlias) and verify
// (verifyWorkspaceAlias / verifyAlias) apply before comparing never folds
// two distinct symbols together -- case-fold-losslessness is preserved by
// construction; only the bit counts below have moved from the previous
// version of this file.
//
//  - EMAIL_ALIAS_TOKEN_BYTES (10 bytes drawn -> 80 raw random bits) and
//    EMAIL_ALIAS_TOKEN_CHARS (15 base32 chars retained by lowerBase32Prefix
//    -> 75 bits kept after truncation): the token is base32, not hex, so
//    every character carries 5 bits instead of hex's 4 -- reusing the
//    signature's encoding buys local-part length without drawing extra
//    random bytes. lowerBase32Prefix's own guard (bytes.byteLength * 8 >=
//    length * 5) requires 10*8=80 >= 15*5=75, which holds with exactly 5
//    bits to spare.
//  - EMAIL_ALIAS_SIGNATURE_CHARS (8 chars): a prefix of the HMAC-SHA256
//    digest (32 bytes = 256 bits, so any prefix up to 51 chars is safe) via
//    lowerBase32Prefix, i.e. 40 bits of the truncated MAC -- sized for the
//    validator-compatibility constraint above, see the threat model above
//    for why a >=120-bit floor does not apply here.
//
// Sizes below keep the whole local-part at exactly 15 + 1 + 8 = 24 octets.
export const EMAIL_ALIAS_TOKEN_BYTES = 10;      // 80 random bits drawn
export const EMAIL_ALIAS_TOKEN_CHARS = 15;      // 75 bits retained after base32 truncation
export const EMAIL_ALIAS_SIGNATURE_CHARS = 8;   // 40 bits of truncated HMAC-SHA256

// Lowercase alphabet, symbols 0-31 in order; every symbol is already
// lowercase and case-distinct (a-z, 2-7 -- 1/0/8/9 excluded per RFC 4648 to
// avoid visual ambiguity with i/l/o/g), so lowercasing a base32 string
// (done unconditionally by both createWorkspaceAlias and
// verifyWorkspaceAlias/verifyAlias, see EMAIL_ALIAS_SIGNATURE_CHARS above)
// never folds two distinct symbols onto one output character and costs zero
// bits of min-entropy. All 32 alphabet symbols (a-z0-9_- superset from
// assertEmailAliasToken's regex) remain dot-atom-legal per RFC 5322 atext.
const BASE32_LOWER_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

// RFC 4648 §6 base32, lowercase, unpadded, truncated to the first `length`
// characters (`length * 5` bits) of `bytes`. Used to encode a prefix of an
// HMAC-SHA256 digest (32 bytes = 256 bits, so any `length` up to 51 is safe)
// as a case-stable alias signature -- see EMAIL_ALIAS_SIGNATURE_CHARS above
// for why base32 (not base64url) is required here.
export function lowerBase32Prefix(bytes: Uint8Array, length: number): string {
  if (!Number.isInteger(length) || length < 1) throw new RangeError("base32_length");
  if (bytes.byteLength * 8 < length * 5) throw new RangeError("base32_insufficient_bytes");
  let output = "";
  let bitBuffer = 0;
  let bitCount = 0;
  for (let index = 0; index < bytes.byteLength && output.length < length; index += 1) {
    bitBuffer = ((bitBuffer << 8) | bytes[index]) >>> 0;
    bitCount += 8;
    while (bitCount >= 5 && output.length < length) {
      bitCount -= 5;
      output += BASE32_LOWER_ALPHABET[(bitBuffer >>> bitCount) & 0x1f];
    }
  }
  return output;
}

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
  // Exact lengths, not ranges: both halves are fixed-size base32 output
  // (EMAIL_ALIAS_TOKEN_CHARS / EMAIL_ALIAS_SIGNATURE_CHARS above), so unlike
  // the previous wide-range grammar this validator can't accept a shape
  // mint/verify would never produce.
  const pattern = new RegExp(`^[a-z2-7]{${EMAIL_ALIAS_TOKEN_CHARS}}\\.[a-z2-7]{${EMAIL_ALIAS_SIGNATURE_CHARS}}$`);
  if (!pattern.test(normalized)) throw new TypeError("email_alias_invalid");
  return normalized;
}
