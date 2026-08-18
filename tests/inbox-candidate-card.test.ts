import { describe, expect, it } from "vitest";
import {
  buildViewFullEmailHref,
  deriveConsequenceTitle,
  formatPhoneDisplay,
  formatTripWindowLabel,
  isTuroDriverAvatarUrl,
  isoToLocalWallTimeInput,
  localWallTimeToIso,
  parseEmailCandidateFacts,
  selectDisplayMessage,
} from "@/components/owner/InboxCandidateCard";

describe("buildViewFullEmailHref", () => {
  it("links into /owner/mail's candidate-filtered view, URL-encoded", () => {
    expect(buildViewFullEmailHref("cand-1")).toBe("/owner/mail?candidateId=cand-1");
    expect(buildViewFullEmailHref("cand/with space")).toBe("/owner/mail?candidateId=cand%2Fwith%20space");
  });
});

describe("parseEmailCandidateFacts", () => {
  it("reads the documented key contract from proposed_state/correction_facts", () => {
    const facts = parseEmailCandidateFacts(
      {
        subject: "Taylor's trip with your Tesla Model 3 is booked!",
        guestName: "Taylor",
        guestAvatarUrl: "https://images.turo.com/media/driver/abc123.300x300.jpg",
        guestPhoneE164: "+15125550101",
        guestMessage: "Hi, what time should I arrive?",
        locationLat: "38.63",
        locationLng: "-90.19",
        tripStartsAt: "2026-09-15T23:00:00.000Z",
        tripEndsAt: "2026-09-21T23:00:00.000Z",
        tripTimezone: "America/Chicago",
      },
      { currentTripStartsAt: "2026-09-10T23:00:00.000Z", currentTripEndsAt: "2026-09-16T23:00:00.000Z" },
    );
    expect(facts.guestName).toBe("Taylor");
    expect(facts.guestAvatarUrl).toBe("https://images.turo.com/media/driver/abc123.300x300.jpg");
    expect(facts.guestPhoneE164).toBe("+15125550101");
    expect(facts.guestMessage).toBe("Hi, what time should I arrive?");
    expect(facts.tripTimezone).toBe("America/Chicago");
    expect(facts.currentTripStartsAt).toBe("2026-09-10T23:00:00.000Z");
  });

  it("reads the real lib/email/turo-parser.ts output shape", () => {
    // Exact keys `parseTuroEmail` writes today — see turo-parser.ts's
    // proposedState.guestFirstName / .tripStartAt / .tripEndAt / .tripTimeZone.
    const facts = parseEmailCandidateFacts(
      {
        subject: "Taylor's trip with your Tesla Model 3 is booked!",
        guestFirstName: "Taylor",
        guestAvatarUrl: "https://images.turo.com/media/driver/abc123.300x300.jpg",
        guestPhoneE164: "+15125550101",
        guestMessageText: "Hi, what time should I arrive?",
        pickupAddress: "123 Main St, St. Louis, MO",
        pickupLat: "38.63",
        pickupLng: "-90.19",
        tripStartAt: "2026-09-15T23:00:00.000Z",
        tripEndAt: "2026-09-21T23:00:00.000Z",
        tripTimeZone: "America/Chicago",
        tripStartLocalText: "Tuesday, September 15, 2026, 6:00 PM",
        tripEndLocalText: "Monday, September 21, 2026, 6:00 PM",
      },
      {},
    );
    expect(facts.guestName).toBe("Taylor");
    expect(facts.guestMessage).toBe("Hi, what time should I arrive?");
    expect(facts.locationAddress).toBe("123 Main St, St. Louis, MO");
    expect(facts.locationLat).toBe("38.63");
    expect(facts.tripStartsAt).toBe("2026-09-15T23:00:00.000Z");
    expect(facts.tripEndsAt).toBe("2026-09-21T23:00:00.000Z");
    expect(facts.tripTimezone).toBe("America/Chicago");
    expect(facts.tripStartLocalText).toBe("Tuesday, September 15, 2026, 6:00 PM");
  });

  it("degrades to nulls for missing/malformed input rather than throwing", () => {
    expect(parseEmailCandidateFacts(null, undefined)).toEqual({
      guestName: null, guestAvatarUrl: null, guestPhoneE164: null, guestMessage: null,
      locationAddress: null, locationLat: null, locationLng: null,
      tripStartsAt: null, tripEndsAt: null, tripTimezone: null,
      tripStartLocalText: null, tripEndLocalText: null,
      currentTripStartsAt: null, currentTripEndsAt: null,
      messageText: null,
    });
    expect(parseEmailCandidateFacts("not-an-object", []).guestName).toBeNull();
  });

  it("accepts documented key aliases", () => {
    const facts = parseEmailCandidateFacts({ avatarUrl: "https://images.turo.com/media/driver/x.jpg", phone: "+15555550100" }, {});
    expect(facts.guestAvatarUrl).toBe("https://images.turo.com/media/driver/x.jpg");
    expect(facts.guestPhoneE164).toBe("+15555550100");
  });

  it("reads messageText -- the subject+body fallback carried on every candidate, unknown-template included", () => {
    const facts = parseEmailCandidateFacts(
      { subject: "Please verify your email address", messageText: "Subject: Please verify your email address\n\nSynthetic body with a verification link." },
      {},
    );
    expect(facts.messageText).toBe("Subject: Please verify your email address\n\nSynthetic body with a verification link.");
  });

  it("leaves messageText null when the parser found nothing readable at all", () => {
    expect(parseEmailCandidateFacts({ subject: "x" }, {}).messageText).toBeNull();
  });
});

