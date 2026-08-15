import { describe, expect, it } from "vitest";
import { initialState, restoreOnboardingProgress } from "@/lib/store";
import type { ProgressSummary } from "@/lib/flow";

const remote: ProgressSummary = {
  stepId: "module-charging", pct: 60, isDone: false, completed: ["welcome", "plan"],
  checklist: { license: true }, moduleTotal: 5, checklistDone: 1, checklistTotal: 4,
  requiredChecklistDone: 1, requiredChecklistTotal: 3, experience: "owner", pathMode: "full",
  startedAt: 1_700_000_000_000, newToTesla: true, guestName: "Should not restore", updatedAt: 1_700_000_100_000,
};

describe("cross-device progress restoration", () => {
  it("restores only bounded journey fields into a blank browser", () => {
    const restored = restoreOnboardingProgress(initialState, remote);
    expect(restored).toMatchObject({ stepId: remote.stepId, pathMode: "full", completed: remote.completed, checklist: remote.checklist, startedAt: remote.startedAt, newToTesla: true });
    expect(restored.profile).toBeNull();
    expect(restored.experience).toBeNull();
    expect(restored).not.toHaveProperty("guestName");
  });

  it("never overwrites local progress", () => {
    const local = { ...initialState, stepId: "module-start-drive", startedAt: 123 };
    expect(restoreOnboardingProgress(local, remote)).toBe(local);
  });
});
