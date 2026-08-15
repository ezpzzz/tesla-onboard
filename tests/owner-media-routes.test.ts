import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClient = vi.fn();
const requireOwnerWorkspace = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const getPublicUrl = vi.fn();
const insert = vi.fn();
const select = vi.fn();
const single = vi.fn();
const getUser = vi.fn();
const updateUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner/server-auth", () => ({
  requireOwnerWorkspace,
  OwnerWorkspaceAuthError: class OwnerWorkspaceAuthError extends Error {
    kind = "forbidden" as const;
  },
}));

const { POST: uploadBrandAsset } = await import("@/app/api/owner/branding/assets/route");
const {
  POST: uploadOwnerAvatar,
  DELETE: deleteOwnerAvatar,
} = await import("@/app/api/owner/avatar/route");

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const userId = "00000000-0000-4000-8000-000000000001";

function imageForm(fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set("file", new File([png], "photo.png", { type: "image/png" }));
  return form;
}

describe("owner media routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upload.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://assets.example/${path}` } }));
    single.mockResolvedValue({ data: { id: "asset", public_url: "https://assets.example/logo" }, error: null });
    select.mockReturnValue({ single });
    insert.mockReturnValue({ select });
    requireOwnerWorkspace.mockResolvedValue({ userId });
    getUser.mockResolvedValue({ data: { user: { id: userId, email: "owner@example.com", user_metadata: {}, identities: [] } }, error: null });
    updateUser.mockResolvedValue({ data: { user: { id: userId, email: "owner@example.com", user_metadata: {}, identities: [] } }, error: null });
    createClient.mockResolvedValue({
      auth: { getUser, updateUser },
      storage: { from: vi.fn(() => ({ upload, remove, getPublicUrl })) },
      from: vi.fn(() => ({ insert })),
    });
  });

  it("rejects cross-origin avatar and brand uploads before reading auth state", async () => {
    const avatar = await uploadOwnerAvatar(new NextRequest("https://evhost.app/api/owner/avatar", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body: imageForm(),
    }));
    const brand = await uploadBrandAsset(new NextRequest("https://evhost.app/api/owner/branding/assets", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body: imageForm({ workspace: "00000000-0000-4000-8000-000000000010", shop: "desert-ev" }),
    }));

    expect(avatar.status).toBe(403);
    expect(brand.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(requireOwnerWorkspace).not.toHaveBeenCalled();
  });

  it("keeps business-logo uploads available independently of Tesla operations", async () => {
    process.env.NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED = "false";
    const response = await uploadBrandAsset(new NextRequest("https://evhost.app/api/owner/branding/assets", {
      method: "POST",
      headers: { origin: "https://evhost.app" },
      body: imageForm({
        workspace: "00000000-0000-4000-8000-000000000010",
        shop: "desert-ev",
        purpose: "logo",
      }),
    }));

    expect(response.status).toBe(201);
    expect(upload).toHaveBeenCalled();
  });

  it("stores an authenticated user's custom avatar under their own prefix", async () => {
    const response = await uploadOwnerAvatar(new NextRequest("https://evhost.app/api/owner/avatar", {
      method: "POST",
      headers: { origin: "https://evhost.app" },
      body: imageForm(),
    }));

    expect(response.status).toBe(201);
    expect(upload.mock.calls[0]?.[0]).toMatch(new RegExp(`^${userId}/avatar-`));
    expect(updateUser).toHaveBeenCalledWith({ data: expect.objectContaining({ evhost_avatar_path: expect.stringMatching(/^00000000-/) }) });
  });

  it("rejects files whose bytes are not a supported raster image", async () => {
    const form = new FormData();
    form.set("file", new File(["<svg onload=alert(1) />"], "photo.png", { type: "image/png" }));
    const response = await uploadOwnerAvatar(new NextRequest("https://evhost.app/api/owner/avatar", {
      method: "POST",
      headers: { origin: "https://evhost.app" },
      body: form,
    }));

    expect(response.status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("removes a newly uploaded object when the auth metadata update fails", async () => {
    updateUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("metadata unavailable") });
    const response = await uploadOwnerAvatar(new NextRequest("https://evhost.app/api/owner/avatar", {
      method: "POST",
      headers: { origin: "https://evhost.app" },
      body: imageForm(),
    }));

    expect(response.status).toBe(502);
    const uploadedPath = upload.mock.calls[0]?.[0] as string;
    expect(remove).toHaveBeenCalledWith([uploadedPath]);
  });

  it("removes only the current user's uploaded avatar and restores provider presentation", async () => {
    getUser.mockResolvedValueOnce({
      data: { user: {
        id: userId,
        email: "owner@example.com",
        user_metadata: {
          evhost_avatar_path: `${userId}/avatar-00000000-0000-4000-8000-000000000002.png`,
          avatar_url: "https://lh3.googleusercontent.com/provider-photo",
        },
        identities: [],
      } },
      error: null,
    });
    const response = await deleteOwnerAvatar(new NextRequest("https://evhost.app/api/owner/avatar", {
      method: "DELETE",
      headers: { origin: "https://evhost.app" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ avatarUrl: "https://lh3.googleusercontent.com/provider-photo" });
    expect(remove).toHaveBeenCalledWith([`${userId}/avatar-00000000-0000-4000-8000-000000000002.png`]);
  });
});