describe("selectDisplayMessage", () => {
  it("shows the full message for a non-guest_message candidate (e.g. an unknown-template notice)", () => {
    expect(selectDisplayMessage({ guestMessage: null, messageText: "Subject: Please verify your email address\n\n..." }, "unknown"))
      .toBe("Subject: Please verify your email address\n\n...");
  });
  it("suppresses the full message for guest_message when the short guest text is already shown, to avoid duplicating it", () => {
    expect(selectDisplayMessage({ guestMessage: "What time works?", messageText: "Subject: ...\n\nWhat time works?" }, "guest_message")).toBeNull();
  });
  it("still falls back to the full message for guest_message if the short guest text wasn't extracted", () => {
    expect(selectDisplayMessage({ guestMessage: null, messageText: "Subject: ...\n\nbody" }, "guest_message")).toBe("Subject: ...\n\nbody");
  });
  it("renders nothing when neither is present", () => {
    expect(selectDisplayMessage({ guestMessage: null, messageText: null }, "unknown")).toBeNull();
  });
});

describe("isTuroDriverAvatarUrl", () => {
  it("accepts only the exact Turo driver-avatar CDN host and path", () => {
    expect(isTuroDriverAvatarUrl("https://images.turo.com/media/driver/abc.300x300.jpg")).toBe(true);
  });
  it("rejects the sibling vehicle-photo path", () => {
    expect(isTuroDriverAvatarUrl("https://images.turo.com/media/vehicle/images/abc.620x372.heic")).toBe(false);
  });
  it("rejects a different host entirely (no accidental open re-hosting of arbitrary URLs)", () => {
    expect(isTuroDriverAvatarUrl("https://evil.example.com/media/driver/abc.jpg")).toBe(false);
  });
  it("rejects null/empty/malformed", () => {
    expect(isTuroDriverAvatarUrl(null)).toBe(false);
    expect(isTuroDriverAvatarUrl("not a url")).toBe(false);
  });
});

describe("formatPhoneDisplay", () => {
  it("formats a US E.164 number for display", () => {
    expect(formatPhoneDisplay("+15125550101")).toBe("(512) 555-0101");
  });
  it("passes through non-US-shaped numbers unchanged", () => {
    expect(formatPhoneDisplay("+442071838750")).toBe("+442071838750");
  });
});

const NO_LOCAL_TEXT = { tripStartLocalText: null, tripEndLocalText: null };

