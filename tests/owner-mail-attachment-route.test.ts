import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClient = vi.fn();
const fetchMailAttachmentBytes = vi.fn();
const isOwnerAuthConfigured = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner/mail-attachment-server", () => ({ fetchMailAttachmentBytes }));
vi.mock("@/lib/owner-auth", () => ({ isOwnerAuthConfigured }));

const { GET } = await import("@/app/api/owner/mail/[id]/attachments/[aid]/route");

const messageId = "00000000-0000-4000-8000-000000000002";
const attachmentId = "00000000-0000-4000-8000-000000000003";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const context = {
  params: Promise.resolve({ id: messageId, aid: attachmentId }),
} as RouteContext<"/api/owner/mail/[id]/attachments/[aid]">;

function request(id = messageId, aid = attachmentId, qs = `workspaceId=${workspaceId}`) {
  return new NextRequest(`https://evhost.app/api/owner/mail/${id}/attachments/${aid}?${qs}`);
}

describe("GET /api/owner/mail/[id]/attachments/[aid]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isOwnerAuthConfigured.mockReturnValue(true);
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner-1" } } }) },
    });
  });

  it("returns not_found in demo mode without touching Supabase", async () => {
    isOwnerAuthConfigured.mockReturnValue(false);
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "not_found" });
    expect(fetchMailAttachmentBytes).not.toHaveBeenCalled();
  });

  it("rejects a malformed message id", async () => {
    const response = await GET(
      request("not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid", aid: attachmentId }) } as RouteContext<"/api/owner/mail/[id]/attachments/[aid]">,
    );
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed attachment id", async () => {
    const response = await GET(
      request(messageId, "not-a-uuid"),
      { params: Promise.resolve({ id: messageId, aid: "not-a-uuid" }) } as RouteContext<"/api/owner/mail/[id]/attachments/[aid]">,
    );
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no owner session", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(fetchMailAttachmentBytes).not.toHaveBeenCalled();
  });

  it("returns 404 for an attachment id that doesn't belong to this message", async () => {
    fetchMailAttachmentBytes.mockResolvedValue({ kind: "not_found" });
    const response = await GET(request(), context);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ state: "not_found" });
  });

  it("returns decrypt_error without a 500", async () => {
    fetchMailAttachmentBytes.mockResolvedValue({ kind: "decrypt_error" });
    const response = await GET(request(), context);
    expect(response.status).not.toBe(500);
    await expect(response.json()).resolves.toEqual({ state: "decrypt_error" });
  });

  it("streams bytes with content-disposition, content-type, and no-store", async () => {
    fetchMailAttachmentBytes.mockResolvedValue({
      kind: "bytes",
      bytes: Buffer.from("hello pdf"),
      filename: "receipt.pdf",
      contentType: "application/pdf",
    });
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain('filename="receipt.pdf"');
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.toString("utf8")).toBe("hello pdf");
  });

  it("falls back to a safe filename when the stored name is empty or hostile", async () => {
    fetchMailAttachmentBytes.mockResolvedValue({
      kind: "bytes",
      bytes: Buffer.from("x"),
      filename: 'evil"\r\nX-Injected: 1',
      contentType: "application/octet-stream",
    });
    const response = await GET(request(), context);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain('"\r');
  });
});
