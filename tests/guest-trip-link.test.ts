import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const createClient = vi.fn();
const redirect = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect, notFound }));

const { default: GuestTripPage } = await import("@/app/trip/[token]/page");

describe("private guest trip links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockResolvedValue({ rpc });
  });

  it("opens the tenant walkthrough directly without guest email authentication", async () => {
    rpc.mockResolvedValue({
      data: [{
        workspace_id: "72000000-0000-4000-8000-000000000001",
        shop_slug: "tracked-rentals",
      }],
      error: null,
    });
    const token = "a".repeat(43);

    await GuestTripPage({ params: Promise.resolve({ token }) });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_onlyevs_trip_invitation", {
      p_public_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(redirect).toHaveBeenCalledWith(
      `/?tenant=72000000-0000-4000-8000-000000000001%7Etracked-rentals&trip=${token}`,
    );
  });

  it("fails closed before querying for a malformed token", async () => {
    await expect(GuestTripPage({ params: Promise.resolve({ token: "short" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
    expect(createClient).not.toHaveBeenCalled();
  });
});
