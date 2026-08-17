import { describe, expect, it } from "vitest";
import { isTripCancellable } from "@/lib/owner/derive";
import type { TripStatus } from "@/lib/owner/types";

// The repo has no React render harness (no jsdom/@testing-library in
// package.json, and vitest.config.ts only includes tests/**/*.test.ts,
// lib/**/*.test.ts, services/**/test/**/*.test.ts -- no .tsx). The "Cancel
// trip" action's visibility-by-state logic is pulled into this pure
// predicate for exactly that reason: it's what app/owner/trips/[id]/page.tsx
// gates the action on, so this is the closest available seam to a UI render
// test for action visibility (same idiom as parseStoredProgress in
// trip-repository.test.ts).
describe("isTripCancellable (Cancel trip action visibility)", () => {
  it("is visible for upcoming and active trips", () => {
    expect(isTripCancellable("upcoming")).toBe(true);
    expect(isTripCancellable("active")).toBe(true);
  });

  it("is hidden once a trip is completed or already cancelled", () => {
    expect(isTripCancellable("completed")).toBe(false);
    expect(isTripCancellable("cancelled")).toBe(false);
  });

  it("covers every TripStatus member (fails to compile if the union grows silently)", () => {
    const all: TripStatus[] = ["upcoming", "active", "completed", "cancelled"];
    expect(all.map(isTripCancellable)).toEqual([true, true, false, false]);
  });
});
