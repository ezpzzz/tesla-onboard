"use client";

/**
 * /owner/mail/[id] detail surface (T13/T14, design doc
 * alex-email-inbox-design-20260817-123909.md). Renders the sandboxed full
 * email (MailContentFrame.tsx, T12) plus everything around it this build
 * adds: attachment downloads, candidate/trip cross-links, per-mechanism
 * trust chips, read-receipt recording + display, and the purge action.
 *
 * Read-receipt recording (T14): fires once per mount, right after the
 * message metadata resolves -- "opening the detail page" is the read event,
 * independent of whether the full content decrypts successfully (a manager
 * who opened a message that came back `too_large`/`decrypt_error` still
 * read *this message*, in the sense the receipt tracks: they looked at it).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCandidateReservationId,
  fetchMailMessage,
  fetchMailMessageTrust,
  fetchMailReadReceipts,
  purgeMail,
  recordMailRead,
} from "@/lib/owner/mail-repository";
import { fetchMailContent, mailAttachmentDownloadUrl, type MailContentFetchState } from "@/lib/owner/mail-content-client";
import {
  attachmentDisplayName,
  buildMailPurgeCopy,
  deriveAvailablePurgeScopes,
  deriveMailTrustChips,
  formatAttachmentSize,
  formatReadReceiptLabel,
  mailContentStateMessage,
  summarizeMailReadReceipts,
  type MailPurgeScope,
  type MailTrustAuth,
} from "./mail-detail-view";
import { deriveMailLinkChip, formatMailListDate, formatMailSender, type MailListItem } from "./mail-list-view";
import { MailContentFrame } from "./MailContentFrame";
import { Badge, Button, Card, cn } from "@/components/ui";
import { EmptyState } from "./owner-ui";
import { StatePanel } from "@/components/evhost-ui";
import { IconDownload } from "@/components/icons";

export function OwnerMailDetail({ messageId }: { messageId: string }) {
  const { workspace } = useOwnerTenant();
  // Memoized (not recomputed fresh every render) so downstream hooks that
  // depend on the `scope` object identity itself (refreshReceipts below)
  // don't re-fire on every unrelated re-render -- vehicleWorkspaceScope()
  // returns a brand-new object per call otherwise, matching OwnerMailList.tsx's
  // own scope memoization.
  const scope = useMemo(() => vehicleWorkspaceScope(workspace?.tenantRef), [workspace?.tenantRef]);

  const [userId, setUserId] = useState<string | null>(null);
  const [meta, setMeta] = useState<MailListItem | null>(null);
  const [metaStatus, setMetaStatus] = useState<"loading" | "loaded" | "not_found" | "error">("loading");
  const [content, setContent] = useState<MailContentFetchState>({ kind: "loading" });
  const [trust, setTrust] = useState<MailTrustAuth | null>(null);
  const [receipts, setReceipts] = useState<{ userId: string; readAtMs: number }[]>([]);
  const [reservationId, setReservationId] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) { setMetaStatus("error"); return; }
    let cancelled = false;
    setMetaStatus("loading");
    fetchMailMessage(scope, messageId)
      .then((row) => {
        if (cancelled) return;
        setMeta(row);
        setMetaStatus(row ? "loaded" : "not_found");
      })
      .catch(() => { if (!cancelled) setMetaStatus("error"); });
    createClient().auth.getUser().then(({ data }) => { if (!cancelled) setUserId(data.user?.id ?? null); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [scope?.key, messageId]);

  useEffect(() => {
    if (!scope) { setContent({ kind: "unconfigured" }); return; }
    let cancelled = false;
    fetchMailContent(scope.workspaceId, messageId).then((state) => { if (!cancelled) setContent(state); });
    return () => { cancelled = true; };
  }, [scope?.key, messageId]);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    fetchMailMessageTrust(scope, messageId).then((result) => { if (!cancelled) setTrust(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [scope?.key, messageId]);

  const refreshReceipts = useCallback(() => {
    if (!scope) return;
    fetchMailReadReceipts(scope, messageId).then(setReceipts).catch(() => undefined);
  }, [scope, messageId]);

  useEffect(() => { refreshReceipts(); }, [refreshReceipts]);

  // Record the read receipt once metadata confirms the message exists --
  // fires at most once per mount (guarded by metaStatus reaching "loaded").
  useEffect(() => {
    if (!scope || metaStatus !== "loaded") return;
    recordMailRead(scope, messageId).then(refreshReceipts).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per (scope, message), not on every refreshReceipts identity change.
  }, [scope?.key, messageId, metaStatus]);

  useEffect(() => {
    if (!scope || !meta?.candidateId) { setReservationId(null); return; }
    let cancelled = false;
    fetchCandidateReservationId(scope, meta.candidateId).then((id) => { if (!cancelled) setReservationId(id); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [scope?.key, meta?.candidateId]);

  if (metaStatus === "loading") {
    return <Card className="p-6 text-center text-sm text-muted">Loading message…</Card>;
  }
  if (metaStatus === "not_found") {
    return (
      <EmptyState title="Message not found." detail="It may have been purged, or the link belongs to a different workspace.">
        <Link href="/owner/mail" className="text-sm font-medium text-brand hover:underline">Back to mail</Link>
      </EmptyState>
    );
  }
  if (metaStatus === "error" || !meta) {
    return <StatePanel tone="danger" title="Mail couldn't be loaded." detail="Try again shortly." />;
  }

  const linkChip = deriveMailLinkChip(meta);
  const receiptSummary = summarizeMailReadReceipts(receipts, userId);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link href="/owner/mail" className="text-xs font-medium text-muted hover:text-ink">← Mail</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {content.kind === "content" ? content.subject || meta.subject : meta.subject}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {formatMailSender(content.kind === "content" ? content.sender || meta.sender : meta.sender)} · {formatMailListDate(meta.sentAtMs)}
            </p>
          </div>
          {linkChip ? (
            linkChip.href ? (
              <Link href={linkChip.href}><Badge tone="brand">{linkChip.label}</Badge></Link>
            ) : (
              <Badge tone="brand">{linkChip.label}</Badge>
            )
          ) : null}
        </div>
      </div>

      {trust ? <TrustChipRow trust={trust} /> : null}

      {content.kind === "loading" ? (
        <Card className="p-6 text-center text-sm text-muted">Loading content…</Card>
      ) : content.kind === "content" ? (
        <MailContentFrame html={content.html} text={content.text} inline={content.inline} />
      ) : content.kind === "unauthorized" ? (
        <StatePanel tone="danger" title="Your owner session expired." detail="Sign in again to view this message." />
      ) : (
        <StatePanel tone="neutral" title="Content unavailable" detail={mailContentStateMessage(content.kind === "error" ? "decrypt_error" : content.kind)} />
      )}

      {content.kind === "content" && content.attachments.length > 0 ? (
        <Card className="p-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Attachments</div>
          <ul className="mt-3 space-y-2">
            {content.attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-white p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{attachmentDisplayName(attachment.filename)}</span>
                <span className="shrink-0 text-xs text-muted">{formatAttachmentSize(attachment.sizeBytes)}</span>
                <a
                  href={mailAttachmentDownloadUrl(scope?.workspaceId ?? "", meta.id, attachment.id)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-line px-3 text-sm font-medium text-brand hover:bg-surface"
                >
                  <IconDownload className="h-4 w-4" aria-hidden="true" /> Download
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-muted">{formatReadReceiptLabel(receiptSummary) || "Not read by anyone on your team yet."}</p>

      <MailPurgePanel
        scope={scope}
        messageId={meta.id}
        inboundEmailId={meta.inboundEmailId}
        guestId={meta.guestId}
        reservationId={reservationId}
      />
    </div>
  );
}

function TrustChipRow({ trust }: { trust: MailTrustAuth }) {
  const chips = deriveMailTrustChips(trust);
  return (
    <div className="flex flex-wrap gap-2" aria-label="Sender authentication">
      {chips.map((chip) => (
        <Badge key={chip.label} tone={chip.tone === "good" ? "good" : chip.tone === "danger" ? "danger" : "neutral"}>
          {chip.label} {chip.status === "pass" ? "✓" : chip.status === "fail" ? "✗" : "unknown"}
        </Badge>
      ))}
    </div>
  );
}

function MailPurgePanel({
  scope,
  messageId,
  inboundEmailId,
  guestId,
  reservationId,
}: {
  scope: ReturnType<typeof vehicleWorkspaceScope>;
  messageId: string;
  inboundEmailId: string;
  guestId: string | null;
  reservationId: string | null;
}) {
  const availableScopes = deriveAvailablePurgeScopes({ reservationId, guestId });
  const [purgeScope, setPurgeScope] = useState<MailPurgeScope>("message");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);

  if (!scope) return null;

  if (done) {
    return (
      <StatePanel
        tone="neutral"
        title="Deleted."
        detail="This email's content, attachments, and search index entry are gone."
        action={<Link href="/owner/mail" className="text-sm font-medium text-brand hover:underline">Back to mail</Link>}
      />
    );
  }

  async function handleConfirm() {
    if (!confirming) { setConfirming(true); setError(null); return; }
    setBusy(true);
    setError(null);
    try {
      await purgeMail(
        scope!,
        purgeScope,
        { inboundEmailId, reservationId: reservationId ?? undefined, guestId: guestId ?? undefined },
      );
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The delete request failed.");
    } finally {
      setBusy(false);
    }
  }

  const copy = buildMailPurgeCopy(purgeScope, { reservationId });

  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Delete captured mail</div>
      <p role="status" aria-live="polite" className="sr-only">
        {confirming ? `Confirm: ${copy.title}. ${copy.body}` : ""}
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-danger/20 bg-danger/[0.04] p-3 text-sm text-danger">{error}</p>
      ) : null}
      {availableScopes.length > 1 && !confirming ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {availableScopes.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPurgeScope(value)}
              aria-pressed={purgeScope === value}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium",
                purgeScope === value ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-ink-soft",
              )}
            >
              {value === "message" ? "This email only" : value === "reservation" ? "This reservation" : "This guest"}
            </button>
          ))}
        </div>
      ) : null}
      {confirming ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-soft">{copy.body}</p>
          <div className="flex gap-2">
            <Button ref={confirmRef} variant="secondary" onClick={() => void handleConfirm()} disabled={busy}>
              {busy ? "Deleting…" : copy.confirmLabel}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void handleConfirm()}>{copy.confirmLabel}</Button>
        </div>
      )}
    </Card>
  );
}
