import { describe, expect, it } from "vitest";
import { calendarCandidateReviewControl } from "@/components/owner/CalendarReviewQueue";

describe("calendar candidate review control", () => {
  it("allows review only after the operations service is enabled", () => {
    expect(calendarCandidateReviewControl(true)).toEqual({
      label: "Review",
      disabled: false,
      title: undefined,
    });
  });

  it("keeps imported events visible but confirmation unavailable while operations are off", () => {
    expect(calendarCandidateReviewControl(false)).toEqual({
      label: "Review unavailable",
      disabled: true,
      title: "Trip confirmation requires the operations service",
    });
  });
});
