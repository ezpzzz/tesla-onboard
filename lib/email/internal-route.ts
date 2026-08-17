import "server-only";

import type { NextRequest } from "next/server";
import type { Pool } from "pg";
import { EMAIL_SIGNATURE_WINDOW_SECONDS } from "@evhost/email-ingest-contract";
import { captureKeyringFromEnv, verifyInternalCapture } from "./security";
import { claimEmailCaptureNonce, getEmailCaptureDbPool } from "./capture-db";

export async function authenticateEmailCaptureRequest(
  request: NextRequest,
  phase: "authorize" | "init" | "finalize",
): Promise<{ body: Uint8Array; db: Pool } | null> {
  const body = new Uint8Array(await request.arrayBuffer());
  const keyId = request.headers.get("x-evhost-email-key-id") ?? "";
  const timestamp = request.headers.get("x-evhost-email-timestamp") ?? "";
  const nonce = request.headers.get("x-evhost-email-nonce") ?? "";
  const signature = request.headers.get("x-evhost-email-signature") ?? "";
  if (!verifyInternalCapture(phase, body, { keyId, timestamp, nonce, signature }, captureKeyringFromEnv())) return null;
  const db = getEmailCaptureDbPool();
  if (!db) return null;
  const { data, error } = await claimEmailCaptureNonce(db, {
    keyVersion: Number(keyId), nonce,
    expiresAt: new Date((Number(timestamp) + EMAIL_SIGNATURE_WINDOW_SECONDS) * 1_000).toISOString(),
  });
  return !error && data === true ? { body, db } : null;
}
