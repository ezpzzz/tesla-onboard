import { describe, expect, it } from "vitest";
import { formatTripDuration, formatTripShortDateRange } from "@/lib/trip-format";

describe("trip presentation formatting", () => {
  it("uses correct singular and plural duration grammar", () => {
    expect(formatTripDuration(0, 86_400_000)).toBe("1 day");
    expect(formatTripDuration(0, 3 * 86_400_000)).toBe("3 days");
  });

  it("preserves the return month when a trip crosses a month boundary", () => {
    const timezone = "America/Phoenix";
    expect(formatTripShortDateRange(
      Date.parse("2026-08-18T17:00:00.000Z"),
      Date.parse("2026-08-21T17:00:00.000Z"),
      timezone,
    )).toBe("Aug 18–21");
    expect(formatTripShortDateRange(
      Date.parse("2026-08-30T17:00:00.000Z"),
      Date.parse("2026-09-02T17:00:00.000Z"),
      timezone,
    )).toBe("Aug 30–Sep 2");
  });
});
