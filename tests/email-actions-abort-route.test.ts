import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireOwnerWorkspace = vi.fn();
const rpc = vi.fn();
const createClient = vi.fn();

class MockOwnerWorkspaceAuthError extends Error {
  constructor(readonly kind: "unauthenticated" | "forbidden" | "invalid_scope") {
    super(kind);
  }
}

vi.mock("@/lib/owner/server-auth", () => ({
  requireOwnerWorkspace,
  OwnerWorkspaceAuthError: MockOwnerWorkspaceAuthError,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { POST } = await import("@/app/api/owner/email-actions/[id]/abort-revocation/route");

const actionId = "00000000-0000-4000-8000-000000000030";
const context = { params: Promise.resolve({ id: actionId }) } as RouteContext<"/api/owner/email-actions/[id]/abort-revocation">;

function request(body: unknown, origin = "https://evhost.app") {
  return new NextRequest(`https://evhost.app/api/owner/email-actions/${actionId}/abort-revocation`, {
    method: "POST",
    headers: { origin, host: "evhost.app", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const configuredEnv = {
  EVHOST_EMAIL_ALIAS_HMAC_KEYS: `1:${Buffer.alloc(32, 3).toString("base64")}`,
  ONLYEVS_DATA_ENCRYPTION_KEYS: `1:${Buffer.alloc(32, 4).toString("base64")}`,
  EVHOST_EMAIL_INGEST_ENABLED: "true",
};

const validBody = { workspaceId: "workspace-id", shopSlug: "desert-ev", expectedRevision: 3, reason: "Guest confirmed by phone; keep the original trip." };

describe("owner email action abort-revocation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(configuredEnv)) vi.stubEnv(key, value);
    requireOwnerWorkspace.mockResolvedValue({ workspaceId: "workspace-id", shopSlug: "desert-ev", role: "manager" });
    createClient.mockResolvedValue({ rpc });
    rpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects a cross-origin abort before touching auth or the database", async () => {
    const response = await POST(request(validBody, "https://attacker.example"), context);
    expect(response.status).toBe(403);
    expect(requireOwnerWorkspace).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed revision or missing reason before checking auth", async () => {
    const response = await POST(request({ ...validBody, expectedRevision: 0 }), context);
    expect(response.status).toBe(400);
    expect(requireOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("fails closed when email intake is not configured on this deployment", async () => {
    vi.stubEnv("EVHOST_EMAIL_INGEST_ENABLED", "false");
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(503);
    expect(requireOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("requires manager-level workspace authorization", async () => {
    const response = await POST(request(validBody), context);
    await response.json();
    expect(requireOwnerWorkspace).toHaveBeenCalledWith("workspace-id", "desert-ev", "manager");
  });

  it("maps an unauthenticated owner session to 401", async () => {
    requireOwnerWorkspace.mockRejectedValue(new MockOwnerWorkspaceAuthError("unauthenticated"));
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(401);
  });

  it("aborts on the happy path and calls the RPC with the exact frozen signature", async () => {
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ aborted: true });
    expect(rpc).toHaveBeenCalledWith("abort_onlyevs_email_revocation", {
      p_workspace_id: "workspace-id",
      p_action_id: actionId,
      p_expected_revision: 3,
      p_reason: validBody.reason,
    });
  });

  it("maps a revision conflict (40001) to a 409 refresh-and-retry response", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "email_action_revision_conflict" } });
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "This action changed. Refresh and try again." });
  });

  it("maps a deadline-passed / already-claimed rejection (55000) to a 409 with a specific reason", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "email_action_not_abortable" } });
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/deadline|provider has already claimed/);
  });

  it("maps a missing manager role (42501) to a 403", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "workspace_manager_required" } });
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(403);
  });

  it("maps a not-found action (P0002) to a 404", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "email_action_not_found" } });
    const response = await POST(request(validBody), context);
    expect(response.status).toBe(404);
  });
});
