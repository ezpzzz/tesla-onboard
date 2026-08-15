import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("encrypted trip capability", () => {
  beforeEach(() => {
    process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = `1:${Buffer.alloc(32, 11).toString("base64")}`;
  });
  afterEach(() => {
    delete process.env.ONLYEVS_DATA_ENCRYPTION_KEYS;
  });

  it("binds the token to workspace, shop, and trip AAD", async () => {
    const { createEncryptedTripLink, decryptTripLink } = await import("@/lib/owner/trip-link-secret");
    const created = createEncryptedTripLink({ workspaceId: "workspace-a", shopSlug: "shop-a", tripId: "trip-a" });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.tokenCiphertext).not.toContain(created.token);
    expect(decryptTripLink({ workspaceId: "workspace-a", shopSlug: "shop-a", tripId: "trip-a", tokenCiphertext: created.tokenCiphertext })).toBe(created.token);
    expect(() => decryptTripLink({ workspaceId: "workspace-a", shopSlug: "shop-a", tripId: "trip-b", tokenCiphertext: created.tokenCiphertext })).toThrow("credential_decryption_failed");
  });
});
