import { createHash } from "node:crypto";
import type { EmailCandidateEvent, NormalizedEmailManifest } from "@evhost/email-ingest-contract";

export interface ParsedTuroCandidate {
  eventType: EmailCandidateEvent;
  reservationId: string | null;
  occurredAt: string;
  proposedState: Record<string, string>;
  blockerCodes: string[];
  templateFingerprint: string;
}

const RESERVATION_PATTERNS = [
  /\/reservation\/(\d{5,20})(?:\/|\b)/i,
  /\breservation(?:\s+(?:id|number)|\s*#)?\s*[:#]?\s*(\d{5,20})\b/i,
];

function eventType(subject: string): EmailCandidateEvent {
  const value = subject.toLowerCase();
  if (/\b(cancelled|canceled)\b/.test(value)) return "cancellation";
  if (/\b(changed|updated|change to)\b/.test(value)) return "change";
  if (/\b(is booked|trip booked|booked!)\b/.test(value)) return "booking";
  if (/\b(sent you a message|new message)\b/.test(value)) return "guest_message";
  if (/earnings|reimbursement|rated their trip|receipt|invoice/.test(value)) return "noise";
  return "unknown";
}

function fingerprint(subject: string): string {
  const shape = subject.toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, "<email>")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(`turo-subject-v1\u001f${shape}`).digest("hex");
}

export function parseTuroEmail(
  email: NormalizedEmailManifest,
  approvedFingerprints: ReadonlySet<string> = new Set(),
): ParsedTuroCandidate {
  const combined = `${email.subject}\n${email.text}\n${email.html ?? ""}`;
  const reservationId = RESERVATION_PATTERNS.map((pattern) => pattern.exec(combined)?.[1]).find(Boolean) ?? null;
  const type = eventType(email.subject);
  const templateFingerprint = fingerprint(email.subject);
  const blockerCodes = new Set<string>();
  if (!approvedFingerprints.has(templateFingerprint)) blockerCodes.add("template_not_allowlisted");
  if (!reservationId && !["noise", "unknown"].includes(type)) blockerCodes.add("reservation_id_missing");
  if (email.receiverAuth.dmarc !== "pass" && email.receiverAuth.dkim !== "pass") blockerCodes.add("sender_auth_unverified");
  if (type === "unknown") blockerCodes.add("event_type_unknown");
  return {
    eventType: type,
    reservationId,
    occurredAt: email.date && Number.isFinite(Date.parse(email.date)) ? new Date(email.date).toISOString() : new Date(0).toISOString(),
    proposedState: { subject: email.subject, sender: email.from },
    blockerCodes: [...blockerCodes],
    templateFingerprint,
  };
}

export function approvedTuroTemplateFingerprints(raw = process.env.EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS ?? ""): ReadonlySet<string> {
  return new Set(raw.split(",").map((value) => value.trim().toLowerCase()).filter((value) => /^[0-9a-f]{64}$/.test(value)));
}
