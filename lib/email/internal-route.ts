import "server-only";

import type { NextRequest } from "next/server";
import { EMAIL_SIGNATURE_WINDOW_SECONDS } from "@evhost/email-ingest-contract";
import { captureKeyringFromEnv, verifyInternalCapture } from "./security";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function authenticateEmailCaptureRequest(
  request: NextRequest,
  phase: "authorize" | "init" | "finalize",
): Promise<{ body: Uint8Array; service: NonNullable<ReturnType<typeof createServiceRoleClient>> } | null> {
  const body = new Uint8Array(await request.arrayBuffer());
  const keyId = request.headers.get("x-evhost-email-key-id") ?? "";
  const timestamp = request.headers.get("x-evhost-email-timestamp") ?? "";
  const nonce = request.headers.get("x-evhost-email-nonce") ?? "";
  const signature = request.headers.get("x-evhost-email-signature") ?? "";
  if (!verifyInternalCapture(phase, body, { keyId, timestamp, nonce, signature }, captureKeyringFromEnv())) return null;
  const service = createServiceRoleClient();
  if (!service) return null;
  const { data, error } = await service.rpc("claim_onlyevs_email_capture_nonce", {
    p_key_version: Number(keyId), p_nonce: nonce,
    p_expires_at: new Date((Number(timestamp) + EMAIL_SIGNATURE_WINDOW_SECONDS) * 1_000).toISOString(),
  });
  return !error && data === true ? { body, service } : null;
}
