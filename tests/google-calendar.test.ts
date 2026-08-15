import { describe, expect, it } from "vitest";
import { normalizeGoogleCalendarEvent } from "@/lib/owner/google-calendar";

describe("Google Calendar candidate normalization", () => {
  it("normalizes a timed recurring instance without interpreting guest identity", () => {
    expect(normalizeGoogleCalendarEvent({
      id: "event-1",
      iCalUID: "uid@example.test",
      recurringEventId: "series-1",
      originalStartTime: { dateTime: "2026-09-01T16:00:00-07:00" },
      summary: "  Smith rental\u0000  ",
      status: "confirmed",
      updated: "2026-08-14T18:00:00Z",
      start: { dateTime: "2026-09-01T16:00:00-07:00", timeZone: "America/Phoenix" },
      end: { dateTime: "2026-09-03T10:00:00-07:00", timeZone: "America/Phoenix" },
      attendees: [{ email: "guest@example.com" }],
      description: "contains provider data we do not persist",
    })).toEqual({
      externalEventId: "event-1",
      externalIcalUid: "uid@example.test",
      recurringInstanceKey: "series-1:2026-09-01T16:00:00-07:00",
      summary: "Smith rental",
      location: null,
      startsAt: "2026-09-01T23:00:00.000Z",
      endsAt: "2026-09-03T17:00:00.000Z",
      timezone: "America/Phoenix",
      sourceUpdatedAt: "2026-08-14T18:00:00.000Z",
      sourceRevision: null,
      status: "pending",
      deletedAt: null,
    });
  });

  it("marks a cancelled timed event while rejecting ambiguous all-day events", () => {
    expect(normalizeGoogleCalendarEvent({
      id: "event-2",
      status: "cancelled",
      start: { dateTime: "2026-09-01T16:00:00Z" },
      end: { dateTime: "2026-09-01T17:00:00Z" },
    })?.status).toBe("cancelled");
    expect(normalizeGoogleCalendarEvent({
      id: "all-day",
      start: { date: "2026-09-01" },
      end: { date: "2026-09-02" },
    })).toBeNull();
  });

  it("rejects malformed and backwards event windows", () => {
    expect(normalizeGoogleCalendarEvent({ id: "bad" })).toBeNull();
    expect(normalizeGoogleCalendarEvent({
      id: "backwards",
      start: { dateTime: "2026-09-02T12:00:00Z" },
      end: { dateTime: "2026-09-01T12:00:00Z" },
    })).toBeNull();
  });
});
