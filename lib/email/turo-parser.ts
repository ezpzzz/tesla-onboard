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
  // "change request" covers Turo's real ApprovedChangeRequestBookedOwner subject
  // ("You've confirmed <Name>'s change request with your Tesla Model 3"), which
  // otherwise falls through to "unknown".
  if (/\b(changed|updated|change to|change request)\b/.test(value)) return "change";
  if (/\b(is booked|trip booked|booked!)\b/.test(value)) return "booking";
  if (/\b(sent you a message|new message)\b/.test(value)) return "guest_message";
  if (/earnings|reimbursement|rated their trip|receipt|invoice/.test(value)) return "noise";
  return "unknown";
}

function fingerprint(subject: string): string {
  const shape = subject.toLowerCase()
    // Turo's real subjects embed the guest's first name directly in otherwise
    // fixed templates ("<Name>'s trip with your Tesla Model 3 is booked!",
    // "<Name> has sent you a message about your Tesla Model 3", "You've
    // confirmed <Name>'s change request with your Tesla Model 3", "<Name> has
    // been charged for your reimbursement invoice"). Without generalizing the
    // name token, every guest mints a distinct fingerprint for the same
    // template, which defeats the human-approved-per-fingerprint allowlist.
    // Replace a possessive name token anywhere it appears ("<name>'s trip...",
    // "confirmed <name>'s change request...") and a leading name token before
    // " has " ("<name> has sent...", "<name> has been charged..."). This is
    // intentionally conservative but can over-generalize on the lowercased
    // subject (e.g. a leading "tesla's ..." would also collapse to "<name>'s
    // ..."). That's acceptable: normalization only needs to be deterministic
    // and collision-safe within Turo's known template space, and a slightly
    // wider bucket is still safe because nothing is auto-approved from it —
    // every fingerprint still requires human review before entering the
    // allowlist.
    .replace(/\b[a-z][a-z'’.-]*['’]s\b/g, "<name>'s")
    .replace(/^[a-z][a-z'’.-]*(?=\s+has\s)/, "<name>")
    .replace(/\b\d+\b/g, "#")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, "<email>")
    .replace(/\s+/g, " ")
    .trim();
  // v2: adds the name-generalization pass above. Bumped so a v1 hash can
  // never be confused with a v2 hash (the allowlist env var is always empty,
  // so this bump ships with nothing to migrate).
  return createHash("sha256").update(`turo-subject-v2\u001f${shape}`).digest("hex");
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
