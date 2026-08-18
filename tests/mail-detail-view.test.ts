import { describe, expect, it } from "vitest";
import {
  attachmentDisplayName,
  buildMailPurgeCopy,
  deriveAvailablePurgeScopes,
  deriveMailTrustChips,
  formatAttachmentSize,
  formatReadReceiptLabel,
  mailContentStateMessage,
  summarizeMailReadReceipts,
} from "@/components/owner/mail-detail-view";

describe("deriveMailTrustChips", () => {
  it("maps true/false/null to pass/fail/unknown with matching tones", () => {
    const chips = deriveMailTrustChips({
      dkimPass: true,
      spfPass: false,
      dmarcPass: null,
      fromDomainAligned: true,
    });
    expect(chips).toEqual([
      { label: "DKIM", status: "pass", tone: "good" },
      { label: "SPF", status: "fail", tone: "danger" },
      { label: "DMARC", status: "unknown", tone: "neutral" },
      { label: "From turo.com", status: "pass", tone: "good" },
    ]);
  });

  it("never coerces an unpopulated (null) signal into a fail", () => {
    const chips = deriveMailTrustChips({ dkimPass: null, spfPass: null, dmarcPass: null, fromDomainAligned: null });
    expect(chips.every((c) => c.status === "unknown")).toBe(true);
    expect(chips.every((c) => c.tone === "neutral")).toBe(true);
  });
});

describe("summarizeMailReadReceipts / formatReadReceiptLabel", () => {
  const receipts = [
    { userId: "u1", readAtMs: 100 },
    { userId: "u2", readAtMs: 300 },
    { userId: "u3", readAtMs: 200 },
  ];

  it("splits the viewer's own receipt from teammates, sorted most-recent-first", () => {
    const summary = summarizeMailReadReceipts(receipts, "u1");
    expect(summary.viewerReadAtMs).toBe(100);
    expect(summary.teammateReceipts.map((r) => r.userId)).toEqual(["u2", "u3"]);
  });

  it("treats a viewer with no receipt as not-yet-read", () => {
    const summary = summarizeMailReadReceipts(receipts, "u9");
    expect(summary.viewerReadAtMs).toBeNull();
    expect(summary.teammateReceipts).toHaveLength(3);
  });

  it("handles a null viewer id (not yet resolved) without throwing", () => {
    const summary = summarizeMailReadReceipts(receipts, null);
    expect(summary.viewerReadAtMs).toBeNull();
    expect(summary.teammateReceipts).toHaveLength(3);
  });

  it("formats zero, one, and many teammate counts distinctly", () => {
    expect(formatReadReceiptLabel({ viewerReadAtMs: null, teammateReceipts: [] })).toBe("");
    expect(formatReadReceiptLabel({ viewerReadAtMs: 1, teammateReceipts: [] })).toBe("You've read this");
    expect(formatReadReceiptLabel({ viewerReadAtMs: null, teammateReceipts: [{ userId: "u2", readAtMs: 1 }] })).toBe(
      "1 teammate has also read this",
    );
    expect(
      formatReadReceiptLabel({
        viewerReadAtMs: 1,
        teammateReceipts: [{ userId: "u2", readAtMs: 1 }, { userId: "u3", readAtMs: 2 }],
      }),
    ).toBe("You've read this · 2 teammates have also read this");
  });
});

describe("deriveAvailablePurgeScopes", () => {
  it("always includes message scope", () => {
    expect(deriveAvailablePurgeScopes({ reservationId: null, guestId: null })).toEqual(["message"]);
  });

  it("adds reservation scope only when a reservation id resolved", () => {
    expect(deriveAvailablePurgeScopes({ reservationId: "RES-1", guestId: null })).toEqual(["message", "reservation"]);
  });

  it("adds guest scope only when a guest id is present", () => {
    expect(deriveAvailablePurgeScopes({ reservationId: null, guestId: "guest-1" })).toEqual(["message", "guest"]);
  });

  it("includes all three when both resolve", () => {
    expect(deriveAvailablePurgeScopes({ reservationId: "RES-1", guestId: "guest-1" })).toEqual([
      "message",
      "reservation",
      "guest",
    ]);
  });
});

describe("buildMailPurgeCopy", () => {
  it("names the message-scope consequence, never a bare 'Are you sure?'", () => {
    const copy = buildMailPurgeCopy("message", {});
    expect(copy.title.toLowerCase()).not.toMatch(/are you sure/);
    expect(copy.body).toMatch(/booking's own copy/);
    expect(copy.confirmLabel).toBe("Delete this email");
  });

  it("names the reservation id in the reservation-scope body when known", () => {
    const copy = buildMailPurgeCopy("reservation", { reservationId: "RES-42" });
    expect(copy.body).toMatch(/RES-42/);
  });

  it("discloses the guest-scope proxy nature honestly (Premise 3: 'the UI says so')", () => {
    const copy = buildMailPurgeCopy("guest", {});
    expect(copy.body).toMatch(/confirmed trips/);
    expect(copy.body).toMatch(/never reached a confirmed trip/);
  });
});

describe("mailContentStateMessage", () => {
  it("returns a distinct honest sentence for every failure kind", () => {
    const kinds = ["not_found", "unconfigured", "too_large", "decrypt_error"] as const;
    const messages = kinds.map(mailContentStateMessage);
    expect(new Set(messages).size).toBe(kinds.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });
});

describe("formatAttachmentSize", () => {
  it("formats bytes, KB, MB with sensible precision", () => {
    expect(formatAttachmentSize(0)).toBe("0 B");
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatAttachmentSize(5_242_880)).toBe("5.0 MB");
  });

  it("labels a negative or non-finite size honestly instead of crashing", () => {
    expect(formatAttachmentSize(-1)).toBe("Unknown size");
    expect(formatAttachmentSize(Number.NaN)).toBe("Unknown size");
  });
});

describe("attachmentDisplayName", () => {
  it("falls back to a generic label for a missing or blank filename", () => {
    expect(attachmentDisplayName(null)).toBe("Attachment");
    expect(attachmentDisplayName("  ")).toBe("Attachment");
    expect(attachmentDisplayName("receipt.pdf")).toBe("receipt.pdf");
  });
});
