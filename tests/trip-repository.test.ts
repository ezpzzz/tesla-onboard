import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelTrip, parseStoredProgress } from "@/lib/owner/trip-repository";

const valid = {
  stepId: "module-charging",
  pct: 62.5,
  isDone: false,
  completed: ["welcome", "plan"],
  checklist: { license: true },
  moduleTotal: 5,
  checklistDone: 1,
  checklistTotal: 4,
  requiredChecklistDone: 1,
  requiredChecklistTotal: 3,
  experience: "new",
  pathMode: "full",
  startedAt: 1_700_000_000_000,
  newToTesla: false,
  guestName: "Guest Driver",
  updatedAt: 1_700_000_100_000,
};

describe("parseStoredProgress", () => {
  it("accepts a complete bounded progress summary", () => {
    expect(parseStoredProgress(valid)).toEqual(valid);
  });

  it("rejects out-of-range progress instead of trusting database JSON", () => {
    expect(parseStoredProgress({ ...valid, pct: 101 })).toBeNull();
    expect(parseStoredProgress({ ...valid, requiredChecklistTotal: 1000 })).toBeNull();
  });

  it("normalizes optional enum-like fields but preserves valid progress", () => {
    expect(parseStoredProgress({ ...valid, experience: "admin", pathMode: "fast" })).toMatchObject({
      experience: null,
      pathMode: null,
      pct: 62.5,
    });
  });
});

describe("cancelTrip", () => {
  const tripId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("posts a trimmed reason to the owner cancel route", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await cancelTrip(tripId, "  guest requested  ");

    expect(fetch).toHaveBeenCalledWith(
      `/api/owner/trips/${tripId}/cancel`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "guest requested" }),
      }),
    );
  });

  it("surfaces the route's error message on failure", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This trip can no longer be cancelled." }),
    });

    await expect(cancelTrip(tripId)).rejects.toThrow("This trip can no longer be cancelled.");
  });
});
