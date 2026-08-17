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

/**
 * Resolved IANA time zone for the reservation's linked vehicle, threaded in by the
 * caller. This module never queries a database or looks up a vehicle itself — the
 * saga executor (services/onlyevs-worker) owns that lookup and passes the result (or
 * null when nothing resolves) immediately before parsing. See the "Timezone strategy
 * decision" section of docs/specs/2026-08-16-executor-build-spec.md: as of this build,
 * `public.onlyevs_vehicles` carries no location/timezone column at all (confirmed by
 * grep — no column was invented for this), so callers pass `null`/omit until that data
 * exists. Passing nothing must never silently fall back to UTC or server-local time.
 */
export interface ParseTuroEmailOptions {
  vehicleTimeZone?: string | null;
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

// ---------------------------------------------------------------------------
// HTML-only enrichment
//
// Every field below is grounded directly against real (unmodified, never
// committed) Turo .eml captures in .turo-email-examples/ — see the "Verified
// extraction facts" section of docs/specs/2026-08-16-executor-build-spec.md.
// All of it is extracted from `email.html`/`email.text` content, i.e. the
// DKIM body-hash-covered parts of the message — never from the custom
// `Driver-ID`/`Reservation-ID`/`Notification-Name` headers, which the DKIM
// `h=` verdict in that spec confirms are NOT covered by either signature and
// so are not cryptographically bound to the message.
// ---------------------------------------------------------------------------

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x2019;|&rsquo;/gi, "’")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Guest avatar + display first name. Avatar CDN paths are stable:
 * `https://images.turo.com/media/driver/<opaque-id>.300x300.jpg`. Vehicle
 * photos live under a sibling path, `/media/vehicle/images/...` — matching on
 * `/media/driver/` specifically is required so a vehicle photo is never
 * mistaken for the guest's avatar.
 */
