import "server-only";

import crypto from "node:crypto";
import {
  credentialKeyringFromEnv,
  decryptCredential,
  encryptCredential,
} from "@/lib/owner/credential-envelope";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function context(workspaceId: string, shopSlug: string, tripId: string) {
  return { workspaceId, shopSlug, provider: "evhost" as const, field: "trip_link" as const, entityId: tripId };
}

export function createEncryptedTripLink(input: {
  workspaceId: string;
  shopSlug: string;
  tripId?: string;
}) {
  const tripId = input.tripId ?? crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const encrypted = encryptCredential(
    token,
    credentialKeyringFromEnv(),
    context(input.workspaceId, input.shopSlug, tripId),
  );
  return { tripId, token, tokenHash, tokenCiphertext: encrypted.ciphertext, keyVersion: encrypted.keyVersion };
}

export function decryptTripLink(input: {
  workspaceId: string;
  shopSlug: string;
  tripId: string;
  tokenCiphertext: string;
}): string {
  const token = decryptCredential(
    input.tokenCiphertext,
    credentialKeyringFromEnv(),
    context(input.workspaceId, input.shopSlug, input.tripId),
  );
  if (!TOKEN_PATTERN.test(token)) throw new Error("credential_decryption_failed");
  return token;
}
