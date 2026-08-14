import crypto from "node:crypto";

export const OWNER_IMPORT_SESSION_TTL_MS = 15 * 60 * 1_000;
export const OWNER_IMPORT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createOwnerImportToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function ownerImportTokenHash(token: string): string {
  if (!OWNER_IMPORT_TOKEN_PATTERN.test(token)) throw new Error("invalid_owner_import_token");
  return crypto.createHash("sha256").update(token).digest("hex");
}