function extractGuestAvatar(html: string): { avatarUrl: string; firstName: string } | null {
  const imgTag = /<img\b[^>]*\bsrc=(["'])(https:\/\/images\.turo\.com\/media\/driver\/[^"']+)\1[^>]*>/i.exec(html);
  if (!imgTag) return null;
  const altMatch = /\balt=(["'])(.*?)\1/i.exec(imgTag[0]);
  return { avatarUrl: imgTag[2], firstName: altMatch ? decodeHtmlEntities(altMatch[2]).trim() : "" };
}

/** Phone is `tel:` in E.164 on the guest's contact link; the display text next to it
 * is a formatted, non-canonical string and is never the extraction source. */
function extractGuestPhoneE164(html: string): string | null {
  const match = /href=(["'])tel:(\+\d{7,15})\1/i.exec(html);
  return match ? match[2] : null;
}

/**
 * The guest's own Turo driver-profile id, parsed from a body link
 * (`turo.com/us/en/drivers/<id>`), not from the untrusted `Driver-ID` header
 * (which, per the DKIM verdict, is host/account-scoped and not guest-specific
 * anyway — it is identical across every fixture regardless of guest).
 */
function extractGuestDriverId(html: string, text: string): string | null {
  const match = /turo\.com\/(?:us\/en\/)?drivers\/(\d{3,20})/i.exec(`${html}\n${text}`);
  return match ? match[1] : null;
}

/** `<a href=".../car-rental/.../tesla/model-3/...">Tesla Model 3<span>2024</span></a>` */
function extractVehicle(html: string): { name: string; year: string } | null {
  const match = /<a\b[^>]*href=(["'])[^"']*\/car-rental\/[^"']*\1[^>]*>\s*([^<]+?)\s*<span>(\d{4})<\/span>/i.exec(html);
  return match ? { name: decodeHtmlEntities(match[2]).trim(), year: match[3] } : null;
}

/**
 * GPS is embedded as a Google Static Maps URL inside a `content: url(...)` CSS
 * rule keyed to `.map-image-link img` (a print/retina-density override, not
 * the visible `<img>` itself — the visible tag carries the same URL, but the
 * CSS rule is the stable, template-level anchor per the evidence doc).
 */
function extractPickupGps(html: string): { lat: string; lng: string; staticMapUrl: string } | null {
  const cssMatch = /\.map-image-link\s+img\s*\{[^}]*content:\s*url\((["']?)(https?:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?[^"')]+)\1\)/i.exec(html);
  if (!cssMatch) return null;
  const staticMapUrl = cssMatch[2];
  const centerMatch = /[?&]center=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i.exec(staticMapUrl);
  return centerMatch ? { lat: centerMatch[1], lng: centerMatch[2], staticMapUrl } : null;
}

/** The address lines sit in a table cell inside the anchor that follows the
 * "Location" section label — same trip-detail partial the map link lives in. */
function extractPickupAddress(html: string): string | null {
  const match = />Location<\/div>[\s\S]*?<a\b[^>]*href=(["'])[^"']*maps\.google\.com[^"']*\1[^>]*>[\s\S]*?<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (!match) return null;
  const lines = match[2].split(/<br\s*\/?>/i).map((line) => stripTags(line)).filter(Boolean);
  return lines.length ? lines.join(", ") : null;
}

/**
 * The guest's own message text is the innerText of `<td class="message_box_blurple">`.
 * The other two color variants (`message_box_green`/`message_box_purple`) are unrelated
 * shared CSS, not guest-message content in this template, and must never be read.
 */
function extractGuestMessageText(html: string): string | null {
  const match = /<td\b[^>]*\bclass=(["'])message_box_blurple\1[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (!match) return null;
  const text = stripTags(match[2]);
  return text || null;
}

/** `earnings payment of $X` (PaymentSentOwner) or `you'll earn $X` (ReservationBookedOwner). */
function extractEarningsTotal(text: string, html: string | null): string | null {
  const combined = `${text}\n${html ?? ""}`;
  const match = /(?:earnings payment of|you['’]ll earn)\s*(?:<strong>)?\$([\d,]+\.\d{2})/i.exec(combined);
  return match ? match[1].replace(/,/g, "") : null;
}

// ---------------------------------------------------------------------------
// Trip-window extraction + the vehicle-location-derived timezone strategy
// ---------------------------------------------------------------------------

interface LocalDateTime { year: number; month: number; day: number; hour: number; minute: number }

function parseDateToken(dateText: string): { month: number; day: number; year: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(dateText.trim());
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return { month: Number(match[1]), day: Number(match[2]), year };
}

function parseTimeToken(timeText: string): { hour: number; minute: number } | null {
  const normalized = timeText.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
  const match = /^(\d{1,2}):(\d{2})\s*([ap]m)$/i.exec(normalized);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (/pm/i.test(match[3])) hour += 12;
  return { hour, minute: Number(match[2]) };
}

function combineLocal(dateText: string, timeText: string): LocalDateTime | null {
  const date = parseDateToken(dateText);
  const time = parseTimeToken(timeText);
  return date && time ? { year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute } : null;
}

/** The real, structured "Trip start"/"Trip end" block in the HTML body: a label
 * `<div>`, a `<strong>` date (`M/D/YY`), then a sibling `<td>` time (`H:MM am/pm`). */
function extractTripBoundaryHtml(html: string, label: "Trip start" | "Trip end"): { dateText: string; timeText: string } | null {
  const re = new RegExp(`>${label}<\\/div>[\\s\\S]*?<strong>\\s*([\\s\\S]*?)\\s*<\\/strong>[\\s\\S]*?<td[^>]*>\\s*([\\s\\S]*?)\\s*<\\/td>`, "i");
  const match = re.exec(html);
  return match ? { dateText: match[1].replace(/\s+/g, " ").trim(), timeText: match[2].replace(/\s+/g, " ").trim() } : null;
}

/** Fallback for the plain-text part, present on several real templates as a plain
 * "Trip start: M/D/YY H:MM AM" line (distinct from ReservationBookedOwner's free-text
 * "...is booked from <full date> to <full date>." sentence, which this does not parse). */
function extractTripBoundaryText(text: string, label: "Trip start" | "Trip end"): { dateText: string; timeText: string } | null {
  const re = new RegExp(`${label}:\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\s+(\\d{1,2}:\\d{2}\\s*[ap]m)`, "i");
  const match = re.exec(text.replace(/[  ]/g, " "));
  return match ? { dateText: match[1], timeText: match[2] } : null;
}

function extractTripWindow(email: NormalizedEmailManifest): { start: LocalDateTime; end: LocalDateTime; startText: string; endText: string } | null {
  const html = email.html ?? "";
  const startRaw = extractTripBoundaryHtml(html, "Trip start") ?? extractTripBoundaryText(email.text, "Trip start");
  const endRaw = extractTripBoundaryHtml(html, "Trip end") ?? extractTripBoundaryText(email.text, "Trip end");
  if (!startRaw || !endRaw) return null;
  const start = combineLocal(startRaw.dateText, startRaw.timeText);
  const end = combineLocal(endRaw.dateText, endRaw.timeText);
  if (!start || !end) return null;
  return { start, end, startText: `${startRaw.dateText} ${startRaw.timeText}`, endText: `${endRaw.dateText} ${endRaw.timeText}` };
}

/** Zone offset (minutes to add to UTC to get local wall-clock) in effect at `utcMs`. */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - utcMs) / 60_000);
}

export type TripInstantResolution =
  | { kind: "resolved"; utcMs: number }
  | { kind: "gap" }
  | { kind: "fold" };

const DST_BRACKET_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Resolves a bare local wall-clock time in `timeZone` to a real UTC instant, refusing
 * to guess when the local time is ambiguous. `local`'s numbers are interpreted purely
 * as an axis for bracket-sampling (not as if they were already UTC) so this stays
 * correct for zones with large offsets, not just US-style ones.
 *
 * - "gap": the local time never occurred (spring-forward) — no valid instant.
 * - "fold": the local time occurred twice (fall-back) — two valid, distinct instants.
 * - "resolved": exactly one valid instant.
 */
export function resolveLocalInstant(local: LocalDateTime, timeZone: string): TripInstantResolution {
  const naiveUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  const roughOffset = zoneOffsetMinutes(naiveUtc, timeZone);
  const approxUtc = naiveUtc - roughOffset * 60_000;
  const candidateOffsets = new Set([
    roughOffset,
    zoneOffsetMinutes(approxUtc - DST_BRACKET_WINDOW_MS, timeZone),
    zoneOffsetMinutes(approxUtc + DST_BRACKET_WINDOW_MS, timeZone),
  ]);
  const validUtcInstants = new Set<number>();
  for (const offset of candidateOffsets) {
    const candidateUtc = naiveUtc - offset * 60_000;
    if (zoneOffsetMinutes(candidateUtc, timeZone) === offset) validUtcInstants.add(candidateUtc);
  }
  if (validUtcInstants.size === 0) return { kind: "gap" };
  if (validUtcInstants.size > 1) return { kind: "fold" };
  return { kind: "resolved", utcMs: [...validUtcInstants][0] };
}

// ---------------------------------------------------------------------------
// Full-message text -- the readable "subject + body" fallback carried on
// *every* candidate, unknown-template included. Without this, a candidate
// whose subject doesn't match any known Turo template (`eventType()` above
// falls through to "unknown") gets no template-specific extraction at all —
// proposedState held only `subject`/`sender` (~80 bytes) and the owner inbox
// card had nothing to show but metadata, even for a message the owner
// actually needs to read (e.g. Turo's "Please verify your email address"
// notice, which carries a verification link only in the body). Known types
// keep their richer structured extraction above; this is additive, not a
// replacement for it.
// ---------------------------------------------------------------------------

/** Hard cap on the combined subject+body text stored in proposedState.messageText,
 * matching the executor spec's "sane bound" -- generous enough for any real Turo
 * template while keeping a single jsonb value bounded regardless of what an inbound
 * message contains. */
export const MESSAGE_TEXT_MAX_CHARS = 20_000;

/**
 * Best-effort HTML → readable plain text: a simple tag-strip, not a full HTML
 * renderer. Block-level tags become line breaks first (so paragraphs/list items/table
 * rows don't run together into one unreadable line) before the remaining markup is
 * discarded and entities are decoded. Only used when the message has no `text` part
 * to fall back on.
 */
function htmlToReadableText(html: string): string {
  const withBreaks = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Subject + plain-text body for every candidate. Prefers the message's own `text`
 * part (already plain text per the email-ingest contract); falls back to stripping
 * tags from `html` only when no text part was captured. Returns null when there's
 * nothing readable at all (no subject-less email exists, but text/html can both be
 * empty), matching every other optional proposedState field's "omit rather than
 * write an empty string" convention.
 */
function buildMessageText(email: NormalizedEmailManifest): string | null {
  const body = email.text.trim().length > 0
    ? email.text.trim()
    : email.html
      ? htmlToReadableText(email.html)
      : "";
  if (!body && !email.subject.trim()) return null;
  const combined = `Subject: ${email.subject}\n\n${body}`.trim();
  return combined.length > MESSAGE_TEXT_MAX_CHARS
    ? `${combined.slice(0, MESSAGE_TEXT_MAX_CHARS)}…`
    : combined;
}

/**
 * Domain of a From-header address, tolerating both a bare address
 * ("noreply@mail.turo.com") and a display-name form
 * ("Turo <noreply@mail.turo.com>"). services/email-ingest-worker/src/normalize.ts
 * already reduces `from` to a bare address in production (it reads the parsed
 * `.address` field, falling back to the envelope address), but
 * NormalizedEmailManifest types `from` as a plain `string` with no guarantee
 * baked into the type, and fixtures/tests use the display-name form -- so this
 * stays tolerant of both rather than assuming the upstream shape.
 */
function fromDomain(from: string): string | null {
  const bracketMatch = /<([^>]+)>\s*$/.exec(from);
  const address = (bracketMatch ? bracketMatch[1] : from).trim();
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return null;
  return address.slice(at + 1).trim().toLowerCase();
}

/** turo.com itself, or any subdomain of it (suffix match on ".turo.com"). */
function isTuroSenderDomain(domain: string | null): boolean {
  if (!domain) return false;
  return domain === "turo.com" || domain.endsWith(".turo.com");
}

export function parseTuroEmail(
  email: NormalizedEmailManifest,
  approvedFingerprints: ReadonlySet<string> = new Set(),
  options: ParseTuroEmailOptions = {},
): ParsedTuroCandidate {
  const combined = `${email.subject}\n${email.text}\n${email.html ?? ""}`;
  const reservationId = RESERVATION_PATTERNS.map((pattern) => pattern.exec(combined)?.[1]).find(Boolean) ?? null;
  const type = eventType(email.subject);
  const templateFingerprint = fingerprint(email.subject);
  const blockerCodes = new Set<string>();
  if (!approvedFingerprints.has(templateFingerprint)) blockerCodes.add("template_not_allowlisted");
  if (!reservationId && !["noise", "unknown"].includes(type)) blockerCodes.add("reservation_id_missing");
  // DMARC-aligned From-domain binding: the visible From header is only as
  // trustworthy as the domain DMARC actually aligned to. A DMARC "pass"
  // alone doesn't say *which* domain passed, so this also requires the
  // visible From address to be turo.com or a turo.com subdomain -- clearing
  // the blocker for a DMARC-pass message from an unrelated domain (SPF/DKIM
  // aligned to that domain, not Turo's) would be exactly the spoofing this
  // blocker exists to catch. TODO(sender-auth): bind the literal DKIM d=
  // domain instead of/in addition to this once a real Cloudflare-origin
  // Authentication-Results header sample is captured -- NormalizedEmailManifest
  // currently only carries the boolean receiverAuth.dkim verdict, not the d=
  // value itself, so a DKIM-only path can't be domain-bound yet.
  if (email.receiverAuth.dmarc !== "pass" || !isTuroSenderDomain(fromDomain(email.from))) {
    blockerCodes.add("sender_auth_unverified");
  }
  if (type === "unknown") blockerCodes.add("event_type_unknown");

  const proposedState: Record<string, string> = { subject: email.subject, sender: email.from };
  const messageText = buildMessageText(email);
  if (messageText) proposedState.messageText = messageText;
  const html = email.html;

  // The avatar/phone/vehicle/trip-window/location partial is shared across every
  // reservation-scoped template (booking, change, cancellation, guest message) in the
  // real corpus; noise (earnings/reimbursement, account-level not reservation-scoped)
  // and unknown never carry it.
  const expectsLocation = type === "booking" || type === "change" || type === "cancellation" || type === "guest_message";

  if (html) {
    const avatar = extractGuestAvatar(html);
    if (avatar) {
      proposedState.guestAvatarUrl = avatar.avatarUrl;
      if (avatar.firstName) proposedState.guestFirstName = avatar.firstName;
    }
    const phone = extractGuestPhoneE164(html);
    if (phone) proposedState.guestPhoneE164 = phone;
    const vehicle = extractVehicle(html);
    if (vehicle) {
      proposedState.vehicleName = vehicle.name;
      proposedState.vehicleYear = vehicle.year;
    }
    const gps = extractPickupGps(html);
    if (gps) {
      proposedState.pickupLat = gps.lat;
      proposedState.pickupLng = gps.lng;
      proposedState.pickupStaticMapUrl = gps.staticMapUrl;
    }
    const address = extractPickupAddress(html);
    if (address) proposedState.pickupAddress = address;
    if (type === "guest_message") {
      const messageText = extractGuestMessageText(html);
      if (messageText) proposedState.guestMessageText = messageText;
    }
  } else if (expectsLocation) {
    // Address/GPS is HTML-only; a missing HTML part must never silently drop pickup
    // location facts a reviewer would otherwise expect to see.
    blockerCodes.add("pickup_location_unresolved");
  }

  const driverId = extractGuestDriverId(html ?? "", email.text);
  if (driverId) proposedState.guestDriverId = driverId;

  // PaymentSentOwner is unlinkable to a reservation (0/2 real samples carry
  // Reservation-ID) and must stay that way — this only ever attaches an amount to
  // proposedState, it never infers or guesses a reservationId for a "noise" candidate.
  const earnings = extractEarningsTotal(email.text, html);
  if (earnings) proposedState.earningsTotal = earnings;

  const tripWindow = extractTripWindow(email);
  if (tripWindow) {
    proposedState.tripStartLocalText = tripWindow.startText;
    proposedState.tripEndLocalText = tripWindow.endText;
    if (!options.vehicleTimeZone) {
      blockerCodes.add("trip_timezone_unresolved");
    } else {
      const start = resolveLocalInstant(tripWindow.start, options.vehicleTimeZone);
      const end = resolveLocalInstant(tripWindow.end, options.vehicleTimeZone);
      if (start.kind !== "resolved" || end.kind !== "resolved") {
        blockerCodes.add("trip_timezone_ambiguous_dst");
      } else {
        proposedState.tripStartAt = new Date(start.utcMs).toISOString();
        proposedState.tripEndAt = new Date(end.utcMs).toISOString();
        proposedState.tripTimeZone = options.vehicleTimeZone;
      }
    }
  }

  return {
    eventType: type,
    reservationId,
    occurredAt: email.date && Number.isFinite(Date.parse(email.date)) ? new Date(email.date).toISOString() : new Date(0).toISOString(),
    proposedState,
    blockerCodes: [...blockerCodes],
    templateFingerprint,
  };
}

export function approvedTuroTemplateFingerprints(raw = process.env.EVHOST_TURO_APPROVED_TEMPLATE_FINGERPRINTS ?? ""): ReadonlySet<string> {
  return new Set(raw.split(",").map((value) => value.trim().toLowerCase()).filter((value) => /^[0-9a-f]{64}$/.test(value)));
}
