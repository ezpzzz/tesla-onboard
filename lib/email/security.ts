import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { captureSignaturePayload, EMAIL_SIGNATURE_WINDOW_SECONDS } from "@evhost/email-ingest-contract";

export interface VersionedKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export function parseEmailKeyring(raw: string, variableName: string): VersionedKeyring {
  const keys = new Map<number, Buffer>();
  for (const item of raw.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const separator = item.indexOf(":");
    const version = Number(item.slice(0, separator));
    const encoded = separator > 0 ? item.slice(separator + 1) : "";
    const key = Buffer.from(encoded, "base64");
    if (!Number.isSafeInteger(version) || version < 1 || keys.has(version) || key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error(`${variableName} must contain unique version:base64 entries with 32-byte keys.`);
    }
    keys.set(version, key);
  }
  if (!keys.size) throw new Error(`${variableName} is not configured.`);
  return { activeVersion: Math.max(...keys.keys()), keys };
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createWorkspaceAlias(keyring: VersionedKeyring): {
  address: string;
  aliasHash: string;
  aliasHint: string;
  keyVersion: number;
} {
  // Hex deliberately avoids punctuation so the local part satisfies the same
  // fail-closed grammar in SQL, the Worker, and the shared contract.
  const token = randomBytes(18).toString("hex");
  const keyVersion = keyring.activeVersion;
  const key = keyring.keys.get(keyVersion);
  if (!key) throw new Error("email_alias_key_missing");
  const signature = createHmac("sha256", key).update(`evhost-email-alias-v1\u001f${token}`).digest("base64url").slice(0, 32).toLowerCase();
  const localPart = `${token}.${signature}`;
  return {
    address: `${localPart}@mail.evhost.app`,
    aliasHash: sha256Hex(localPart),
    aliasHint: token.slice(-8),
    keyVersion,
  };
}

export function verifyWorkspaceAlias(localPart: string, keyring: VersionedKeyring): boolean {
  const normalized = localPart.trim().toLowerCase();
  const [token, signature, extra] = normalized.split(".");
  if (extra !== undefined || !token || !signature) return false;
  for (const key of keyring.keys.values()) {
    const expected = createHmac("sha256", key).update(`evhost-email-alias-v1\u001f${token}`).digest("base64url").slice(0, 32).toLowerCase();
    if (expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return true;
  }
  return false;
}

export interface InternalSignatureHeaders {
  keyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

export function signInternalCapture(
  phase: "authorize" | "init" | "finalize",
  body: Uint8Array,
  keyring: VersionedKeyring,
  now = Date.now(),
): InternalSignatureHeaders {
  const keyId = String(keyring.activeVersion);
  const key = keyring.keys.get(keyring.activeVersion);
  if (!key) throw new Error("email_capture_key_missing");
  const timestamp = String(Math.floor(now / 1_000));
  const nonce = randomBytes(16).toString("base64url");
  const payload = captureSignaturePayload({ phase, keyId, timestamp, nonce, bodySha256: sha256Hex(body) });
  return { keyId, timestamp, nonce, signature: createHmac("sha256", key).update(payload).digest("base64url") };
}

export function verifyInternalCapture(
  phase: "authorize" | "init" | "finalize",
  body: Uint8Array,
  headers: InternalSignatureHeaders,
  keyring: VersionedKeyring,
  now = Date.now(),
): boolean {
  const version = Number(headers.keyId);
  const key = keyring.keys.get(version);
  const timestamp = Number(headers.timestamp);
  if (!key || !Number.isSafeInteger(timestamp) || Math.abs(Math.floor(now / 1_000) - timestamp) > EMAIL_SIGNATURE_WINDOW_SECONDS) return false;
  const payload = captureSignaturePayload({ phase, keyId: headers.keyId, timestamp: headers.timestamp, nonce: headers.nonce, bodySha256: sha256Hex(body) });
  const expected = createHmac("sha256", key).update(payload).digest("base64url");
  return expected.length === headers.signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(headers.signature));
}

export function aliasKeyringFromEnv(): VersionedKeyring {
  return parseEmailKeyring(process.env.EVHOST_EMAIL_ALIAS_HMAC_KEYS ?? "", "EVHOST_EMAIL_ALIAS_HMAC_KEYS");
}

export function captureKeyringFromEnv(): VersionedKeyring {
  return parseEmailKeyring(process.env.EVHOST_EMAIL_CAPTURE_HMAC_KEYS ?? "", "EVHOST_EMAIL_CAPTURE_HMAC_KEYS");
}
