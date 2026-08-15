import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const createClient = vi.fn();
const allowRequest = vi.fn(() => true);

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/owner-throttle", () => ({ allowRequest }));

const { POST } = await import("@/app/api/guest/trips/progress/route");

function request(origin = "https://evhost.app") {
  return new NextRequest("https://evhost.app/api/guest/trips/progress", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      token: "a".repeat(43),
      progress: {
        stepId: "welcome",
        pct: 10,
        isDone: false,
        completed: [],
        checklist: {},
        moduleTotal: 5,
        checklistDone: 0,
        checklistTotal: 3,
        requiredChecklistDone: 0,
        requiredChecklistTotal: 2,
        updatedAt: 1_700_000_000_000,
      },
    }),
  });
}

describe("guest trip progress capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowRequest.mockReturnValue(true);
    rpc.mockResolvedValue({ error: null });
    createClient.mockResolvedValue({ rpc });
  });

  it("publishes bounded progress without requiring a Supabase guest session", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_onlyevs_guest_onboarding_progress", {
      p_public_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_progress: expect.objectContaining({ stepId: "welcome", updatedAt: expect.any(Number) }),
    });
  });

  it("rejects cross-origin writes before touching Supabase", async () => {
    const response = await POST(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });
});
