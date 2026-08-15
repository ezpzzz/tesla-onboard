import crypto from "node:crypto";
import type { IntegrationProvider } from "./access-types";

const FORMAT = "oev1";

export interface CredentialKeyring {
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

export interface CredentialAad {
  workspaceId: string;
  shopSlug: string;
  provider: IntegrationProvider | "evhost";
  field: "provider_subject" | "refresh_token" | "invite_url" | "driver_id" | "location" | "trip_link";
  /** Adds record-level binding for secrets that are not already scoped by a
   * provider-owned identifier. Omitted for legacy envelopes so existing
   * integration credentials retain byte-for-byte AAD compatibility. */
  entityId?: string;
}

function invalidKeyring(): never {
  throw new Error(
    "ONLYEVS_DATA_ENCRYPTION_KEYS must contain unique version:base64 entries with 32-byte keys.",
  );
}

export function parseCredentialKeyring(raw: string): CredentialKeyring {
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator < 1) invalidKeyring();
    const version = Number(entry.slice(0, separator));
    const encoded = entry.slice(separator + 1);
    if (!Number.isSafeInteger(version) || version < 1 || keys.has(version)) invalidKeyring();
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) invalidKeyring();
    keys.set(version, key);
  }
  if (keys.size === 0) invalidKeyring();
  return { activeVersion: Math.max(...keys.keys()), keys };
}

function aadBytes(context: CredentialAad): Buffer {
  return Buffer.from(
    [FORMAT, context.workspaceId, context.shopSlug, context.provider, context.field, context.entityId]
      .filter((value): value is string => value !== undefined)
      .join("\u001f"),
    "utf8",
  );
}

function decodeBase64Url(value: string, expectedBytes?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_encoding");
  const decoded = Buffer.from(value, "base64url");
  // Node accepts non-canonical base64url strings whose unused trailing bits
  // differ. Reject those so changing any envelope character is unambiguously
  // treated as tampering rather than decoding to the same bytes.
  if (decoded.toString("base64url") !== value) throw new Error("invalid_encoding");
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw new Error("invalid_length");
  }
  return decoded;
}

export function encryptCredential(
  plaintext: string,
  keyring: CredentialKeyring,
  context: CredentialAad,
): { ciphertext: string; keyVersion: number } {
  if (!plaintext) throw new Error("credential_plaintext_required");
  const version = keyring.activeVersion;
  const key = keyring.keys.get(version);
  if (!key) throw new Error("credential_key_missing");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadBytes(context));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyVersion: version,
    ciphertext: [
      FORMAT,
      String(version),
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join("."),
  };
}

export function decryptCredential(
  ciphertext: string,
  keyring: CredentialKeyring,
  context: CredentialAad,
): string {
  try {
    const [format, versionText, ivText, tagText, dataText, extra] = ciphertext.split(".");
    if (format !== FORMAT || extra !== undefined) throw new Error("invalid_format");
    const version = Number(versionText);
    const key = keyring.keys.get(version);
    if (!key) throw new Error("unknown_key");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, decodeBase64Url(ivText, 12));
    decipher.setAAD(aadBytes(context));
    decipher.setAuthTag(decodeBase64Url(tagText, 16));
    return Buffer.concat([
      decipher.update(decodeBase64Url(dataText)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("credential_decryption_failed");
  }
}

export function credentialKeyringFromEnv(): CredentialKeyring {
  return parseCredentialKeyring(process.env.ONLYEVS_DATA_ENCRYPTION_KEYS ?? "");
}

export function oauthStateSecretFromEnv(): string {
  const secret = process.env.ONLYEVS_OAUTH_STATE_SECRET
    ?? process.env.TESLA_SESSION_SECRET
    ?? "";
  if (secret.length < 32) throw new Error("ONLYEVS_OAUTH_STATE_SECRET is not configured securely.");
  return secret;
}
