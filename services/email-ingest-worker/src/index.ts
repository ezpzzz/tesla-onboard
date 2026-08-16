import PostalMime from "postal-mime";
import {
  canonicalJsonBytes, encodeEvmailEnvelope, encodeEvmailPlaintext, evmailAad,
  EMAIL_MAX_RAW_BYTES, type AuthorizeManifest, type CaptureFinalizeManifest,
  type CaptureInitManifest, type NormalizedEmailManifest,
} from "@evhost/email-ingest-contract";

interface EmailMessage { from: string; to: string; headers?: Headers; raw: ReadableStream<Uint8Array>; rawSize: number; setReject(reason: string): void }
interface R2Bucket { put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown> }
interface Env {
  EMAIL_BUCKET: R2Bucket;
  EVHOST_APP_ORIGIN: string;
  EVHOST_EMAIL_INGEST_ENABLED: string;
  EVHOST_EMAIL_ALIAS_HMAC_KEYS: string;
  EVHOST_EMAIL_CAPTURE_HMAC_KEYS: string;
  EVHOST_EMAIL_KEK_KEYS: string;
  EMAIL_RETENTION_DAYS: string;
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
const sha256 = async (value: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", (typeof value === "string" ? encoder.encode(value) : value) as BufferSource));
const base64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const randomBase64url = (length: number) => base64url(crypto.getRandomValues(new Uint8Array(length)).buffer);

function parseKeys(raw: string): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  for (const entry of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    const [versionText, encoded, extra] = entry.split(":");
    const version = Number(versionText);
    if (extra !== undefined || !Number.isInteger(version) || version < 1) throw new Error("invalid_worker_keyring");
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.length !== 32 || result.has(version)) throw new Error("invalid_worker_keyring");
    result.set(version, bytes);
  }
  if (!result.size) throw new Error("missing_worker_keyring");
  return result;
}

async function hmac(key: Uint8Array, value: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", cryptoKey, value as BufferSource));
}

async function verifyAlias(localPart: string, keys: Map<number, Uint8Array>): Promise<boolean> {
  const [token, signature, extra] = localPart.toLowerCase().split(".");
  if (!token || !signature || extra !== undefined) return false;
  for (const key of keys.values()) {
    const expected = (await hmac(key, encoder.encode(`evhost-email-alias-v1\u001f${token}`))).slice(0, 32).toLowerCase();
    if (expected === signature) return true;
  }
  return false;
}

async function readCapped(stream: ReadableStream<Uint8Array>, advertised: number): Promise<Uint8Array> {
  if (advertised > EMAIL_MAX_RAW_BYTES) throw new Error("email_raw_too_large");
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > EMAIL_MAX_RAW_BYTES) { await reader.cancel(); throw new Error("email_raw_too_large"); } chunks.push(value); }
  const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output;
}

async function signedPost(env: Env, phase: "authorize" | "init" | "finalize", path: string, body: Uint8Array) {
  const keys = parseKeys(env.EVHOST_EMAIL_CAPTURE_HMAC_KEYS); const version = Math.max(...keys.keys()); const key = keys.get(version)!;
  const timestamp = String(Math.floor(Date.now() / 1_000)); const nonce = randomBase64url(16); const bodyHash = await sha256(body);
  const parts = [`evhost-email-signature-v1`, phase, String(version), timestamp, nonce, bodyHash].map((value) => encoder.encode(value));
  const payload = new Uint8Array(parts.reduce((sum, part) => sum + 4 + part.length, 0)); const view = new DataView(payload.buffer); let offset = 0;
  for (const part of parts) { view.setUint32(offset, part.length, false); offset += 4; payload.set(part, offset); offset += part.length; }
  const response = await fetch(`${env.EVHOST_APP_ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-evhost-email-key-id": String(version), "x-evhost-email-timestamp": timestamp, "x-evhost-email-nonce": nonce, "x-evhost-email-signature": await hmac(key, payload) }, body: body as unknown as BodyInit });
  if (!response.ok) throw new Error(`capture_${phase}_${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

function authResult(headers: Array<{ key: string; value: string }>, name: "dkim" | "dmarc" | "spf" | "arc"): "pass" | "fail" | "unknown" {
  const value = headers.filter((header) => header.key.toLowerCase() === "authentication-results").map((header) => header.value).join(";").toLowerCase();
  return new RegExp(`\\b${name}=pass\\b`).test(value) ? "pass" : new RegExp(`\\b${name}=(?:fail|softfail|temperror|permerror)\\b`).test(value) ? "fail" : "unknown";
}

async function encryptMessage(env: Env, plaintext: Uint8Array, aad: Uint8Array) {
  const keys = parseKeys(env.EVHOST_EMAIL_KEK_KEYS); const version = Math.max(...keys.keys()); const kekBytes = keys.get(version)!;
  const dekBytes = crypto.getRandomValues(new Uint8Array(32)); const wrapIv = crypto.getRandomValues(new Uint8Array(12)); const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const dek = await crypto.subtle.importKey("raw", dekBytes, "AES-GCM", false, ["encrypt"]); const kek = await crypto.subtle.importKey("raw", kekBytes as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: contentIv as BufferSource, additionalData: aad as BufferSource }, dek, plaintext as BufferSource));
  const wrappedDek = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv as BufferSource, additionalData: aad as BufferSource }, kek, dekBytes as BufferSource));
  return { version, wrappedDek, bytes: encodeEvmailEnvelope({ kekVersion: version, wrapIv, wrappedDek, contentIv, ciphertext }) };
}

