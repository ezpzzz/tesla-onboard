/**
 * Pure view-model derivations for the /owner/mail list surface (T13, design
 * doc alex-email-inbox-design-20260817-123909.md). No I/O -- see
 * lib/owner/mail-repository.ts for the RPC calls that produce the raw rows
 * this module shapes, and components/owner/OwnerMailList.tsx for the
 * presentational half. Vitest-testable without jsdom (this repo's Vitest
 * runs node-only) -- same split as components/owner/ledger-view.ts.
 */

export interface MailListRpcRow {
  id: string;
  inbound_email_id: string;
  subject: string;
  sender: string;
  sent_at: string;
  snippet: string;
  has_attachments: boolean;
  candidate_id: string | null;
  trip_id: string | null;
  guest_id: string | null;
  event_type: string | null;
  is_read: boolean;
}

export interface MailListItem {
  id: string;
  inboundEmailId: string;
  subject: string;
  sender: string;
  sentAtMs: number;
  snippet: string;
  hasAttachments: boolean;
  candidateId: string | null;
  tripId: string | null;
  guestId: string | null;
  eventType: string | null;
  isRead: boolean;
}

/** Snake-case RPC row -> camelCase view item. The only place this shape
 * translation happens, so list_onlyevs_email_messages,
 * list_onlyevs_email_messages_for_candidate, and
 * list_onlyevs_email_messages_for_trip (identical row shape) all funnel
 * through one mapper. */
export function mapMailListRow(row: MailListRpcRow): MailListItem {
  return {
    id: row.id,
    inboundEmailId: row.inbound_email_id,
    subject: row.subject.trim() || "(no subject)",
    sender: row.sender,
    sentAtMs: Date.parse(row.sent_at),
    snippet: row.snippet,
    hasAttachments: row.has_attachments,
    candidateId: row.candidate_id,
    tripId: row.trip_id,
    guestId: row.guest_id,
    eventType: row.event_type,
    isRead: row.is_read,
  };
}

/**
 * "noise"-classified mail is Turo's own earnings/receipt/rating chatter
 * (lib/email/turo-parser.ts's `eventType()`) -- present by design so the
 * archive is honest ("every Turo email"), but not worth defaulting into a
 * host's daily triage view. Open Question 3 (design doc), resolved: shown
 * only behind the explicit "All mail" toggle. A message with no linked
 * candidate at all (`eventType === null`) is NOT noise -- it's simply
 * uncategorized, and stays visible by default.
 */
export function isNoiseMailItem(item: Pick<MailListItem, "eventType">): boolean {
  return item.eventType === "noise";
}

export function shouldShowMailItem(item: Pick<MailListItem, "eventType">, allMail: boolean): boolean {
  return allMail || !isNoiseMailItem(item);
}

/** Tri-state UI control -> the RPC's nullable boolean filter param. */
export type LinkedFilterValue = "all" | "linked" | "unlinked";

export function resolveLinkedFilterParam(value: LinkedFilterValue): boolean | null {
  if (value === "linked") return true;
  if (value === "unlinked") return false;
  return null;
}

export interface MailLinkChip {
  label: string;
  href: string | null;
}

/**
 * One badge naming what this message is already linked to, highest-signal
 * link first (a trip is the most concrete outcome). `href` is null when no
 * safe deep link exists yet -- candidate ids don't resolve to an openable
 * Inbox card by URL, and guest ids (private.onlyevs_guests, the telemetry
 * ledger's durable identity) are a different id space than the owner
 * dashboard's Driver rows, so this never guesses a route that could 404 or
 * open the wrong record.
 */
export function deriveMailLinkChip(item: Pick<MailListItem, "tripId" | "candidateId" | "guestId">): MailLinkChip | null {
  if (item.tripId) return { label: "Linked to trip", href: `/owner/trips/${item.tripId}` };
  if (item.candidateId) return { label: "Linked to booking update", href: "/owner/inbox" };
  if (item.guestId) return { label: "Linked to guest", href: null };
  return null;
}

/** Browser-local (not UTC) on purpose -- this surface only ever renders
 * post-mount, client-fetched data (same as OwnerInbox.tsx's own inline
 * Intl.DateTimeFormat use for `occurredAt`), so there is no SSR/first-paint
 * value to keep in sync with, unlike the UTC-fixed-mock-data pages in
 * owner-ui.tsx. */
export function formatMailListDate(sentAtMs: number): string {
  if (!Number.isFinite(sentAtMs)) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(sentAtMs);
}

export interface MailListCursor {
  sentAtMs: number;
  id: string;
}

/** Next cursor from the last row of an already-sorted (sent_at desc, id asc)
 * RPC page -- null once a page comes back short of the request limit
 * (nothing left to page into) or empty. */
export function nextMailCursor(items: MailListItem[], requestedLimit: number): MailListCursor | null {
  if (items.length === 0 || items.length < requestedLimit) return null;
  const last = items[items.length - 1]!;
  return { sentAtMs: last.sentAtMs, id: last.id };
}

/** Sender label for the list row: prefer the readable address as-is (Turo's
 * sender header is already a plain email address), never truncated here --
 * the row's own CSS truncates. Present only to give the empty/blank case one
 * clear owner. */
export function formatMailSender(sender: string): string {
  return sender.trim() || "Unknown sender";
}

export function unreadCountLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 unread" : `${count} unread`;
}
