import { describe, expect, it } from "vitest";
import { parseStoredProgress } from "@/lib/owner/trip-repository";

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