export default {
  async email(message: EmailMessage, env: Env): Promise<void> {
    if (env.EVHOST_EMAIL_INGEST_ENABLED !== "true") { message.setReject("EVhost email intake is paused"); return; }
    const localPart = message.to.toLowerCase().split("@")[0];
    if (!(await verifyAlias(localPart, parseKeys(env.EVHOST_EMAIL_ALIAS_HMAC_KEYS)))) { message.setReject("Unknown EVhost address"); return; }
    const requestedInboundId = crypto.randomUUID();
    const aliasHash = await sha256(localPart);
    const sourceMessageId = message.headers?.get("message-id")?.trim().slice(0, 998) || null;
    const authorize: AuthorizeManifest = { version: 1, aliasId: localPart.slice(-8), envelopeRecipientHash: aliasHash, sourceMessageId, requestedInboundId, timestamp: Math.floor(Date.now() / 1_000), nonce: randomBase64url(16) };
    const authorized = await signedPost(env, "authorize", "/api/internal/turo-email/authorize", canonicalJsonBytes(authorize));
    const raw = await readCapped(message.raw, message.rawSize);
    const parsed = await PostalMime.parse(raw);
    const headers = (parsed.headers ?? []) as Array<{ key: string; value: string }>;
    const normalized: NormalizedEmailManifest = { version: 1, from: parsed.from?.address ?? message.from, to: message.to, subject: parsed.subject ?? "", messageId: parsed.messageId ?? sourceMessageId, date: parsed.date ?? null, text: parsed.text ?? "", html: typeof parsed.html === "string" ? parsed.html : null, receiverAuth: { dkim: authResult(headers, "dkim"), dmarc: authResult(headers, "dmarc"), spf: authResult(headers, "spf"), arc: authResult(headers, "arc") } };
    const normalizedBytes = canonicalJsonBytes(normalized); const rawHash = await sha256(raw); const normalizedHash = await sha256(normalizedBytes);
    const objectKey = String(authorized.object_key); const inboundId = String(authorized.inbound_id); const aliasRevision = Number(authorized.accepted_alias_revision);
    const aad = evmailAad({ inboundId, aliasHash, rawSha256: rawHash, normalizedSha256: normalizedHash, objectKey });
    const encrypted = await encryptMessage(env, encodeEvmailPlaintext(raw, normalizedBytes), aad);
    const init: CaptureInitManifest = { version: 1, phase: "init", inboundId, acceptedAliasRevision: aliasRevision, rawSha256: rawHash, normalizedSha256: normalizedHash, rawBytes: raw.length, normalizedBytes: normalizedBytes.length, authVerdict: normalized.receiverAuth.dmarc === "pass" || normalized.receiverAuth.dkim === "pass" ? "pass" : "review", kekVersion: encrypted.version, timestamp: Math.floor(Date.now() / 1_000), nonce: randomBase64url(16) };
    await signedPost(env, "init", "/api/internal/turo-email/capture?phase=init", canonicalJsonBytes(init));
    await env.EMAIL_BUCKET.put(objectKey, encrypted.bytes, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { inboundId, format: "EVMAIL1" } });
    const retentionDays = Math.min(30, Math.max(1, Number(env.EMAIL_RETENTION_DAYS) || 30));
    const finalize: CaptureFinalizeManifest = { version: 1, phase: "finalize", inboundId, objectKey, ciphertextSha256: await sha256(encrypted.bytes), ciphertextBytes: encrypted.bytes.length, wrappedDekSha256: await sha256(encrypted.wrappedDek), kekVersion: encrypted.version, deleteAfter: new Date(Date.now() + retentionDays * 86_400_000).toISOString(), timestamp: Math.floor(Date.now() / 1_000), nonce: randomBase64url(16) };
    await signedPost(env, "finalize", "/api/internal/turo-email/capture?phase=finalize", canonicalJsonBytes(finalize));
  },
};
