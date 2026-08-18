/**
 * Pure view-model derivations for the /owner/mail/[id] detail surface (T13/
 * T14, design doc alex-email-inbox-design-20260817-123909.md). No I/O -- see
 * lib/owner/mail-repository.ts for the RPC calls and components/owner/
 * OwnerMailDetail.tsx for the presentational half. Vitest-testable without
 * jsdom (node-only), same split as components/owner/ledger-view.ts.
 */

/* ── Trust chips (T14) ────────────────────────────────────────────────────
 * Each mechanism is independently `boolean | null` on
 * private.onlyevs_email_message_index -- populated at parse for new mail,
 * derived during index_backfill for already-captured mail, and legitimately
 * unknown for anything indexed before either writer ran. `null` renders as
 * "unknown", never coerced to fail -- a receiver-auth signal the pipeline
 * hasn't computed yet is not the same claim as one that failed. */

export type MailTrustStatus = "pass" | "fail" | "unknown";

export interface MailTrustChip {
  label: string;
  status: MailTrustStatus;
  tone: "good" | "danger" | "neutral";
}

export interface MailTrustAuth {
  dkimPass: boolean | null;
  spfPass: boolean | null;
  dmarcPass: boolean | null;
  fromDomainAligned: boolean | null;
}

function trustChip(label: string, value: boolean | null): MailTrustChip {
  if (value === true) return { label, status: "pass", tone: "good" };
  if (value === false) return { label, status: "fail", tone: "danger" };
  return { label, status: "unknown", tone: "neutral" };
}

export function deriveMailTrustChips(auth: MailTrustAuth): MailTrustChip[] {
  return [
    trustChip("DKIM", auth.dkimPass),
    trustChip("SPF", auth.spfPass),
    trustChip("DMARC", auth.dmarcPass),
    trustChip("From turo.com", auth.fromDomainAligned),
  ];
}

/* ── Read receipts (T14) ──────────────────────────────────────────────────
 * Audit-visible to every workspace manager (decided during spec review, not
 * an open question) -- get_onlyevs_email_read_receipts returns every user's
 * receipt, not just the caller's own. */

export interface MailReadReceipt {
  userId: string;
  readAtMs: number;
}

export interface MailReadReceiptSummary {
  /** This viewer's own read time, or null if they haven't opened it (should
   * be rare once recordMailRead fires on open, but the read can still be
   * mid-flight or have failed). */
  viewerReadAtMs: number | null;
  /** Every other workspace member's read time, most recent first. */
  teammateReceipts: MailReadReceipt[];
}

export function summarizeMailReadReceipts(
  receipts: MailReadReceipt[],
  viewerUserId: string | null,
): MailReadReceiptSummary {
  const viewer = viewerUserId ? receipts.find((r) => r.userId === viewerUserId) ?? null : null;
  const teammates = receipts
    .filter((r) => r.userId !== viewerUserId)
    .slice()
    .sort((a, b) => b.readAtMs - a.readAtMs);
  return { viewerReadAtMs: viewer?.readAtMs ?? null, teammateReceipts: teammates };
}

export function formatReadReceiptLabel(summary: MailReadReceiptSummary): string {
  const parts: string[] = [];
  if (summary.viewerReadAtMs !== null) parts.push("You've read this");
  if (summary.teammateReceipts.length === 1) parts.push("1 teammate has also read this");
  else if (summary.teammateReceipts.length > 1) parts.push(`${summary.teammateReceipts.length} teammates have also read this`);
  return parts.join(" · ");
}

/* ── Purge (T13, design doc Premise 3) ────────────────────────────────────
 * "message" is always available. "reservation"/"guest" only appear once the
 * caller has resolved the id each scope needs -- deriveAvailablePurgeScopes
 * never guesses one from a candidate/trip id alone. Guest-scoped purge is
 * NOT an exact guest-content match for captured-but-unconfirmed mail (see
 * purge_onlyevs_email_guest's own comment,
 * supabase/migrations/20260817140000_onlyevs_workspace_mail.sql) -- the copy
 * below says so explicitly, per Premise 3's "the UI says so" requirement. */

export type MailPurgeScope = "message" | "reservation" | "guest";

export interface MailPurgeCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

export function deriveAvailablePurgeScopes(opts: {
  reservationId: string | null;
  guestId: string | null;
}): MailPurgeScope[] {
  const scopes: MailPurgeScope[] = ["message"];
  if (opts.reservationId) scopes.push("reservation");
  if (opts.guestId) scopes.push("guest");
  return scopes;
}

export function buildMailPurgeCopy(scope: MailPurgeScope, opts: { reservationId?: string | null }): MailPurgeCopy {
  switch (scope) {
    case "message":
      return {
        title: "Delete this email",
        body: "Deletes this message's full content, attachments, and search index row. If it's linked to a booking, the booking's own copy of the message text is scrubbed too -- the booking record and its other facts stay intact. This cannot be undone.",
        confirmLabel: "Delete this email",
      };
    case "reservation":
      return {
        title: "Delete every email for this reservation",
        body: `Deletes the full content and attachments of every captured email tied to reservation ${opts.reservationId ?? "this reservation"}${opts.reservationId ? "" : " (id unavailable)"} -- not just this one. This cannot be undone.`,
        confirmLabel: "Delete reservation's emails",
      };
    case "guest":
      return {
        title: "Delete every email linked to this guest",
        body: "Deletes every captured email already linked to this guest's confirmed trips (by guest, trip, or a shared reservation). Mail that never reached a confirmed trip has no reliable guest link and won't be found by this scope. This cannot be undone.",
        confirmLabel: "Delete guest's emails",
      };
  }
}

/* ── Content-fetch honest states (T11 read route) ─────────────────────── */

export type MailContentStateKind = "not_found" | "unconfigured" | "too_large" | "decrypt_error";

export function mailContentStateMessage(kind: MailContentStateKind): string {
  switch (kind) {
    case "not_found":
      return "This message couldn't be found. It may have been purged, or belongs to a different workspace.";
    case "unconfigured":
      return "Full email content isn't available in this environment yet.";
    case "too_large":
      return "This message is too large to open in-app. Try the attachment list below or reach it another way.";
    case "decrypt_error":
      return "This message's content couldn't be decrypted right now. Try again shortly.";
  }
}

/* ── Attachments ──────────────────────────────────────────────────────── */

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes === 0) return "0 B";
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${SIZE_UNITS[unitIndex]}`;
}

export function attachmentDisplayName(filename: string | null): string {
  const trimmed = filename?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Attachment";
}