describe("formatTripWindowLabel", () => {
  it("returns an unresolved state for the tz-unresolved blocker, never guessing UTC", () => {
    const label = formatTripWindowLabel({ tripStartsAt: null, tripEndsAt: null, tripTimezone: null, ...NO_LOCAL_TEXT }, ["trip_timezone_unresolved"]);
    expect(label?.unresolved).toBe(true);
    expect(label?.reason).toBe("unresolved");
  });
  it("falls back to Turo's raw local-time text when the timezone couldn't be resolved", () => {
    const label = formatTripWindowLabel(
      { tripStartsAt: null, tripEndsAt: null, tripTimezone: null, tripStartLocalText: "Tuesday, September 15, 2026, 6:00 PM", tripEndLocalText: "Monday, September 21, 2026, 6:00 PM" },
      ["trip_timezone_unresolved"],
    );
    expect(label?.text).toContain("Tuesday, September 15, 2026, 6:00 PM");
  });
  it("returns an unresolved state for the DST-ambiguous blocker", () => {
    const label = formatTripWindowLabel({ tripStartsAt: "2026-03-08T09:00:00.000Z", tripEndsAt: "2026-03-09T09:00:00.000Z", tripTimezone: "America/Chicago", ...NO_LOCAL_TEXT }, ["trip_timezone_ambiguous_dst"]);
    expect(label?.unresolved).toBe(true);
    expect(label?.reason).toBe("ambiguous_dst");
  });
  it("returns null (renders nothing) when no blocker and no dates are available", () => {
    expect(formatTripWindowLabel({ tripStartsAt: null, tripEndsAt: null, tripTimezone: null, ...NO_LOCAL_TEXT }, [])).toBeNull();
  });
  it("formats a resolved window in the vehicle's timezone", () => {
    const label = formatTripWindowLabel(
      { tripStartsAt: "2026-09-15T23:00:00.000Z", tripEndsAt: "2026-09-21T23:00:00.000Z", tripTimezone: "America/Chicago", ...NO_LOCAL_TEXT },
      [],
    );
    expect(label?.unresolved).toBe(false);
    expect(label?.text).toContain("–");
  });
});

describe("deriveConsequenceTitle", () => {
  it.each([
    ["booking", "Taylor booked a trip"],
    ["change", "Taylor requested a trip change"],
    ["cancellation", "Taylor cancelled their trip"],
    ["guest_message", "Taylor sent a message"],
  ])("is consequence-led for %s", (eventType, expected) => {
    expect(deriveConsequenceTitle({ eventType, title: "fallback" }, "Taylor")) .toBe(expected);
  });
  it("falls back to the item title for unknown/noise event types", () => {
    expect(deriveConsequenceTitle({ eventType: "noise", title: "Payment receipt" }, "Taylor")).toBe("Payment receipt");
  });
  it("falls back to a generic guest when no name was extracted", () => {
    expect(deriveConsequenceTitle({ eventType: "booking", title: "fallback" }, null)).toBe("A guest booked a trip");
  });
});

describe("wall-clock <-> ISO conversion for the correction editor", () => {
  it("round-trips a wall-clock time through a named timezone", () => {
    const iso = "2026-09-15T23:00:00.000Z"; // 6:00 PM America/Chicago (CDT, UTC-5) in September
    const local = isoToLocalWallTimeInput(iso, "America/Chicago");
    expect(local).toBe("2026-09-15T18:00");
    const backToIso = localWallTimeToIso(local, "America/Chicago");
    expect(new Date(backToIso).toISOString()).toBe(iso);
  });
  it("accounts for a different offset than the DST case above (standard time)", () => {
    const iso = "2026-01-15T18:00:00.000Z"; // noon CST (UTC-6) in January
    const local = isoToLocalWallTimeInput(iso, "America/Chicago");
    expect(local).toBe("2026-01-15T12:00");
    expect(new Date(localWallTimeToIso(local, "America/Chicago")).toISOString()).toBe(iso);
  });
});
