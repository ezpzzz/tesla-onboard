import { createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Versioned public-key ring for the SendGrid Event Webhook's ECDSA signature,
 * carved out of `lib/email/*` (M1) specifically for this route — mirrors the
 * rotation shape of `parseEmailKeyring` in `lib/email/security.ts` (version:material
 * entries, try-each-key verification) but holds asymmetric public keys rather than
 * 32-byte HMAC secrets, so it cannot reuse that parser directly.
 */
export interface SendGridWebhookKeyring {
  keys: ReadonlyMap<number, KeyObject>;
}

function parsePublicKeyMaterial(material: string): KeyObject {
  const trimmed = material.trim();
  if (!trimmed) throw new Error("empty key material");
  return createPublicKey(
    trimmed.includes("BEGIN PUBLIC KEY")
      ? trimmed.replaceAll("\\n", "\n")
      : { key: Buffer.from(trimmed, "base64"), format: "der", type: "spki" },
  );
}

/**
 * Parses `version:pem-or-der,version:pem-or-der,...`. A single entry with no
 * `N:` version prefix is accepted as version 1, for backward compatibility with
 * the previous single-key `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` shape.
 */
export function parseSendGridWebhookKeyring(raw: string, variableName: string): SendGridWebhookKeyring {
  const trimmedRaw = raw.trim();
  if (!trimmedRaw) throw new Error(`${variableName} is not configured.`);
  const entries = trimmedRaw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new Error(`${variableName} is not configured.`);
  const keys = new Map<number, KeyObject>();
  for (const entry of entries) {
    const match = /^(\d+):([\s\S]+)$/.exec(entry);
    let version: number;
    let material: string;
    if (match) {
      version = Number(match[1]);
      material = match[2];
    } else if (entries.length === 1) {
      version = 1;
      material = entry;
    } else {
      throw new Error(`${variableName} must contain unique version:key entries.`);
    }
    if (!Number.isSafeInteger(version) || version < 1 || keys.has(version)) {
      throw new Error(`${variableName} must contain unique version:key entries.`);
    }
    keys.set(version, parsePublicKeyMaterial(material));
  }
  return { keys };
}

/**
 * Verifies a SendGrid Event Webhook signature against every configured key
 * version and returns the version that actually verified, or null if none did
 * (unknown/rotated-out key, tampered payload, or malformed signature).
 */
export function verifySendGridWebhookSignature(
  raw: Buffer,
  timestamp: string,
  signature: string,
  keyring: SendGridWebhookKeyring,
): number | null {
  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signature, "base64");
  } catch {
    return null;
  }
  if (!signatureBuffer.length) return null;
  const payload = Buffer.concat([Buffer.from(timestamp), raw]);
  for (const [version, key] of keyring.keys) {
    try {
      if (verify("sha256", payload, key, signatureBuffer)) return version;
    } catch {
      // Malformed key/signature combination for this version; try the next one.
    }
  }
  return null;
}

/**
 * `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` (singular) was renamed to
 * `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS` (plural, versioned keyring) in
 * this same change. This is a merge-to-deploy-in-one-step repo, so the
 * hosting provider's env var cannot be guaranteed to be renamed atomically
 * with the code -- reading only the new name would make every SendGrid
 * event webhook start failing closed (400) the instant this deploys against
 * an environment that still has only the old singular var set. Prefer the
 * new plural var; fall back to the old singular one (still valid single-key
 * input per parseSendGridWebhookKeyring's version-1 shorthand) so the
 * rename can land in the provider's dashboard on its own schedule. Remove
 * this fallback once the provider env is confirmed migrated.
 */
export function sendGridWebhookKeyringFromEnv(): SendGridWebhookKeyring {
  const plural = process.env.EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS;
  if (plural) {
    return parseSendGridWebhookKeyring(plural, "EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS");
  }
  return parseSendGridWebhookKeyring(
    process.env.EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY ?? "",
    "EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS",
  );
}
