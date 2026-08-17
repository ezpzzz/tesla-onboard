import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClient = vi.fn();
const fetchMailMessageContent = vi.fn();
const isOwnerAuthConfigured = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner/mail-content-server", () => ({ fetchMailMessageContent }));
vi.mock("@/lib/owner-auth", () => ({ isOwnerAuthConfigured }));

const { GET } = await import("@/app/api/owner/mail/[id]/content/route");

const messageId = "00000000-0000-4000-8000-000000000002";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: messageId }) } as RouteContext<"/api/owner/mail/[id]/content">;

function request(id = messageId, qs = `workspaceId=${workspaceId}`) {
  return new NextRequest(`https://evhost.app/api/owner/mail/${id}/content?${qs}`);
}

describe("GET /api/owner/mail/[id]/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isOwnerAuthConfigured.mockReturnValue(true);
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } } }) },
    });
  });

  it("returns an honest not_found without touching Supabase in demo mode", async () => {
    isOwnerAuthConfigured.mockReturnValue(false);
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "not_found" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchMailMessageContent).not.toHaveBeenCalled();
  });

  it("rejects malformed message ids before touching the database", async () => {
    const response = await GET(
      request("not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) } as RouteContext<"/api/owner/mail/[id]/content">,
    );
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed workspaceId query param", async () => {
    const response = await GET(request(messageId, "workspaceId=not-a-uuid"), context);
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no owner session", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(fetchMailMessageContent).not.toHaveBeenCalled();
  });

  it("returns 404 not_found for a missing or cross-workspace message", async () => {
    fetchMailMessageContent.mockResolvedValue({ kind: "not_found" });
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ state: "not_found" });
  });

  it("returns an honest unconfigured state without a 500", async () => {
    fetchMailMessageContent.mockResolvedValue({ kind: "unconfigured" });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "unconfigured" });
  });

  it("returns too_large for an oversized envelope, not a 500", async () => {
    fetchMailMessageContent.mockResolvedValue({ kind: "too_large" });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "too_large" });
  });

  it("returns decrypt_error without leaking ciphertext or a stack trace", async () => {
    fetchMailMessageContent.mockResolvedValue({ kind: "decrypt_error" });
    const response = await GET(request(), context);
    const body = await response.json();
    expect(response.status).not.toBe(500);
    expect(body).toEqual({ state: "decrypt_error" });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|stack trace/i);
  });

  it("returns the full content envelope on success with no-store headers", async () => {
    fetchMailMessageContent.mockResolvedValue({
      kind: "content",
      subject: "Booking confirmed",
      sender: "no-reply@turo.com",
      sentAtMs: 1_755_374_400_000,
      html: "<p>hi</p>",
      text: "hi",
      attachments: [{ id: "a1", filename: "receipt.pdf", contentType: "application/pdf", sizeBytes: 1200, contentId: null, inlined: false }],
      inline: { "logo@evhost": "data:image/png;base64,AAAA" },
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      state: "content",
      subject: "Booking confirmed",
      sender: "no-reply@turo.com",
      sentAtMs: 1_755_374_400_000,
      html: "<p>hi</p>",
      text: "hi",
      attachments: [{ id: "a1", filename: "receipt.pdf", contentType: "application/pdf", sizeBytes: 1200, contentId: null, inlined: false }],
      inline: { "logo@evhost": "data:image/png;base64,AAAA" },
    });
    expect(fetchMailMessageContent).toHaveBeenCalledWith({
      supabase: expect.anything(),
      workspaceId,
      messageId,
    });
  });
});
