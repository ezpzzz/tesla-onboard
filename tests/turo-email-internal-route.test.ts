import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseEmailKeyring, signInternalCapture } from "@/lib/email/security";
import { canonicalJsonBytes } from "@evhost/email-ingest-contract";

// lib/email/internal-route.ts is exercised directly (not just through a
// mocked route module) so its own `import "server-only"` needs a stand-in --
// the real package is only resolvable inside Next's bundler, not under
// Vitest/Node module resolution.
vi.mock("server-only", () => ({}));

const claimEmailCaptureNonce = vi.fn();
const authorizeEmailAlias = vi.fn();
const initEmailCapture = vi.fn();
const finalizeEmailCapture = vi.fn();
const getEmailCaptureDbPool = vi.fn();

vi.mock("@/lib/email/capture-db", () => ({
  claimEmailCaptureNonce,
  authorizeEmailAlias,
  initEmailCapture,
  finalizeEmailCapture,
  getEmailCaptureDbPool,
}));

const { authenticateEmailCaptureRequest } = await import("@/lib/email/internal-route");
const { POST: authorizePost } = await import("@/app/api/internal/turo-email/authorize/route");
const { POST: capturePost } = await import("@/app/api/internal/turo-email/capture/route");

const CAPTURE_KEY = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const keyring = parseEmailKeyring(CAPTURE_KEY, "EVHOST_EMAIL_CAPTURE_HMAC_KEYS");
const FAKE_POOL = { query: vi.fn() };

