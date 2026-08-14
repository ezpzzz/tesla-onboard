export interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarEvent {
  id?: string;
  iCalUID?: string;
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
  summary?: string;
  status?: string;
  updated?: string;
  etag?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  [key: string]: unknown;
}

export interface CalendarCandidateInput {
  externalEventId: string;
  externalIcalUid: string | null;
  recurringInstanceKey: string | null;
  summary: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  sourceUpdatedAt: string | null;
  sourceRevision: string | null;
  status: "pending" | "cancelled";
  deletedAt: string | null;
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function cleanSummary(value: unknown): string {
  if (typeof value !== "string") return "Untitled calendar event";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
    || "Untitled calendar event";
}

/**
 * Calendar data is untrusted scheduling input, not a booking. This adapter
 * deliberately ignores descriptions and attendees; the owner must explicitly
 * confirm the vehicle and guest identity before any trip/access grant exists.
 */
export function normalizeGoogleCalendarEvent(
  event: GoogleCalendarEvent,
): CalendarCandidateInput | null {
  if (!event.id || !event.start?.dateTime || !event.end?.dateTime) return null;
  const startsAt = normalizedDate(event.start.dateTime);
  const endsAt = normalizedDate(event.end.dateTime);
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  const original = event.originalStartTime?.dateTime ?? event.originalStartTime?.date;
  return {
    externalEventId: event.id,
    externalIcalUid: typeof event.iCalUID === "string" ? event.iCalUID : null,
    recurringInstanceKey: event.recurringEventId && original
      ? `${event.recurringEventId}:${original}`
      : null,
    summary: cleanSummary(event.summary),
    startsAt,
    endsAt,
    timezone: event.start.timeZone ?? event.end.timeZone ?? "UTC",
    sourceUpdatedAt: normalizedDate(event.updated),
    sourceRevision: typeof event.etag === "string" ? event.etag.slice(0, 500) : null,
    status: event.status === "cancelled" ? "cancelled" : "pending",
    deletedAt: event.status === "cancelled" ? new Date().toISOString() : null,
  };
}
