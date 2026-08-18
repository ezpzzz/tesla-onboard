import { describe, expect, it } from "vitest";
import {
  deriveMailLinkChip,
  formatMailListDate,
  formatMailSender,
  isNoiseMailItem,
  mapMailListRow,
  nextMailCursor,
  resolveLinkedFilterParam,
  shouldShowMailItem,
  unreadCountLabel,
  type MailListItem,
  type MailListRpcRow,
} from "@/components/owner/mail-list-view";

const BASE_ROW: MailListRpcRow = {
  id: "10000000-0000-4000-8000-000000000001",
  inbound_email_id: "20000000-0000-4000-8000-000000000001",
  subject: "Your trip is confirmed",
  sender: "noreply@messages.turo.com",
  sent_at: "2026-08-15T18:30:00.000Z",
  snippet: "Your booking is confirmed for Aug 20-24.",
  has_attachments: true,
  candidate_id: null,
  trip_id: null,
  guest_id: null,
  event_type: "booking",
  is_read: false,
};

describe("mapMailListRow", () => {
  it("maps snake_case RPC columns to the camelCase view item", () => {
    const item = mapMailListRow(BASE_ROW);
    expect(item).toEqual<MailListItem>({
      id: BASE_ROW.id,
      inboundEmailId: BASE_ROW.inbound_email_id,
      subject: "Your trip is confirmed",
      sender: "noreply@messages.turo.com",
      sentAtMs: Date.parse(BASE_ROW.sent_at),
      snippet: BASE_ROW.snippet,
      hasAttachments: true,
      candidateId: null,
      tripId: null,
      guestId: null,
      eventType: "booking",
      isRead: false,
    });
  });

  it("falls back to a placeholder for a blank subject", () => {
    const item = mapMailListRow({ ...BASE_ROW, subject: "   " });
    expect(item.subject).toBe("(no subject)");
  });
});

describe("isNoiseMailItem / shouldShowMailItem", () => {
  it("flags exactly the 'noise' event type as noise", () => {
    expect(isNoiseMailItem({ eventType: "noise" })).toBe(true);
    expect(isNoiseMailItem({ eventType: "booking" })).toBe(false);
    expect(isNoiseMailItem({ eventType: null })).toBe(false);
  });

  it("hides noise unless the All mail toggle is on", () => {
    expect(shouldShowMailItem({ eventType: "noise" }, false)).toBe(false);
    expect(shouldShowMailItem({ eventType: "noise" }, true)).toBe(true);
  });

  it("never hides an uncategorized (null event type) message", () => {
    expect(shouldShowMailItem({ eventType: null }, false)).toBe(true);
  });

  it("never hides a non-noise categorized message", () => {
    expect(shouldShowMailItem({ eventType: "guest_message" }, false)).toBe(true);
  });
});

describe("resolveLinkedFilterParam", () => {
  it("maps the tri-state UI control to the RPC's nullable boolean", () => {
    expect(resolveLinkedFilterParam("all")).toBeNull();
    expect(resolveLinkedFilterParam("linked")).toBe(true);
    expect(resolveLinkedFilterParam("unlinked")).toBe(false);
  });
});

describe("deriveMailLinkChip", () => {
  it("prefers a trip link, with a safe deep link into the trip page", () => {
    const chip = deriveMailLinkChip({ tripId: "trip-1", candidateId: "cand-1", guestId: "guest-1" });
    expect(chip).toEqual({ label: "Linked to trip", href: "/owner/trips/trip-1" });
  });

  it("falls back to a candidate link without guessing a deep-linkable id", () => {
    const chip = deriveMailLinkChip({ tripId: null, candidateId: "cand-1", guestId: null });
    expect(chip).toEqual({ label: "Linked to booking update", href: "/owner/inbox" });
  });

  it("labels a guest-only link with no href -- guest ids don't resolve to a Driver route", () => {
    const chip = deriveMailLinkChip({ tripId: null, candidateId: null, guestId: "guest-1" });
    expect(chip).toEqual({ label: "Linked to guest", href: null });
  });

  it("returns null when nothing is linked", () => {
    expect(deriveMailLinkChip({ tripId: null, candidateId: null, guestId: null })).toBeNull();
  });
});

describe("formatMailListDate", () => {
  it("formats a finite timestamp", () => {
    expect(formatMailListDate(Date.parse("2026-08-15T18:30:00.000Z"))).toMatch(/Aug 15/);
  });

  it("renders an honest label for a non-finite timestamp instead of 'Invalid Date'", () => {
    expect(formatMailListDate(Number.NaN)).toBe("Unknown date");
  });
});

describe("nextMailCursor", () => {
  const item = (id: string, sentAtMs: number): MailListItem => ({
    id, inboundEmailId: id, subject: "s", sender: "s", sentAtMs, snippet: "", hasAttachments: false,
    candidateId: null, tripId: null, guestId: null, eventType: null, isRead: false,
  });

  it("returns null for an empty page", () => {
    expect(nextMailCursor([], 50)).toBeNull();
  });

  it("returns null when the page came back short of the requested limit -- nothing left to page into", () => {
    const items = [item("a", 3), item("b", 2)];
    expect(nextMailCursor(items, 50)).toBeNull();
  });

  it("returns the last row's cursor when the page is full", () => {
    const items = [item("a", 3), item("b", 2)];
    expect(nextMailCursor(items, 2)).toEqual({ sentAtMs: 2, id: "b" });
  });
});

describe("formatMailSender / unreadCountLabel", () => {
  it("labels a blank sender honestly", () => {
    expect(formatMailSender("  ")).toBe("Unknown sender");
    expect(formatMailSender("host@turo.com")).toBe("host@turo.com");
  });

  it("pluralizes the unread count and renders nothing at zero", () => {
    expect(unreadCountLabel(0)).toBe("");
    expect(unreadCountLabel(1)).toBe("1 unread");
    expect(unreadCountLabel(4)).toBe("4 unread");
  });
});