function signedRequest(
  url: string,
  phase: "authorize" | "init" | "finalize",
  body: unknown,
  overrides: Partial<{ signature: string; nonce: string; keyId: string; timestamp: string }> = {},
) {
  const raw = Buffer.from(canonicalJsonBytes(body));
  const headers = signInternalCapture(phase, raw, keyring);
  return new NextRequest(url, {
    method: "POST",
    body: raw,
    headers: {
      "x-evhost-email-key-id": overrides.keyId ?? headers.keyId,
      "x-evhost-email-timestamp": overrides.timestamp ?? headers.timestamp,
      "x-evhost-email-nonce": overrides.nonce ?? headers.nonce,
      "x-evhost-email-signature": overrides.signature ?? headers.signature,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVHOST_EMAIL_CAPTURE_HMAC_KEYS = CAPTURE_KEY;
  getEmailCaptureDbPool.mockReturnValue(FAKE_POOL);
  claimEmailCaptureNonce.mockResolvedValue({ data: true, error: null });
});

describe("authenticateEmailCaptureRequest", () => {
  it("rejects a bad signature without touching the database", async () => {
    const request = signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", { a: 1 }, { signature: "not-a-real-signature" });
    const result = await authenticateEmailCaptureRequest(request, "authorize");
    expect(result).toBeNull();
    expect(claimEmailCaptureNonce).not.toHaveBeenCalled();
  });

  it("rejects a signature bound to a different phase (authorize signature replayed against capture)", async () => {
    const request = signedRequest("https://evhost.app/api/internal/turo-email/capture", "authorize", { a: 1 });
    const result = await authenticateEmailCaptureRequest(request, "init");
    expect(result).toBeNull();
    expect(claimEmailCaptureNonce).not.toHaveBeenCalled();
  });

  it("fails closed when ONLYEVS_EMAIL_CAPTURE_DATABASE_URL is unset (no service-role fallback)", async () => {
    getEmailCaptureDbPool.mockReturnValue(null);
    const request = signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", { a: 1 });
    const result = await authenticateEmailCaptureRequest(request, "authorize");
    expect(result).toBeNull();
    expect(claimEmailCaptureNonce).not.toHaveBeenCalled();
  });

  it("rejects a replayed nonce -- the claim RPC reporting it was already inserted", async () => {
    claimEmailCaptureNonce.mockResolvedValue({ data: false, error: null });
    const request = signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", { a: 1 });
    const result = await authenticateEmailCaptureRequest(request, "authorize");
    expect(result).toBeNull();
  });

  it("rejects when the claim RPC itself errors", async () => {
    claimEmailCaptureNonce.mockResolvedValue({ data: null, error: new Error("db unavailable") });
    const request = signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", { a: 1 });
    const result = await authenticateEmailCaptureRequest(request, "authorize");
    expect(result).toBeNull();
  });

  it("accepts a validly signed, unclaimed-nonce request and hands back the scoped db pool", async () => {
    const request = signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", { a: 1 });
    const result = await authenticateEmailCaptureRequest(request, "authorize");
    expect(result).not.toBeNull();
    expect(result?.db).toBe(FAKE_POOL);
    expect(claimEmailCaptureNonce).toHaveBeenCalledWith(FAKE_POOL, expect.objectContaining({ nonce: expect.any(String) }));
  });
});

describe("POST /api/internal/turo-email/authorize", () => {
  const manifest = {
    version: 1, aliasId: "alias-1", envelopeRecipientHash: "a".repeat(64),
    sourceMessageId: "msg-1", requestedInboundId: "00000000-0000-4000-8000-000000000001",
    timestamp: Math.floor(Date.now() / 1_000), nonce: "n",
  };

  it("returns 401 on a bad signature without calling the alias RPC", async () => {
    const response = await authorizePost(signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", manifest, { signature: "bogus" }));
    expect(response.status).toBe(401);
    expect(authorizeEmailAlias).not.toHaveBeenCalled();
  });

  it("returns 403 when the alias RPC finds no accepting alias", async () => {
    authorizeEmailAlias.mockResolvedValue({ data: [], error: null });
    const response = await authorizePost(signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", manifest));
    expect(response.status).toBe(403);
  });

  it("returns the alias row as JSON, with accepted_alias_revision as a real number", async () => {
    authorizeEmailAlias.mockResolvedValue({
      data: [{
        inbound_id: manifest.requestedInboundId, workspace_id: "ws-1", integration_id: "int-1",
        accepted_alias_revision: 3, object_key: "pending/x.evmail",
        integration_status: "active", integration_mode: "review",
      }], error: null,
    });
    const response = await authorizePost(signedRequest("https://evhost.app/api/internal/turo-email/authorize", "authorize", manifest));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted_alias_revision).toBe(3);
    expect(typeof body.accepted_alias_revision).toBe("number");
    expect(authorizeEmailAlias).toHaveBeenCalledWith(FAKE_POOL, {
      aliasHash: manifest.envelopeRecipientHash, inboundId: manifest.requestedInboundId, rfcMessageId: manifest.sourceMessageId,
    });
  });
});

describe("POST /api/internal/turo-email/capture", () => {
  const initManifest = {
    version: 1, phase: "init", inboundId: "00000000-0000-4000-8000-000000000002",
    acceptedAliasRevision: 1, rawSha256: "a".repeat(64), normalizedSha256: "b".repeat(64),
    rawBytes: 100, normalizedBytes: 90, authVerdict: "pass", kekVersion: 1,
    timestamp: Math.floor(Date.now() / 1_000), nonce: "n",
  };

  it("returns 401 on a bad signature without calling init", async () => {
    const response = await capturePost(signedRequest("https://evhost.app/api/internal/turo-email/capture?phase=init", "init", initManifest, { signature: "bogus" }));
    expect(response.status).toBe(401);
    expect(initEmailCapture).not.toHaveBeenCalled();
  });

  it("returns 409 when the init RPC reports a conflict", async () => {
    initEmailCapture.mockResolvedValue({ data: null, error: new Error("email_capture_init_conflict") });
    const response = await capturePost(signedRequest("https://evhost.app/api/internal/turo-email/capture?phase=init", "init", initManifest));
    expect(response.status).toBe(409);
  });

  it("calls initEmailCapture with the parsed manifest and returns id/state", async () => {
    initEmailCapture.mockResolvedValue({ data: { id: initManifest.inboundId, state: "storing" }, error: null });
    const response = await capturePost(signedRequest("https://evhost.app/api/internal/turo-email/capture?phase=init", "init", initManifest));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: initManifest.inboundId, state: "storing" });
    expect(initEmailCapture).toHaveBeenCalledWith(FAKE_POOL, {
      inboundId: initManifest.inboundId, aliasRevision: initManifest.acceptedAliasRevision,
      rawSha256: initManifest.rawSha256, normalizedSha256: initManifest.normalizedSha256,
      rawBytes: initManifest.rawBytes, normalizedBytes: initManifest.normalizedBytes,
      authVerdict: initManifest.authVerdict, kekVersion: initManifest.kekVersion,
    });
  });

  it("routes phase=finalize to finalizeEmailCapture", async () => {
    const finalizeManifest = {
      version: 1, phase: "finalize", inboundId: "00000000-0000-4000-8000-000000000003",
      objectKey: "pending/00000000-0000-4000-8000-000000000003.evmail", ciphertextSha256: "c".repeat(64),
      ciphertextBytes: 200, wrappedDekSha256: "d".repeat(64), kekVersion: 1,
      deleteAfter: new Date(Date.now() + 86_400_000).toISOString(),
      timestamp: Math.floor(Date.now() / 1_000), nonce: "n",
    };
    finalizeEmailCapture.mockResolvedValue({ data: { id: finalizeManifest.inboundId, state: "stored" }, error: null });
    const response = await capturePost(signedRequest("https://evhost.app/api/internal/turo-email/capture?phase=finalize", "finalize", finalizeManifest));
    expect(response.status).toBe(200);
    expect(finalizeEmailCapture).toHaveBeenCalledWith(FAKE_POOL, {
      inboundId: finalizeManifest.inboundId, objectKey: finalizeManifest.objectKey,
      ciphertextSha256: finalizeManifest.ciphertextSha256, ciphertextBytes: finalizeManifest.ciphertextBytes,
      wrappedDekSha256: finalizeManifest.wrappedDekSha256, kekVersion: finalizeManifest.kekVersion,
      deleteAfter: finalizeManifest.deleteAfter,
    });
    expect(initEmailCapture).not.toHaveBeenCalled();
  });
});
