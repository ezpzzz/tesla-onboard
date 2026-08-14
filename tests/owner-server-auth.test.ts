import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { OwnerWorkspaceAuthError, requireOwnerWorkspace } = await import("@/lib/owner/server-auth");

describe("owner workspace server authorization", () => {
  it("rejects malformed tenant scopes before constructing a database client", async () => {
    await expect(requireOwnerWorkspace("not-a-uuid", "shop", "manager"))
      .rejects.toMatchObject({ kind: "invalid_scope" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a missing authenticated user", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });
    await expect(requireOwnerWorkspace("6acaf5d4-a1ce-4c32-a17f-ae3779be897f", "onlyevs", "manager"))
      .rejects.toMatchObject({ kind: "unauthenticated" });
  });
});
